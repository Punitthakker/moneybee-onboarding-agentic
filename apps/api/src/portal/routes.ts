import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  AnswersSchema, DocTypeSchema, EntityTypeSchema, buildChecklist, offeredEntityTypes, publicTenantView, questionsFor, requirementsFor, type DocType, type EntityType,
} from '@moneybee/shared';
import { authenticate, requireRole } from '../auth';
import type { Ctx } from '../context';
import type { CaseRec } from '../db/types';
import { ingest, type IntakeInput } from '../agents/intake';
import { classifyFiles } from '../agents/classifier';
import { step } from '../agents/runtime';
import { transition } from '../agents/orchestrator';
import type { JobQueue } from '../queue';
import { HttpError, audit, wrap } from '../routes/util';
import {
  PORTAL_COOKIE, canUpload, contactFor, emailHash, maskEmail, merchantView, mintLink, readPortalSession, resolveLink, sendLinkEmail, signPortalSession,
} from './service';

const Contact = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  mobile: z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, 'mobile number, for example +971 50 000 0000').optional().or(z.literal('').transform(() => undefined)),
});
const StartBody = z.object({
  entityType: EntityTypeSchema,
  answers: AnswersSchema.default({}),
  businessName: z.string().trim().min(2).max(200),
  contact: Contact,
  locale: z.enum(['en', 'ar']).default('en'),
  consent: z.literal(true, { errorMap: () => ({ message: 'please accept the privacy notice' }) }),
});
const PatchBody = z.object({ entityType: EntityTypeSchema.optional(), answers: AnswersSchema.optional(), businessName: z.string().trim().min(2).max(200).optional(), locale: z.enum(['en', 'ar']).optional() }).strict();

/**
 * Merchant self-serve portal API.
 *   public:   GET /public/requirements, POST /public/applications, POST /public/applications/resume, POST /portal/session
 *   merchant: /portal/application (cookie mb_portal, CSRF header on writes)
 *   ops:      POST /cases/:id/portal-link (send an upload link to the merchant of an existing case)
 */
