import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it } from 'vitest';
import { fetchSender, verifySignature } from '../src/core/webhooks.js';
import { EXAMPLE, type World, makeWorld } from './helpers.js';

const HOUR = 3600 * 1000;

describe('webhooks', () => {
  let w: World;
  beforeEach(async () => {
    w = await makeWorld();
  });

  const register = async (cred = 'merchant_a1', events: string[] = ['example.created']) => {
    const res = await w.call(cred, 'POST', '/webhook-endpoints', { body: { url: 'http://127.0.0.1:9/hook', events } });
    expect(res.status).toBe(201);
    w.expectSpec('createWebhookEndpoint', res);
    return res.body as { id: string; secret: string };
  };
  const create = (cred = 'merchant_a1') => w.call(cred, 'POST', '/template/examples', { body: EXAMPLE });
  // Tests move the clock by hours, so tokens (1h) expire. Re-authenticate before reading.
  const deliveries = async (cred = 'merchant_a1') => {
    w.forgetTokens();
    const res = await w.call(cred, 'GET', '/webhook-deliveries');
    expect(res.status).toBe(200);
    return res.body.data as any[];
  };

  it('shows the secret once and never again', async () => {
    const ep = await register();
    expect(ep.secret).toMatch(/^whsec_/);
    const list = await w.call('merchant_a1', 'GET', '/webhook-endpoints');
    expect(JSON.stringify(list.body)).not.toContain(ep.secret);
    w.expectSpec('listWebhookEndpoints', list);
  });

  it('delivers a signed event that the documented verification accepts', async () => {
    const ep = await register();
    const ex = await create();
    await w.services.worker.tick();
    expect(w.sent).toHaveLength(1);
    const req = w.sent[0]!;
    const nowSec = Math.floor(w.clock.now().getTime() / 1000);
    expect(verifySignature(req.headers['MoneyBee-Signature']!, req.body, ep.secret, nowSec)).toBe(true);
    expect(verifySignature(req.headers['MoneyBee-Signature']!, `${req.body} `, ep.secret, nowSec)).toBe(false);
    expect(verifySignature(req.headers['MoneyBee-Signature']!, req.body, 'whsec_wrong', nowSec)).toBe(false);
    expect(verifySignature(req.headers['MoneyBee-Signature']!, req.body, ep.secret, nowSec + 301)).toBe(false);
    const evt = JSON.parse(req.body);
    expect(evt).toMatchObject({ object: 'event', type: 'example.created', data_version: 1, api_version: '2026-10-24', livemode: false });
    expect(evt.data.example_id).toBe(ex.body.id);
    expect(req.headers['MoneyBee-Event-Type']).toBe('example.created');
    expect(req.headers['MoneyBee-Delivery-Attempt']).toBe('1');
    const [d] = await deliveries();
    expect(d).toMatchObject({ status: 'delivered' });
    expect(d.attempts).toHaveLength(1);
  });

  it('only sends events the endpoint subscribed to; * subscribes to all', async () => {
    await register('merchant_a1', ['example.decided']);
    await create();
    await w.services.worker.tick();
    expect(w.sent).toHaveLength(0);
    await register('merchant_a1', ['*']);
    await create();
    await w.services.worker.tick();
    expect(w.sent).toHaveLength(1);
  });

  it('retries with backoff and gives up after six attempts', async () => {
    await register();
    w.setReceiver(() => ({ status: 500 }));
    await create();
    await w.services.worker.tick();
    expect((await deliveries())[0]).toMatchObject({ status: 'pending' });
    // not due yet: a tick right away does nothing
    await w.services.worker.tick();
    expect(w.sent).toHaveLength(1);
    for (let i = 0; i < 8; i++) {
      w.clock.advance(7 * HOUR);
      await w.services.worker.tick();
    }
    expect(w.sent).toHaveLength(6);
    const [d] = await deliveries();
    expect(d.status).toBe('failed');
    expect(d.next_attempt_at).toBeNull();
    expect(d.attempts.map((a: any) => a.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(d.attempts.every((a: any) => a.status_code === 500)).toBe(true);
    w.forgetTokens();
    w.expectSpec('listWebhookDeliveries', await w.call('merchant_a1', 'GET', '/webhook-deliveries'));
  });

  it('schedules the second attempt about 30 seconds later, within the jitter window', async () => {
    await register();
    w.setReceiver(() => ({ status: 503 }));
    await create();
    await w.services.worker.tick();
    const [d] = await deliveries();
    const delay = (new Date(d.next_attempt_at).getTime() - w.clock.now().getTime()) / 1000;
    expect(delay).toBeGreaterThanOrEqual(24);
    expect(delay).toBeLessThanOrEqual(36);
  });

  it('succeeds on a later attempt and stops', async () => {
    await register();
    let n = 0;
    w.setReceiver(() => ({ status: ++n < 3 ? 500 : 200 }));
    await create();
    for (let i = 0; i < 5; i++) {
      await w.services.worker.tick();
      w.clock.advance(HOUR);
    }
    expect(w.sent).toHaveLength(3);
    expect((await deliveries())[0].status).toBe('delivered');
  });

  it('treats redirects and timeouts as failures', async () => {
    await register();
    w.setReceiver(() => ({ status: 302 }));
    await create();
    await w.services.worker.tick();
    expect((await deliveries())[0]).toMatchObject({ status: 'pending' });
    w.setReceiver(() => {
      throw new Error('boom');
    });
    w.clock.advance(HOUR);
    await w.services.worker.tick();
    const [d] = await deliveries();
    expect(d.attempts[1].status_code).toBeNull();
    expect(d.attempts[1].error).toBe('Error');
  });

  it('replays an event, to all endpoints or to one', async () => {
    const a = await register();
    const b = await register();
    await create();
    await w.services.worker.tick();
    expect(w.sent).toHaveLength(2);
    const evs = (await w.call('merchant_a1', 'GET', '/events')).body.data.filter((e: any) => e.type === 'example.created');
    const all = await w.call('merchant_a1', 'POST', `/events/${evs[0].id}/replay`, { body: {} });
    expect(all.status).toBe(202);
    expect(all.body.delivery_ids).toHaveLength(2);
    w.expectSpec('replayEvent', all);
    await w.services.worker.tick();
    expect(w.sent).toHaveLength(4);
    const one = await w.call('merchant_a1', 'POST', `/events/${evs[0].id}/replay`, { body: { endpoint_id: a.id } });
    expect(one.body.delivery_ids).toHaveLength(1);
    const missing = await w.call('merchant_a1', 'POST', `/events/${evs[0].id}/replay`, { body: { endpoint_id: 'whe_doesnotexist1' } });
    expect(missing.status).toBe(404);
    expect(b.id).not.toBe(a.id);
  });

  it('cancels pending deliveries when an endpoint is disabled', async () => {
    const ep = await register();
    w.setReceiver(() => ({ status: 500 }));
    await create();
    await w.services.worker.tick();
    const del = await w.call('merchant_a1', 'DELETE', `/webhook-endpoints/${ep.id}`);
    expect(del.status).toBe(200);
    expect(del.body.status).toBe('disabled');
    w.clock.advance(HOUR);
    await w.services.worker.tick();
    expect(w.sent).toHaveLength(1);
    expect((await deliveries())[0].status).toBe('cancelled');
    w.forgetTokens();
    await create();
    await w.services.worker.tick();
    expect(w.sent).toHaveLength(1);
  });

  it('sends a ping and records it as an event', async () => {
    const ep = await register();
    const res = await w.call('merchant_a1', 'POST', `/webhook-endpoints/${ep.id}/ping`);
    expect(res.status).toBe(202);
    w.expectSpec('pingWebhookEndpoint', res);
    await w.services.worker.tick();
    expect(JSON.parse(w.sent[0]!.body).type).toBe('webhook.ping');
  });

  it('delivers merchant events to a partner endpoint, not to a sibling merchant endpoint', async () => {
    await register('partner_a', ['example.created']);
    await register('merchant_a2', ['example.created']);
    await create('merchant_a1');
    await w.services.worker.tick();
    expect(w.sent).toHaveLength(1);
    const dels = await deliveries('partner_a');
    expect(dels).toHaveLength(1);
    expect(await deliveries('merchant_a2')).toHaveLength(0);
  });

  it('does not deliver events from other partners', async () => {
    await register('partner_b', ['example.created']);
    await create('merchant_a1');
    await w.services.worker.tick();
    expect(w.sent).toHaveLength(0);
  });

  it('works end to end over real HTTP to a local receiver', async () => {
    const received: { headers: any; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = 204;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const port = (server.address() as AddressInfo).port;
      const real = await makeWorld();
      // swap in the real sender
      (real.services.worker as any).sender = fetchSender;
      const ep = await real.call('merchant_a1', 'POST', '/webhook-endpoints', { body: { url: `http://127.0.0.1:${port}/hook`, events: ['example.created'] } });
      await real.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE });
      await real.services.worker.tick();
      expect(received).toHaveLength(1);
      const sig = received[0]!.headers['moneybee-signature'] as string;
      expect(verifySignature(sig, received[0]!.body, ep.body.secret, Math.floor(real.clock.now().getTime() / 1000))).toBe(true);
      const d = (await real.call('merchant_a1', 'GET', '/webhook-deliveries')).body.data[0];
      expect(d.status).toBe('delivered');
      expect(d.attempts[0].status_code).toBe(204);
    } finally {
      server.close();
    }
  });
});
