import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireRole } from '../auth';
import type { Ctx } from '../context';
import { hashToken, looksLikeToken, safeEqualHex } from '../crypto/token';
import { buildOnboardingPackage } from '../package';
import { audit, HttpError, wrap } from './util';

/** Token endpoints. The token is the credential: never logged, hashed before lookup, constant-time compare, rate limited, audited. */
export function onboardingRoutes(ctx: Ctx): Router {
  const r = Router();
  const limiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.ip ?? 'ip' });
  const auditTok = async (action: string, entity: string, ip: string | null, meta?: unknown) =>
    ctx.store.audit.add({ id: crypto.randomUUID(), actor: 'token-bearer', action, entity, ip, at: ctx.now().toISOString(), meta });

  r.get('/onboarding/:token/status', limiter, wrap(async (req, res) => {
    const t = req.params.token;
    if (!looksLikeToken(t)) return res.status(404).json({ error: 'not found' });
    const hash = hashToken(t);
    const row = await ctx.repo.findTokenByHash(hash);
    // lookup is by hash; constant-time comparison of the stored hash protects against timing side channels
    if (!row || !row.tokenHash || !safeEqualHex(hash, row.tokenHash)) {
      await auditTok('token.status_unknown', 'token', req.ip ?? null);
      return res.status(404).json({ error: 'not found' });
    }
    if (!row.scopes.includes('status')) return res.status(403).json({ error: 'token lacks status scope' });
    const now = ctx.now();
    const status = row.revokedAt ? 'REVOKED' : new Date(row.expiresAt) <= now ? 'EXPIRED' : row.redeemedAt ? 'REDEEMED' : 'VALID';
    await auditTok('token.status', `token:${row.id}`, req.ip ?? null, { status });
    res.json({ status, caseId: row.caseId, merchantId: row.merchantId, expiresAt: row.expiresAt, redeemedAt: row.redeemedAt, scopes: row.scopes });
  }));

  r.post('/onboarding/:token/claim', limiter, wrap(async (req, res) => {
    const t = req.params.token;
    if (!looksLikeToken(t)) return res.status(404).json({ error: 'not found' });
    const out = await ctx.repo.claimToken(hashToken(t), ctx.now());
    if (!out.ok) {
      await auditTok('token.claim_rejected', 'token', req.ip ?? null, { reason: out.reason });
      const code = out.reason === 'not_found' ? 404 : out.reason === 'redeemed' ? 409 : out.reason === 'scope' ? 403 : 410;
      return res.status(code).json({ error: out.reason === 'redeemed' ? 'token already redeemed' : out.reason === 'expired' ? 'token expired' : out.reason === 'revoked' ? 'token revoked' : 'not found' });
    }
    const bundle = await ctx.repo.getBundleByCase(out.token.caseId);
    const c = bundle ? await ctx.store.cases.get(bundle.caseRow.mongoCaseId) : null;
    if (!bundle || !c) throw new HttpError(500, 'onboarding record unavailable');
    await auditTok('token.claimed', `token:${out.token.id}`, req.ip ?? null);
    const pkg = await buildOnboardingPackage(ctx, out.token, bundle, c);
    res.set('Cache-Control', 'no-store').json(pkg);
  }));

  r.post('/tokens/:id/revoke', authenticate(ctx), requireRole('UNDERWRITER'), wrap(async (req, res) => {
    const ok = await ctx.repo.revokeToken(req.params.id, ctx.now());
    await audit(ctx, req, 'token.revoked', `token:${req.params.id}`, { ok });
    if (!ok) throw new HttpError(404, 'token not found or already revoked');
    res.json({ revoked: true });
  }));

  return r;
}
