import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { Config } from './config.js';
import type { ErrorDetail } from './errors.js';
import type { AttemptRec, DeliveryRec, MemoryStore } from './store.js';
import { type Clock, safeEqual } from './util.js';
import { eventToApi } from './events.js';

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

/** HMAC-SHA256 over `{timestamp}.{raw body}`. */
export function signPayload(secret: string, timestampSec: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestampSec}.${body}`).digest('hex');
}

export function signatureHeader(secret: string, timestampSec: number, body: string): string {
  return `t=${timestampSec},v1=${signPayload(secret, timestampSec, body)}`;
}

/** Receiver-side check. Also the reference for the SDK. Rejects stale timestamps to stop replays. */
export function verifySignature(header: string, body: string, secret: string, nowSec: number, toleranceSec = SIGNATURE_TOLERANCE_SECONDS): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  return safeEqual(parts.v1, signPayload(secret, t, body));
}

function ipv4Private(host: string): boolean {
  const [a, b] = host.split('.').map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * Refuses URLs that point inside the network (SSRF). Literal IPs and well-known internal names are checked here.
 * Production must also resolve DNS at delivery time and pin the connection to a public address, which this does not do.
 */
export function validateWebhookUrl(raw: string, allowHttpLoopback: boolean): ErrorDetail[] {
  const bad = (message: string): ErrorDetail[] => [{ field: 'body.url', code: 'url_not_allowed', message }];
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return bad('Not a valid URL.');
  }
  if (u.username || u.password) return bad('Credentials in the URL are not allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (loopback && allowHttpLoopback && (u.protocol === 'http:' || u.protocol === 'https:')) return [];
  if (u.protocol !== 'https:') return bad('Only https URLs are allowed.');
  if (loopback || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return bad('Internal hosts are not allowed.');
  const ver = isIP(host);
  if (ver === 4 && ipv4Private(host)) return bad('Private and link-local addresses are not allowed.');
  if (ver === 6 && (host === '::' || /^(fc|fd|fe[89ab])/.test(host) || host.startsWith('::ffff:'))) return bad('Private and link-local addresses are not allowed.');
  return [];
}

export interface SendRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}
export type Sender = (req: SendRequest) => Promise<{ status: number }>;

/** Default sender. Redirects are not followed: a 3xx counts as a failed attempt, which blocks redirect-based SSRF. */
export const fetchSender: Sender = async (req) => {
  const res = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(req.timeoutMs),
  });
  await res.body?.cancel();
  return { status: res.status };
};

/**
 * Delivers pending webhooks. `tick()` sends everything that is due. The server calls it on a timer; tests call it
 * directly with a fake clock. Delivery is at least once: receivers must deduplicate on the event id.
 * In-memory queue: a crash loses pending deliveries. Production needs a durable queue.
 */
export class WebhookWorker {
  private inFlight = new Set<string>();
  constructor(
    private store: MemoryStore,
    private cfg: Config,
    private clock: Clock,
    private sender: Sender = fetchSender,
    private rng: () => number = Math.random,
  ) {}

  /** Seconds to wait before attempt number `n` (0-based). Plus or minus 20 percent jitter after the first. */
  delaySeconds(n: number): number {
    const base = this.cfg.webhookBackoffSeconds[n] ?? 0;
    return n === 0 ? base : base * (0.8 + this.rng() * 0.4);
  }

  async tick(): Promise<{ attempted: number }> {
    const now = this.clock.now();
    const due = this.store
      .allDeliveriesInternal()
      .filter((d) => d.status === 'pending' && d.nextAttemptAt && new Date(d.nextAttemptAt) <= now && !this.inFlight.has(d.id));
    await Promise.all(due.map((d) => this.attempt(d)));
    return { attempted: due.length };
  }

  private async attempt(d: DeliveryRec) {
    this.inFlight.add(d.id);
    try {
      const endpoint = this.store.getEndpointInternal(d.endpointId);
      const event = this.store.getEventInternal(d.eventId);
      if (!endpoint || endpoint.status !== 'active' || !event) {
        d.status = 'cancelled';
        d.nextAttemptAt = null;
        return;
      }
      const body = JSON.stringify(eventToApi(event));
      const startedAt = this.clock.now();
      const nowSec = Math.floor(startedAt.getTime() / 1000);
      const number = d.attempts.length + 1;
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'MoneyBee-Webhooks/1',
        'MoneyBee-Signature': signatureHeader(endpoint.secret, nowSec, body),
        'MoneyBee-Event-Id': event.id,
        'MoneyBee-Event-Type': event.type,
        'MoneyBee-Delivery-Id': d.id,
        'MoneyBee-Delivery-Attempt': String(number),
      };
      const t0 = Date.now();
      const attempt: AttemptRec = { number, at: startedAt.toISOString(), statusCode: null, error: null, durationMs: 0 };
      try {
        const res = await this.sender({ url: endpoint.url, headers, body, timeoutMs: this.cfg.webhookTimeoutMs });
        attempt.statusCode = res.status;
        if (res.status < 200 || res.status >= 300) attempt.error = `HTTP ${res.status}`;
      } catch (err) {
        attempt.error = err instanceof Error ? err.name : 'error';
      }
      attempt.durationMs = Date.now() - t0;
      d.attempts.push(attempt);
      if (attempt.error === null) {
        d.status = 'delivered';
        d.nextAttemptAt = null;
      } else if (d.attempts.length >= this.cfg.webhookBackoffSeconds.length) {
        d.status = 'failed';
        d.nextAttemptAt = null;
      } else {
        d.nextAttemptAt = new Date(this.clock.now().getTime() + this.delaySeconds(d.attempts.length) * 1000).toISOString();
      }
    } finally {
      this.inFlight.delete(d.id);
    }
  }
}
