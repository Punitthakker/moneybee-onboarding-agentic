import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { EntityTypeSchema, type CaseField } from '@moneybee/shared';
import { authenticate, requireRole } from '../auth';
import type { Ctx } from '../context';
import { maskId } from '../crypto/pii';
import { verifyFileUrl } from '../crypto/token';
import type { CaseRec } from '../db/types';
import { ingest, type IntakeInput } from '../agents/intake';
import { transition } from '../agents/orchestrator';
import { notifyDecision } from '../bot/notify';
import { loadBotPolicy } from '../bot/policy';
import { botStats } from '../bot/stats';
import type { JobQueue } from '../queue';
import { CompletionError, completeCase } from '../complete';
import { audit, HttpError, parse, wrap } from './util';

const CreateCase = z.object({
  name: z.string().min(1).max(200).optional(),
  entityType: z.union([EntityTypeSchema, z.literal('auto')]).default('auto'),
  acquirerCode: z.string().min(1),
});
const ReviewBody = z.object({
  decision: z.enum(['approve', 'reject', 'request_info']),
  notes: z.string().trim().min(5, 'notes are mandatory (min 5 characters)').max(4000),
  /** bot-intake cases only: the text the merchant receives (request_info: the edited gap-chaser draft; reject: a merchant-safe reason). Internal notes are never sent. */
  merchantMessage: z.string().trim().max(2000).optional(),
});
const FieldPatch = z.object({
  path: z.string().min(1),
  value: z.unknown().optional(),
  confirm: z.boolean().optional(),
  reason: z.string().trim().min(3, 'a reason is required').max(1000),
});
const EmailBody = z.object({
  from: z.string().max(300).optional(),
  subject: z.string().max(300).optional(),
  body: z.string().max(200000).default(''),
  attachments: z.array(z.object({ filename: z.string().max(260), contentBase64: z.string() })).max(50).default([]),
});

/** VIEWER role sees ID numbers masked. */
function present(c: CaseRec, role: string): CaseRec {
  const out = structuredClone(c);
  // never send invite hashes or the encrypted Emirates ID to the browser
  if (out.uaepass) {
    delete out.uaepass.inviteHash;
    if (out.uaepass.identity) {
      const { emiratesIdEnc: _e, emiratesIdHash: _h, ...rest } = out.uaepass.identity;
      out.uaepass.identity = rest as typeof out.uaepass.identity;
    }
    out.uaepass.signing = out.uaepass.signing.map(({ documentKey: _k, ...s }) => s as never);
  }
  if (role !== 'VIEWER') return out;
  for (const h of out.idHolders) h.idNumber = maskId(h.idNumber) ?? undefined;
  for (const d of out.documents) if (d.fields?.idNumber) d.fields.idNumber.value = maskId(String(d.fields.idNumber.value));
  return out;
}

