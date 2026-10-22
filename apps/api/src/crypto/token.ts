import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_PREFIX = 'mb_onb_';

/** 256-bit random, URL-safe, opaque. */
export function mintToken(): { token: string; hash: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

export function looksLikeToken(t: string): boolean {
  return t.startsWith(TOKEN_PREFIX) && /^[A-Za-z0-9_\-]+$/.test(t) && t.length === TOKEN_PREFIX.length + 43;
}

/** HMAC-SHA256 webhook signature over `${timestamp}.${body}`. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function verifyWebhook(opts: {
  secret: string;
  timestamp: string;
  body: string;
  signature: string;
  nowMs?: number;
  windowMs?: number;
}): boolean {
  const now = opts.nowMs ?? Date.now();
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now - ts * 1000) > (opts.windowMs ?? 5 * 60 * 1000)) return false;
  const expected = signWebhook(opts.secret, opts.timestamp, opts.body);
  const a = Buffer.from(expected);
  const b = Buffer.from(opts.signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Short-lived signed download URL parameters for a stored file. */
export function signFileUrl(secret: string, fileId: string, expUnix: number): string {
  return createHmac('sha256', secret).update(`file:${fileId}:${expUnix}`).digest('base64url');
}
export function verifyFileUrl(secret: string, fileId: string, expUnix: number, sig: string, nowMs = Date.now()): boolean {
  if (!Number.isFinite(expUnix) || expUnix * 1000 < nowMs) return false;
  const a = Buffer.from(signFileUrl(secret, fileId, expUnix));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
