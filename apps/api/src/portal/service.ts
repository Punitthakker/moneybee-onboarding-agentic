import { createHmac, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  DOC_TYPE_LABELS, POWERED_BY, buildChecklist, publicTenantView, questionsFor, requirementsFor, type Answers, type DocType, type EntityType, type Policy,
} from '@moneybee/shared';
import { jwtSecret } from '../auth';
import type { Ctx } from '../context';
import { hashToken, safeEqualHex } from '../crypto/token';
import type { CaseRec } from '../db/types';

/**
 * Merchant self-serve portal: magic links, merchant sessions and the merchant-safe view of an application.
 *
 * Magic link: mb_ml_<caseId>_<32 random bytes>. Only its SHA-256 hash is stored. It is valid for
 * PORTAL_LINK_TTL_HOURS and can be opened several times (people open email on phone and laptop); asking for a
 * new link replaces the old one. The link lands on /apply/link#<token>: the token sits in the URL fragment,
 * which browsers never send to a server, and the page posts it once to exchange it for a session cookie.
 */

export const LINK_PREFIX = 'mb_ml_';
const LINK_RE = /^mb_ml_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;
export const PORTAL_COOKIE = 'mb_portal';

export const normEmail = (e: string) => e.trim().toLowerCase();
export const emailHash = (ctx: Ctx, email: string) => createHmac('sha256', ctx.fileUrlSecret).update(`email:${normEmail(email)}`).digest('hex');
export const maskEmail = (email: string) => {
  const [u, d] = normEmail(email).split('@');
  return d ? `${u.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}` : '***';
};

export function contactFor(ctx: Ctx, c: { name: string; email: string; mobile?: string }): NonNullable<CaseRec['portal']>['contact'] {
  return {
    name: c.name.trim(),
    emailEnc: ctx.cipher.encrypt(normEmail(c.email)),
    emailHash: emailHash(ctx, c.email),
    emailMasked: maskEmail(c.email),
    ...(c.mobile ? { mobileEnc: ctx.cipher.encrypt(c.mobile.trim()) } : {}),
  };
}

