import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { findFixturesDir } from '../src/eval/harness';
import { CSRF, makeTestApp } from './helpers';

const FIX = findFixturesDir();
const files = (slug: string) => fs.readdirSync(path.join(FIX, slug)).filter((f) => !f.endsWith('.json'));
const linkIn = (text: string) => /#(mb_ml_[^\s]+)/.exec(text)?.[1];

async function start(t: Awaited<ReturnType<typeof makeTestApp>>, over: Record<string, unknown> = {}, host = 'botim.localhost') {
  const a = request.agent(t.app);
  const res = await a.post('/api/v1/public/applications').set(CSRF).set('host', host).send({
    entityType: 'llc', businessName: 'Oasis Table Restaurants LLC', answers: { vat_registered: true, has_corporate_shareholders: false, chamber_member: false },
    contact: { name: 'Aisha Merchant', email: 'Aisha@Example.test', mobile: '+971 50 123 4567' }, locale: 'en', consent: true, ...over,
  });
  return { a, res };
}

describe('merchant portal: requirements', () => {
  it('lists the company types the tenant offers, with questions and documents (branch included)', async () => {
    const t = await makeTestApp();
    const r = await request(t.app).get('/api/v1/public/requirements?tenant=botim').expect(200);
    expect(r.body.tenant.id).toBe('botim');
    expect(r.body.tenant.poweredBy).toBe('Powered by MoneyBee');
    const ids = r.body.entityTypes.map((e: { id: string }) => e.id);
    expect(ids).toEqual(['sole_establishment', 'llc', 'free_zone', 'mainland', 'branch']);
    const branch = r.body.entityTypes.find((e: { id: string }) => e.id === 'branch');
    expect(branch.label).toMatch(/Branch/);
    expect(branch.labelAr).toBeTruthy();
    expect(branch.documents.filter((d: { required: boolean }) => d.required).map((d: { docType: string }) => d.docType)).toEqual(expect.arrayContaining(['parent_company_documents', 'branch_board_resolution', 'parent_ownership_chart']));
    expect(branch.questions.map((q: { id: string }) => q.id)).toContain('parent_location');
    const incumbency = branch.documents.find((d: { docType: string }) => d.docType === 'incumbency_certificate');
    expect(incumbency).toMatchObject({ required: false, ifApplicable: true });
  });
});

