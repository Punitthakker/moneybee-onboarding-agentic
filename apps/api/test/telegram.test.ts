import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, beforeAll } from 'vitest';
import { makeTestApp, CSRF } from './helpers';
import { createApp } from '../src/app';
import { TelegramAdapter } from '../src/channels/telegram/adapter';
import { createMockTelegramClient, keyboardRows } from '../src/channels/telegram/client';
import { loadBotPolicy, sessionIdFor } from '../src/bot';

const FIX = path.resolve(__dirname, '../../../fixtures/merchants/02-llc');
const SECRET = 'tg-test-secret';
const CHAT = 55512345;

let upd = 1000;
const message = (chat: number, body: Record<string, unknown>) => ({ update_id: ++upd, message: { message_id: upd, from: { id: chat, is_bot: false, first_name: 'Test', language_code: 'en' }, chat: { id: chat, type: 'private' }, date: 1700000000, ...body } });
const text = (t: string, chat = CHAT) => message(chat, { text: t });
const doc = (fileId: string, name: string, mime = 'application/pdf', chat = CHAT) => message(chat, { document: { file_id: fileId, file_unique_id: 'u', file_name: name, mime_type: mime, file_size: 1234 } });
const photo = (fileId: string, chat = CHAT) => message(chat, { photo: [{ file_id: 'small', file_unique_id: 's', width: 90, height: 90, file_size: 100 }, { file_id: fileId, file_unique_id: 'l', width: 1280, height: 960, file_size: 50000 }] });
const sticker = (chat = CHAT) => message(chat, { sticker: { file_id: 'st', width: 512, height: 512, is_animated: false } });
const callback = (data: string, chat = CHAT) => ({ update_id: ++upd, callback_query: { id: `cq${upd}`, from: { id: chat, is_bot: false, first_name: 'Test' }, message: { message_id: upd - 1, chat: { id: chat, type: 'private' }, date: 1700000000 }, chat_instance: 'x', data } });