export async function mintLink(ctx: Ctx, caseId: string): Promise<{ token: string; expiresAt: string }> {
  const token = `${LINK_PREFIX}${caseId}_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(ctx.now().getTime() + ctx.cfg.PORTAL_LINK_TTL_HOURS * 3600_000).toISOString();
  await ctx.store.cases.update(caseId, (c) => {
    if (!c.portal) throw new Error('case has no portal contact');
    c.portal.link = { hash: hashToken(token), expiresAt, sentAt: ctx.now().toISOString() };
  });
  return { token, expiresAt };
}

/** Constant-time hash compare and expiry check. Anything wrong returns null, with no hint why. */
export async function resolveLink(ctx: Ctx, token: string | undefined): Promise<CaseRec | null> {
  const m = token ? LINK_RE.exec(token) : null;
  if (!m) return null;
  const c = await ctx.store.cases.get(m[1]);
  const l = c?.portal?.link;
  if (!c || !l) return null;
  if (!safeEqualHex(hashToken(token!), l.hash)) return null;
  if (new Date(l.expiresAt) <= ctx.now()) return null;
  return c;
}

export const signPortalSession = (ctx: Ctx, c: CaseRec) =>
  jwt.sign({ sub: c.id, k: 'portal', tid: c.tenantId ?? 'moneybee' }, jwtSecret(ctx), { algorithm: 'HS256', expiresIn: `${ctx.cfg.PORTAL_SESSION_HOURS}h` });
export const readPortalSession = (ctx: Ctx, t: string | undefined): string | null => {
  try {
    const p = t ? (jwt.verify(t, jwtSecret(ctx), { algorithms: ['HS256'] }) as { sub: string; k?: string }) : null;
    return p && p.k === 'portal' ? p.sub : null;
  } catch {
    return null;
  }
};

export function linkUrl(ctx: Ctx, token: string) {
  return `${ctx.cfg.PUBLIC_WEB_URL.replace(/\/$/, '')}/apply/link#${token}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Tenant-branded magic-link email. The link is never logged. */
export async function sendLinkEmail(ctx: Ctx, c: CaseRec, to: string, token: string, why: 'start' | 'resume' | 'ops') {
  const t = ctx.tenants.getOrDefault(c.tenantId);
  const brand = `${t.branding.displayName} ${t.branding.productName}`.trim();
  const url = linkUrl(ctx, token);
  const ar = c.portal?.locale === 'ar';
  const hours = ctx.cfg.PORTAL_LINK_TTL_HOURS;
  const intro = {
    start: ar ? 'شكراً لبدء طلبك. استخدم الرابط أدناه للعودة إليه في أي وقت.' : 'Thanks for starting your application. Use the link below to come back to it at any time.',
    resume: ar ? 'طلبت رابطاً للعودة إلى طلبك.' : 'You asked for a link to get back to your application.',
    ops: ar ? 'يرجى رفع مستندات نشاطك التجاري عبر الرابط الآمن أدناه.' : 'Please upload your business documents through the secure link below.',
  }[why];
  const cta = ar ? 'متابعة الطلب' : 'Continue my application';
  const expiry = ar ? `الرابط صالح لمدة ${hours} ساعة. لا تشاركه مع أحد.` : `This link works for ${hours} hours. Do not share it with anyone.`;
  const ignore = ar ? 'إذا لم تطلب هذا البريد فيمكنك تجاهله.' : 'If you did not ask for this, you can ignore this email.';
  const subject = ar ? `${brand}: طلبك ${c.ref}` : `${brand}: your application ${c.ref}`;
  const text = `${intro}\n\n${cta}: ${url}\n\n${expiry}\n${ignore}\n\n${t.name} - ${POWERED_BY}`;
  const color = t.branding.colors.primary;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a" dir="${ar ? 'rtl' : 'ltr'}">
<p style="font-size:13px;color:#666;margin:0 0 18px">${esc(brand)} &middot; ${esc(c.ref)}</p>
<p style="font-size:16px;line-height:1.5">${esc(intro)}</p>
<p style="margin:26px 0"><a href="${esc(url)}" style="background:${esc(color)};color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;display:inline-block;font-weight:bold">${esc(cta)}</a></p>
<p style="font-size:13px;color:#555;line-height:1.5">${esc(expiry)}<br>${esc(ignore)}</p>
<p style="font-size:11px;color:#999;margin-top:28px">${esc(t.name)} &middot; ${esc(POWERED_BY)}</p></div>`;
  await ctx.mailer.send({ to, subject, text, html, fromName: brand });
}

/* ---------------- merchant view ---------------- */

export type MerchantPhase = 'collecting' | 'submitted' | 'in_review' | 'needs_info' | 'approved' | 'rejected' | 'completed';

export function phaseOf(c: CaseRec): MerchantPhase {
  if (c.status === 'DRAFT') return 'collecting';
  if (c.status === 'NEEDS_INFO') return 'needs_info';
  if (c.status === 'APPROVED') return 'approved';
  if (c.status === 'REJECTED') return 'rejected';
  if (c.status === 'COMPLETED') return 'completed';
  if (c.status === 'AWAITING_REVIEW') return 'in_review';
  // ops-created case that has not been run yet: the merchant is still collecting
  if (c.status === 'RECEIVED' && (c.run?.seq ?? 0) === 0) return 'collecting';
  return 'submitted';
}

export const canUpload = (c: CaseRec) => ['collecting', 'needs_info'].includes(phaseOf(c)) && c.run?.state !== 'running' && c.run?.state !== 'queued';

export function merchantView(ctx: Ctx, c: CaseRec, policy: Policy) {
  const t = ctx.tenants.getOrDefault(c.tenantId);
  const entityType = (c.entityType ?? (c.entityTypeRequested !== 'auto' ? c.entityTypeRequested : undefined)) as EntityType | undefined;
  const answers: Answers = c.portal?.answers ?? {};
  const reqs = entityType ? requirementsFor(policy, entityType, answers) : [];
  const docs = c.documents.map((d) => ({ id: d.id, docType: d.docType, expiresOn: d.expiresOn, issuedOn: d.issuedOn }));
  const sum = buildChecklist(reqs, docs, ctx.now());
  const fileOfDoc = new Map(c.documents.map((d) => [d.id, d.fileId]));
  const fileName = new Map(c.files.map((f) => [f.id, f.name]));
  const def = entityType ? policy.entityTypes[entityType] : undefined;
  const phase = phaseOf(c);
  const classified = new Map<string, DocType[]>();
  for (const d of c.documents) classified.set(d.fileId, [...(classified.get(d.fileId) ?? []), d.docType]);
  const slots = new Map((c.portal?.uploads ?? []).map((u) => [u.fileId, u.slot]));
  return {
    tenant: publicTenantView(t),
    application: {
      ref: c.ref,
      businessName: c.legalName ?? c.name,
      entityType: entityType ?? null,
      entityLabel: def?.label ?? null,
      entityLabelAr: def?.labelAr ?? null,
      answers,
      questions: entityType ? questionsFor(policy, entityType) : [],
      phase,
      canEdit: phase === 'collecting' && c.status === 'DRAFT',
      canUpload: canUpload(c),
      canSubmit: canUpload(c) && (phase === 'needs_info' || sum.complete),
      submittedAt: c.portal?.submittedAt ?? null,
      contact: c.portal ? { name: c.portal.contact.name, emailMasked: c.portal.contact.emailMasked } : null,
      locale: c.portal?.locale ?? 'en',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    },
    checklist: {
      requiredTotal: sum.requiredTotal,
      requiredDone: sum.requiredDone,
      pct: sum.pct,
      complete: sum.complete,
      items: sum.items.map((i) => ({
        docType: i.docType, label: i.label, required: i.required, conditional: i.conditional, ifApplicable: !!i.ifApplicable,
        reason: i.reason ?? null, reasonAr: i.reasonAr ?? null, hint: i.rule.hint ?? null, hintAr: i.rule.hintAr ?? null, perPerson: i.rule.perPerson ?? null,
        status: i.status, files: Array.from(new Set(i.docIds.map((id) => fileName.get(fileOfDoc.get(id) ?? '') ?? ''))).filter(Boolean),
      })),
    },
    files: c.files
      .filter((f) => !f.duplicateOf && f.source !== 'email_body')
      .map((f) => {
        const types = classified.get(f.id) ?? [];
        return {
          id: f.id, name: f.name, size: f.size, at: f.createdAt, source: f.source,
          detected: types.map((x) => ({ docType: x, label: DOC_TYPE_LABELS[x] })),
          slot: slots.get(f.id) ?? null,
          state: types.length ? (types.every((x) => x === 'unknown') ? 'unrecognised' : 'recognised') : 'checking',
        };
      }),
    // only what the merchant can act on: missing and expired documents. Underwriting findings stay internal.
    requests: phase === 'needs_info' ? (c.gaps?.items ?? []).filter((g) => g.kind === 'missing_document' || g.kind === 'expired_document').map((g) => ({ docType: g.docType ?? null, message: g.message })) : [],
    timeline: timeline(c),
  };
}

function timeline(c: CaseRec) {
  const ev: { at: string; kind: string; detail?: string }[] = [{ at: c.createdAt, kind: 'started' }];
  // one entry per day of uploads, stamped with the last upload of that day
  const byDay = new Map<string, { n: number; last: string }>();
  for (const f of c.files) {
    if (f.duplicateOf || f.source === 'email_body') continue;
    const day = f.createdAt.slice(0, 10);
    const cur = byDay.get(day) ?? { n: 0, last: f.createdAt };
    byDay.set(day, { n: cur.n + 1, last: f.createdAt > cur.last ? f.createdAt : cur.last });
  }
  for (const { n, last } of byDay.values()) ev.push({ at: last, kind: 'documents', detail: String(n) });
  if (c.portal?.submittedAt) ev.push({ at: c.portal.submittedAt, kind: 'submitted' });
  const lastReview = c.reviews[c.reviews.length - 1];
  if (lastReview) ev.push({ at: lastReview.at, kind: lastReview.decision === 'request_info' ? 'needs_info' : lastReview.decision === 'reject' ? 'rejected' : 'approved' });
  if (c.completion) ev.push({ at: c.completion.sqlWrittenAt, kind: 'completed' });
  return ev.sort((a, b) => a.at.localeCompare(b.at));
}
