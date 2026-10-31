import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Drives a merchant through the WhatsApp bot with signed Meta-shaped webhooks against the running stack
 * (WHATSAPP_MODE=mock), then signs in to the back office and reviews the resulting case.
 * Requires: stack running with WHATSAPP_MODE=mock, E2E_PASSWORD for an UNDERWRITER or ADMIN.
 */
const EMAIL = process.env.E2E_EMAIL ?? 'admin@moneybee.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SECRET = process.env.WHATSAPP_APP_SECRET || 'mock-app-secret';
const FIX = path.resolve(__dirname, '../fixtures/merchants/03-free-zone-fzco');
const FROM = `9715${String(Date.now()).slice(-8)}`;

let n = 0;
const envelope = (message: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'e2e', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'e2e' }, messages: [{ from: FROM, id: `wamid.e2e.${Date.now()}.${++n}`, timestamp: '1', ...message }] } }] }],
});

async function wa(request: APIRequestContext, message: Record<string, unknown>) {
  const body = JSON.stringify(envelope(message));
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
  const res = await request.post('/api/v1/channels/whatsapp/webhook', { data: body, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig } });
  expect(res.status()).toBe(200);
  await new Promise((r) => setTimeout(r, 700));
}
const text = (body: string) => ({ type: 'text', text: { body } });
const btn = (id: string) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: id } } });
const list = (id: string) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: id } } });

async function lastBotMessage(request: APIRequestContext) {
  const r = await request.get(`/api/v1/channels/whatsapp/mock/outbox?from=${FROM}`);
  const { sent } = (await r.json()) as { sent: { body: string; options?: { id: string }[] }[] };
  return sent[sent.length - 1];
}

async function sendDoc(request: APIRequestContext, file: string) {
  const up = await request.post('/api/v1/channels/whatsapp/mock/media', { data: fs.readFileSync(path.join(FIX, file)), headers: { 'Content-Type': 'application/octet-stream', 'x-filename': file, 'x-mime': 'application/pdf' } });
  const { id } = (await up.json()) as { id: string };
  await wa(request, { type: 'document', document: { id, mime_type: 'application/pdf', filename: file } });
}

test('a merchant onboards over WhatsApp, the case reaches review, the underwriter sees the bot intake and requests info', async ({ page, request }) => {
  test.skip(!PASSWORD, 'set E2E_PASSWORD');
  const probe = await request.get('/api/v1/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=mock-verify&hub.challenge=1');
  test.skip(probe.status() !== 200, 'stack is not running with WHATSAPP_MODE=mock');

  // Stage 0 to 1
  await wa(request, text('hi'));
  expect((await lastBotMessage(request)).options?.map((o) => o.id)).toEqual(['en', 'ar']);
  await wa(request, btn('en'));
  await wa(request, btn('agree'));
  await wa(request, text('Salma'));
  await wa(request, text('Nimbus Pay Labs FZCO'));
  await wa(request, list('free_zone'));
  await wa(request, list('Dubai'));
  await wa(request, list('DMCC'));
  await wa(request, text('Restaurant and cafe in JLT, dine-in and delivery'));
  expect((await lastBotMessage(request)).body).toMatch(/Sounds like Restaurants/);
  await wa(request, btn('yes'));
  for (const id of ['both', 'b2c', 'oneoff', 'uae']) await wa(request, btn(id));
  await wa(request, list('V3'));
  await wa(request, list('T2'));
  await wa(request, list('none'));
  await wa(request, btn('1to3'));
  await wa(request, text('nimbus.example'));
  await wa(request, list('none'));
  expect((await lastBotMessage(request)).body).toMatch(/All correct\?/);
  await wa(request, btn('ok'));
  await wa(request, btn('manual'));
  expect((await lastBotMessage(request)).body).toMatch(/1 of \d+: please send your \*Trade licence\*/);

  // Stage 3: every fixture document
  for (const f of ['trade_licence.pdf', 'eid.pdf', 'passport.pdf', 'ejari.pdf', 'bank_letter.pdf', 'website.pdf', 'certificate_of_incorporation.pdf', 'moa.pdf', 'register_of_shareholders.pdf', 'register_of_directors.pdf', 'signatory.pdf', 'ubo_declaration.pdf', 'vat.pdf']) {
    await sendDoc(request, f);
    if (/Anything else you would like to add/.test((await lastBotMessage(request)).body)) break;
  }
  await wa(request, btn('done'));
  const offer = await lastBotMessage(request);
  expect(offer.body).toMatch(/Indicative pricing|indicative range|approval is not certain/);
  expect(offer.body).not.toMatch(/score/i);
  await wa(request, btn('submit'));
  const submitted = await lastBotMessage(request);
  const ref = /\*(MB-\d{4}-\d{4})\*/.exec(submitted.body)?.[1];
  expect(ref).toBeTruthy();

  // Back office
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Merchant cases.')).toBeVisible();
  await expect(page.getByText('Onboarding bot funnel')).toBeVisible();
  await page.getByText(ref!).first().click();
  await expect(page.getByText('AWAITING REVIEW').first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole('tab', { name: /Bot intake/ }).click();
  await expect(page.getByText('Pre-approval (bot')).toBeVisible();
  await expect(page.getByText('Indicative pricing offered')).toBeVisible();
  await expect(page.getByText('Nimbus Pay Labs FZCO').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Risk and decision' }).click();
  await page.getByLabel('Notes (mandatory, internal)').fill('E2E: internal note that must never reach the merchant');
  await page.getByLabel(/Message to the merchant/).fill('- Please send a clearer photo of the Ejari');
  await page.getByRole('button', { name: 'Request info' }).click();
  await expect(page.getByText('NEEDS INFO').first()).toBeVisible();

  const relayed = await lastBotMessage(request);
  expect(relayed.body).toMatch(/needs a few more things to continue:\n- Please send a clearer photo of the Ejari/);
  expect(relayed.body).not.toMatch(/internal note/);
});
