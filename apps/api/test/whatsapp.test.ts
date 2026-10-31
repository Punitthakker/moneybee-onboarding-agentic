import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, beforeAll } from 'vitest';
import { makeTestApp, CSRF } from './helpers';
import { createApp } from '../src/app';
import { WhatsAppAdapter } from '../src/channels/whatsapp/adapter';
import { createMockWhatsAppClient } from '../src/channels/whatsapp/client';
import { loadBotPolicy, sessionIdFor } from '../src/bot';

const FIX = path.resolve(__dirname, '../../../fixtures/merchants/01-sole-establishment');
const APP_SECRET = 'test-app-secret';
const VERIFY = 'test-verify-token';
const FROM = '971501112222';

const sign = (body: string) => 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex');

/** Recorded-shape Meta webhook payloads (ids and numbers are synthetic). */
let msgN = 0;
const envelope = (message: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '1234567890', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '971400000000', phone_number_id: '111222333' }, contacts: [{ profile: { name: 'Test Merchant' }, wa_id: FROM }], messages: [{ from: FROM, id: `wamid.test.${++msgN}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }],
});
const textMsg = (body: string) => envelope({ type: 'text', text: { body } });
const buttonMsg = (id: string, title = id) => envelope({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const listMsg = (id: string, title = id) => envelope({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } });
const docMsg = (mediaId: string, filename: string, mime = 'application/pdf') => envelope({ type: 'document', document: { id: mediaId, mime_type: mime, filename } });
const stickerMsg = () => envelope({ type: 'sticker', sticker: { id: 'x', mime_type: 'image/webp' } });
const statusOnly = () => ({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.x', status: 'delivered' }] } }] }] });

describe('WhatsApp Cloud API adapter', () => {
  let app: ReturnType<typeof createApp>;
  let t: Awaited<ReturnType<typeof makeTestApp>>;
  let client: ReturnType<typeof createMockWhatsAppClient>;

  beforeAll(async () => {
    t = await makeTestApp();
    client = createMockWhatsAppClient({
      'media-licence': { data: fs.readFileSync(path.join(FIX, 'trade_licence.pdf')), mime: 'application/pdf', name: 'trade_licence.pdf' },
      'media-eid': { data: fs.readFileSync(path.join(FIX, 'emirates_id.pdf')), mime: 'application/pdf', name: 'emirates_id.pdf' },
    });
    const adapter = new WhatsAppAdapter(t.ctx, t.queue, { verifyToken: VERIFY, appSecret: APP_SECRET, client, inline: true, botPolicy: loadBotPolicy(path.resolve(__dirname, '../../..')) });
    t.ctx.onBotOutbox = (id) => adapter.drainOutbox(id).then(() => undefined);
    app = createApp(t.ctx, t.queue, { whatsapp: adapter });
  });

  const post = (payload: unknown) => {
    const body = JSON.stringify(payload);
    return request(app).post('/api/v1/channels/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(body)).send(body);
  };
  const last = () => client.sent[client.sent.length - 1];

  it('completes the Meta verification handshake and rejects a bad token', async () => {
    const ok = await request(app).get('/api/v1/channels/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '424242' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('424242');
    const bad = await request(app).get('/api/v1/channels/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' });
    expect(bad.status).toBe(403);
  });

  it('rejects unsigned and badly signed webhooks', async () => {
    const body = JSON.stringify(textMsg('hi'));
    await request(app).post('/api/v1/channels/whatsapp/webhook').set('Content-Type', 'application/json').send(body).expect(401);
    await request(app).post('/api/v1/channels/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=deadbeef').send(body).expect(401);
    expect(client.sent).toHaveLength(0);
  });

  it('ignores status-only events', async () => {
    await post(statusOnly()).expect(200);
    expect(client.sent).toHaveLength(0);
  });

  it('text -> greeting with language buttons; button reply -> consent buttons; list reply works; sticker -> unsupported', async () => {
    await post(textMsg('Hello')).expect(200);
    expect(last().kind).toBe('buttons');
    expect(last().options?.map((o) => o.id)).toEqual(['en', 'ar']);
    expect(last().to).toBe(FROM);

    await post(buttonMsg('en', 'English')).expect(200);
    expect(last().kind).toBe('buttons');
    expect(last().body).toMatch(/Do you agree to continue/);
    await post(buttonMsg('agree', 'I agree')).expect(200);
    expect(last().kind).toBe('text');
    expect(last().body).toMatch(/What is your name/);
    await post(textMsg('Fatima')).expect(200);
    await post(textMsg('Fatima Trading')).expect(200);
    // 6 entity options -> rendered as a list, titles clipped to 24 chars
    expect(last().kind).toBe('list');
    expect(last().options!.every((o) => o.title.length <= 24)).toBe(true);
    await post(listMsg('sole_establishment', 'Sole Establishment')).expect(200);
    expect(last().body).toMatch(/Which emirate/);
    await post(stickerMsg()).expect(200);
    // error line, then the question is re-asked
    expect(client.sent.at(-2)?.body).toMatch(/Please pick one of the options/);
    expect(last().body).toMatch(/Which emirate/);
  });

  it('deduplicates redelivered message ids', async () => {
    const p = listMsg('Dubai');
    const before = client.sent.length;
    await post(p).expect(200);
    await post(p).expect(200);
    expect(client.sent.length).toBe(before + 1);
  });

  it('document messages are downloaded and filed; the bot reacts per document', async () => {
    // get to the documents stage quickly
    for (const [kind, id] of [['text', 'we sell dates, nuts and chocolates'], ['btn', 'yes'], ['btn', 'instore'], ['btn', 'b2c'], ['btn', 'oneoff'], ['btn', 'uae'], ['list', 'V2'], ['list', 'T1'], ['list', 'none'], ['btn', '1to3'], ['text', 'not yet'], ['list', 'none'], ['btn', 'ok'], ['btn', 'manual']] as const) {
      await post(kind === 'text' ? textMsg(id) : kind === 'btn' ? buttonMsg(id) : listMsg(id)).expect(200);
    }
    expect(last().body).toMatch(/1 of \d+: please send your \*Trade licence\*/);
    await post(docMsg('media-eid', 'eid.pdf')).expect(200);
    const texts = client.sent.slice(-2).map((x) => x.body).join('\n');
    expect(texts).toMatch(/Emirates ID of the owner or signatory received/);
    await post(docMsg('media-licence', 'licence.pdf')).expect(200);
    expect(client.sent.slice(-2).map((x) => x.body).join('\n')).toMatch(/Trade licence received/);
    const s = await t.ctx.store.botSessions.get(sessionIdFor('whatsapp', FROM));
    expect(s?.checklist?.received).toEqual(expect.arrayContaining(['emirates_id', 'trade_licence']));
    const c = await t.ctx.store.cases.get(s!.caseId!);
    expect(c?.files.length).toBe(2);
    expect(c?.ownerEmail).toBe('bot@moneybee.local');
  });

  it('a human request_info on a bot case sends the merchant message (text inside 24h, template outside)', async () => {
    // build a submitted case the fast way: reuse the sole-establishment session, fake AWAITING_REVIEW with a risk block
    const s = (await t.ctx.store.botSessions.get(sessionIdFor('whatsapp', FROM)))!;
    await t.ctx.store.cases.update(s.caseId!, (x) => {
      x.status = 'AWAITING_REVIEW';
      x.gaps = { items: [{ kind: 'missing', message: 'Bank letter missing' } as never], draftMessage: '- Bank letter or IBAN certificate\n- Ejari' };
      x.botIntake = { sessionId: s.id, channel: 'whatsapp', lang: 'en', answers: s.answers, mcc: s.mcc ?? null, prescreen: null, pricing: null, flags: { extraReview: false }, submittedAt: new Date().toISOString(), transcript: [] };
    });
    const uw = await t.login('uw@t.local');
    client.reset();
    await uw.post(`/api/v1/cases/${s.caseId}/review`).set(CSRF).send({ decision: 'request_info', notes: 'need the bank letter and ejari' }).expect(200);
    expect(last().kind).toBe('text');
    expect(last().body).toMatch(/needs a few more things to continue:\n- Bank letter or IBAN certificate/);
    const after = await t.ctx.store.botSessions.get(s.id);
    expect(after?.outbox.every((o) => o.sentAt)).toBe(true);

    // outside the 24h window: the approved template goes instead of free text
    t.clock.now = new Date(Date.now() + 30 * 3600 * 1000);
    await t.ctx.store.cases.update(s.caseId!, (x) => void (x.status = 'AWAITING_REVIEW'));
    client.reset();
    await uw.post(`/api/v1/cases/${s.caseId}/review`).set(CSRF).send({ decision: 'reject', notes: 'internal: screening concern', merchantMessage: 'We could not verify the business address.' }).expect(200);
    expect(last().kind).toBe('template');
    expect(last().template?.name).toBe('moneybee_rejected_v1');
    expect(JSON.stringify(client.sent)).not.toMatch(/screening concern/);
    const closed = await t.ctx.store.botSessions.get(s.id);
    expect(closed?.step).toBe('CLOSED_DECLINED');
    expect(closed?.outbox.at(-1)?.text).toMatch(/could not verify the business address/);
  });
});