describe('merchant portal: start, magic link, upload, submit', () => {
  it('runs the whole self-serve journey and the case lands in the review queue', async () => {
    const t = await makeTestApp();
    const { a, res } = await start(t);
    expect(res.status).toBe(201);
    expect(res.body.ref).toMatch(/^BT-\d{4}-\d{4}$/);
    expect(res.body.emailMasked).toBe('a****@example.test');

    // a branded magic link was emailed; the link puts the token in the URL fragment
    const mail = t.ctx.mailer.outbox!.at(-1)!;
    expect(mail.to).toBe('Aisha@Example.test');
    expect(mail.fromName).toBe('Botim Business Onboarding');
    expect(mail.text).toContain('http://web.test/apply/link#mb_ml_');
    expect(mail.html).toContain('Powered by MoneyBee');

    // the start call already signed this browser in
    let v = (await a.get('/api/v1/portal/application').expect(200)).body;
    expect(v.application).toMatchObject({ phase: 'collecting', entityType: 'llc', canEdit: true, canUpload: true, canSubmit: false });
    expect(v.tenant.id).toBe('botim');
    // the VAT certificate is required (the answer says VAT registered; this acquirer also always asks for it)
    const vat = v.checklist.items.find((i: { docType: string }) => i.docType === 'vat_certificate');
    expect(vat).toMatchObject({ required: true, status: 'missing' });
    // not a chamber member: the chamber certificate is not asked for
    expect(v.checklist.items.find((i: { docType: string }) => i.docType === 'chamber_certificate')).toMatchObject({ required: false, ifApplicable: true });
    expect(v.checklist.requiredDone).toBe(0);
    // nothing internal leaks
    expect(JSON.stringify(v)).not.toMatch(/emailEnc|emailHash|"hash"|risk|findings/);

    // a slot upload of the trade licence ticks that item straight away
    const dir = path.join(FIX, '02-llc');
    const up = await a.post('/api/v1/portal/application/documents').set(CSRF).field('slot', 'trade_licence').attach('files', fs.readFileSync(path.join(dir, 'trade_licence.pdf')), 'trade_licence.pdf').expect(201);
    expect(up.body.added[0]).toMatchObject({ name: 'trade_licence.pdf', detected: ['trade_licence'], matchesSlot: true });
    expect(up.body.view.checklist.items.find((i: { docType: string }) => i.docType === 'trade_licence').status).toBe('received');

    // submitting with documents missing is refused with the list of what is left
    const early = await a.post('/api/v1/portal/application/submit').set(CSRF).send({}).expect(422);
    expect(early.body.error).toMatch(/still needed: .*MOA/);

    // drop everything else in one go (bulk upload, no slot)
    let req = a.post('/api/v1/portal/application/documents').set(CSRF);
    for (const f of files('02-llc').filter((f) => f !== 'trade_licence.pdf')) req = req.attach('files', fs.readFileSync(path.join(dir, f)), f);
    v = (await req.expect(201)).body.view;
    expect(v.checklist.complete).toBe(true);
    expect(v.application.canSubmit).toBe(true);

    // changing answers is allowed while collecting
    v = (await a.patch('/api/v1/portal/application').set(CSRF).send({ answers: { chamber_member: true } }).expect(200)).body;
    expect(v.checklist.complete).toBe(false); // chamber certificate now required
    v = (await a.patch('/api/v1/portal/application').set(CSRF).send({ answers: { chamber_member: false } }).expect(200)).body;
    expect(v.checklist.complete).toBe(true);

    const sub = await a.post('/api/v1/portal/application/submit').set(CSRF).send({}).expect(202);
    expect(sub.body.application.canEdit).toBe(false);
    await t.queue.idle?.();
    v = (await a.get('/api/v1/portal/application').expect(200)).body;
    expect(v.application.phase).toBe('in_review');
    expect(v.application.canUpload).toBe(false);
    expect(v.timeline.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['started', 'documents', 'submitted']));

    // ops (same tenant) see the case with its contact; the link hash never leaves the server
    const uw = await t.login('uw@botim.test');
    const list = (await uw.get('/api/v1/cases').expect(200)).body.cases;
    const row = list.find((c: { ref: string }) => c.ref === res.body.ref);
    expect(row.status).toBe('AWAITING_REVIEW');
    const full = (await uw.get(`/api/v1/cases/${row.id}`).expect(200)).body.case;
    expect(full.portal.contact.email).toBe('aisha@example.test');
    expect(full.portal.contact.emailEnc).toBeUndefined();
    expect(full.portal.link.hash).toBe('');
    expect(full.entityType).toBe('llc');
    // MoneyBee staff of another tenant cannot see it
    const mb = await t.login('uw@t.local');
    await mb.get(`/api/v1/cases/${row.id}`).expect(404);
  });

  it('exchanges the emailed link for a session on another device, and rejects bad or expired links', async () => {
    const t = await makeTestApp();
    await start(t);
    const token = linkIn(t.ctx.mailer.outbox!.at(-1)!.text)!;
    const phone = request.agent(t.app);
    await phone.get('/api/v1/portal/application').expect(401);
    await phone.post('/api/v1/portal/session').send({ token }).expect(403); // CSRF header required
    const s = await phone.post('/api/v1/portal/session').set(CSRF).send({ token }).expect(200);
    expect(s.body.tenant).toBe('botim');
    expect((await phone.get('/api/v1/portal/application').expect(200)).body.application.ref).toBe(s.body.ref);
    // the same link works again within its lifetime (laptop and phone)
    await request.agent(t.app).post('/api/v1/portal/session').set(CSRF).send({ token }).expect(200);
    // tampered token
    await request.agent(t.app).post('/api/v1/portal/session').set(CSRF).send({ token: token.slice(0, -2) + 'xx' }).expect(401);
    // expired
    t.clock.now = new Date(t.clock.now.getTime() + 73 * 3600_000);
    await request.agent(t.app).post('/api/v1/portal/session').set(CSRF).send({ token }).expect(401);
  });

  it('resume by email sends a fresh link (old one stops working) and never reveals whether an application exists', async () => {
    const t = await makeTestApp();
    const { res } = await start(t);
    const first = linkIn(t.ctx.mailer.outbox!.at(-1)!.text)!;
    const n = t.ctx.mailer.outbox!.length;
    const ok = await request(t.app).post('/api/v1/public/applications/resume').set(CSRF).set('host', 'botim.localhost').send({ email: ' aisha@EXAMPLE.test ' }).expect(202);
    const none = await request(t.app).post('/api/v1/public/applications/resume').set(CSRF).set('host', 'botim.localhost').send({ email: 'nobody@example.test' }).expect(202);
    expect(Object.keys(ok.body)).toEqual(Object.keys(none.body));
    expect(t.ctx.mailer.outbox!.length).toBe(n + 1);
    const second = linkIn(t.ctx.mailer.outbox!.at(-1)!.text)!;
    expect(second).not.toBe(first);
    expect(t.ctx.mailer.outbox!.at(-1)!.subject).toContain(res.body.ref);
    await request.agent(t.app).post('/api/v1/portal/session').set(CSRF).send({ token: first }).expect(401);
    await request.agent(t.app).post('/api/v1/portal/session').set(CSRF).send({ token: second }).expect(200);
    // the same email on another tenant finds nothing there
    await request(t.app).post('/api/v1/public/applications/resume').set(CSRF).send({ email: 'aisha@example.test' }).expect(202);
    expect(t.ctx.mailer.outbox!.length).toBe(n + 1);
  });

  it('validates the start form and refuses company types the tenant does not offer', async () => {
    const t = await makeTestApp();
    expect((await start(t, { consent: false })).res.status).toBe(400);
    expect((await start(t, { contact: { name: 'A', email: 'not-an-email' } })).res.status).toBe(400);
    await t.ctx.tenants.update('botim', { enabledEntityTypes: ['llc'] }, 'test');
    const r = (await start(t, { entityType: 'branch' })).res;
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not offered/);
  });

  it('lets the merchant remove a wrong file before submitting, and locks edits after', async () => {
    const t = await makeTestApp();
    const { a } = await start(t, { entityType: 'sole_establishment', answers: { vat_registered: false, licence_kind: 'professional', owner_uae_national: false } });
    let v = (await a.get('/api/v1/portal/application').expect(200)).body;
    // a professional licence held by a non-national needs a local service agent agreement
    expect(v.checklist.items.find((i: { docType: string }) => i.docType === 'local_service_agent_agreement')).toMatchObject({ required: true, conditional: true });
    const up = await a.post('/api/v1/portal/application/documents').set(CSRF).attach('files', fs.readFileSync(path.join(FIX, '02-llc', 'moa.pdf')), 'moa.pdf').expect(201);
    v = (await a.delete(`/api/v1/portal/application/files/${up.body.added[0].id}`).set(CSRF).expect(200)).body;
    expect(v.files).toHaveLength(0);
  });
});

