import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/core/config.js';
import { FakeClock } from '../src/core/util.js';
import type { SendRequest, Sender } from '../src/core/webhooks.js';
import { seedSandbox, type SandboxWorld } from '../src/sandbox.js';

export interface CallOpts {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  /** Idempotency key. Generated automatically for non-GET calls. Pass false to omit it. */
  idem?: string | false;
  raw?: string;
  contentType?: string;
}

export interface Res {
  status: number;
  body: any;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

export interface World extends BuiltApp {
  world: SandboxWorld;
  clock: FakeClock;
  sent: SendRequest[];
  /** Controls what the fake webhook receiver answers. */
  setReceiver(fn: (r: SendRequest) => { status: number } | Promise<{ status: number }>): void;
  call(cred: string, method: string, path: string, opts?: CallOpts): Promise<Res>;
  anon(method: string, path: string, opts?: CallOpts & { token?: string }): Promise<Res>;
  tokenFor(cred: string): Promise<string>;
  /** Drops cached tokens so the next call authenticates again (use after moving the clock far ahead). */
  forgetTokens(): void;
  /** Asserts a response body matches what the spec declares for that operation and status. */
  expectSpec(operationId: string, res: Res): void;
}

const BASE = '/v1';

export async function makeWorld(env: Record<string, string> = {}, extra: { openapiDir?: string } = {}): Promise<World> {
  const config = loadConfig({
    MB_SIGNING_SECRET: 'test-signing-secret-that-is-long-enough-1234567890',
    MB_INCLUDE_TEMPLATE: 'true',
    MB_RESPONSE_VALIDATION: 'strict',
    MB_ALLOW_HTTP_LOOPBACK_WEBHOOKS: 'true',
    MB_RATE_LIMIT_PER_MIN: '100000',
    MB_TOKEN_RATE_LIMIT_PER_MIN: '100000',
    ...env,
  });
  const clock = new FakeClock();
  const sent: SendRequest[] = [];
  let receiver: (r: SendRequest) => { status: number } | Promise<{ status: number }> = () => ({ status: 200 });
  const sender: Sender = async (r) => {
    sent.push(r);
    return receiver(r);
  };
  const built = await buildApp({ config, clock, sender, logger: false, openapiDir: extra.openapiDir });
  const world = seedSandbox(built.services);
  const tokens = new Map<string, string>();

  const inject = async (method: string, path: string, headers: Record<string, string>, o: CallOpts): Promise<Res> => {
    const qs = Object.entries(o.query ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const hasBody = o.body !== undefined || o.raw !== undefined;
    const res = await built.app.inject({
      method: method as 'GET',
      url: `${BASE}${path}${qs ? `?${qs}` : ''}`,
      headers: {
        ...(hasBody ? { 'content-type': o.contentType ?? 'application/json' } : {}),
        ...headers,
        ...(o.headers ?? {}),
      },
      payload: o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body)),
    });
    let body: any;
    try {
      body = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      body = undefined;
    }
    return { status: res.statusCode, body, headers: res.headers as Res['headers'], text: res.body };
  };

  const tokenFor = async (cred: string) => {
    const hit = tokens.get(cred);
    if (hit) return hit;
    const c = world.credentials[cred]!;
    const res = await inject('POST', '/oauth/token', {}, {
      contentType: 'application/x-www-form-urlencoded',
      raw: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.secret }).toString(),
    });
    expect(res.status, `token for ${cred}: ${res.text}`).toBe(200);
    tokens.set(cred, res.body.access_token);
    return res.body.access_token as string;
  };

  const w: World = {
    ...built,
    world,
    clock,
    sent,
    setReceiver: (fn) => {
      receiver = fn;
    },
    tokenFor,
    forgetTokens: () => tokens.clear(),
    call: async (cred, method, path, o = {}) => {
      const token = await tokenFor(cred);
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (method !== 'GET' && o.idem !== false) headers['idempotency-key'] = o.idem ?? randomUUID();
      return inject(method, path, headers, o);
    },
    anon: async (method, path, o = {}) => {
      const headers: Record<string, string> = o.token ? { authorization: `Bearer ${o.token}` } : {};
      if (method !== 'GET' && o.idem !== false && o.idem) headers['idempotency-key'] = o.idem;
      return inject(method, path, headers, o);
    },
    expectSpec: (operationId, res) => {
      const op = built.services.spec.byId.get(operationId)!;
      const v = built.services.spec.validatorsFor(op).response(res.status);
      expect(v, `spec declares no ${res.status} response for ${operationId}`).not.toBeUndefined();
      if (v) expect(v(res.body), JSON.stringify(v.errors)).toBe(true);
    },
  };
  return w;
}

export const EXAMPLE = { name: 'Synthetic coffee order', amount_minor: 1500, currency: 'AED' };
