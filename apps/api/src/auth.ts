import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { DEFAULT_TENANT_ID, type Role } from '@moneybee/shared';
import type { Ctx } from './context';
import type { UserRec } from './db/types';
import { tenantCases, tenantOf, type TenantCases } from './db/tenant-scope';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
}
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    reqId?: string;
    /** tenant of the signed-in user (ops routes) or of the resolved public page */
    tenantId?: string;
    /** tenant-scoped case accessor, set by authenticate(); user-facing routes must use this, not ctx.store.cases */
    cases?: TenantCases;
  }
}

export const toAuthUser = (u: UserRec): AuthUser => ({ id: u.id, email: u.email, name: u.name, role: u.role, tenantId: tenantOf(u) });

const COOKIE = 'mb_session';
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function jwtSecret(ctx: Ctx): string {
  return ctx.cfg.JWT_SECRET || ctx.fileUrlSecret;
}

export function setSession(ctx: Ctx, res: Response, u: UserRec) {
  const token = jwt.sign({ sub: u.id, role: u.role }, jwtSecret(ctx), { expiresIn: '8h', algorithm: 'HS256' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: ctx.cfg.COOKIE_SECURE, maxAge: 8 * 3600 * 1000, path: '/' });
}
export function clearSession(res: Response) {
  res.clearCookie(COOKIE, { path: '/' });
}

export async function verifyLogin(ctx: Ctx, email: string, password: string): Promise<UserRec | null> {
  const u = await ctx.store.users.findByEmail(email);
  const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY_HASH);
  return u && u.active && ok ? u : null;
}

export function authenticate(ctx: Ctx) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ error: 'unauthenticated' });
    try {
      const p = jwt.verify(token, jwtSecret(ctx), { algorithms: ['HS256'] }) as { sub: string };
      const u = await ctx.store.users.findById(p.sub);
      if (!u || !u.active) return res.status(401).json({ error: 'unauthenticated' });
      const tenant = ctx.tenants.get(tenantOf(u));
      if (!tenant || tenant.status !== 'active') return res.status(403).json({ error: 'tenant suspended' });
      req.user = toAuthUser(u);
      req.tenantId = tenant.id;
      req.cases = tenantCases(ctx.store, tenant.id);
      // CSRF: cookie-authenticated writes must carry a custom header (blocked cross-site by CORS)
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.header('x-moneybee-csrf') !== '1') return res.status(403).json({ error: 'csrf header missing' });
      next();
    } catch {
      return res.status(401).json({ error: 'unauthenticated' });
    }
  };
}

const ROLE_NAMES: Record<Role, string> = { ADMIN: 'admin', UNDERWRITER: 'underwriter', SECOND_REVIEWER: 'second reviewer', VIEWER: 'viewer' };

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (req.user.role !== 'ADMIN' && !roles.includes(req.user.role)) {
      // say which role is needed instead of a bare "forbidden" (the web app translates it with the code and roles)
      const allowed: Role[] = ['ADMIN', ...roles.filter((r) => r !== 'ADMIN')];
      const names = allowed.map((r) => ROLE_NAMES[r]);
      return res.status(403).json({
        error: `Your role (${ROLE_NAMES[req.user.role]}) cannot do this. Sign in as ${names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0]}.`,
        code: 'role_forbidden', role: req.user.role, allowed,
      });
    }
    next();
  };
}

/** Global settings, policies and acquirer config affect every tenant, so only platform (MoneyBee) admins may change them. */
export function requirePlatform(ctx: Ctx) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (ctx.tenants.get(req.tenantId)?.kind !== 'platform') return res.status(403).json({ error: 'platform admins only' });
    next();
  };
}

export async function seedUsers(ctx: Ctx) {
  const mk = async (email: string, name: string, role: Role, password: string, tenantId = DEFAULT_TENANT_ID) => {
    if (await ctx.store.users.findByEmail(email)) return;
    await ctx.store.users.create({ id: randomUUID(), tenantId, email, name, role, passwordHash: await bcrypt.hash(password, 10), active: true, createdAt: new Date().toISOString() });
  };
  let adminPw = ctx.cfg.ADMIN_PASSWORD;
  if (!adminPw) {
    adminPw = randomBytes(9).toString('base64url');
    ctx.log.warn(`ADMIN_PASSWORD not set; generated one-time admin password for ${ctx.cfg.ADMIN_EMAIL}: ${adminPw}`);
  }
  await mk(ctx.cfg.ADMIN_EMAIL, 'Admin', 'ADMIN', adminPw);
  if (ctx.cfg.SEED_DEMO_DATA) {
    let demo = ctx.cfg.DEMO_PASSWORD;
    if (!demo) {
      demo = randomBytes(9).toString('base64url');
      ctx.log.warn(`DEMO_PASSWORD not set; generated demo password for demo users: ${demo}`);
    }
    await mk('underwriter@moneybee.local', 'Demo Underwriter', 'UNDERWRITER', demo);
    await mk('second@moneybee.local', 'Demo Second Reviewer', 'SECOND_REVIEWER', demo);
    await mk('viewer@moneybee.local', 'Demo Viewer', 'VIEWER', demo);
    // demo users for the Botim white-label tenant (only if that tenant is configured)
    if (ctx.tenants.get('botim')) {
      await mk('admin@botim.local', 'Botim Admin (demo)', 'ADMIN', demo, 'botim');
      await mk('underwriter@botim.local', 'Botim Underwriter (demo)', 'UNDERWRITER', demo, 'botim');
      await mk('second@botim.local', 'Botim Second Reviewer (demo)', 'SECOND_REVIEWER', demo, 'botim');
      await mk('viewer@botim.local', 'Botim Viewer (demo)', 'VIEWER', demo, 'botim');
    }
  }
}
