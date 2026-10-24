import type { Clock } from './util.js';

export interface RateResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until a full window is available again. */
  resetSeconds: number;
  /** Seconds until one more request is allowed. Only meaningful when not allowed. */
  retryAfterSeconds: number;
}

/** Token bucket. Capacity equals the per-minute limit and refills continuously. In-memory: use Redis when running more than one replica. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private clock: Clock) {}

  take(key: string, perMinute: number): RateResult {
    const now = this.clock.now().getTime();
    const ratePerMs = perMinute / 60000;
    const b = this.buckets.get(key) ?? { tokens: perMinute, at: now };
    b.tokens = Math.min(perMinute, b.tokens + (now - b.at) * ratePerMs);
    b.at = now;
    let allowed = false;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      allowed = true;
    }
    this.buckets.set(key, b);
    return {
      allowed,
      limit: perMinute,
      remaining: Math.floor(b.tokens),
      resetSeconds: Math.ceil((perMinute - b.tokens) / (ratePerMs * 1000)),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((1 - b.tokens) / (ratePerMs * 1000))),
    };
  }
}
