import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyWebhook } from '../src/crypto/token';
import { findFixturesDir } from '../src/eval/harness';
import { transition } from '../src/agents/orchestrator';
import { CSRF, makeTestApp } from './helpers';

const FIX = findFixturesDir();
function zipOf(slug: string): Buffer {
  const z = new AdmZip();
  for (const f of fs.readdirSync(path.join(FIX, slug))) if (!f.endsWith('.json')) z.addFile(`${slug}/${f}`, fs.readFileSync(path.join(FIX, slug, f)));
  return z.toBuffer();
}

// tiny webhook receiver
const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
let failNext = 0;
const hookServer = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    if (failNext > 0) {
      failNext--;
      res.statusCode = 503;
      return res.end();
    }
    received.push({ headers: req.headers, body: b });
    res.end('ok');
  });
});
let hookUrl = '';
beforeAll(async () => {
  await new Promise<void>((r) => hookServer.listen(0, '127.0.0.1', () => r()));
  hookUrl = `http://127.0.0.1:${(hookServer.address() as { port: number }).port}/hook`;
});
afterAll(() => hookServer.close());

async function newCase(t: Awaited<ReturnType<typeof makeTestApp>>, slug: string) {
  const uw = await t.login('uw@t.local');
  const c = await uw.post('/api/v1/cases').set(CSRF).send({ acquirerCode: 'EXAMPLE_ACQUIRER_A', entityType: 'auto' }).expect(201);
  const id = c.body.id as string;
  const up = await uw.post(`/api/v1/cases/${id}/documents`).set(CSRF).attach('files', zipOf(slug), `${slug}.zip`).expect(201);
  expect(up.body.added.length).toBeGreaterThan(5);
  await uw.post(`/api/v1/cases/${id}/run`).set(CSRF).send({}).expect(202);
  return { uw, id };
}

describe('auth and RBAC', () => {
  it('rejects unauthenticated and enforces roles and CSRF header', async () => {
    const t = await makeTestApp();
    const viewer = await t.login('v@t.local');
    await viewer.post('/api/v1/cases').set(CSRF).send({ acquirerCode: 'EXAMPLE_ACQUIRER_A' }).expect(403);
    const uw = await t.login('uw@t.local');
    await uw.post('/api/v1/cases').send({ acquirerCode: 'EXAMPLE_ACQUIRER_A' }).expect(403); // no csrf header
    const anon = await (await import('supertest')).default(t.app).get('/api/v1/cases');
    expect(anon.status).toBe(401);
  });
});

describe('pipeline guardrails', () => {
  it('the system can never set APPROVED', () => {
    const c = { status: 'AWAITING_REVIEW' } as never;
    expect(() => transition(c, 'APPROVED', { type: 'system' })).toThrow();
    expect(() => transition(c, 'COMPLETED', { type: 'system' })).toThrow();
  });

  it('prompt injection fixture is flagged and lands in review, not approved', async () => {
    const t = await makeTestApp();
    const { uw, id } = await newCase(t, '08-prompt-injection');
    const r = await uw.get(`/api/v1/cases/${id}`).expect(200);
    expect(r.body.case.status).toBe('AWAITING_REVIEW');
    expect(r.body.case.injectionSuspected).toBe(true);
    expect(r.body.case.risk.rating).toBe('REFER');
    expect(r.body.case.findings.map((f: { code: string }) => f.code)).toContain('INJECTION_SUSPECTED');
  });
});

