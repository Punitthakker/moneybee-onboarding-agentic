import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { POWERED_BY, TenantSchema, TenantUpdateSchema, publicTenantView } from '@moneybee/shared';
import { loadTenantFiles } from '../src/tenancy/service';
import { tenantCases } from '../src/db/tenant-scope';
import { CSRF, makeTestApp } from './helpers';

const newCase = (agent: ReturnType<typeof request.agent>, body: Record<string, unknown> = {}) =>
  agent.post('/api/v1/cases').set(CSRF).send({ acquirerCode: 'EXAMPLE_ACQUIRER_A', entityType: 'auto', name: 'Tenant test merchant', ...body });

describe('tenant config', () => {
  it('ships valid tenant files for moneybee and botim', () => {
    const ids = loadTenantFiles().map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['moneybee', 'botim']));
  });

  it('marks the Botim brand as a placeholder until real assets are supplied', () => {
    const botim = loadTenantFiles().find((t) => t.id === 'botim')!;
    expect(botim.kind).toBe('white_label');
    expect(botim.branding.isPlaceholder).toBe(true);
    expect(botim.branding.logoUrl).toContain('placeholder');
    const logo = path.resolve('apps/web/public', botim.branding.logoUrl.replace(/^\//, ''));
    expect(fs.existsSync(logo)).toBe(true);
  });

  it('rejects any attempt to configure "Powered by MoneyBee"', () => {
    const base = loadTenantFiles().find((t) => t.id === 'botim')!;
    expect(() => TenantSchema.parse({ ...base, poweredBy: false })).toThrow();
    expect(() => TenantUpdateSchema.parse({ poweredBy: 'Powered by Someone Else' })).toThrow();
    expect(() => TenantUpdateSchema.parse({ branding: { ...base.branding, hidePoweredBy: true } })).toThrow();
  });

  it('always adds Powered by MoneyBee to the public view', () => {
    for (const t of loadTenantFiles()) expect(publicTenantView(t).poweredBy).toBe(POWERED_BY);
    expect(POWERED_BY).toBe('Powered by MoneyBee');
  });
});

