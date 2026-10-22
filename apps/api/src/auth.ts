import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@moneybee/shared';
import type { Ctx } from './context';
import type { UserRec } from './db/types';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    reqId?: string;
  }
}

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
      req.user = { id: u.id, email: u.email, name: u.name, role: u.role };
      // CSRF: cookie-authenticated writes must carry a custom header (blocked cross-site by CORS)
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.header('x-moneybee-csrf') !== '1') return res.status(403).json({ error: 'csrf header missing' });
      next();
    } catch {
      return res.status(401).json({ error: 'unauthenticated' });
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (req.user.role !== 'ADMIN' && !roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

export async function seedUsers(ctx: Ctx) {
  const mk = async (email: string, name: string, role: Role, password: string) => {
    if (await ctx.store.users.findByEmail(email)) return;
    await ctx.store.users.create({ id: randomUUID(), email, name, role, passwordHash: await bcrypt.hash(password, 10), active: true, createdAt: new Date().toISOString() });
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
  }
}