describe('Telegram Bot API adapter', () => {
  let app: ReturnType<typeof createApp>;
  let t: Awaited<ReturnType<typeof makeTestApp>>;
  let client: ReturnType<typeof createMockTelegramClient>;

  beforeAll(async () => {
    t = await makeTestApp();
    client = createMockTelegramClient({
      'f-licence': { data: fs.readFileSync(path.join(FIX, 'trade_licence.pdf')), mime: 'application/pdf', name: 'trade_licence.pdf' },
      'f-moa': { data: fs.readFileSync(path.join(FIX, 'moa.pdf')), mime: 'application/pdf', name: 'moa.pdf' },
      'f-photo': { data: Buffer.from('not really a jpeg'), mime: 'image/jpeg', name: 'photo.jpg' },
    });
    const adapter = new TelegramAdapter(t.ctx, t.queue, { webhookSecret: SECRET, client, inline: true, botPolicy: loadBotPolicy(path.resolve(__dirname, '../../..')) });
    t.ctx.onBotOutbox = (id) => adapter.drainOutbox(id).then(() => undefined);
    app = createApp(t.ctx, t.queue, { telegram: adapter });
  });

  const post = (payload: object, secret = SECRET) => request(app).post('/api/v1/channels/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', secret).send(payload);
  const last = () => client.sent[client.sent.length - 1];

  it('rejects updates without the webhook secret', async () => {
    await post(text('hi'), 'wrong').expect(401);
    await request(app).post('/api/v1/channels/telegram/webhook').send(text('hi')).expect(401);
    expect(client.sent).toHaveLength(0);
  });

  it('keyboard layout: short labels pair up, long labels get their own row, callback_data within 64 bytes', () => {
    const rows = keyboardRows([{ id: 'en', title: 'English' }, { id: 'ar', title: 'العربية' }, { id: 'free_zone', title: 'Free Zone company (FZCO, FZE, FZ-LLC)' }, { id: 'x'.repeat(100), title: 'X' }]);
    expect(rows[0]).toHaveLength(2);
    expect(rows[1]).toHaveLength(1);
    expect(rows[2][0].callback_data.length).toBe(64);
  });

  it('/start with a deep-link payload records the referral and greets; callback queries drive the flow', async () => {
    await post(text('/start pemo')).expect(200);
    expect(last().kind).toBe('keyboard');
    expect(last().options?.map((o) => o.id)).toEqual(['en', 'ar']);
    const s = await t.ctx.store.botSessions.get(sessionIdFor('telegram', String(CHAT)));
    expect(s?.referral).toBe('pemo');

    await post(callback('en')).expect(200);
    expect(last().body).toMatch(/Do you agree to continue/);
    await post(callback('agree')).expect(200);
    await post(text('Omar')).expect(200);
    await post(text('Desert Rose Trading LLC')).expect(200);
    expect(last().kind).toBe('keyboard');
    expect(last().options?.length).toBe(6);
    await post(callback('llc')).expect(200);
    await post(callback('Dubai')).expect(200);
    expect(last().body).toMatch(/what does Desert Rose Trading LLC sell/);
  });

  it('deduplicates redelivered update_ids', async () => {
    const u = text('general trading of fmcg and household goods wholesale');
    const before = client.sent.length;
    await post(u).expect(200);
    await post(u).expect(200);
    expect(client.sent.length).toBe(before + 1);
  });

  it('documents and photos are downloaded; stickers are unsupported; /start on an existing session resumes', async () => {
    for (const id of ['yes', 'both', 'b2b', 'oneoff', 'gcc', 'V3', 'T3', 'bank_pos', 'fees', 'gt3']) await post(callback(id)).expect(200);
    await post(text('desertrose.example')).expect(200);
    await post(callback('none')).expect(200);
    await post(callback('ok')).expect(200);
    await post(callback('manual')).expect(200);
    expect(last().body).toMatch(/1 of \d+: please send your \*Trade licence\*/);

    await post(sticker()).expect(200);
    expect(client.sent.at(-2)?.body).toMatch(/only read photos and PDFs/);

    await post(doc('f-licence', 'licence.pdf')).expect(200);
    expect(client.sent.slice(-2).map((x) => x.body).join('\n')).toMatch(/Trade licence received/);
    await post(photo('f-photo')).expect(200); // unreadable image in mock mode -> ask again, nothing crashes
    expect(client.sent.slice(-2).map((x) => x.body).join('\n')).toMatch(/could not read that clearly|please send your/);
    await post(doc('f-moa', 'moa.pdf')).expect(200);
    const s = await t.ctx.store.botSessions.get(sessionIdFor('telegram', String(CHAT)));
    expect(s?.checklist?.received).toEqual(expect.arrayContaining(['trade_licence', 'moa_aoa']));

    await post(text('/start pemo')).expect(200);
    expect(last().body).toMatch(/please send your/); // resumed at the current document, not restarted
    expect(s?.step).toBe('S3_COLLECT');
  });

  it('a human decision reaches the Telegram merchant as plain text (no window rule) and the referral is on the case', async () => {
    const s = (await t.ctx.store.botSessions.get(sessionIdFor('telegram', String(CHAT))))!;
    await t.ctx.store.cases.update(s.caseId!, (x) => {
      x.status = 'AWAITING_REVIEW';
      x.botIntake = { sessionId: s.id, channel: 'telegram', lang: 'en', answers: s.answers, mcc: s.mcc ?? null, prescreen: null, pricing: null, flags: { extraReview: false }, referral: s.referral, submittedAt: new Date().toISOString(), transcript: [] };
    });
    const c = await t.ctx.store.cases.get(s.caseId!);
    expect(c?.botIntake?.referral).toBe('pemo');
    const uw = await t.login('uw@t.local');
    client.reset();
    t.clock.now = new Date(Date.now() + 5 * 24 * 3600 * 1000); // days later: still plain text on Telegram
    await uw.post(`/api/v1/cases/${s.caseId}/review`).set(CSRF).send({ decision: 'request_info', notes: 'need the ejari', merchantMessage: '- Ejari or office lease' }).expect(200);
    expect(last().kind).toBe('text');
    expect(last().body).toMatch(/needs a few more things to continue:\n- Ejari or office lease/);
    expect(last().chatId).toBe(String(CHAT));
  });

  it('group chats are ignored', async () => {
    const before = client.sent.length;
    await post({ update_id: ++upd, message: { message_id: 1, chat: { id: -100123, type: 'supergroup' }, date: 1, text: 'hi' } }).expect(200);
    expect(client.sent.length).toBe(before);
  });
});
