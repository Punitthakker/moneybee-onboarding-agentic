import { beforeEach, describe, expect, it } from 'vitest';
import { provisionClient } from '../src/sandbox.js';
import { type World, makeWorld } from './helpers.js';

const form = (o: Record<string, string>) => ({ contentType: 'application/x-www-form-urlencoded', raw: new URLSearchParams(o).toString() });

describe('authentication and authorisation', () => {
  let w: World;
  beforeEach(async () => {
    w = await makeWorld();
  });

  it('issues a token for valid client credentials', async () => {
    const c = w.world.credentials.partner_a!;
    const res = await w.anon('POST', '/oauth/token', form({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.secret }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    expect(res.headers['cache-control']).toBe('no-store');
    w.expectSpec('createAccessToken', res);
  });

  it('accepts HTTP Basic client authentication', async () => {
    const c = w.world.credentials.partner_a!;
    const basic = Buffer.from(`${c.clientId}:${c.secret}`).toString('base64');
    const res = await w.anon('POST', '/oauth/token', { ...form({ grant_type: 'client_credentials' }), headers: { authorization: `Basic ${basic}` } });
    expect(res.status).toBe(200);
  });

  it('rejects credentials sent both ways', async () => {
    const c = w.world.credentials.partner_a!;
    const basic = Buffer.from(`${c.clientId}:${c.secret}`).toString('base64');
    const res = await w.anon('POST', '/oauth/token', {
      ...form({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.secret }),
      headers: { authorization: `Basic ${basic}` },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns RFC 6749 errors at the token endpoint, with a request id', async () => {
    const c = w.world.credentials.partner_a!;
    const bad = await w.anon('POST', '/oauth/token', form({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: 'wrong' }));
    expect(bad.status).toBe(401);
    expect(bad.body).toMatchObject({ error: 'invalid_client' });
    expect(bad.body.request_id).toMatch(/^req_/);
    w.expectSpec('createAccessToken', bad);

    const grant = await w.anon('POST', '/oauth/token', form({ grant_type: 'password', client_id: c.clientId, client_secret: c.secret }));
    expect(grant.status).toBe(400);
    expect(grant.body.error).toBe('invalid_request');
  });

  it('does not tell a wrong id from a wrong secret', async () => {
    const c = w.world.credentials.partner_a!;
    const a = await w.anon('POST', '/oauth/token', form({ grant_type: 'client_credentials', client_id: 'mb_test_nope', client_secret: c.secret }));
    const b = await w.anon('POST', '/oauth/token', form({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: 'nope' }));
    expect(a.body.error_description).toBe(b.body.error_description);
  });

  it('refuses a live-prefixed credential on the sandbox host', async () => {
    const res = await w.anon('POST', '/oauth/token', form({ grant_type: 'client_credentials', client_id: 'mb_live_abc', client_secret: 'x' }));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('narrows scopes on request and rejects scopes the client does not hold', async () => {
    const c = w.world.credentials.merchant_a1!;
    const ok = await w.anon('POST', '/oauth/token', form({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.secret, scope: 'events:read' }));
    expect(ok.body.scope).toBe('events:read');
    const bad = await w.anon('POST', '/oauth/token', form({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.secret, scope: 'template:examples.decide' }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_scope');
  });

  it('cannot give a merchant a scope its level may not hold', async () => {
    expect(() => provisionClient(w.services, w.world.tenants.merchant_a1!.id, { scopes: ['template:examples.decide'] })).toThrow(/cannot be held by a merchant/);
    expect(() => provisionClient(w.services, w.world.tenants.merchant_a1!.id, { scopes: ['no:such.scope'] })).toThrow(/unknown scope/);
  });

  it('rejects a missing, malformed or forged bearer token with the error envelope', async () => {
    for (const token of [undefined, 'garbage', 'a.b.c']) {
      const res = await w.anon('GET', '/me', { token });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({ code: 'unauthenticated' });
      expect(res.body.error.request_id).toMatch(/^req_/);
      expect(res.body.error.doc_url).toBe('https://docs.moneybee.example/errors/unauthenticated');
      expect(res.headers['www-authenticate']).toBe('Bearer');
      w.expectSpec('getCurrentContext', res);
    }
  });

  it('rejects a token signed with another key', async () => {
    const other = await makeWorld({ MB_SIGNING_SECRET: 'a-completely-different-signing-secret-0987654321' });
    const foreign = await other.tokenFor('partner_a');
    const res = await w.anon('GET', '/me', { token: foreign });
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = await w.tokenFor('partner_a');
    expect((await w.anon('GET', '/me', { token })).status).toBe(200);
    w.clock.advance(3601 * 1000);
    expect((await w.anon('GET', '/me', { token })).status).toBe(401);
  });

  it('stops honouring tokens the moment a client is disabled', async () => {
    const token = await w.tokenFor('merchant_a1');
    expect((await w.anon('GET', '/me', { token })).status).toBe(200);
    w.services.store.disableClient(w.world.credentials.merchant_a1!.clientId);
    expect((await w.anon('GET', '/me', { token })).status).toBe(401);
  });

  it('returns the caller context from the credential only', async () => {
    const res = await w.call('merchant_a1', 'GET', '/me');
    expect(res.status).toBe(200);
    expect(res.body.tenant).toEqual({ id: w.world.tenants.merchant_a1!.id, level: 'merchant', parent_id: w.world.tenants.partner_a!.id });
    expect(res.body.actor.type).toBe('service');
    expect(res.body.environment).toBe('sandbox');
    w.expectSpec('getCurrentContext', res);
  });

  it('refuses an operation when the token lacks the scope, and records the refusal', async () => {
    const c = w.world.credentials.merchant_a1!;
    const t = await w.anon('POST', '/oauth/token', form({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.secret, scope: 'events:read' }));
    const res = await w.anon('GET', '/webhook-endpoints', { token: t.body.access_token });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('insufficient_scope');
    w.expectSpec('listWebhookEndpoints', res);
    const audit = w.services.store.auditChain(w.world.tenants.merchant_a1!.id).filter((a) => a.action === 'listWebhookEndpoints');
    expect(audit[0]).toMatchObject({ result: 'denied', status: 403, errorCode: 'insufficient_scope' });
  });

  it('serves unknown routes with the error envelope', async () => {
    const res = await w.anon('GET', '/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
