import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MockUaePassProvider } from '../src/integrations/uaepass/mock';
import { maskEid } from '../src/integrations/uaepass/service';
import { CSRF, makeTestApp } from './helpers';

type T = Awaited<ReturnType<typeof makeTestApp>>;

async function setup(env: Record<string, string> = {}) {
  const t = await makeTestApp(env);
  const uw = await t.login('uw@t.local');
  const c = await uw.post('/api/v1/cases').set(CSRF).send({ acquirerCode: 'EXAMPLE_ACQUIRER_A', entityType: 'auto' }).expect(201);
  const caseId = c.body.id as string;
  const inv = await uw.post(`/api/v1/cases/${caseId}/uaepass/invite`).set(CSRF).expect(201);
  const invite = inv.body.invite as string;
  return { t, uw, caseId, invite, agent: request.agent(t.app) };
}
const H = (invite: string) => ({ ...CSRF, 'x-invite': invite });

async function login(t: T, agent: ReturnType<typeof request.agent>, invite: string, persona: string) {
  const start = await agent.post('/api/v1/auth/uaepass/start').set(H(invite)).send({}).expect(200);
  const state = new URL(start.body.url).searchParams.get('state')!;
  const auth = await agent.post('/api/v1/mock/uaepass/authorize').set(CSRF).send({ state, persona }).expect(200);
  const cb = new URL(auth.body.redirectUrl);
  return { state, res: await agent.get(cb.pathname + cb.search) };
}

