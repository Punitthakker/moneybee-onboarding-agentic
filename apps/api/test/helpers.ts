import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { loadConfig } from '../src/config';
import { makeLogger } from '../src/logger';
import { buildCtx } from '../src/bootstrap';
import { createMemoryStore } from '../src/db/memory-store';
import { createMemoryRepository } from '../src/sql/memory-repository';
import { createMemoryBlobStore } from '../src/storage';
import { createApp } from '../src/app';
import { createInlineQueue } from '../src/queue';
import type { Role } from '@moneybee/shared';
import type { Ctx } from '../src/context';

export const EVAL_NOW = new Date('2026-10-22T08:00:00Z');

export async function makeTestApp(env: Record<string, string> = {}) {
  const cfg = loadConfig({ NODE_ENV: 'test', STORE: 'memory', REPO: 'memory', QUEUE_MODE: 'inline', LLM_MODE: 'mock', LOG_LEVEL: 'silent', JWT_SECRET: 'test-jwt-secret', PII_ENC_KEY: Buffer.alloc(32, 7).toString('base64'), WEBHOOK_BACKOFF_MS: '20', WEBHOOK_MAX_ATTEMPTS: '3', ...env });
  const clock = { now: EVAL_NOW };
  const ctx: Ctx = await buildCtx(cfg, makeLogger('silent'), { store: createMemoryStore(), repo: createMemoryRepository(), blobs: createMemoryBlobStore(), now: () => clock.now });
  const queue = createInlineQueue(() => ctx, { awaitPipeline: true }) as ReturnType<typeof createInlineQueue> & { idle(): Promise<void> };
  const app = createApp(ctx, queue);
  const users: Record<string, string> = {};
  // users without tenantId belong to the platform tenant (moneybee), like records created before tenancy
  for (const [role, email] of [['ADMIN', 'admin@t.local'], ['UNDERWRITER', 'uw@t.local'], ['UNDERWRITER', 'uw2@t.local'], ['SECOND_REVIEWER', 'sr@t.local'], ['VIEWER', 'v@t.local']] as [Role, string][]) {
    await ctx.store.users.create({ id: randomUUID(), email, name: email, role, passwordHash: await bcrypt.hash('pw-123456789', 4), active: true, createdAt: new Date().toISOString() });
    users[email] = email;
  }
  // white-label tenant users
  for (const [role, email] of [['ADMIN', 'admin@botim.test'], ['UNDERWRITER', 'uw@botim.test'], ['VIEWER', 'v@botim.test']] as [Role, string][]) {
    await ctx.store.users.create({ id: randomUUID(), tenantId: 'botim', email, name: email, role, passwordHash: await bcrypt.hash('pw-123456789', 4), active: true, createdAt: new Date().toISOString() });
    users[email] = email;
  }
  const login = async (email: string) => {
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email, password: 'pw-123456789' }).expect(200);
    return agent;
  };
  return { ctx, app, queue, login, clock };
}

export const CSRF = { 'x-moneybee-csrf': '1' };