export function portalRoutes(ctx: Ctx, queue: JobQueue): Router {
  const r = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ctx.cfg.MAX_UPLOAD_MB * 1024 * 1024, files: 20 } });
  const reads = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false });
  const writes = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
  // starting applications and asking for links send email: keep it tight per address and per IP
  const mailing = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
  const csrf = (req: Request, res: Response, next: () => void) => (req.header('x-moneybee-csrf') === '1' ? next() : void res.status(403).json({ error: 'csrf header missing' }));
  const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: ctx.cfg.COOKIE_SECURE, maxAge: ctx.cfg.PORTAL_SESSION_HOURS * 3600_000, path: '/' };

  const publicTenant = (req: Request) => {
    const explicit = (typeof req.query.tenant === 'string' ? req.query.tenant : undefined) ?? req.header('x-moneybee-tenant') ?? null;
    return ctx.tenants.resolvePublic({ explicit, host: req.header('x-forwarded-host') ?? req.header('host') ?? null });
  };
  const policyFor = async (c: CaseRec) => (await ctx.policies.forAcquirer(c.acquirerCode)).policy;
  const auditM = (c: CaseRec, action: string, req: Request, meta?: unknown) =>
    ctx.store.audit.add({ id: randomUUID(), tenantId: c.tenantId, actor: `merchant:${c.portal?.contact.emailMasked ?? 'portal'}`, action, entity: `case:${c.id}`, ip: req.ip ?? null, at: ctx.now().toISOString(), meta });

  /** Email failures are logged (never the link) and reported to the caller instead of failing the request. */
  const trySend = async (fn: () => Promise<void>, caseId: string) => {
    try {
      await fn();
      return true;
    } catch (e) {
      ctx.log.error({ err: (e as Error).message, caseId }, 'portal email not sent');
      return false;
    }
  };

  /* ---------------- public ---------------- */

  r.get('/public/requirements', reads, wrap(async (req, res) => {
    const t = publicTenant(req);
    const set = await ctx.policies.active();
    const acq = t.defaultAcquirerCode ?? set.acquirers[0]?.code;
    const { policy } = await ctx.policies.forAcquirer(acq);
    const types = offeredEntityTypes(policy, t.enabledEntityTypes);
    res.set('Cache-Control', 'public, max-age=60').json({
      tenant: publicTenantView(t),
      entityTypes: types.map((id) => {
        const d = policy.entityTypes[id]!;
        return {
          id, label: d.label ?? id, labelAr: d.labelAr ?? null, description: d.description ?? null, descriptionAr: d.descriptionAr ?? null,
          questions: questionsFor(policy, id),
          documents: requirementsFor(policy, id, {}).map((x) => ({ docType: x.docType, label: x.label, required: x.required, ifApplicable: !!x.ifApplicable, reason: x.reason ?? null, reasonAr: x.reasonAr ?? null, hint: x.rule.hint ?? null, hintAr: x.rule.hintAr ?? null })),
        };
      }),
      uboThresholdPct: policy.uboThresholdPct,
    });
  }));

  r.post('/public/applications', mailing, csrf, wrap(async (req, res) => {
    const b = StartBody.parse(req.body ?? {});
    const t = publicTenant(req);
    const set = await ctx.policies.active();
    const acquirerCode = t.defaultAcquirerCode ?? set.acquirers[0]?.code;
    if (!acquirerCode) throw new HttpError(503, 'no acquirer configured');
    const { policy } = await ctx.policies.forAcquirer(acquirerCode);
    if (!offeredEntityTypes(policy, t.enabledEntityTypes).includes(b.entityType)) throw new HttpError(400, `company type ${b.entityType} is not offered by ${t.name}`);
    const n = (await ctx.store.cases.count()) + 1;
    const now = ctx.now().toISOString();
    const c: CaseRec = {
      id: randomUUID(), tenantId: t.id, ref: `${t.casePrefix}-${ctx.now().getUTCFullYear()}-${String(n).padStart(4, '0')}`, version: 1, name: b.businessName, status: 'DRAFT',
      entityTypeRequested: b.entityType, entityType: b.entityType, acquirerCode, ownerId: 'merchant-portal', ownerEmail: 'merchant-portal', createdAt: now, updatedAt: now,
      files: [], documents: [], fields: {}, directors: [], shareholders: [], signatories: [], idHolders: [], findings: [], checklist: [], reviews: [], needsReviewFields: [],
      injectionSuspected: false, usage: { tokens: 0, budget: ctx.cfg.CASE_TOKEN_BUDGET, calls: 0 }, run: { seq: 0, state: 'idle' },
      portal: { source: 'merchant_portal', contact: contactFor(ctx, b.contact), answers: b.answers, locale: b.locale, uploads: [], lastSeenAt: now },
    };
    await ctx.store.cases.create(c);
    const { token } = await mintLink(ctx, c.id);
    // the application exists and this browser is signed in even if the email cannot be sent right now
    const emailSent = await trySend(() => sendLinkEmail(ctx, c, b.contact.email, token, 'start'), c.id);
    await auditM(c, 'portal.application_started', req, { entityType: b.entityType, emailSent });
    res.cookie(PORTAL_COOKIE, signPortalSession(ctx, c), cookieOpts);
    res.status(201).json({ ref: c.ref, emailMasked: maskEmail(b.contact.email), emailSent });
  }));

  /** Always answers the same way, so it cannot be used to find out who has an application. */
  r.post('/public/applications/resume', mailing, csrf, wrap(async (req, res) => {
    const { email } = z.object({ email: z.string().trim().email().max(200) }).parse(req.body ?? {});
    const t = publicTenant(req);
    const open = (await ctx.store.cases.list({ tenantId: t.id, portalEmailHash: emailHash(ctx, email), limit: 20 })).filter((c) => !['REJECTED', 'COMPLETED'].includes(c.status)).slice(0, 3);
    for (const c of open) {
      const { token } = await mintLink(ctx, c.id);
      const sent = await trySend(() => sendLinkEmail(ctx, c, email, token, 'resume'), c.id);
      await auditM(c, 'portal.link_resent', req, { emailSent: sent });
    }
    res.status(202).json({ ok: true, emailMasked: maskEmail(email) });
  }));

  r.post('/portal/session', writes, csrf, wrap(async (req, res) => {
    const { token } = z.object({ token: z.string().max(200) }).parse(req.body ?? {});
    const c = await resolveLink(ctx, token);
    if (!c) throw new HttpError(401, 'this link is invalid or has expired');
    res.cookie(PORTAL_COOKIE, signPortalSession(ctx, c), cookieOpts);
    await ctx.store.cases.update(c.id, (x) => { if (x.portal) x.portal.lastSeenAt = ctx.now().toISOString(); });
    await auditM(c, 'portal.signed_in', req);
    res.set('Cache-Control', 'no-store').json({ ok: true, ref: c.ref, tenant: c.tenantId ?? 'moneybee' });
  }));

  r.post('/portal/signout', csrf, (_req, res) => {
    res.clearCookie(PORTAL_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  /* ---------------- merchant (session cookie) ---------------- */

  const session = wrap(async (req, _res, next) => {
    const id = readPortalSession(ctx, req.cookies?.[PORTAL_COOKIE]);
    const c = id ? await ctx.store.cases.get(id) : null;
    if (!c || !c.portal) throw new HttpError(401, 'please open the link we emailed you');
    (req as Request & { pcase: CaseRec }).pcase = c;
    next();
  });
  const pc = (req: Request) => (req as Request & { pcase: CaseRec }).pcase;
  const view = async (id: string) => {
    const c = (await ctx.store.cases.get(id))!;
    return merchantView(ctx, c, await policyFor(c));
  };

  r.get('/portal/application', reads, session, wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await view(pc(req).id));
  }));

  r.patch('/portal/application', writes, csrf, session, wrap(async (req, res) => {
    const b = PatchBody.parse(req.body ?? {});
    const c = pc(req);
    if (c.status !== 'DRAFT') throw new HttpError(409, 'the application was already sent and can no longer be changed');
    if (b.entityType) {
      const t = ctx.tenants.getOrDefault(c.tenantId);
      if (!offeredEntityTypes(await policyFor(c), t.enabledEntityTypes).includes(b.entityType)) throw new HttpError(400, `company type ${b.entityType} is not offered`);
    }
    await ctx.store.cases.update(c.id, (x) => {
      if (b.entityType) { x.entityType = b.entityType; x.entityTypeRequested = b.entityType; }
      if (b.answers) x.portal!.answers = { ...x.portal!.answers, ...b.answers };
      if (b.businessName) x.name = b.businessName;
      if (b.locale) x.portal!.locale = b.locale;
    });
    await auditM(c, 'portal.application_updated', req, { keys: Object.keys(b) });
    res.json(await view(c.id));
  }));

  r.post('/portal/application/documents', writes, csrf, session, upload.array('files'), wrap(async (req, res) => {
    const c = pc(req);
    if (!canUpload(c)) throw new HttpError(409, 'documents cannot be added while the application is being checked');
    const slot = req.body?.slot ? DocTypeSchema.parse(req.body.slot) : undefined;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new HttpError(400, 'choose at least one file');
    if (c.files.length + files.length > ctx.cfg.PORTAL_MAX_FILES) throw new HttpError(413, `an application can hold up to ${ctx.cfg.PORTAL_MAX_FILES} files`);
    const inputs: IntakeInput[] = files.map((f) => ({ name: f.originalname, data: f.buffer, originPath: f.originalname }));
    const result = await ingest(ctx, c.id, inputs);
    const at = ctx.now().toISOString();
    await ctx.store.cases.update(c.id, (x) => {
      x.files.push(...result.added);
      if (result.added.some((f) => f.injectionSuspected)) x.injectionSuspected = true;
      x.portal!.uploads.push(...result.added.map((f) => ({ fileId: f.id, ...(slot ? { slot } : {}), at })));
      x.portal!.lastSeenAt = at;
    });
    // classify straight away so the checklist ticks while the merchant is still here (extraction waits for submit)
    const newIds = new Set(result.added.map((f) => f.id));
    const detected: Record<string, DocType[]> = {};
    if (newIds.size) {
      const cur = (await ctx.store.cases.get(c.id))!;
      const docs = await step(ctx, c.id, cur.run?.seq ?? 0, 'classifier', 'Classify portal upload', async (h) => {
        const out = await classifyFiles(ctx, h, { ...cur, files: cur.files.filter((f) => newIds.has(f.id)) });
        h.summary(`${out.length} document(s) classified from the merchant portal`);
        return out;
      });
      // a file the classifier cannot place, uploaded into a checklist slot, takes the slot's type for a human to confirm later
      for (const d of docs) if (d.docType === 'unknown' && slot) Object.assign(d, { docType: slot, classConfidence: 0.3, needsReview: true });
      await ctx.store.cases.update(c.id, (x) => {
        const have = new Set(x.documents.map((d) => d.fileId));
        x.documents.push(...docs.filter((d) => !have.has(d.fileId)));
      });
      for (const d of docs) detected[d.fileId] = [...(detected[d.fileId] ?? []), d.docType];
    }
    await auditM(c, 'portal.documents_added', req, { added: result.added.length, rejected: result.rejected.length, slot });
    res.status(201).json({
      added: result.added.map((f) => ({ id: f.id, name: f.name, detected: detected[f.id] ?? [], matchesSlot: slot ? (detected[f.id] ?? []).includes(slot) : null })),
      duplicates: result.duplicates,
      rejected: result.rejected,
      view: await view(c.id),
    });
  }));

  r.delete('/portal/application/files/:fileId', writes, csrf, session, wrap(async (req, res) => {
    const c = pc(req);
    if (c.status !== 'DRAFT') throw new HttpError(409, 'files can only be removed before the application is sent');
    const f = c.files.find((x) => x.id === req.params.fileId);
    if (!f) throw new HttpError(404, 'file not found');
    await ctx.store.cases.update(c.id, (x) => {
      x.files = x.files.filter((y) => y.id !== f.id && y.duplicateOf !== f.id);
      x.documents = x.documents.filter((d) => d.fileId !== f.id);
      x.portal!.uploads = x.portal!.uploads.filter((u) => u.fileId !== f.id);
    });
    if (!c.files.some((y) => y.id !== f.id && y.storageKey === f.storageKey)) await ctx.blobs.delete(f.storageKey).catch(() => undefined);
    await auditM(c, 'portal.file_removed', req, { file: f.name });
    res.json(await view(c.id));
  }));

  r.post('/portal/application/submit', writes, csrf, session, wrap(async (req, res) => {
    const c = pc(req);
    if (!canUpload(c)) throw new HttpError(409, 'the application is already being checked');
    const policy = await policyFor(c);
    const et = (c.entityType ?? c.entityTypeRequested) as EntityType;
    const sum = buildChecklist(requirementsFor(policy, et, c.portal?.answers ?? {}), c.documents.map((d) => ({ id: d.id, docType: d.docType, expiresOn: d.expiresOn, issuedOn: d.issuedOn })), ctx.now());
    if (c.status !== 'NEEDS_INFO' && !sum.complete) {
      const missing = sum.items.filter((i) => i.required && i.status !== 'received').map((i) => i.label);
      throw Object.assign(new HttpError(422, `still needed: ${missing.join(', ')}`), { missing });
    }
    if (!c.files.length) throw new HttpError(400, 'upload documents first');
    const seq = (c.run?.seq ?? 0) + 1;
    await ctx.store.cases.update(c.id, (x) => {
      if (x.status === 'DRAFT') transition(x, 'RECEIVED', { type: 'system' });
      x.portal!.submittedAt = ctx.now().toISOString();
      x.run = { seq, state: 'queued' };
    });
    await auditM(c, 'portal.submitted', req, { seq });
    await queue.enqueuePipeline({ caseId: c.id, runSeq: seq, from: 'classify' });
    res.status(202).json(await view(c.id));
  }));

  /* ---------------- ops: send an upload link for an existing case ---------------- */

  r.post('/cases/:id/portal-link', authenticate(ctx), requireRole('UNDERWRITER'), writes, wrap(async (req, res) => {
    const b = z.object({ email: z.string().trim().email().max(200).optional(), name: z.string().trim().min(2).max(120).optional(), locale: z.enum(['en', 'ar']).optional() }).parse(req.body ?? {});
    const c = await req.cases!.require(req.params.id); // another tenant's case is a 404
    if (['APPROVED', 'REJECTED', 'COMPLETED'].includes(c.status)) throw new HttpError(409, `case is ${c.status}`);
    let to = b.email;
    if (!to && c.portal) to = ctx.cipher.decrypt(c.portal.contact.emailEnc);
    if (!to) throw new HttpError(400, 'merchant email is required');
    await req.cases!.update(c.id, (x) => {
      if (!x.portal) x.portal = { source: 'ops_link', contact: contactFor(ctx, { name: b.name ?? x.name, email: to! }), answers: {}, locale: b.locale ?? 'en', uploads: [] };
      else if (b.email) x.portal.contact = contactFor(ctx, { name: b.name ?? x.portal.contact.name, email: b.email });
      if (b.locale && x.portal) x.portal.locale = b.locale;
    });
    const { token, expiresAt } = await mintLink(ctx, c.id);
    if (!(await trySend(async () => sendLinkEmail(ctx, (await ctx.store.cases.get(c.id))!, to!, token, 'ops'), c.id))) throw new HttpError(502, 'the email could not be sent; check the mail settings (SMTP_URL) and try again');
    await audit(ctx, req, 'portal.link_sent', `case:${c.id}`, { to: maskEmail(to) });
    res.status(201).json({ sentTo: maskEmail(to), expiresAt });
  }));

  return r;
}