describe('tenant isolation', () => {
  it('a Botim user cannot see, list, edit or invite on a MoneyBee case, and the reverse', async () => {
    const t = await makeTestApp();
    const mbUw = await t.login('uw@t.local');
    const btUw = await t.login('uw@botim.test');

    const mb = await newCase(mbUw).expect(201);
    const bt = await newCase(btUw).expect(201);
    expect(mb.body.ref).toMatch(/^MB-\d{4}-\d{4}$/);
    expect(bt.body.ref).toMatch(/^BT-\d{4}-\d{4}$/);

    // read
    await btUw.get(`/api/v1/cases/${mb.body.id}`).expect(404);
    await mbUw.get(`/api/v1/cases/${bt.body.id}`).expect(404);
    await btUw.get(`/api/v1/cases/${bt.body.id}`).expect(200);

    // list and stats
    const btList = await btUw.get('/api/v1/cases').expect(200);
    expect(btList.body.cases.map((c: { id: string }) => c.id)).toEqual([bt.body.id]);
    const mbList = await mbUw.get('/api/v1/cases').expect(200);
    expect(mbList.body.cases.map((c: { id: string }) => c.id)).not.toContain(bt.body.id);
    const stats = await btUw.get('/api/v1/stats').expect(200);
    expect(stats.body.total).toBe(1);

    // writes on another tenant's case behave like a missing case
    await btUw.post(`/api/v1/cases/${mb.body.id}/documents`).set(CSRF).attach('files', Buffer.from('%PDF-1.4 test'), 'x.pdf').expect(404);
    await btUw.post(`/api/v1/cases/${mb.body.id}/run`).set(CSRF).send({}).expect(404);
    await btUw.post(`/api/v1/cases/${mb.body.id}/review`).set(CSRF).send({ decision: 'reject', notes: 'not mine to review' }).expect(404);
    await btUw.post(`/api/v1/cases/${mb.body.id}/complete`).set(CSRF).send({}).expect(404);
    await btUw.post(`/api/v1/cases/${mb.body.id}/uaepass/invite`).set(CSRF).send({}).expect(404);
    await btUw.get(`/api/v1/cases/${mb.body.id}/events`).expect(404);

    // records carry their tenant
    expect((await t.ctx.store.cases.get(bt.body.id))!.tenantId).toBe('botim');
    expect((await t.ctx.store.cases.get(mb.body.id))!.tenantId).toBe('moneybee');
  });

  it('the scoped accessor never lets a mutator move a case to another tenant', async () => {
    const t = await makeTestApp();
    const btUw = await t.login('uw@botim.test');
    const bt = await newCase(btUw).expect(201);
    const scoped = tenantCases(t.ctx.store, 'botim');
    const after = await scoped.update(bt.body.id, (c) => {
      c.tenantId = 'moneybee';
    });
    expect(after.tenantId).toBe('botim');
    await expect(tenantCases(t.ctx.store, 'moneybee').update(bt.body.id, () => undefined)).rejects.toThrow('case not found');
  });

  it('only shows and edits users of the admin\'s own tenant', async () => {
    const t = await makeTestApp();
    const btAdmin = await t.login('admin@botim.test');
    const list = await btAdmin.get('/api/v1/users').expect(200);
    const emails = list.body.users.map((u: { email: string }) => u.email);
    expect(emails).toEqual(expect.arrayContaining(['admin@botim.test', 'uw@botim.test']));
    expect(emails).not.toContain('uw@t.local');
    const mbUser = (await t.ctx.store.users.findByEmail('uw@t.local'))!;
    await btAdmin.patch(`/api/v1/users/${mbUser.id}`).set(CSRF).send({ active: false }).expect(404);
    const created = await btAdmin.post('/api/v1/users').set(CSRF).send({ email: 'new@botim.test', name: 'New', role: 'VIEWER', password: 'a-long-password-1' }).expect(201);
    expect((await t.ctx.store.users.findById(created.body.id))!.tenantId).toBe('botim');
  });

  it('keeps global settings and policies to platform admins', async () => {
    const t = await makeTestApp();
    const btAdmin = await t.login('admin@botim.test');
    await btAdmin.get('/api/v1/settings').expect(403);
    await btAdmin.put('/api/v1/settings').set(CSRF).send({ webhookUrl: 'https://attacker.example/hook' }).expect(403);
    await btAdmin.put('/api/v1/settings/policy').set(CSRF).send({ base: {}, acquirers: [], note: 'try' }).expect(403);
    const mbAdmin = await t.login('admin@t.local');
    await mbAdmin.get('/api/v1/settings').expect(200);
  });

  it('refuses company types the tenant has not enabled', async () => {
    const t = await makeTestApp();
    const btAdmin = await t.login('admin@botim.test');
    await btAdmin.put('/api/v1/tenant').set(CSRF).send({ enabledEntityTypes: ['free_zone'] }).expect(200);
    const btUw = await t.login('uw@botim.test');
    await newCase(btUw, { entityType: 'llc' }).expect(400);
    await newCase(btUw, { entityType: 'free_zone' }).expect(201);
  });

  it('scopes the audit log to the tenant', async () => {
    const t = await makeTestApp();
    const btUw = await t.login('uw@botim.test');
    await newCase(btUw).expect(201);
    const mbAdmin = await t.login('admin@t.local');
    await newCase(await t.login('uw@t.local')).expect(201);
    const btAdmin = await t.login('admin@botim.test');
    const btAudit = (await btAdmin.get('/api/v1/audit').expect(200)).body.audit as { actor: string }[];
    expect(btAudit.length).toBeGreaterThan(0);
    expect(btAudit.every((a) => a.actor.endsWith('@botim.test'))).toBe(true);
    const mbAudit = (await mbAdmin.get('/api/v1/audit').expect(200)).body.audit as { actor: string }[];
    expect(mbAudit.some((a) => a.actor.endsWith('@botim.test'))).toBe(false);
  });
});