export function caseRoutes(ctx: Ctx, queue: JobQueue): Router {
  const r = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 300 }, preservePath: true });
  const auth = authenticate(ctx);
  const writer = requireRole('UNDERWRITER');
  const reviewer = requireRole('UNDERWRITER', 'SECOND_REVIEWER');

  const load = async (id: string) => {
    const c = await ctx.store.cases.get(id);
    if (!c) throw new HttpError(404, 'case not found');
    return c;
  };

  r.get('/stats', auth, wrap(async (_req, res) => {
    const all = await ctx.store.cases.list({ limit: 1000 });
    const today = new Date().toISOString().slice(0, 10);
    let auto = 0;
    let total = 0;
    for (const c of all) {
      const f = Object.values(c.fields);
      total += f.length;
      auto += f.filter((x) => !x.needsReview && !x.edited).length;
    }
    const packed = all.filter((c) => c.run?.finishedAt && c.pack);
    const avgMs = packed.length ? packed.reduce((s, c) => s + (new Date(c.run!.finishedAt!).getTime() - new Date(c.createdAt).getTime()), 0) / packed.length : 0;
    res.json({
      casesToday: all.filter((c) => c.createdAt.startsWith(today)).length,
      autoCompletedFieldsPct: total ? Math.round((auto / total) * 100) : 0,
      avgTimeToPackSeconds: Math.round(avgMs / 1000),
      awaitingReview: all.filter((c) => c.status === 'AWAITING_REVIEW').length,
      total: all.length,
      bot: await botStats(ctx, loadBotPolicy().session.expireAfterDays),
    });
  }));

  r.get('/cases', auth, wrap(async (req, res) => {
    const q = z.object({ status: z.string().optional(), q: z.string().optional(), entityType: EntityTypeSchema.optional(), acquirer: z.string().optional() }).parse(req.query);
    const rows = await ctx.store.cases.list({ ...q, status: q.status as never });
    res.json({
      cases: rows.map((c) => ({
        id: c.id, ref: c.ref, name: c.legalName ?? c.name, status: c.status, entityType: c.entityType ?? c.entityTypeRequested, acquirerCode: c.acquirerCode, risk: c.risk?.rating ?? null,
        confidence: avgConfidence(c), needsReview: c.needsReviewFields.length, owner: c.ownerEmail, createdAt: c.createdAt, updatedAt: c.updatedAt, run: c.run?.state ?? 'idle', docs: c.documents.length,
      })),
    });
  }));

  r.post('/cases', auth, writer, wrap(async (req, res) => {
    const b = parse(CreateCase, req.body);
    const acq = (await ctx.policies.acquirers()).find((a) => a.code === b.acquirerCode);
    if (!acq) throw new HttpError(400, `unknown acquirer ${b.acquirerCode}`);
    const n = (await ctx.store.cases.count()) + 1;
    const now = ctx.now().toISOString();
    const c: CaseRec = {
      id: randomUUID(), ref: `MB-${new Date().getUTCFullYear()}-${String(n).padStart(4, '0')}`, version: 1, name: b.name ?? 'New merchant', status: 'RECEIVED', entityTypeRequested: b.entityType,
      acquirerCode: b.acquirerCode, ownerId: req.user!.id, ownerEmail: req.user!.email, createdAt: now, updatedAt: now, files: [], documents: [], fields: {}, directors: [], shareholders: [], signatories: [],
      idHolders: [], findings: [], checklist: [], reviews: [], needsReviewFields: [], injectionSuspected: false, usage: { tokens: 0, budget: ctx.cfg.CASE_TOKEN_BUDGET, calls: 0 }, run: { seq: 0, state: 'idle' },
    };
    if (b.entityType !== 'auto') c.entityType = b.entityType;
    await ctx.store.cases.create(c);
    await audit(ctx, req, 'case.created', `case:${c.id}`);
    res.status(201).json({ id: c.id, ref: c.ref });
  }));

  r.get('/cases/:id', auth, wrap(async (req, res) => {
    const c = await load(req.params.id);
    await audit(ctx, req, 'case.read_pii', `case:${c.id}`); // PII read is audited
    const [traces, webhooks, policy] = await Promise.all([ctx.store.traces.listByCase(c.id), ctx.store.webhooks.listByCase(c.id), ctx.policies.forAcquirer(c.acquirerCode)]);
    res.json({
      case: present(c, req.user!.role), traces, webhooks: webhooks.map(({ bodyEnc: _b, ...w }) => w),
      llmIsMock: ctx.llm.isMock, policy: { version: policy.version, confidenceThreshold: policy.policy.confidenceThreshold, uboThresholdPct: policy.policy.uboThresholdPct },
    });
  }));

  r.post('/cases/:id/documents', auth, writer, upload.array('files'), wrap(async (req, res) => {
    const c = await load(req.params.id);
    if (['APPROVED', 'REJECTED', 'COMPLETED'].includes(c.status)) throw new HttpError(409, `case is ${c.status}`);
    const inputs: IntakeInput[] = [];
    for (const f of (req.files as Express.Multer.File[] | undefined) ?? []) inputs.push({ name: f.originalname, data: f.buffer, originPath: f.originalname });
    if (req.body?.email) {
      const em = parse(EmailBody, typeof req.body.email === 'string' ? JSON.parse(req.body.email) : req.body.email);
      inputs.push({ name: `email-body-${em.subject ?? 'message'}.txt`, data: Buffer.from(`From: ${em.from ?? ''}\nSubject: ${em.subject ?? ''}\n\n${em.body}`), asEmailBody: true, originPath: `email:${em.subject ?? ''}` });
      for (const a of em.attachments) inputs.push({ name: a.filename, data: Buffer.from(a.contentBase64, 'base64'), source: 'email', originPath: `email:${em.subject ?? ''}` });
    }
    if (!inputs.length) throw new HttpError(400, 'no files or email provided');
    const result = await ingest(ctx, c.id, inputs);
    await ctx.store.cases.update(c.id, (x) => {
      x.files.push(...result.added);
      if (result.added.some((f) => f.injectionSuspected)) x.injectionSuspected = true;
      if (x.name === 'New merchant' && result.added[0]) x.name = `Merchant (${result.added[0].name})`;
    });
    await audit(ctx, req, 'case.documents_added', `case:${c.id}`, { added: result.added.length, rejected: result.rejected.length });
    res.status(201).json({ added: result.added.map((f) => ({ id: f.id, name: f.name, mime: f.mime, pages: f.pageCount, injectionSuspected: !!f.injectionSuspected })), duplicates: result.duplicates, rejected: result.rejected });
  }));

  r.post('/cases/:id/run', auth, writer, wrap(async (req, res) => {
    const { from } = z.object({ from: z.enum(['classify', 'verify']).default('classify') }).parse(req.body ?? {});
    const c = await load(req.params.id);
    if (['APPROVED', 'REJECTED', 'COMPLETED'].includes(c.status)) throw new HttpError(409, `case is ${c.status}`);
    if (c.run?.state === 'running' || c.run?.state === 'queued') throw new HttpError(409, 'pipeline already running');
    if (!c.files.length) throw new HttpError(400, 'upload documents first');
    const seq = (c.run?.seq ?? 0) + 1;
    await ctx.store.cases.update(c.id, (x) => {
      x.run = { seq, state: 'queued' };
      if (x.usage.tokens >= x.usage.budget) x.usage.budget = ctx.cfg.CASE_TOKEN_BUDGET + x.usage.tokens; // an explicit human re-run grants a fresh budget window
    });
    await audit(ctx, req, 'case.run', `case:${c.id}`, { seq, from });
    await queue.enqueuePipeline({ caseId: c.id, runSeq: seq, from });
    res.status(202).json({ queued: true, runSeq: seq });
  }));

  r.patch('/cases/:id/fields', auth, reviewer, wrap(async (req, res) => {
    const b = parse(FieldPatch, req.body);
    const c = await load(req.params.id);
    if (!['AWAITING_REVIEW', 'NEEDS_INFO'].includes(c.status)) throw new HttpError(409, `fields can be edited in AWAITING_REVIEW or NEEDS_INFO (current: ${c.status})`);
    const before = c.fields[b.path];
    const now = ctx.now().toISOString();
    const updated = await ctx.store.cases.update(c.id, (x) => {
      const cur: CaseField = x.fields[b.path] ?? { value: null, confidence: 0, needsReview: false };
      if (b.confirm) {
        x.fields[b.path] = { ...cur, needsReview: false, edited: { by: req.user!.email, reason: b.reason, at: now, previous: cur.value } };
      } else {
        if (!('value' in b)) throw new HttpError(400, 'value required');
        x.fields[b.path] = { ...cur, value: b.value as CaseField['value'], confidence: 1, needsReview: false, edited: { by: req.user!.email, reason: b.reason, at: now, previous: cur.value } };
      }
      x.needsReviewFields = Object.entries(x.fields).filter(([, f]) => f.needsReview).map(([k]) => k);
      if (b.path === 'company.legalName') x.legalName = String(b.value ?? '');
    });
    await audit(ctx, req, b.confirm ? 'field.confirmed' : 'field.edited', `case:${c.id}:${b.path}`, { reason: b.reason }, before, updated.fields[b.path]);
    res.json({ field: updated.fields[b.path], needsReviewFields: updated.needsReviewFields });
  }));

  r.post('/cases/:id/review', auth, reviewer, wrap(async (req, res) => {
    const b = parse(ReviewBody, req.body);
    const c = await load(req.params.id);
    if (c.status !== 'AWAITING_REVIEW') throw new HttpError(409, `case is ${c.status}; review needs AWAITING_REVIEW`);
    if (c.run?.state === 'running' || c.run?.state === 'queued') throw new HttpError(409, 'pipeline is running');
    const me = req.user!;
    const needsTwo = !!c.risk?.requiresSecondReviewer;
    if (b.decision === 'approve') {
      if (c.needsReviewFields.length) throw new HttpError(409, `confirm or correct low-confidence fields first: ${c.needsReviewFields.join(', ')}`);
      if (c.reviews.some((x) => x.decision === 'approve' && x.reviewerId === me.id)) throw new HttpError(409, 'you have already approved this case; a different reviewer is required');
      if (needsTwo && c.reviews.some((x) => x.decision === 'approve') && !['SECOND_REVIEWER', 'ADMIN'].includes(me.role)) throw new HttpError(403, 'the second approval must come from a SECOND_REVIEWER');
      if (needsTwo && !c.reviews.some((x) => x.decision === 'approve') && me.role === 'SECOND_REVIEWER') throw new HttpError(403, 'the first approval must come from an UNDERWRITER');
    }
    const updated = await ctx.store.cases.update(c.id, (x) => {
      x.reviews.push({ reviewerId: me.id, reviewerEmail: me.email, role: me.role, decision: b.decision, notes: b.notes, at: ctx.now().toISOString() });
      if (b.decision === 'reject') transition(x, 'REJECTED', { type: 'human', id: me.id, email: me.email });
      else if (b.decision === 'request_info') transition(x, 'NEEDS_INFO', { type: 'human', id: me.id, email: me.email });
      else {
        const approvals = x.reviews.filter((v) => v.decision === 'approve');
        const distinct = new Set(approvals.map((v) => v.reviewerId)).size;
        if (distinct >= (needsTwo ? 2 : 1)) transition(x, 'APPROVED', { type: 'human', id: me.id, email: me.email });
      }
    });
    await audit(ctx, req, `review.${b.decision}`, `case:${c.id}`, { notes: b.notes, needsSecondReviewer: needsTwo, merchantMessageSent: !!updated.botIntake });
    ctx.bus.emit(c.id, { type: 'status', status: updated.status });
    // Bot-intake cases: the HUMAN decision is relayed to the merchant on their channel. Agents never reach this code path.
    if (updated.botIntake) {
      const ev =
        b.decision === 'request_info'
          ? ({ kind: 'needs_info', message: b.merchantMessage || updated.gaps?.draftMessage || (updated.botIntake.lang === 'ar' ? '- مستندات إضافية يطلبها فريق الاكتتاب' : '- Additional documents requested by our underwriting team') } as const)
          : b.decision === 'reject'
            ? ({ kind: 'rejected', merchantSafeReason: b.merchantMessage ?? '' } as const)
            : updated.status === 'APPROVED'
              ? ({ kind: 'approved' } as const)
              : null;
      if (ev) {
        const sess = await notifyDecision(ctx, updated, ev);
        if (sess && ctx.onBotOutbox) await ctx.onBotOutbox(sess.id).catch((e) => ctx.log.warn(`bot outbox drain failed: ${e instanceof Error ? e.message : e}`));
      }
    }
    res.json({ status: updated.status, awaitingSecondReviewer: needsTwo && updated.status === 'AWAITING_REVIEW' && updated.reviews.some((v) => v.decision === 'approve'), reviews: updated.reviews });
  }));

  r.post('/cases/:id/complete', auth, writer, wrap(async (req, res) => {
    try {
      const out = await completeCase(ctx, queue, req.params.id, { id: req.user!.id, email: req.user!.email }, req.ip ?? null);
      res.status(201).json({ ...out, note: 'The token is shown once and cannot be retrieved again.' });
    } catch (e) {
      if (e instanceof CompletionError) throw new HttpError(e.status, e.message);
      throw e;
    }
  }));

  r.post('/cases/:id/submit-pack', auth, writer, wrap(async (req, res) => {
    const c = await load(req.params.id);
    if (!c.pack) throw new HttpError(409, 'no pack built');
    const adapter = ctx.adapters.api_submit_mock;
    const sub = await adapter.submit(ctx, c, { files: c.pack.files, payload: c.pack.payload as Record<string, unknown> });
    await ctx.store.cases.update(c.id, (x) => {
      x.pack!.submission = sub;
    });
    await audit(ctx, req, 'pack.submit_mock', `case:${c.id}`);
    res.json({ submission: sub, warning: 'MOCK submission: no acquirer API was called.' });
  }));

  // SSE: live agent timeline
  r.get('/cases/:id/events', auth, wrap(async (req, res) => {
    await load(req.params.id);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ type: 'hello' });
    const unsub = ctx.bus.subscribe(req.params.id, send);
    const ka = setInterval(() => res.write(': keep-alive\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ka);
      unsub();
    });
  }));

  // authenticated file view for the document viewer
  r.get('/cases/:id/files/:fileId', auth, wrap(async (req, res) => {
    const c = await load(req.params.id);
    const f = c.files.find((x) => x.id === req.params.fileId);
    if (!f) throw new HttpError(404, 'file not found');
    await audit(ctx, req, 'file.read_pii', `case:${c.id}:file:${f.id}`);
    const data = await ctx.blobs.get(f.storageKey);
    res.set({ 'Content-Type': f.mime, 'Content-Disposition': `inline; filename="${f.name.replace(/"/g, '')}"`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.send(data);
  }));

  r.get('/cases/:id/pack/:name', auth, wrap(async (req, res) => {
    const c = await load(req.params.id);
    const f = c.pack?.files.find((x) => x.name === req.params.name);
    if (!f) throw new HttpError(404, 'file not found');
    await audit(ctx, req, 'pack.read_pii', `case:${c.id}:${f.name}`);
    const data = await ctx.blobs.get(f.key);
    res.set({ 'Content-Type': f.name.endsWith('.zip') ? 'application/zip' : f.name.endsWith('.json') ? 'application/json' : 'application/pdf', 'Content-Disposition': `attachment; filename="${f.name}"`, 'X-Content-Type-Options': 'nosniff' });
    res.send(data);
  }));

  r.get('/webhooks/dead', auth, wrap(async (_req, res) => {
    const dead = await ctx.store.webhooks.listDead();
    res.json({ deliveries: dead.map(({ bodyEnc: _b, ...w }) => w) });
  }));
  r.post('/webhooks/:id/retry', auth, writer, wrap(async (req, res) => {
    const d = await ctx.store.webhooks.get(req.params.id);
    if (!d) throw new HttpError(404, 'delivery not found');
    if (!d.bodyEnc) throw new HttpError(409, 'delivery body already cleared (it was delivered)');
    await ctx.store.webhooks.update(d.id, { status: 'PENDING', attempts: 0, lastError: undefined });
    await queue.enqueueWebhook({ deliveryId: d.id });
    await audit(ctx, req, 'webhook.retry', `webhook:${d.id}`);
    res.status(202).json({ queued: true });
  }));

  return r;
}

function avgConfidence(c: CaseRec): number | null {
  const v = Object.values(c.fields);
  return v.length ? Math.round((v.reduce((s, f) => s + f.confidence, 0) / v.length) * 100) / 100 : null;
}

/** Public signed download (used by the claim package). No cookie, validated by HMAC and expiry. */
export function downloadRoute(ctx: Ctx): Router {
  const r = Router();
  r.get('/dl', wrap(async (req, res) => {
    const { k, exp, sig } = z.object({ k: z.string(), exp: z.coerce.number(), sig: z.string() }).parse(req.query);
    const key = Buffer.from(k, 'base64url').toString('utf8');
    if (!key.startsWith('cases/') || key.includes('..')) throw new HttpError(400, 'bad key');
    if (!verifyFileUrl(ctx.fileUrlSecret, key, exp, sig, ctx.now().getTime())) throw new HttpError(403, 'link expired or invalid');
    await ctx.store.audit.add({ id: randomUUID(), actor: 'signed-url', action: 'file.download_signed', entity: key, ip: req.ip ?? null, at: ctx.now().toISOString() });
    const data = await ctx.blobs.get(key);
    const name = key.split('/').pop() ?? 'file';
    res.set({ 'Content-Type': name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.zip') ? 'application/zip' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.send(data);
  }));
  return r;
}

export type { Request };
