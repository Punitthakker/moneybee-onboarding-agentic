import { beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLE, type World, makeWorld } from './helpers.js';

describe('audit log', () => {
  let w: World;
  beforeEach(async () => {
    w = await makeWorld();
  });

  it('records state changes with actor, resource and scopes used', async () => {
    const ex = await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE });
    const res = await w.call('merchant_a1', 'GET', '/audit-events', { query: { action: 'createExample' } });
    expect(res.status).toBe(200);
    w.expectSpec('listAuditEvents', res);
    const row = res.body.data[0];
    expect(row).toMatchObject({ action: 'createExample', method: 'POST', status: 201, result: 'success', idempotent_replay: false });
    expect(row.actor.type).toBe('service');
    expect(row.scopes_used).toContain('template:examples.write');
    expect(row.resource).toMatchObject({ type: 'example', id: ex.body.id });
  });

  it('records the actor type for users and agents', async () => {
    const ex = await w.call('partner_a', 'POST', '/template/examples', { body: EXAMPLE });
    await w.call('partner_a_reviewer', 'POST', `/template/examples/${ex.body.id}/decision`, { body: { outcome: 'approve', reason_code: 'OK' } });
    await w.call('partner_a_agent', 'GET', '/me');
    const rows = (await w.call('partner_a', 'GET', '/audit-events', { query: { limit: 100 } })).body.data;
    const byAction = (a: string) => rows.find((r: any) => r.action === a);
    expect(byAction('decideExample').actor.type).toBe('user');
    expect(byAction('getCurrentContext').actor.type).toBeDefined();
    expect(rows.some((r: any) => r.actor.type === 'agent')).toBe(true);
  });

  it('records denied attempts', async () => {
    const ex = await w.call('partner_a', 'POST', '/template/examples', { body: EXAMPLE });
    const denied = await w.call('partner_a', 'POST', `/template/examples/${ex.body.id}/decision`, { body: { outcome: 'approve', reason_code: 'OK' } });
    expect(denied.status).toBe(403);
    const rows = (await w.call('partner_a', 'GET', '/audit-events', { query: { result: 'denied' } })).body.data;
    expect(rows[0]).toMatchObject({ action: 'decideExample', result: 'denied', status: 403 });
  });

  it('chains hashes and verifies', async () => {
    for (let i = 0; i < 3; i++) await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE });
    const v = await w.call('merchant_a1', 'GET', '/audit-events/verification');
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ valid: true, first_invalid_seq: null });
    expect(v.body.events_checked).toBeGreaterThan(3);
    w.expectSpec('verifyAuditChain', v);
    const rows = (await w.call('merchant_a1', 'GET', '/audit-events', { query: { limit: 100, sort: 'occurred_at' } })).body.data;
    rows.sort((a: any, b: any) => a.seq - b.seq);
    for (let i = 1; i < rows.length; i++) expect(rows[i].prev_hash).toBe(rows[i - 1].hash);
  });

  it('detects tampering and names the first broken record', async () => {
    for (let i = 0; i < 4; i++) await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE });
    const tid = w.world.tenants.merchant_a1!.id;
    w.services.store.__tamperAudit(tid, 2, { status: 200 });
    const v = await w.call('merchant_a1', 'GET', '/audit-events/verification');
    expect(v.body.valid).toBe(false);
    expect(v.body.first_invalid_seq).toBe(2);
  });

  it('filters by action, result, resource and time', async () => {
    const ex = await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE });
    w.clock.advance(60_000);
    await w.call('merchant_a1', 'GET', `/template/examples/${ex.body.id}`);
    const byRes = await w.call('merchant_a1', 'GET', '/audit-events', { query: { resource_type: 'example', resource_id: ex.body.id } });
    expect(byRes.body.data.length).toBeGreaterThan(0);
    expect(byRes.body.data.every((r: any) => r.resource?.id === ex.body.id)).toBe(true);
    const cut = new Date(w.clock.now().getTime() - 30_000).toISOString();
    const after = await w.call('merchant_a1', 'GET', '/audit-events', { query: { occurred_after: cut } });
    expect(after.body.data.every((r: any) => r.occurred_at >= cut)).toBe(true);
    const none = await w.call('merchant_a1', 'GET', '/audit-events', { query: { action: 'nothingLikeThis' } });
    expect(none.body.data).toEqual([]);
  });

  it('never stores secrets or request bodies in the audit record', async () => {
    await w.call('merchant_a1', 'POST', '/webhook-endpoints', { body: { url: 'https://hooks.example.com/x', events: ['*'], description: 'top-secret-label' } });
    const text = JSON.stringify((await w.call('merchant_a1', 'GET', '/audit-events', { query: { limit: 100 } })).body);
    expect(text).not.toContain('top-secret-label');
    expect(text).not.toMatch(/whsec_/);
    expect(text).not.toMatch(/Bearer /);
  });
});
