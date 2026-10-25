import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { publicTenantView } from '@moneybee/shared';
import { authenticate, clearSession, setSession, toAuthUser, verifyLogin } from '../auth';
import type { Ctx } from '../context';
import { tenantOf } from '../db/tenant-scope';
import { audit, wrap } from './util';

export function authRoutes(ctx: Ctx): Router {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
  r.post('/login', limiter, wrap(async (req, res) => {
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const u = await verifyLogin(ctx, email, password);
    const tenant = u ? ctx.tenants.get(tenantOf(u)) : null;
    if (!u || !tenant || tenant.status !== 'active') {
      await ctx.store.audit.add({ id: crypto.randomUUID(), tenantId: u ? tenantOf(u) : undefined, actor: email, action: 'auth.login_failed', entity: 'auth', ip: req.ip ?? null, at: ctx.now().toISOString() });
      return res.status(401).json({ error: 'invalid credentials' });
    }
    setSession(ctx, res, u);
    req.user = toAuthUser(u);
    req.tenantId = tenant.id;
    await audit(ctx, req, 'auth.login', `user:${u.id}`);
    res.json({ user: req.user, tenant: publicTenantView(tenant) });
  }));
  r.post('/logout', (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });
  r.get('/me', authenticate(ctx), (req, res) => res.json({ user: req.user, tenant: publicTenantView(ctx.tenants.getOrDefault(req.tenantId)) }));
  return r;
}
