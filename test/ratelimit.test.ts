import { describe, expect, it } from 'vitest';
import { makeWorld } from './helpers.js';

describe('rate limiting', () => {
  it('returns 429 with Retry-After and the error envelope once the bucket is empty', async () => {
    const w = await makeWorld({ MB_RATE_LIMIT_PER_MIN: '5' });
    const token = await w.tokenFor('merchant_a1');
    const codes: number[] = [];
    let limited: any;
    for (let i = 0; i < 8; i++) {
      const r = await w.anon('GET', '/me', { token });
      codes.push(r.status);
      if (r.status === 429) limited = r;
    }
    expect(codes.filter((c) => c === 200).length).toBeGreaterThanOrEqual(4);
    expect(codes).toContain(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(limited.headers['ratelimit-remaining']).toBe('0');
    w.expectSpec('getCurrentContext', limited);
  });

  it('refills over time', async () => {
    const w = await makeWorld({ MB_RATE_LIMIT_PER_MIN: '5' });
    const token = await w.tokenFor('merchant_a1');
    for (let i = 0; i < 10; i++) await w.anon('GET', '/me', { token });
    expect((await w.anon('GET', '/me', { token })).status).toBe(429);
    w.clock.advance(30_000);
    expect((await w.anon('GET', '/me', { token })).status).toBe(200);
  });

  it('limits each client independently', async () => {
    const w = await makeWorld({ MB_RATE_LIMIT_PER_MIN: '3' });
    const a = await w.tokenFor('merchant_a1');
    const b = await w.tokenFor('merchant_a2');
    for (let i = 0; i < 6; i++) await w.anon('GET', '/me', { token: a });
    expect((await w.anon('GET', '/me', { token: a })).status).toBe(429);
    expect((await w.anon('GET', '/me', { token: b })).status).toBe(200);
  });

  it('does not store 429 responses for idempotent replay and does not audit them', async () => {
    const w = await makeWorld({ MB_RATE_LIMIT_PER_MIN: '4' });
    const before = w.services.store.auditChain(w.world.tenants.merchant_a1!.id).length;
    for (let i = 0; i < 12; i++) await w.call('merchant_a1', 'GET', '/me');
    const rows = w.services.store.auditChain(w.world.tenants.merchant_a1!.id).slice(before);
    expect(rows.every((r) => r.status !== 429)).toBe(true);
  });

  it('rate limits the token endpoint per source address', async () => {
    const w = await makeWorld({ MB_TOKEN_RATE_LIMIT_PER_MIN: '3' });
    const body = { contentType: 'application/x-www-form-urlencoded', raw: 'grant_type=client_credentials&client_id=mb_test_x&client_secret=y' };
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await w.anon('POST', '/oauth/token', body)).status);
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes).toContain(429);
  });
});
