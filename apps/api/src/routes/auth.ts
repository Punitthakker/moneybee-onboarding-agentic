import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, clearSession, setSession, verifyLogin } from '../auth';
import type { Ctx } from '../context';
import { audit, wrap } from './util';

export function authRoutes(ctx: Ctx): Router {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
  r.post('/login', limiter, wrap(async (req, res) => {
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const u = await verifyLogin(ctx, email, password);
    if (!u) {
      await ctx.store.audit.add({ id: crypto.randomUUID(), actor: email, action: 'auth.login_failed', entity: 'auth', ip: req.ip ?? null, at: ctx.now().toISOString() });
      return res.status(401).json({ error: 'invalid credentials' });
    }
    setSession(ctx, res, u);
    req.user = { id: u.id, email: u.email, name: u.name, role: u.role };
    await audit(ctx, req, 'auth.login', `user:${u.id}`);
    res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role } });
  }));
  r.post('/logout', (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });
  r.get('/me', authenticate(ctx), (req, res) => res.json({ user: req.user }));
  return r;
}
