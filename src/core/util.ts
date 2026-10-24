import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

/** Controllable clock for tests. */
export class FakeClock implements Clock {
  constructor(private t = new Date('2026-10-24T12:00:00.000Z')) {}
  now() {
    return new Date(this.t.getTime());
  }
  advance(ms: number) {
    this.t = new Date(this.t.getTime() + ms);
  }
  set(d: Date) {
    this.t = d;
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Compare against itself to keep timing flat, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** JSON with sorted object keys. Used for hashing so key order never changes a hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export const ZERO_HASH = '0'.repeat(64);
