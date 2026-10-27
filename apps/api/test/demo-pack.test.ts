import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CSRF, makeTestApp } from './helpers';

/** The demo pack (demo-pack/, built by fixtures/demo-pack.ts) must give the outcomes its README promises. */
const ROOT = path.resolve(__dirname, '../../../demo-pack');
const dirOf = (prefix: string) => path.join(ROOT, fs.readdirSync(ROOT).find((d) => d.startsWith(prefix))!);
const pdfs = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith('.pdf'));

async function opsCase(t: Awaited<ReturnType<typeof makeTestApp>>, prefix: string) {
  const uw = await t.login('uw@botim.test');
  const c = await uw.post('/api/v1/cases').set(CSRF).send({ acquirerCode: 'EXAMPLE_ACQUIRER_A', entityType: 'llc' }).expect(201);
  const dir = dirOf(prefix);
  let req = uw.post(`/api/v1/cases/${c.body.id}/documents`).set(CSRF);
  for (const f of pdfs(dir)) req = req.attach('files', fs.readFileSync(path.join(dir, f)), f);
  await req.expect(201);
  await uw.post(`/api/v1/cases/${c.body.id}/run`).set(CSRF).send({}).expect(202);
  await t.queue.idle?.();
  return { uw, c: (await uw.get(`/api/v1/cases/${c.body.id}`).expect(200)).body.case };
}

describe('demo pack', () => {
  it('A (Golden Palm) goes through the merchant portal to LOW risk, approval and completion', async () => {
    const t = await makeTestApp();
    const a = request.agent(t.app);
    await a.post('/api/v1/public/applications').set(CSRF).set('host', 'botim.localhost').send({
      entityType: 'llc', businessName: 'Golden Palm Restaurant LLC', answers: { vat_registered: true, has_corporate_shareholders: false, chamber_member: false },
      contact: { name: 'Sara Al Demo', email: 'sara@goldenpalm.example' }, locale: 'ar', consent: true,
    }).expect(201);
    const dir = dirOf('A ');
    let req = a.post('/api/v1/portal/application/documents').set(CSRF);
    for (const f of pdfs(dir)) req = req.attach('files', fs.readFileSync(path.join(dir, f)), f);
    const v = (await req.expect(201)).body.view;
    expect(v.files.every((f: { state: string }) => f.state === 'recognised')).toBe(true);
    expect(v.checklist.complete).toBe(true);
    expect(v.application.missingRequired).toBe(0);
    await a.post('/api/v1/portal/application/submit').set(CSRF).send({}).expect(202);
    await t.queue.idle?.();

    const uw = await t.login('uw@botim.test');
    const row = (await uw.get('/api/v1/cases').expect(200)).body.cases.find((c: { name: string }) => /Golden Palm/.test(c.name));
    const c = (await uw.get(`/api/v1/cases/${row.id}`).expect(200)).body.case;
    expect(c.status).toBe('AWAITING_REVIEW');
    expect(c.risk.rating).toBe('LOW');
    expect(c.findings.filter((f: { severity: string }) => f.severity === 'fail')).toEqual([]);
    expect(c.ubo.ubos.map((u: { name: string }) => u.name).sort()).toEqual(['Omar Al Sample', 'Sara Al Demo']);
    expect(c.fields['company.legalName'].value).toBe('Golden Palm Restaurant LLC');
    expect(c.needsReviewFields).toEqual([]);
    await uw.post(`/api/v1/cases/${c.id}/review`).set(CSRF).send({ decision: 'approve', notes: 'Checked licence, IDs and ownership' }).expect(200);
    const done = await uw.post(`/api/v1/cases/${c.id}/complete`).set(CSRF).send({}).expect(201);
    expect(done.body.token).toMatch(/^mb_/);
  });

  it('B (Blue Dhow) traces ownership through two holding companies', async () => {
    const t = await makeTestApp();
    const { c } = await opsCase(t, 'B ');
    expect(c.status).toBe('AWAITING_REVIEW');
    expect(c.ubo.layers).toBeGreaterThanOrEqual(2);
    const ubos = Object.fromEntries(c.ubo.ubos.map((u: { name: string; effectivePct: number }) => [u.name, Math.round(u.effectivePct)]));
    expect(ubos).toEqual({ 'Huda Al Example': 30, 'Yousef Al Sample': 28 });
    expect(c.ubo.unresolved).toEqual([]);
    expect(['LOW', 'MEDIUM']).toContain(c.risk.rating);
  });

  it('C (Redline) is referred because the owner is on the mock sanctions list', async () => {
    const t = await makeTestApp();
    const { c } = await opsCase(t, 'C ');
    expect(c.risk.rating).toBe('REFER');
    expect(c.risk.requiresSecondReviewer).toBe(true);
    expect(c.screening.results.some((r: { status: string; category: string }) => r.status === 'HIT' && r.category === 'SANCTIONS')).toBe(true);
  });
});
