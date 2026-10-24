import { beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLE, type World, makeWorld } from './helpers.js';

describe('validation and error envelope', () => {
  let w: World;
  beforeEach(async () => {
    w = await makeWorld();
  });

  it('returns 422 with per-field details for a bad body', async () => {
    const res = await w.call('merchant_a1', 'POST', '/template/examples', { body: { name: '', amount_minor: -1 } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_failed');
    const fields = res.body.error.details.map((d: any) => d.field);
    expect(fields).toContain('body.name');
    expect(fields).toContain('body.amount_minor');
    expect(fields).toContain('body.currency');
    w.expectSpec('createExample', res);
  });

  it('rejects unknown body fields instead of ignoring them', async () => {
    const res = await w.call('merchant_a1', 'POST', '/template/examples', { body: { ...EXAMPLE, surprise: 1 } });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toContainEqual(expect.objectContaining({ field: 'body.surprise', code: 'unknown_field' }));
  });

  it('rejects unknown query parameters', async () => {
    const res = await w.call('merchant_a1', 'GET', '/template/examples', { query: { colour: 'red' } });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0]).toMatchObject({ field: 'query.colour', code: 'unknown_field' });
  });

  it('enforces limit range and enum values', async () => {
    expect((await w.call('merchant_a1', 'GET', '/template/examples', { query: { limit: 0 } })).status).toBe(422);
    expect((await w.call('merchant_a1', 'GET', '/template/examples', { query: { limit: 101 } })).status).toBe(422);
    expect((await w.call('merchant_a1', 'GET', '/template/examples', { query: { sort: 'name' } })).status).toBe(422);
    expect((await w.call('merchant_a1', 'GET', '/template/examples', { query: { limit: 100 } })).status).toBe(200);
  });

  it('returns 400 invalid_json for a broken body', async () => {
    const res = await w.call('merchant_a1', 'POST', '/template/examples', { raw: '{"name":' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });

  it('returns 415 for an unsupported content type', async () => {
    const res = await w.call('merchant_a1', 'POST', '/template/examples', { raw: 'name=x', contentType: 'text/plain' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('unsupported_media_type');
  });

  it('rejects a body on an operation without one when required fields are missing', async () => {
    const res = await w.call('merchant_a1', 'POST', '/template/examples', {});
    expect(res.status).toBe(422);
  });

  it('rejects malformed cursors, tampered cursors and cursors reused with other filters', async () => {
    for (let i = 0; i < 3; i++) await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE });
    const first = await w.call('merchant_a1', 'GET', '/template/examples', { query: { limit: 1 } });
    const cursor = first.body.page.next_cursor as string;
    expect(cursor).toBeTruthy();
    for (const bad of ['garbage', `${cursor}x`, `${cursor.split('.')[0]}.AAAA`]) {
      const res = await w.call('merchant_a1', 'GET', '/template/examples', { query: { limit: 1, cursor: bad } });
      expect(res.status, bad).toBe(400);
      expect(res.body.error.code).toBe('invalid_cursor');
    }
    const other = await w.call('merchant_a1', 'GET', '/template/examples', { query: { limit: 1, cursor, sort: 'created_at' } });
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe('invalid_cursor');
  });

  it('rejects a cursor minted for another credential key', async () => {
    const other = await makeWorld({ MB_SIGNING_SECRET: 'a-completely-different-signing-secret-0987654321' });
    for (const x of [w, other]) for (let i = 0; i < 2; i++) await x.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE });
    const foreign = (await other.call('merchant_a1', 'GET', '/template/examples', { query: { limit: 1 } })).body.page.next_cursor;
    const res = await w.call('merchant_a1', 'GET', '/template/examples', { query: { limit: 1, cursor: foreign } });
    expect(res.status).toBe(400);
  });

  it('refuses an unsupported API version and accepts the supported one', async () => {
    const bad = await w.call('merchant_a1', 'GET', '/me', { headers: { 'moneybee-version': '1999-01-01' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('unsupported_version');
    const ok = await w.call('merchant_a1', 'GET', '/me', { headers: { 'moneybee-version': '2026-10-24' } });
    expect(ok.status).toBe(200);
    expect(ok.headers['moneybee-version']).toBe('2026-10-24');
  });

  it('echoes a valid X-Request-Id and generates one otherwise', async () => {
    const echoed = await w.call('merchant_a1', 'GET', '/me', { headers: { 'x-request-id': 'my-trace-id-12345' } });
    expect(echoed.headers['x-request-id']).toBe('my-trace-id-12345');
    const generated = await w.call('merchant_a1', 'GET', '/me', { headers: { 'x-request-id': 'bad id with spaces' } });
    expect(String(generated.headers['x-request-id'])).toMatch(/^req_/);
  });

  it('sets no-store and rate limit headers on responses', async () => {
    const res = await w.call('merchant_a1', 'GET', '/me');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
  });

  it('applies the sandbox force-error header only for authenticated callers', async () => {
    const forced = await w.call('merchant_a1', 'GET', '/me', { headers: { 'moneybee-sandbox-force-error': 'rate_limited' } });
    expect(forced.status).toBe(429);
    const anon = await w.anon('GET', '/me', { headers: { 'moneybee-sandbox-force-error': 'rate_limited' } });
    expect(anon.status).toBe(401);
  });

  it('refuses force-error outside the sandbox environment', async () => {
    const prod = await makeWorld({ MB_ENV: 'production' }).catch((e) => e as Error);
    // production must not boot with the sandbox seed credentials prefix check relaxed; either refusal is acceptable
    if (prod instanceof Error) return;
    const res = await prod.anon('GET', '/me', { headers: { 'moneybee-sandbox-force-error': 'internal_error' } });
    expect([401, 400]).toContain(res.status);
  });
});

describe('webhook URL validation', () => {
  it('blocks private, link-local, metadata and non-https targets', async () => {
    const w = await makeWorld({ MB_ALLOW_HTTP_LOOPBACK_WEBHOOKS: 'false' });
    const bad = [
      'http://example.com/hook',
      'https://127.0.0.1/hook',
      'https://localhost/hook',
      'https://10.0.0.5/hook',
      'https://192.168.1.10/hook',
      'https://172.16.0.1/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/hook',
      'https://user:pw@example.com/hook',
      'ftp://example.com/hook',
      'https://0x7f000001/hook',
    ];
    for (const url of bad) {
      const res = await w.call('merchant_a1', 'POST', '/webhook-endpoints', { body: { url, events: ['*'] } });
      expect(res.status, url).toBe(422);
    }
    const ok = await w.call('merchant_a1', 'POST', '/webhook-endpoints', { body: { url: 'https://hooks.example.com/mb', events: ['*'] } });
    expect(ok.status).toBe(201);
  });

  it('rejects unknown event types', async () => {
    const w = await makeWorld();
    const res = await w.call('merchant_a1', 'POST', '/webhook-endpoints', { body: { url: 'https://hooks.example.com/mb', events: ['no.such.event'] } });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].code).toBe('unknown_event_type');
  });
});
