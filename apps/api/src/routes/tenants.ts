import { Router } from 'express';
import { publicTenantView } from '@moneybee/shared';
import { authenticate, requireRole } from '../auth';
import type { Ctx } from '../context';
import { audit, HttpError, wrap } from './util';

/**
 * Tenant branding and settings.
 *  - public: theme a page before sign-in (login, merchant portal) from ?tenant=, the x-moneybee-tenant header or the host name
 *  - signed in: read and update the caller's own tenant (ADMIN of that tenant)
 */
export function tenantRoutes(ctx: Ctx): Router {
  const r = Router();

  r.get('/public/tenant', (req, res) => {
    const explicit = (typeof req.query.tenant === 'string' ? req.query.tenant : undefined) ?? req.header('x-moneybee-tenant') ?? null;
    const t = ctx.tenants.resolvePublic({ explicit, host: req.header('x-forwarded-host') ?? req.header('host') ?? null });
    res.set('Cache-Control', 'public, max-age=60').json({ tenant: publicTenantView(t) });
  });

  r.get('/public/tenants/:id', (req, res) => {
    const t = ctx.tenants.get(req.params.id);
    if (!t || t.status !== 'active') return res.status(404).json({ error: 'tenant not found' });
    res.set('Cache-Control', 'public, max-age=60').json({ tenant: publicTenantView(t) });
  });

  r.get('/tenant', authenticate(ctx), (req, res) => {
    const t = ctx.tenants.getOrDefault(req.tenantId);
    const { createdAt, updatedAt, updatedBy, ...config } = t;
    res.json({ tenant: publicTenantView(t), config, meta: { createdAt, updatedAt, updatedBy } });
  });

  r.put('/tenant', authenticate(ctx), requireRole(), wrap(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (JSON.stringify(body).toLowerCase().includes('poweredby')) throw new HttpError(400, '"Powered by MoneyBee" is fixed by the platform and cannot be changed or removed');
    const before = ctx.tenants.getOrDefault(req.tenantId);
    // invalid or unknown fields raise a ZodError, which the error handler returns as 400 with the field issues
    const next = await ctx.tenants.update(before.id, body, req.user!.email, ctx.now());
    await audit(ctx, req, 'tenant.updated', `tenant:${next.id}`, { keys: Object.keys(body) }, before, next);
    res.json({ tenant: publicTenantView(next) });
  }));

  return r;
}