describe('email failures', () => {
  it('keeps the application and the session when the email cannot be sent; ops get a clear error', async () => {
    const t = await makeTestApp();
    t.ctx.mailer.send = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:1025'); };
    const { a, res } = await start(t);
    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);
    await a.get('/api/v1/portal/application').expect(200);
    await request(t.app).post('/api/v1/public/applications/resume').set(CSRF).set('host', 'botim.localhost').send({ email: 'aisha@example.test' }).expect(202);
    const uw = await t.login('uw@t.local');
    const c = await uw.post('/api/v1/cases').set(CSRF).send({ acquirerCode: 'EXAMPLE_ACQUIRER_A', entityType: 'llc' }).expect(201);
    const r = await uw.post(`/api/v1/cases/${c.body.id}/portal-link`).set(CSRF).send({ email: 'm@example.test' }).expect(502);
    expect(r.body.error).toMatch(/could not be sent/);
  });
});

describe('ops can send an upload link for an existing case', () => {
  it('emails the merchant, and the merchant can upload into the ops-created case', async () => {
    const t = await makeTestApp();
    const uw = await t.login('uw@t.local');
    const c = await uw.post('/api/v1/cases').set(CSRF).send({ acquirerCode: 'EXAMPLE_ACQUIRER_A', entityType: 'branch', name: 'Harbourline Logistics Branch' }).expect(201);
    const viewer = await t.login('v@t.local');
    await viewer.post(`/api/v1/cases/${c.body.id}/portal-link`).set(CSRF).send({ email: 'm@example.test' }).expect(403);
    const sent = await uw.post(`/api/v1/cases/${c.body.id}/portal-link`).set(CSRF).send({ email: 'm@example.test', name: 'Yusuf' }).expect(201);
    expect(sent.body.sentTo).toBe('m**@example.test');
    const mail = t.ctx.mailer.outbox!.at(-1)!;
    expect(mail.fromName).toBe('MoneyBee Onboard');
    const a = request.agent(t.app);
    await a.post('/api/v1/portal/session').set(CSRF).send({ token: linkIn(mail.text) }).expect(200);
    const v = (await a.get('/api/v1/portal/application').expect(200)).body;
    expect(v.application).toMatchObject({ entityType: 'branch', phase: 'collecting', canUpload: true, canEdit: false });
    let up = a.post('/api/v1/portal/application/documents').set(CSRF);
    for (const f of files('11-branch-foreign-parent')) up = up.attach('files', fs.readFileSync(path.join(FIX, '11-branch-foreign-parent', f)), f);
    const view = (await up.expect(201)).body.view;
    expect(view.checklist.complete).toBe(true);
    await a.post('/api/v1/portal/application/submit').set(CSRF).send({}).expect(202);
    await t.queue.idle?.();
    const full = (await uw.get(`/api/v1/cases/${c.body.id}`).expect(200)).body.case;
    expect(full.status).toBe('AWAITING_REVIEW');
    expect(full.ubo.ubos.map((u: { name: string }) => u.name).sort()).toEqual(['Leila Parento', 'Omar Holdingsen']);
  });
});
