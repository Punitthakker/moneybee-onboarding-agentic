import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../src/core/util.js';
import { EXAMPLE, type World, makeWorld } from './helpers.js';

describe('idempotency', () => {
  let w: World;
  beforeEach(async () => {
    w = await makeWorld();
  });

  const count = async (cred = 'merchant_a1') => (await w.call(cred, 'GET', '/template/examples')).body.data.length as number;

  it('requires an Idempotency-Key on state-changing calls', async () => {
    const res = await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('idempotency_key_missing');
    expect(res.body.error.details[0].field).toBe('header.Idempotency-Key');
    w.expectSpec('createExample', res);
    expect(await count()).toBe(0);
  });

  it('does not require it on reads or on the token endpoint', async () => {
    expect((await w.call('merchant_a1', 'GET', '/me')).status).toBe(200);
  });

  it('rejects a malformed key', async () => {
    const res = await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].field).toBe('header.Idempotency-Key');
  });

  it('replays the first response and creates exactly one resource', async () => {
    const first = await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: 'key-0000001' });
    const again = await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: 'key-0000001' });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await count()).toBe(1);
    // one event, not two
    expect((await w.call('merchant_a1', 'GET', '/events')).body.data.filter((e: any) => e.type === 'example.created')).toHaveLength(1);
  });

  it('treats key order in the body as the same request', async () => {
    const a = await w.call('merchant_a1', 'POST', '/template/examples', { raw: '{"name":"x","amount_minor":5,"currency":"AED"}', idem: 'key-0000002' });
    const b = await w.call('merchant_a1', 'POST', '/template/examples', { raw: '{"currency":"AED","amount_minor":5,"name":"x"}', idem: 'key-0000002' });
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.id).toBe(a.body.id);
  });

  it('returns 409 when the key is reused with a different request', async () => {
    await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: 'key-0000003' });
    const res = await w.call('merchant_a1', 'POST', '/template/examples', { body: { ...EXAMPLE, amount_minor: 9999 }, idem: 'key-0000003' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('idempotency_key_conflict');
    w.expectSpec('createExample', res);
    expect(await count()).toBe(1);
  });

  it('returns 409 with Retry-After while the first request is still running', async () => {
    const fp = sha256Hex(canonicalJson({ m: 'post', p: '/template/examples', params: {}, query: {}, body: EXAMPLE }));
    const c = w.world.credentials.merchant_a1!;
    w.services.store.putIdem(w.services.store.idemKey(c.tenantId, c.clientId, 'key-0000004'), {
      fingerprint: fp,
      state: 'in_progress',
      expiresAt: w.clock.now().getTime() + 60_000,
    });
    const res = await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: 'key-0000004' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('idempotency_request_in_progress');
    expect(res.headers['retry-after']).toBe('1');
    expect(await count()).toBe(0);
  });

  it('forgets keys after the replay window', async () => {
    const first = await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: 'key-0000005' });
    w.clock.advance(23 * 3600 * 1000);
    w.forgetTokens(); // the 1h token has expired; this test is about the key window
    expect((await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: 'key-0000005' })).headers['idempotent-replayed']).toBe('true');
    w.clock.advance(2 * 3600 * 1000);
    w.forgetTokens();
    const later = await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: 'key-0000005' });
    expect(later.status).toBe(201);
    expect(later.body.id).not.toBe(first.body.id);
    expect(later.headers['idempotent-replayed']).toBeUndefined();
  });

  it('scopes keys to the credential: another client can use the same key', async () => {
    const a = await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: 'shared-key-1' });
    const b = await w.call('merchant_a2', 'POST', '/template/examples', { body: EXAMPLE, idem: 'shared-key-1' });
    expect(b.status).toBe(201);
    expect(b.body.id).not.toBe(a.body.id);
  });

  it('does not consume the key when validation fails', async () => {
    const bad = await w.call('merchant_a1', 'POST', '/template/examples', { body: { name: 'x' }, idem: 'key-0000006' });
    expect(bad.status).toBe(422);
    const good = await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: 'key-0000006' });
    expect(good.status).toBe(201);
  });

  it('does not store pipeline or server errors, so the retry works', async () => {
    const forced = await w.call('merchant_a1', 'POST', '/template/examples', {
      body: EXAMPLE,
      idem: 'key-0000007',
      headers: { 'moneybee-sandbox-force-error': 'internal_error' },
    });
    expect(forced.status).toBe(500);
    expect(forced.body.error.code).toBe('internal_error');
    const retry = await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: 'key-0000007' });
    expect(retry.status).toBe(201);
  });

  it('stores business errors from the handler and replays them', async () => {
    const ex = await w.call('partner_a', 'POST', '/template/examples', { body: EXAMPLE });
    const decide = { outcome: 'approve', reason_code: 'OK' };
    const first = await w.call('partner_a_reviewer', 'POST', `/template/examples/${ex.body.id}/decision`, { body: decide, idem: 'decide-key-1' });
    expect(first.status).toBe(200);
    const second = await w.call('partner_a_reviewer', 'POST', `/template/examples/${ex.body.id}/decision`, { body: decide, idem: 'decide-key-2' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('example_already_decided');
    const replay = await w.call('partner_a_reviewer', 'POST', `/template/examples/${ex.body.id}/decision`, { body: decide, idem: 'decide-key-2' });
    expect(replay.status).toBe(409);
    expect(replay.headers['idempotent-replayed']).toBe('true');
  });

  it('records a replay in the audit log', async () => {
    await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: 'key-0000008' });
    await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE, idem: 'key-0000008' });
    const rows = w.services.store.auditChain(w.world.tenants.merchant_a1!.id).filter((a) => a.action === 'createExample');
    expect(rows.map((r) => r.idempotentReplay)).toEqual([false, true]);
  });
});
