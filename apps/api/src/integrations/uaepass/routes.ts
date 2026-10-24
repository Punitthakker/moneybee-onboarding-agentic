import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { CreateShareRequestSchema, SHARE_DOC_LABELS, type IdentityView, type ShareDocType } from '@moneybee/shared';
import { authenticate, requireRole } from '../../auth';
import type { Ctx } from '../../context';
import type { CaseRec } from '../../db/types';
import { audit, HttpError, wrap } from '../../routes/util';
import { MockUaePassProvider, PERSONAS } from './mock';
import {
  auditUaePass, beginLogin, completeLogin, createInvite, createShare, createSigning, merchantCookieName, readLoginState, readMerchantSession, redirectUri, resolveInvite, signMerchantSession,
  syncShare, syncSigning, uaeNow,
} from './service';

const STATE_COOKIE = 'mb_uaepass_state';
const cookieOpts = (ctx: Ctx, maxAgeMs: number) => ({ httpOnly: true, sameSite: 'lax' as const, secure: ctx.cfg.COOKIE_SECURE, maxAge: maxAgeMs, path: '/' });

/** What a merchant may see about their own case. Nothing from the underwriting side. */
function merchantView(ctx: Ctx, c: CaseRec, signedIn: boolean) {
  const u = c.uaepass;
  const idn = u?.identity;
  const identity: IdentityView | null = idn && signedIn ? { name: idn.name, emiratesIdMasked: idn.emiratesIdMasked, sopLevel: idn.sopLevel, mobile: idn.mobile, email: idn.email, verifiedAt: idn.verifiedAt, provider: idn.provider } : null;
  const vault = signedIn
    ? c.documents.filter((d) => d.provenance === 'issuer_verified').map((d) => ({ id: d.id, type: d.docType, label: SHARE_DOC_LABELS[d.docType as ShareDocType] ?? d.docType, issuer: d.issuingAuthority ?? '', requestNo: d.uaepassRequestNo ?? '', expiresOn: d.expiresOn ?? null, verifiedStatus: d.verifiedStatus }))
    : [];
  return {
    case: { ref: c.ref, name: c.legalName ?? c.name },
    mode: ctx.uaepass.mode, signingEnabled: ctx.cfg.UAEPASS_SIGNING_ENABLED, providerName: ctx.cfg.UAEPASS_PROVIDER_NAME, shareTtlMinutes: ctx.cfg.UAEPASS_SHARE_TTL_MINUTES,
    signedIn, identity, shareRequests: signedIn ? u?.shareRequests ?? [] : [],
    signing: signedIn ? (u?.signing ?? []).map(({ documentKey: _k, transactionId: _t, ...s }) => s) : [],
    vault, clockOffsetMinutes: ctx.uaepass instanceof MockUaePassProvider ? ctx.uaepass.clockOffsetMinutes : 0,
  };
}

