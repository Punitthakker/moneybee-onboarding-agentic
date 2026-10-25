import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { RoleSchema } from '@moneybee/shared';
import { authenticate, requirePlatform, requireRole } from '../auth';
import { tenantOf } from '../db/tenant-scope';
import type { Ctx } from '../context';
import { audit, HttpError, wrap } from './util';

export function adminRoutes(ctx: Ctx): Router {
  const r = Router();
  const auth = authenticate(ctx);
  const admin = requireRole(); // ADMIN only (requireRole always lets ADMIN through)
  // global settings, policies and acquirer config affect every tenant: platform (MoneyBee) admins only
  const platform = requirePlatform(ctx);

  r.get('/acquirers', auth, wrap(async (_req, res) => {
    res.json({ acquirers: (await ctx.policies.acquirers()).map((a) => ({ code: a.code, label: a.label, example: a.example })) });
  }));

  r.get('/settings', auth, admin, platform, wrap(async (_req, res) => {
    const s = await ctx.store.settings.get();
    res.json({
      tokenTtlHours: s.tokenTtlHours ?? (await ctx.policies.active()).base.tokenTtlHours ?? ctx.cfg.TOKEN_TTL_HOURS,
      webhookUrl: s.webhookUrl ?? ctx.cfg.ONBOARDING_WEBHOOK_URL ?? '',
      webhookSecretSet: !!(s.webhookSecretEnc || ctx.cfg.ONBOARDING_WEBHOOK_SECRET),
      llmMode: ctx.llm.isMock ? 'mock' : 'live',
      screeningProvider: ctx.screening.name,
      screeningIsMock: ctx.screening.isMock,
      model: ctx.llm.modelName,
    });
  }));
  r.put('/settings', auth, admin, platform, wrap(async (req, res) => {
    const b = z.object({ tokenTtlHours: z.number().positive().max(24 * 30).optional(), webhookUrl: z.string().url().or(z.literal('')).optional(), webhookSecret: z.string().min(16).max(200).optional() }).parse(req.body);
    const cur = await ctx.store.settings.get();
    const next = { ...cur };
    if (b.tokenTtlHours !== undefined) next.tokenTtlHours = b.tokenTtlHours;
    if (b.webhookUrl !== undefined) next.webhookUrl = b.webhookUrl || undefined;
    if (b.webhookSecret) next.webhookSecretEnc = ctx.cipher.encrypt(b.webhookSecret);
    await ctx.store.settings.set(next);
    await audit(ctx, req, 'settings.updated', 'settings', { keys: Object.keys(b) });
    res.json({ ok: true });
  }));

  r.get('/settings/policy', auth, wrap(async (_req, res) => {
    const p = await ctx.policies.active();
    res.json({ version: p.version, base: p.base, acquirers: p.acquirers, by: p.by, at: p.at, note: p.note });
  }));
  r.put('/settings/policy', auth, admin, platform, wrap(async (req, res) => {
    const b = z.object({ base: z.unknown(), acquirers: z.array(z.unknown()), note: z.string().min(3).max(500) }).parse(req.body);
    const next = await ctx.policies.save(b.base, b.acquirers, req.user!.email, b.note);
    await audit(ctx, req, 'policy.updated', `policy:v${next.version}`, { note: b.note });
    res.json({ version: next.version });
  }));
  r.get('/settings/policy/versions', auth, wrap(async (_req, res) => {
    res.json({ versions: await ctx.store.policies.versions() });
  }));

  r.get('/users', auth, admin, wrap(async (req, res) => {
    res.json({ users: (await ctx.store.users.list({ tenantId: req.tenantId })).map(({ passwordHash: _p, ...u }) => u) });
  }));
  r.post('/users', auth, admin, wrap(async (req, res) => {
    const b = z.object({ email: z.string().email(), name: z.string().min(1), role: RoleSchema, password: z.string().min(12) }).parse(req.body);
    if (await ctx.store.users.findByEmail(b.email)) throw new HttpError(409, 'user exists');
    const u = await ctx.store.users.create({ id: randomUUID(), tenantId: req.tenantId, email: b.email, name: b.name, role: b.role, passwordHash: await bcrypt.hash(b.password, 10), active: true, createdAt: ctx.now().toISOString() });
    await audit(ctx, req, 'user.created', `user:${u.id}`, { role: u.role });
    res.status(201).json({ id: u.id });
  }));
  r.patch('/users/:id', auth, admin, wrap(async (req, res) => {
    const b = z.object({ role: RoleSchema.optional(), active: z.boolean().optional(), password: z.string().min(12).optional() }).parse(req.body);
    const patch: Record<string, unknown> = {};
    if (b.role) patch.role = b.role;
    if (b.active !== undefined) patch.active = b.active;
    if (b.password) patch.passwordHash = await bcrypt.hash(b.password, 10);
    const target = await ctx.store.users.findById(req.params.id);
    if (!target || tenantOf(target) !== req.tenantId) throw new HttpError(404, 'user not found');
    const u = await ctx.store.users.update(req.params.id, patch);
    if (!u) throw new HttpError(404, 'user not found');
    await audit(ctx, req, 'user.updated', `user:${u.id}`, { keys: Object.keys(patch) });
    res.json({ ok: true });
  }));

  r.get('/audit', auth, admin, wrap(async (req, res) => {
    res.json({ audit: await ctx.store.audit.list({ entity: typeof req.query.entity === 'string' ? req.query.entity : undefined, tenantId: req.tenantId, limit: 300 }) });
  }));
  return r;
}
