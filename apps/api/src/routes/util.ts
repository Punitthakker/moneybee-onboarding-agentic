import { createHash, randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import type { Ctx } from '../context';

export const wrap = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler => (req, res, next) => {
  fn(req, res, next).catch(next);
};

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  return schema.parse(data);
}

export function errorHandler(ctx: Ctx) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: 'validation_failed', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const e = err as { status?: number; statusCode?: number; message?: string; code?: string };
    const status = e.status ?? e.statusCode ?? 500;
    if (e.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file too large' });
    if (status >= 500) ctx.log.error({ err, reqId: req.reqId, path: req.path }, 'request failed');
    res.status(status).json({ error: status >= 500 ? 'internal_error' : e.message ?? 'error', reqId: req.reqId });
  };
}

export const hashJson = (v: unknown) => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex');

export async function audit(ctx: Ctx, req: Request, action: string, entity: string, meta?: unknown, before?: unknown, after?: unknown) {
  await ctx.store.audit.add({
    id: randomUUID(), tenantId: req.tenantId ?? req.user?.tenantId, actor: req.user?.email ?? 'anonymous', action, entity, ip: req.ip ?? null, at: ctx.now().toISOString(), meta,
    beforeHash: before === undefined ? null : hashJson(before), afterHash: after === undefined ? null : hashJson(after),
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