export function uaepassRoutes(ctx: Ctx): Router {
  const r = Router();
  const limiter = rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.ip ?? 'ip' });
  const web = ctx.cfg.PUBLIC_WEB_URL;

  /* ---------- ops: create the merchant invite link ---------- */
  r.post('/cases/:id/uaepass/invite', authenticate(ctx), requireRole('UNDERWRITER'), wrap(async (req, res) => {
    const c = await ctx.store.cases.get(req.params.id);
    if (!c) throw new HttpError(404, 'case not found');
    if (['APPROVED', 'REJECTED', 'COMPLETED'].includes(c.status)) throw new HttpError(409, `case is ${c.status}`);
    const inv = await createInvite(ctx, c.id);
    await audit(ctx, req, 'uaepass.invite_created', `case:${c.id}`, { expiresAt: inv.expiresAt });
    res.set('Cache-Control', 'no-store').status(201).json({ invite: inv.invite, url: `${web}/m/${inv.invite}`, expiresAt: inv.expiresAt });
  }));

  /* ---------- merchant side (invite token in the x-invite header, never in a logged URL) ---------- */
  const invited = wrap(async (req, _res, next) => {
    const c = await resolveInvite(ctx, req.header('x-invite') ?? undefined);
    if (!c) throw new HttpError(401, 'invalid or expired link');
    (req as Request & { mcase?: CaseRec }).mcase = c;
    next();
  });
  const getCase = (req: Request) => (req as Request & { mcase: CaseRec }).mcase;
  const csrf = (req: Request, res: Response, next: () => void) => (req.header('x-moneybee-csrf') === '1' ? next() : void res.status(403).json({ error: 'csrf header missing' }));
  const signedIn = (req: Request) => readMerchantSession(ctx, req.cookies?.[merchantCookieName]) === getCase(req).id && !!getCase(req).uaepass?.identity;
  const needSignIn = (req: Request) => {
    if (!signedIn(req)) throw new HttpError(401, 'sign in with UAE PASS first');
  };

  r.get('/merchant/session', limiter, invited, wrap(async (req, res) => {
    const c = getCase(req);
    // keep request statuses fresh (expiry, approval) on every read
    if (signedIn(req)) {
      for (const s of c.uaepass?.shareRequests ?? []) if (s.status === 'pending') await syncShare(ctx, c.id, s.requestNo);
      for (const s of c.uaepass?.signing ?? []) if (s.status === 'pending') await syncSigning(ctx, c.id, s.id);
    }
    const fresh = (await ctx.store.cases.get(c.id))!;
    res.set('Cache-Control', 'no-store').json(merchantView(ctx, fresh, signedIn(req)));
  }));

  r.post('/auth/uaepass/start', limiter, csrf, invited, wrap(async (req, res) => {
    const { url, cookie } = beginLogin(ctx, req.header('x-invite')!);
    res.cookie(STATE_COOKIE, cookie, cookieOpts(ctx, 10 * 60_000));
    await auditUaePass(ctx, 'merchant:uaepass', 'uaepass.login_started', `case:${getCase(req).id}`, req.ip ?? null, { provider: ctx.uaepass.mode });
    res.json({ url });
  }));

  r.get('/auth/uaepass/callback', limiter, wrap(async (req, res) => {
    const q = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(req.query);
    const st = readLoginState(ctx, req.cookies?.[STATE_COOKIE]);
    res.clearCookie(STATE_COOKIE, { path: '/' });
    const back = (code: string) => res.redirect(302, `${web}/m?auth=${code}`);
    if (!st || !q.state || q.state !== st.state) return back('state_invalid'); // CSRF or replay
    if (q.error || !q.code) return back('cancelled');
    const out = await completeLogin(ctx, st, q.code);
    if (!out.ok) return back(out.reason === 'sop_not_verified' ? 'sop_low' : out.reason === 'invite_invalid' ? 'invite_invalid' : 'failed');
    res.cookie(merchantCookieName, signMerchantSession(ctx, out.caseId), cookieOpts(ctx, 2 * 3600_000));
    back('ok');
  }));

  r.post('/merchant/share-requests', limiter, csrf, invited, wrap(async (req, res) => {
    needSignIn(req);
    const b = CreateShareRequestSchema.parse(req.body ?? {});
    // one open request at a time: expire-check existing pending ones first
    const c = getCase(req);
    for (const s of c.uaepass?.shareRequests ?? []) if (s.status === 'pending') await syncShare(ctx, c.id, s.requestNo);
    const fresh = await ctx.store.cases.get(c.id);
    if (fresh?.uaepass?.shareRequests.some((s) => s.status === 'pending')) throw new HttpError(409, 'a share request is already waiting in the UAE PASS app');
    const view = await createShare(ctx, c.id, b.documents, b.purpose);
    res.status(201).json(view);
  }));

  r.get('/merchant/share-requests/:no', limiter, invited, wrap(async (req, res) => {
    needSignIn(req);
    const v = await syncShare(ctx, getCase(req).id, req.params.no);
    if (!v) throw new HttpError(404, 'not found');
    res.set('Cache-Control', 'no-store').json(v);
  }));

  r.post('/merchant/signing', limiter, csrf, invited, wrap(async (req, res) => {
    needSignIn(req);
    const out = await createSigning(ctx, getCase(req).id);
    res.status(201).json(out);
  }));
  r.get('/merchant/signing/:id', limiter, invited, wrap(async (req, res) => {
    needSignIn(req);
    const s = await syncSigning(ctx, getCase(req).id, req.params.id);
    if (!s) throw new HttpError(404, 'not found');
    const { documentKey: _k, transactionId: _t, ...pub } = s;
    res.set('Cache-Control', 'no-store').json(pub);
  }));

  r.post('/merchant/signout', csrf, (_req, res) => {
    res.clearCookie(merchantCookieName, { path: '/' });
    res.json({ ok: true });
  });

  /* ---------- mock simulator back end (only when UAEPASS_MODE=mock) ---------- */
  if (ctx.uaepass instanceof MockUaePassProvider) {
    const mock = ctx.uaepass;
    const m = Router();
    m.use(limiter, csrf);
    m.get('/personas', (_req, res) => res.json({ personas: PERSONAS.map(({ id, label, note }) => ({ id, label, note })) }));
    m.post('/authorize', wrap(async (req, res) => {
      const b = z.object({ state: z.string().min(8), persona: z.string(), cancel: z.boolean().optional() }).parse(req.body);
      const u = new URL(redirectUri(ctx));
      u.searchParams.set('state', b.state);
      if (b.cancel) u.searchParams.set('error', 'access_denied');
      else {
        const code = mock.authorize(b.persona);
        if (!code) throw new HttpError(400, 'unknown persona');
        u.searchParams.set('code', code);
      }
      res.json({ redirectUrl: u.toString() });
    }));
    m.get('/share/:no', wrap(async (req, res) => {
      const v = mock.peekRequest(req.params.no, ctx.now());
      if (!v) throw new HttpError(404, 'request not found (the simulator forgets requests after an API restart)');
      res.json({ request: v, simulatedNow: uaeNow(ctx).toISOString() });
    }));
    m.post('/share/:no/decision', wrap(async (req, res) => {
      const { decision } = z.object({ decision: z.enum(['approve', 'decline']) }).parse(req.body);
      const out = mock.decideShare(req.params.no, decision, ctx.now());
      if (!out.ok) throw new HttpError(out.reason === 'not_found' ? 404 : 409, out.reason === 'expired' ? 'this request has expired' : out.reason === 'already_decided' ? 'already answered' : 'request not found');
      res.json({ request: out.view });
    }));
    m.get('/sign/:tx', wrap(async (req, res) => {
      const s = mock.peekSigning(req.params.tx, ctx.now());
      if (!s) throw new HttpError(404, 'signing request not found');
      res.json({ signing: s, simulatedNow: uaeNow(ctx).toISOString() });
    }));
    m.post('/sign/:tx/decision', wrap(async (req, res) => {
      const { decision } = z.object({ decision: z.enum(['sign', 'decline']) }).parse(req.body);
      const out = mock.decideSigning(req.params.tx, decision, ctx.now());
      if (!out.ok) throw new HttpError(out.reason === 'not_found' ? 404 : 409, out.reason === 'expired' ? 'this request has expired' : out.reason === 'already_decided' ? 'already answered' : 'not found');
      res.json({ ok: true });
    }));
    m.get('/clock', (_req, res) => res.json({ offsetMinutes: mock.clockOffsetMinutes, simulatedNow: uaeNow(ctx).toISOString() }));
    m.post('/clock', wrap(async (req, res) => {
      const b = z.object({ advanceMinutes: z.number().min(0).max(7 * 24 * 60).optional(), reset: z.boolean().optional() }).parse(req.body);
      if (b.reset) mock.resetClock();
      if (b.advanceMinutes) mock.advanceClock(b.advanceMinutes);
      res.json({ offsetMinutes: mock.clockOffsetMinutes, simulatedNow: uaeNow(ctx).toISOString() });
    }));
    r.use('/mock/uaepass', m);
  }
  return r;
}
