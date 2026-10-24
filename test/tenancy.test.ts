import { beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLE, type World, makeWorld } from './helpers.js';

describe('tenant isolation', () => {
  let w: World;
  let exA1: string;
  let exA2: string;
  let exB1: string;

  beforeEach(async () => {
    w = await makeWorld();
    const mk = async (cred: string) => (await w.call(cred, 'POST', '/template/examples', { body: EXAMPLE })).body.id as string;
    exA1 = await mk('merchant_a1');
    exA2 = await mk('merchant_a2');
    exB1 = await mk('merchant_b1');
  });

  it('a merchant sees only its own resources', async () => {
    const list = await w.call('merchant_a1', 'GET', '/template/examples');
    expect(list.body.data.map((x: any) => x.id)).toEqual([exA1]);
  });

  it('a merchant gets 404, not 403, for a sibling merchant resource', async () => {
    const res = await w.call('merchant_a1', 'GET', `/template/examples/${exA2}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
    w.expectSpec('getExample', res);
    // identical to a resource that does not exist at all, so existence does not leak
    const missing = await w.call('merchant_a1', 'GET', '/template/examples/ex_doesnotexist1');
    expect(missing.body.error.message).toBe(res.body.error.message.replace('Example', 'Example'));
  });

  it('a partner sees its own merchants but not another partner merchants', async () => {
    const a = await w.call('partner_a', 'GET', '/template/examples');
    expect(a.body.data.map((x: any) => x.id).sort()).toEqual([exA1, exA2].sort());
    const b = await w.call('partner_b', 'GET', '/template/examples');
    expect(b.body.data.map((x: any) => x.id)).toEqual([exB1]);
    expect((await w.call('partner_a', 'GET', `/template/examples/${exB1}`)).status).toBe(404);
  });

  it('the platform sees everything below it', async () => {
    const res = await w.call('platform', 'GET', '/template/examples');
    expect(res.body.data).toHaveLength(3);
  });

  it('a child cannot see its parent resources', async () => {
    const own = await w.call('partner_a', 'POST', '/template/examples', { body: EXAMPLE });
    expect((await w.call('merchant_a1', 'GET', `/template/examples/${own.body.id}`)).status).toBe(404);
  });

  it('records the creating tenant from the credential', async () => {
    const res = await w.call('merchant_a2', 'GET', `/template/examples/${exA2}`);
    expect(res.body.tenant_id).toBe(w.world.tenants.merchant_a2!.id);
  });

  it('refuses a tenant id supplied in the body', async () => {
    const res = await w.call('merchant_a1', 'POST', '/template/examples', { body: { ...EXAMPLE, tenant_id: w.world.tenants.merchant_b1!.id } });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toContainEqual(expect.objectContaining({ field: 'body.tenant_id', code: 'unknown_field' }));
  });

  it('ignores tenant hints in headers', async () => {
    const res = await w.call('merchant_a1', 'GET', '/template/examples', { headers: { 'x-tenant-id': w.world.tenants.merchant_b1!.id } });
    expect(res.body.data.map((x: any) => x.id)).toEqual([exA1]);
  });

  it('scopes webhook endpoints, deliveries, events and audit the same way', async () => {
    const ep = await w.call('merchant_a1', 'POST', '/webhook-endpoints', { body: { url: 'http://127.0.0.1:9/hook', events: ['*'] } });
    expect(ep.status).toBe(201);
    // sibling and other partner cannot see or touch it
    for (const cred of ['merchant_a2', 'partner_b', 'merchant_b1']) {
      const list = await w.call(cred, 'GET', '/webhook-endpoints');
      expect(list.body.data.map((x: any) => x.id), cred).not.toContain(ep.body.id);
      expect((await w.call(cred, 'DELETE', `/webhook-endpoints/${ep.body.id}`)).status, cred).toBe(404);
      expect((await w.call(cred, 'POST', `/webhook-endpoints/${ep.body.id}/ping`)).status, cred).toBe(404);
    }
    // the parent partner can see it but cannot disable or ping it: only the owner mutates
    const seen = await w.call('partner_a', 'GET', '/webhook-endpoints');
    expect(seen.body.data.map((x: any) => x.id)).toContain(ep.body.id);
    expect((await w.call('partner_a', 'DELETE', `/webhook-endpoints/${ep.body.id}`)).status).toBe(404);

    const ev = await w.call('merchant_a2', 'GET', '/events');
    expect(ev.body.data.every((e: any) => e.tenant_id === w.world.tenants.merchant_a2!.id)).toBe(true);
    const aud = await w.call('merchant_a2', 'GET', '/audit-events');
    expect(aud.body.data.every((e: any) => e.tenant_id === w.world.tenants.merchant_a2!.id)).toBe(true);
  });

  it('only exposes audit tenants the caller may see', async () => {
    const foreign = await w.call('merchant_a1', 'GET', '/audit-events', { query: { tenant_id: w.world.tenants.merchant_b1!.id } });
    expect(foreign.status).toBe(404);
    const verify = await w.call('merchant_a1', 'GET', '/audit-events/verification', { query: { tenant_id: w.world.tenants.merchant_a2!.id } });
    expect(verify.status).toBe(404);
    const child = await w.call('partner_a', 'GET', '/audit-events', { query: { tenant_id: w.world.tenants.merchant_a1!.id } });
    expect(child.status).toBe(200);
    expect(child.body.data.length).toBeGreaterThan(0);
  });

  it('replay cannot reach an event of another tenant', async () => {
    const evs = await w.call('merchant_b1', 'GET', '/events');
    const res = await w.call('merchant_a1', 'POST', `/events/${evs.body.data[0].id}/replay`);
    expect(res.status).toBe(404);
  });
});