describe('UAE PASS (mock provider)', () => {
  it('masks Emirates ID numbers', () => {
    expect(maskEid('784-1988-7654321-3')).toBe('784-****-*******-3');
    expect(maskEid('bad')).toBe('***');
  });

  it('signs in, shares documents, and ingests them as issuer-verified evidence', async () => {
    const { t, uw, caseId, invite, agent } = await setup();
    // before login: session shows nothing sensitive
    const pre = await agent.get('/api/v1/merchant/session').set({ 'x-invite': invite }).expect(200);
    expect(pre.body.signedIn).toBe(false);
    expect(pre.body.identity).toBeNull();

    const { res } = await login(t, agent, invite, 'sop3');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/m?auth=ok');

    const s1 = await agent.get('/api/v1/merchant/session').set({ 'x-invite': invite }).expect(200);
    expect(s1.body.signedIn).toBe(true);
    expect(s1.body.identity.emiratesIdMasked).toBe('784-****-*******-3');
    expect(JSON.stringify(s1.body)).not.toContain('7654321');

    const created = await agent.post('/api/v1/merchant/share-requests').set(H(invite)).send({ documents: ['emirates_id', 'residence_visa'] }).expect(201);
    expect(created.body.status).toBe('pending');
    expect(created.body.requestNo).toMatch(/^MBIB26[a-z]{2}\d{10}$/);
    // a second request while one is pending is refused
    await agent.post('/api/v1/merchant/share-requests').set(H(invite)).send({}).expect(409);

    const no = created.body.requestNo as string;
    const sim = await agent.get(`/api/v1/mock/uaepass/share/${no}`).set(CSRF).expect(200);
    expect(sim.body.request.status).toBe('pending');
    await agent.post(`/api/v1/mock/uaepass/share/${no}/decision`).set(CSRF).send({ decision: 'approve' }).expect(200);

    const done = await agent.get(`/api/v1/merchant/share-requests/${no}`).set({ 'x-invite': invite }).expect(200);
    expect(done.body.status).toBe('shared');
    expect(done.body.ingestedAt).toBeTruthy();
    // polling again must not ingest twice
    await agent.get(`/api/v1/merchant/share-requests/${no}`).set({ 'x-invite': invite }).expect(200);

    const view = await uw.get(`/api/v1/cases/${caseId}`).expect(200);
    const c = view.body.case;
    const docs = c.documents.filter((d: { provenance?: string }) => d.provenance === 'issuer_verified');
    expect(docs.map((d: { docType: string }) => d.docType).sort()).toEqual(['emirates_id', 'residence_visa']);
    expect(c.files.filter((f: { source: string }) => f.source === 'uaepass')).toHaveLength(2);
    expect(docs[0].fields.fullName.confidence).toBe(1);
    // nothing secret reaches the ops browser
    expect(JSON.stringify(c.uaepass)).not.toContain('inviteHash');
    expect(JSON.stringify(c.uaepass)).not.toContain('emiratesIdEnc');
    expect(c.uaepass.identity.emiratesIdMasked).toBe('784-****-*******-3');

    // the pipeline keeps the issuer-verified documents and the verifier still runs over them
    await uw.post(`/api/v1/cases/${caseId}/run`).set(CSRF).send({}).expect(202);
    await t.queue.idle();
    const after = (await uw.get(`/api/v1/cases/${caseId}`).expect(200)).body.case;
    expect(after.documents.filter((d: { provenance?: string }) => d.provenance === 'issuer_verified')).toHaveLength(2);
    expect(['AWAITING_REVIEW', 'NEEDS_INFO', 'PACK_BUILT', 'VERIFIED', 'EXTRACTED', 'CLASSIFIED', 'RECEIVED', 'UBO_RESOLVED', 'SCREENED', 'RISK_SCORED']).toContain(after.status);
    expect(after.status).not.toBe('APPROVED');
  });

  it('expires a pending request when the simulated clock moves on, and allows a new one', async () => {
    const { t, caseId, invite, agent } = await setup();
    await login(t, agent, invite, 'sop3');
    const r = await agent.post('/api/v1/merchant/share-requests').set(H(invite)).send({}).expect(201);
    await agent.post('/api/v1/mock/uaepass/clock').set(CSRF).send({ advanceMinutes: 45 }).expect(200);
    const s = await agent.get(`/api/v1/merchant/share-requests/${r.body.requestNo}`).set({ 'x-invite': invite }).expect(200);
    expect(s.body.status).toBe('expired');
    await agent.post(`/api/v1/mock/uaepass/share/${r.body.requestNo}/decision`).set(CSRF).send({ decision: 'approve' }).expect(409);
    await agent.post('/api/v1/merchant/share-requests').set(H(invite)).send({}).expect(201);
    expect(caseId).toBeTruthy();
  });

  it('records a declined request and ingests nothing', async () => {
    const { t, uw, caseId, invite, agent } = await setup();
    await login(t, agent, invite, 'sop3');
    const r = await agent.post('/api/v1/merchant/share-requests').set(H(invite)).send({}).expect(201);
    await agent.post(`/api/v1/mock/uaepass/share/${r.body.requestNo}/decision`).set(CSRF).send({ decision: 'decline' }).expect(200);
    const s = await agent.get(`/api/v1/merchant/share-requests/${r.body.requestNo}`).set({ 'x-invite': invite }).expect(200);
    expect(s.body.status).toBe('declined');
    const c = (await uw.get(`/api/v1/cases/${caseId}`).expect(200)).body.case;
    expect(c.documents).toHaveLength(0);
  });

  it('blocks SOP1 accounts, rejects a wrong state, and needs a valid invite', async () => {
    const { t, invite, agent } = await setup();
    const r1 = await login(t, agent, invite, 'sop1');
    expect(r1.res.headers.location).toContain('auth=sop_low');
    const s = await agent.get('/api/v1/merchant/session').set({ 'x-invite': invite }).expect(200);
    expect(s.body.signedIn).toBe(false);

    // wrong state: callback must refuse
    const start = await agent.post('/api/v1/auth/uaepass/start').set(H(invite)).send({}).expect(200);
    const realState = new URL(start.body.url).searchParams.get('state')!;
    const auth = await agent.post('/api/v1/mock/uaepass/authorize').set(CSRF).send({ state: realState, persona: 'sop3' }).expect(200);
    const cb = new URL(auth.body.redirectUrl);
    cb.searchParams.set('state', 'tampered-state-value');
    const bad = await agent.get(cb.pathname + cb.search);
    expect(bad.headers.location).toContain('auth=state_invalid');

    await request(t.app).get('/api/v1/merchant/session').set({ 'x-invite': invite.slice(0, -2) + 'xx' }).expect(401);
    await request(t.app).get('/api/v1/merchant/session').expect(401);
    // share requests need the UAE PASS session cookie, the invite alone is not enough
    await request(t.app).post('/api/v1/merchant/share-requests').set(H(invite)).send({}).expect(401);
  });

  it('refuses expired invites and requires the CSRF header', async () => {
    const { t, invite, agent, clock } = await setup().then(async (x) => ({ ...x, clock: x.t.clock }));
    await agent.post('/api/v1/auth/uaepass/start').set({ 'x-invite': invite }).send({}).expect(403);
    clock.now = new Date(clock.now.getTime() + 80 * 3600_000);
    await agent.get('/api/v1/merchant/session').set({ 'x-invite': invite }).expect(401);
    expect(t).toBeTruthy();
  });

  it('keeps signing behind the feature flag', async () => {
    const off = await setup();
    await login(off.t, off.agent, off.invite, 'sop3');
    await off.agent.post('/api/v1/merchant/signing').set(H(off.invite)).send({}).expect(404);
    const sess = await off.agent.get('/api/v1/merchant/session').set({ 'x-invite': off.invite }).expect(200);
    expect(sess.body.signingEnabled).toBe(false);
  });

  it('signs the agreement with UAE PASS when enabled and stores the signed file', async () => {
    const { t, uw, caseId, invite, agent } = await setup({ UAEPASS_SIGNING_ENABLED: 'true' });
    await login(t, agent, invite, 'sop3');
    const s = await agent.post('/api/v1/merchant/signing').set(H(invite)).send({}).expect(201);
    expect(s.body.signUrl).toContain('/sim/uaepass/sign?tx=');
    const pending = await agent.get(`/api/v1/merchant/signing/${s.body.id}`).set({ 'x-invite': invite }).expect(200);
    expect(pending.body.status).toBe('pending');
    await agent.post(`/api/v1/mock/uaepass/sign/${s.body.id}/decision`).set(CSRF).send({ decision: 'sign' }).expect(200);
    const done = await agent.get(`/api/v1/merchant/signing/${s.body.id}`).set({ 'x-invite': invite }).expect(200);
    expect(done.body.status).toBe('signed');
    expect(done.body.signatureValid).toBe(true);
    expect(done.body.signedFileId).toBeTruthy();
    const c = (await uw.get(`/api/v1/cases/${caseId}`).expect(200)).body.case;
    expect(c.files.some((f: { source: string }) => f.source === 'uaepass_signed')).toBe(true);
    expect(JSON.stringify(c.uaepass)).not.toContain('documentKey');
  });

  it('live provider fails closed without credentials or the share API spec', async () => {
    const t = await makeTestApp({ UAEPASS_MODE: 'live' });
    expect(t.ctx.uaepass).not.toBeInstanceOf(MockUaePassProvider);
    expect(() => t.ctx.uaepass.buildAuthorizeUrl({ state: 's', nonce: 'n', codeChallenge: 'c', redirectUri: 'http://x' })).toThrow(/not configured/);
    expect(() => t.ctx.uaepass.createShareRequest({ purpose: 'x', providerName: 'p', documents: ['emirates_id'], ttlMinutes: 5 }, new Date())).toThrow(/not configured/);
    // the mock simulator routes are not mounted in live mode
    await request(t.app).get('/api/v1/mock/uaepass/personas').set(CSRF).expect(404);
  });
});
