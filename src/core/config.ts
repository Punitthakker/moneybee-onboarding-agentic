import { z } from 'zod';
import type { Env } from './types.js';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const schema = z.object({
  MB_SIGNING_SECRET: z.string().min(32, 'MB_SIGNING_SECRET must be at least 32 characters'),
  MB_ENV: z.enum(['sandbox']).default('sandbox'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  MB_DOCS_BASE_URL: z.string().url().default('https://docs.moneybee.example'),
  MB_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(120),
  MB_TOKEN_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(30),
  MB_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  MB_IDEMPOTENCY_WINDOW_HOURS: z.coerce.number().min(0.0001).default(24),
  MB_ALLOW_HTTP_LOOPBACK_WEBHOOKS: bool.default('false'),
  MB_INCLUDE_TEMPLATE: bool.default('false'),
  MB_RESPONSE_VALIDATION: z.enum(['off', 'warn', 'strict']).default('warn'),
  MB_WEBHOOK_BACKOFF_SECONDS: z.string().default('0,30,120,600,3600,21600'),
  MB_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(100).default(10000),
});

export interface Config {
  signingSecret: string;
  env: Env;
  port: number;
  docsBaseUrl: string;
  rateLimitPerMin: number;
  tokenRateLimitPerMin: number;
  tokenTtlSeconds: number;
  idempotencyWindowMs: number;
  allowHttpLoopbackWebhooks: boolean;
  includeTemplate: boolean;
  responseValidation: 'off' | 'warn' | 'strict';
  /** Seconds before each delivery attempt. The first entry is the initial attempt. */
  webhookBackoffSeconds: number[];
  webhookTimeoutMs: number;
  /** Dated versions this server accepts in MoneyBee-Version. The first entry is the default. */
  supportedVersions: string[];
}

export const API_VERSIONS = ['2026-10-24'];

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const c = parsed.data;
  return {
    signingSecret: c.MB_SIGNING_SECRET,
    env: c.MB_ENV,
    port: c.PORT,
    docsBaseUrl: c.MB_DOCS_BASE_URL.replace(/\/$/, ''),
    rateLimitPerMin: c.MB_RATE_LIMIT_PER_MIN,
    tokenRateLimitPerMin: c.MB_TOKEN_RATE_LIMIT_PER_MIN,
    tokenTtlSeconds: c.MB_TOKEN_TTL_SECONDS,
    idempotencyWindowMs: c.MB_IDEMPOTENCY_WINDOW_HOURS * 3600 * 1000,
    allowHttpLoopbackWebhooks: c.MB_ALLOW_HTTP_LOOPBACK_WEBHOOKS,
    includeTemplate: c.MB_INCLUDE_TEMPLATE,
    responseValidation: c.MB_RESPONSE_VALIDATION,
    webhookBackoffSeconds: c.MB_WEBHOOK_BACKOFF_SECONDS.split(',').map((s) => Number(s.trim())),
    webhookTimeoutMs: c.MB_WEBHOOK_TIMEOUT_MS,
    supportedVersions: API_VERSIONS,
  };
}