describe('end to end: review, complete, SQL write, token, webhook, claim', () => {
  it('happy path with second reviewer rules', async () => {
    const t = await makeTestApp({ ONBOARDING_WEBHOOK_URL: hookUrl, ONBOARDING_WEBHOOK_SECRET: 'whsec_test_1234567890' });
    const { uw, id } = await newCase(t, '10-bundle-transliteration');
    let r = await uw.get(`/api/v1/cases/${id}`).expect(200);
    expect(r.body.case.status).toBe('AWAITING_REVIEW');
    expect(r.body.case.needsReviewFields).toContain('company.tradeName');

    // cannot approve while low-confidence fields are open
    await uw.post(`/api/v1/cases/${id}/review`).set(CSRF).send({ decision: 'approve', notes: 'looks fine' }).expect(409);
    // edits need a reason
    await uw.patch(`/api/v1/cases/${id}/fields`).set(CSRF).send({ path: 'company.tradeName', value: 'Bundle Bites' }).expect(400);
    await uw.patch(`/api/v1/cases/${id}/fields`).set(CSRF).send({ path: 'company.tradeName', value: 'Bundle Bites', reason: 'Checked against the shop sign photo' }).expect(200);
    // notes are mandatory
    await uw.post(`/api/v1/cases/${id}/review`).set(CSRF).send({ decision: 'approve', notes: '' }).expect(400);
    // cannot complete before approval
    await uw.post(`/api/v1/cases/${id}/complete`).set(CSRF).send({}).expect(409);

    const ap = await uw.post(`/api/v1/cases/${id}/review`).set(CSRF).send({ decision: 'approve', notes: 'All policy checks reviewed' }).expect(200);
    expect(ap.body.status).toBe('APPROVED'); // LOW risk: single approval

    const done = await uw.post(`/api/v1/cases/${id}/complete`).set(CSRF).send({}).expect(201);
    const token: string = done.body.token;
    expect(token).toMatch(/^mb_onb_[A-Za-z0-9_-]{43}$/);
    await uw.post(`/api/v1/cases/${id}/complete`).set(CSRF).send({}).expect(409);

    // SQL contents (memory repo mirrors the MSSQL repo contract)
    const dump = (t.ctx.repo as unknown as { _dump(): Record<string, unknown[]> })._dump();
    expect(dump.merchants).toHaveLength(1);
    expect(dump.cases).toHaveLength(1);
    expect(dump.docs.length).toBeGreaterThan(5);
    const tok = dump.tokens[0] as { tokenHash: string };
    expect(tok.tokenHash).toHaveLength(64);
    expect(JSON.stringify(dump)).not.toContain(token);
    const party = (dump.parties as { idNumberEnc: string | null }[]).find((p) => p.idNumberEnc);
    expect(party?.idNumberEnc).not.toMatch(/^784-/);

    // webhook
    await (t.queue as unknown as { idle(): Promise<void> }).idle();
    expect(received.length).toBe(1);
    const h = received[0];
    const body = JSON.parse(h.body);
    expect(body.event).toBe('onboarding.completed');
    expect(body.token).toBe(token);
    expect(verifyWebhook({ secret: 'whsec_test_1234567890', timestamp: String(h.headers['x-moneybee-timestamp']), body: h.body, signature: String(h.headers['x-moneybee-signature']), nowMs: t.clock.now.getTime() })).toBe(true);
    expect(verifyWebhook({ secret: 'wrong', timestamp: String(h.headers['x-moneybee-timestamp']), body: h.body, signature: String(h.headers['x-moneybee-signature']), nowMs: t.clock.now.getTime() })).toBe(false);
    expect(verifyWebhook({ secret: 'whsec_test_1234567890', timestamp: String(h.headers['x-moneybee-timestamp']), body: h.body, signature: String(h.headers['x-moneybee-signature']), nowMs: t.clock.now.getTime() + 6 * 60 * 1000 })).toBe(false);
    const hooks = await t.ctx.store.webhooks.listByCase(id);
    expect(hooks[0].status).toBe('DELIVERED');
    expect(JSON.stringify(hooks)).not.toContain(token);

    // status and claim
    const anon = (await import('supertest')).default(t.app);
    const st = await anon.get(`/api/v1/onboarding/${token}/status`).expect(200);
    expect(st.body.status).toBe('VALID');
    const cl = await anon.post(`/api/v1/onboarding/${token}/claim`).expect(200);
    expect(cl.body.merchant.legalName).toBe('Bundle Bites Trading LLC');
    expect(cl.body.ubos[0].fullName).toBe('Mohammed Bundlani');
    expect(cl.body.documents.length).toBeGreaterThan(5);
    expect(cl.body.risk.screeningIsMock).toBe(true);
    await anon.get(new URL(cl.body.documents[0].downloadUrl).pathname + new URL(cl.body.documents[0].downloadUrl).search).expect(200);
    await anon.post(`/api/v1/onboarding/${token}/claim`).expect(409); // single use
    expect((await anon.get(`/api/v1/onboarding/${token}/status`)).body.status).toBe('REDEEMED');
    await anon.get(`/api/v1/onboarding/mb_onb_${'A'.repeat(43)}/status`).expect(404);
  });

  it('expired and revoked tokens are rejected; high risk needs two distinct reviewers', async () => {
    const t = await makeTestApp({ ONBOARDING_WEBHOOK_URL: hookUrl, ONBOARDING_WEBHOOK_SECRET: 'whsec_test_1234567890' });
    const { uw, id } = await newCase(t, '09-sanctions-hit');
    const r = await uw.get(`/api/v1/cases/${id}`).expect(200);
    expect(r.body.case.risk.requiresSecondReviewer).toBe(true);
    const a1 = await uw.post(`/api/v1/cases/${id}/review`).set(CSRF).send({ decision: 'approve', notes: 'Underwriter approval for test' }).expect(200);
    expect(a1.body.status).toBe('AWAITING_REVIEW');
    await uw.post(`/api/v1/cases/${id}/review`).set(CSRF).send({ decision: 'approve', notes: 'Same person again' }).expect(409);
    const uw2 = await t.login('uw2@t.local');
    await uw2.post(`/api/v1/cases/${id}/review`).set(CSRF).send({ decision: 'approve', notes: 'Second underwriter' }).expect(403);
    const sr = await t.login('sr@t.local');
    const a2 = await sr.post(`/api/v1/cases/${id}/review`).set(CSRF).send({ decision: 'approve', notes: 'Second reviewer approval' }).expect(200);
    expect(a2.body.status).toBe('APPROVED');
    const done = await uw.post(`/api/v1/cases/${id}/complete`).set(CSRF).send({}).expect(201);
    const anon = (await import('supertest')).default(t.app);

    // revoke
    await uw.post(`/api/v1/tokens/${done.body.tokenId}/revoke`).set(CSRF).send({}).expect(200);
    await anon.post(`/api/v1/onboarding/${done.body.token}/claim`).expect(410);

    // expiry: new case, advance the clock beyond the TTL
    const { uw: u3, id: id3 } = await newCase(t, '01-sole-establishment');
    await u3.post(`/api/v1/cases/${id3}/review`).set(CSRF).send({ decision: 'approve', notes: 'Clean low risk merchant' }).expect(200);
    const d3 = await u3.post(`/api/v1/cases/${id3}/complete`).set(CSRF).send({}).expect(201);
    t.clock.now = new Date(t.clock.now.getTime() + 25 * 3600 * 1000);
    const ex = await anon.post(`/api/v1/onboarding/${d3.body.token}/claim`);
    expect(ex.status).toBe(410);
    expect(ex.body.error).toBe('token expired');
  });

  it('webhook retries then dead-letters', async () => {
    const t = await makeTestApp({ ONBOARDING_WEBHOOK_URL: hookUrl, ONBOARDING_WEBHOOK_SECRET: 'whsec_test_1234567890' });
    const { uw, id } = await newCase(t, '02-llc');
    await uw.post(`/api/v1/cases/${id}/review`).set(CSRF).send({ decision: 'approve', notes: 'Clean low risk merchant' }).expect(200);
    failNext = 10;
    await uw.post(`/api/v1/cases/${id}/complete`).set(CSRF).send({}).expect(201);
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 30));
      await (t.queue as unknown as { idle(): Promise<void> }).idle();
      const h = (await t.ctx.store.webhooks.listByCase(id))[0];
      if (h.status === 'DEAD') break;
    }
    const h = (await t.ctx.store.webhooks.listByCase(id))[0];
    expect(h.status).toBe('DEAD');
    expect(h.attempts).toBe(3);
    failNext = 0;
    await uw.post(`/api/v1/webhooks/${h.id}/retry`).set(CSRF).send({}).expect(202);
    await (t.queue as unknown as { idle(): Promise<void> }).idle();
    expect((await t.ctx.store.webhooks.listByCase(id))[0].status).toBe('DELIVERED');
  });
});