describe('tenant branding API', () => {
  it('resolves the public tenant from ?tenant=, the header or the host name, defaulting to MoneyBee', async () => {
    const t = await makeTestApp();
    const a = request(t.app);
    expect((await a.get('/api/v1/public/tenant').expect(200)).body.tenant.id).toBe('moneybee');
    expect((await a.get('/api/v1/public/tenant?tenant=botim').expect(200)).body.tenant.id).toBe('botim');
    expect((await a.get('/api/v1/public/tenant').set('x-moneybee-tenant', 'botim').expect(200)).body.tenant.id).toBe('botim');
    expect((await a.get('/api/v1/public/tenant').set('host', 'botim.localhost:5173').expect(200)).body.tenant.id).toBe('botim');
    expect((await a.get('/api/v1/public/tenant?tenant=unknown').expect(200)).body.tenant.id).toBe('moneybee');
    const bt = (await a.get('/api/v1/public/tenants/botim').expect(200)).body.tenant;
    expect(bt.poweredBy).toBe('Powered by MoneyBee');
    expect(bt.branding.displayName).toBe('Botim');
    expect(JSON.stringify(bt)).not.toContain('emailDomain'); // internal contact config stays private
    await a.get('/api/v1/public/tenants/nope').expect(404);
  });

  it('lets a tenant admin rebrand but never remove Powered by MoneyBee', async () => {
    const t = await makeTestApp();
    const btAdmin = await t.login('admin@botim.test');
    const cur = (await btAdmin.get('/api/v1/tenant').expect(200)).body.config;
    const updated = await btAdmin.put('/api/v1/tenant').set(CSRF).send({ branding: { ...cur.branding, productName: 'Merchant Onboarding' } }).expect(200);
    expect(updated.body.tenant.branding.productName).toBe('Merchant Onboarding');
    expect(updated.body.tenant.poweredBy).toBe('Powered by MoneyBee');

    const blocked = await btAdmin.put('/api/v1/tenant').set(CSRF).send({ poweredBy: '' }).expect(400);
    expect(blocked.body.error).toContain('Powered by MoneyBee');
    await btAdmin.put('/api/v1/tenant').set(CSRF).send({ branding: { ...cur.branding, showPoweredBy: false } }).expect(400);
    await btAdmin.put('/api/v1/tenant').set(CSRF).send({ kind: 'platform' }).expect(400); // cannot promote itself
    await btAdmin.put('/api/v1/tenant').set(CSRF).send({ branding: { ...cur.branding, colors: { ...cur.branding.colors, primary: 'blue' } } }).expect(400);

    // only admins may edit, and only their own tenant
    const btUw = await t.login('uw@botim.test');
    await btUw.put('/api/v1/tenant').set(CSRF).send({ name: 'x' }).expect(403);
    const mb = (await request(t.app).get('/api/v1/public/tenants/moneybee').expect(200)).body.tenant;
    expect(mb.branding.productName).toBe('Onboard');
  });

  it('returns the tenant with the signed-in user', async () => {
    const t = await makeTestApp();
    const btUw = await t.login('uw@botim.test');
    const me = await btUw.get('/api/v1/auth/me').expect(200);
    expect(me.body.user.tenantId).toBe('botim');
    expect(me.body.tenant.id).toBe('botim');
    expect(me.body.tenant.poweredBy).toBe('Powered by MoneyBee');
  });

  it('brands the merchant portal with the case owner\'s tenant', async () => {
    const t = await makeTestApp();
    const btUw = await t.login('uw@botim.test');
    const c = await newCase(btUw).expect(201);
    const inv = await btUw.post(`/api/v1/cases/${c.body.id}/uaepass/invite`).set(CSRF).send({}).expect(201);
    const s = await request(t.app).get('/api/v1/merchant/session').set({ 'x-invite': inv.body.invite }).expect(200);
    expect(s.body.tenant.id).toBe('botim');
    expect(s.body.tenant.poweredBy).toBe('Powered by MoneyBee');
  });
});
