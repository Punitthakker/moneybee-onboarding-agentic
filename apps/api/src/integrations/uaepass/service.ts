import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { SHARE_DOC_LABELS, isVerifiedSop, type ShareDocType, type ShareRequestView } from '@moneybee/shared';
import { jwtSecret } from '../../auth';
import type { Ctx } from '../../context';
import { hashToken, safeEqualHex } from '../../crypto/token';
import type { CaseRec, CaseUaePass, DocRec } from '../../db/types';
import { ingest } from '../../agents/intake';
import type { IdentityClaims } from './types';

export const INVITE_PREFIX = 'mb_inv_';
const INVITE_RE = /^mb_inv_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

export const uaeNow = (ctx: Ctx): Date => ctx.uaepass.now?.(ctx.now()) ?? ctx.now();
export const redirectUri = (ctx: Ctx) => ctx.cfg.UAEPASS_REDIRECT_URI ?? `${ctx.cfg.PUBLIC_API_URL}/api/v1/auth/uaepass/callback`;

export async function auditUaePass(ctx: Ctx, actor: string, action: string, entity: string, ip: string | null, meta?: unknown) {
  await ctx.store.audit.add({ id: randomUUID(), actor, action, entity, ip, at: ctx.now().toISOString(), meta });
}

const blank = (): CaseUaePass => ({ shareRequests: [], signing: [] });

/* ---------------- invite ---------------- */

export async function createInvite(ctx: Ctx, caseId: string): Promise<{ invite: string; expiresAt: string }> {
  const invite = `${INVITE_PREFIX}${caseId}_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(ctx.now().getTime() + ctx.cfg.UAEPASS_INVITE_TTL_HOURS * 3600_000).toISOString();
  await ctx.store.cases.update(caseId, (c) => {
    c.uaepass ??= blank();
    c.uaepass.inviteHash = hashToken(invite);
    c.uaepass.inviteExpiresAt = expiresAt;
  });
  return { invite, expiresAt };
}

/** Resolves an invite token to its case. Constant-time hash compare, expiry enforced. Returns null for anything wrong. */
export async function resolveInvite(ctx: Ctx, token: string | undefined): Promise<CaseRec | null> {
  const m = token ? INVITE_RE.exec(token) : null;
  if (!m) return null;
  const c = await ctx.store.cases.get(m[1]);
  const u = c?.uaepass;
  if (!c || !u?.inviteHash || !u.inviteExpiresAt) return null;
  if (!safeEqualHex(hashToken(token!), u.inviteHash)) return null;
  if (new Date(u.inviteExpiresAt) <= ctx.now()) return null;
  return c;
}

/* ---------------- login ---------------- */

export interface LoginState {
  state: string;
  nonce: string;
  verifier: string;
  invite: string;
}
export const signLoginState = (ctx: Ctx, s: LoginState) => jwt.sign(s, jwtSecret(ctx), { algorithm: 'HS256', expiresIn: '10m' });
export const readLoginState = (ctx: Ctx, t: string | undefined): LoginState | null => {
  try {
    return t ? (jwt.verify(t, jwtSecret(ctx), { algorithms: ['HS256'] }) as unknown as LoginState) : null;
  } catch {
    return null;
  }
};

export function beginLogin(ctx: Ctx, invite: string): { url: string; cookie: string } {
  const state = randomBytes(18).toString('base64url');
  const nonce = randomBytes(18).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = ctx.uaepass.buildAuthorizeUrl({ state, nonce, codeChallenge: challenge, redirectUri: redirectUri(ctx) });
  return { url, cookie: signLoginState(ctx, { state, nonce, verifier, invite }) };
}

const eidHash = (ctx: Ctx, eid: string) => createHmac('sha256', ctx.fileUrlSecret).update(`eid:${eid.replace(/\D/g, '')}`).digest('hex');
export const maskEid = (eid: string) => {
  const d = eid.replace(/\D/g, '');
  return d.length === 15 ? `${d.slice(0, 3)}-****-*******-${d.slice(-1)}` : '***';
};

export type LoginResult = { ok: true; caseId: string } | { ok: false; reason: 'sop_not_verified' | 'invite_invalid' | 'failed'; sop?: string };

export async function completeLogin(ctx: Ctx, st: LoginState, code: string): Promise<LoginResult> {
  const c = await resolveInvite(ctx, st.invite);
  if (!c) return { ok: false, reason: 'invite_invalid' };
  let claims: IdentityClaims;
  try {
    const tok = await ctx.uaepass.exchangeCode({ code, codeVerifier: st.verifier, redirectUri: redirectUri(ctx) });
    claims = await ctx.uaepass.getUserInfo(tok.accessToken);
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message }, 'uaepass login failed'); // never log codes or tokens
    return { ok: false, reason: 'failed' };
  }
  if (!isVerifiedSop(claims.sopLevel) || !claims.emiratesId) {
    await auditUaePass(ctx, 'merchant:uaepass', 'uaepass.login_blocked', `case:${c.id}`, null, { sop: claims.sopLevel });
    return { ok: false, reason: 'sop_not_verified', sop: claims.sopLevel };
  }
  await ctx.store.cases.update(c.id, (x) => {
    x.uaepass ??= blank();
    x.uaepass.identity = {
      name: claims.name, emiratesIdEnc: ctx.cipher.encrypt(claims.emiratesId), emiratesIdHash: eidHash(ctx, claims.emiratesId), emiratesIdMasked: maskEid(claims.emiratesId),
      sopLevel: claims.sopLevel, mobile: claims.mobile, email: claims.email, verifiedAt: uaeNow(ctx).toISOString(), provider: ctx.uaepass.mode,
    };
  });
  await auditUaePass(ctx, 'merchant:uaepass', 'auth.uaepass_login', `case:${c.id}`, null, { sop: claims.sopLevel, provider: ctx.uaepass.mode });
  return { ok: true, caseId: c.id };
}

const MERCHANT_COOKIE = 'mb_merchant';
export const merchantCookieName = MERCHANT_COOKIE;
export const signMerchantSession = (ctx: Ctx, caseId: string) => jwt.sign({ sub: caseId, k: 'merchant' }, jwtSecret(ctx), { algorithm: 'HS256', expiresIn: '2h' });
export const readMerchantSession = (ctx: Ctx, t: string | undefined): string | null => {
  try {
    const p = t ? (jwt.verify(t, jwtSecret(ctx), { algorithms: ['HS256'] }) as { sub: string; k?: string }) : null;
    return p && p.k === 'merchant' ? p.sub : null;
  } catch {
    return null;
  }
};

function identityClaims(ctx: Ctx, c: CaseRec): IdentityClaims | null {
  const i = c.uaepass?.identity;
  if (!i) return null;
  return { name: i.name, emiratesId: ctx.cipher.decrypt(i.emiratesIdEnc), sopLevel: i.sopLevel, mobile: i.mobile, email: i.email };
}

/* ---------------- document sharing ---------------- */

export async function createShare(ctx: Ctx, caseId: string, documents: ShareDocType[], purpose?: string): Promise<ShareRequestView> {
  const c = await ctx.store.cases.get(caseId);
  const id = c?.uaepass?.identity;
  if (!c || !id) throw Object.assign(new Error('sign in with UAE PASS first'), { status: 409 });
  const view = await ctx.uaepass.createShareRequest(
    { purpose: purpose ?? 'New merchant registration', providerName: ctx.cfg.UAEPASS_PROVIDER_NAME, documents: [...new Set(documents)], ttlMinutes: ctx.cfg.UAEPASS_SHARE_TTL_MINUTES, applicantEmail: id.email, applicantPhone: id.mobile },
    ctx.now(),
  );
  await ctx.store.cases.update(caseId, (x) => {
    x.uaepass ??= blank();
    x.uaepass.shareRequests.unshift(view);
  });
  await auditUaePass(ctx, 'merchant:uaepass', 'uaepass.share_created', `case:${caseId}`, null, { requestNo: view.requestNo, documents });
  return view;
}

/** Brings a stored request up to date with the provider (expiry, approval, decline) and ingests documents once. */
export async function syncShare(ctx: Ctx, caseId: string, requestNo: string): Promise<ShareRequestView | null> {
  const c = await ctx.store.cases.get(caseId);
  const cur = c?.uaepass?.shareRequests.find((r) => r.requestNo === requestNo);
  if (!c || !cur) return null;
  if (cur.status !== 'pending' && (cur.status !== 'shared' || cur.ingestedAt)) return cur; // terminal and settled
  const latest = cur.status === 'shared' ? cur : await ctx.uaepass.getShareRequest(cur, ctx.now());
  let ingestedAt = cur.ingestedAt ?? null;
  if (latest.status === 'shared' && !ingestedAt) {
    await ingestShared(ctx, c, latest);
    ingestedAt = ctx.now().toISOString();
  }
  const next: ShareRequestView = { ...latest, ingestedAt };
  await ctx.store.cases.update(caseId, (x) => {
    const i = x.uaepass?.shareRequests.findIndex((r) => r.requestNo === requestNo) ?? -1;
    if (x.uaepass && i >= 0) x.uaepass.shareRequests[i] = next;
  });
  if (next.status !== cur.status) await auditUaePass(ctx, 'merchant:uaepass', `uaepass.share_${next.status}`, `case:${caseId}`, null, { requestNo });
  return next;
}

async function ingestShared(ctx: Ctx, c: CaseRec, req: ShareRequestView) {
  const docs = await ctx.uaepass.fetchSharedDocuments(req, identityClaims(ctx, c));
  for (const d of docs) {
    const res = await ingest(ctx, c.id, [{ name: d.fileName, data: d.data, source: 'uaepass' }]);
    const file = res.added[0];
    if (!file) continue; // duplicate or rejected: nothing new to add
    const docId = randomUUID();
    const fields: NonNullable<DocRec['fields']> = {};
    for (const [k, v] of Object.entries(d.fields)) fields[k] = { value: v, confidence: 1, source: { docId, page: 1, snippet: `Issuer-verified via UAE PASS (${req.requestNo})` } };
    const rec: DocRec = {
      id: docId, fileId: file.id, docType: d.type, language: 'en', issuingAuthority: d.issuerName, pageStart: 1, pageEnd: 1, classConfidence: 1, expiresOn: d.expiresOn ?? null,
      verifiedStatus: 'UNVERIFIED', extracted: true, provenance: 'issuer_verified', uaepassRequestNo: req.requestNo, fields,
    };
    await ctx.store.cases.update(c.id, (x) => {
      x.files.push(file);
      x.documents.push(rec);
    });
    await auditUaePass(ctx, 'merchant:uaepass', 'uaepass.document_ingested', `case:${c.id}`, null, { requestNo: req.requestNo, type: d.type, sha256: file.sha256 });
  }
}

/* ---------------- signing (feature flag UAEPASS_SIGNING_ENABLED) ---------------- */

async function agreementPdf(c: CaseRec, providerName: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const p = pdf.addPage([595, 842]);
  const lines = [
    `${providerName.toUpperCase()} MERCHANT SERVICES AGREEMENT`, `Case reference: ${c.ref}`, `Merchant: ${c.legalName ?? c.name}`, '',
    'Sample agreement for demonstration. The merchant appoints the provider to process card and wallet payments', 'under the provider standard terms, and confirms the information given during onboarding is accurate.', '',
    'Signed electronically by the authorised signatory.',
  ];
  let y = 780;
  lines.forEach((l, i) => {
    p.drawText(l, { x: 50, y, size: i === 0 ? 15 : 10.5, font: i === 0 ? bold : font, color: rgb(0.1, 0.1, 0.1) });
    y -= i === 0 ? 30 : 17;
  });
  p.drawText('SAMPLE DOCUMENT - SYNTHETIC TEST DATA', { x: 50, y: 30, size: 8, font, color: rgb(0.6, 0.1, 0.1) });
  return Buffer.from(await pdf.save());
}

async function stampSigned(original: Buffer, o: { name: string; eidMasked: string; at: string; tx: string; sha: string; mock: boolean }): Promise<Buffer> {
  const pdf = await PDFDocument.load(original);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const p = pdf.addPage([595, 842]);
  const rows = [
    o.mock ? 'ELECTRONIC SIGNATURE PAGE (SIMULATED UAE PASS)' : 'ELECTRONIC SIGNATURE PAGE (UAE PASS)', `Signer: ${o.name}`, `Emirates ID: ${o.eidMasked}`, `Signed at: ${o.at}`, `Transaction: ${o.tx}`, `SHA-256 of the document before signing:`, o.sha,
  ];
  let y = 780;
  rows.forEach((l, i) => {
    p.drawText(l, { x: 50, y, size: i === 0 ? 14 : i === 6 ? 8 : 10.5, font: i === 0 ? bold : font, color: rgb(0.1, 0.1, 0.1) });
    y -= i === 0 ? 30 : 18;
  });
  if (o.mock) p.drawText('SIMULATED SIGNATURE - NOT LEGALLY BINDING - NO REAL UAE PASS TRANSACTION OCCURRED', { x: 50, y: 30, size: 8, font, color: rgb(0.6, 0.1, 0.1) });
  return Buffer.from(await pdf.save());
}

export async function createSigning(ctx: Ctx, caseId: string): Promise<{ id: string; signUrl: string }> {
  if (!ctx.cfg.UAEPASS_SIGNING_ENABLED) throw Object.assign(new Error('signing is not enabled'), { status: 404 });
  const c = await ctx.store.cases.get(caseId);
  if (!c?.uaepass?.identity) throw Object.assign(new Error('sign in with UAE PASS first'), { status: 409 });
  const pdf = await agreementPdf(c, ctx.cfg.UAEPASS_PROVIDER_NAME);
  const sha = createHash('sha256').update(pdf).digest('hex');
  const id = randomUUID();
  const documentKey = `cases/${caseId}/uaepass/agreement-${id}.pdf`;
  await ctx.blobs.put(documentKey, pdf);
  const documentName = 'Merchant services agreement.pdf';
  const started = await ctx.uaepass.startSigning({ transactionId: id, documentName, documentSha256: sha, ttlMinutes: ctx.cfg.UAEPASS_SHARE_TTL_MINUTES }, ctx.now());
  await ctx.store.cases.update(caseId, (x) => {
    x.uaepass ??= blank();
    x.uaepass.signing.unshift({ id, transactionId: id, documentKey, status: 'pending', documentName, createdAt: uaeNow(ctx).toISOString(), expiresAt: started.expiresAt, provider: ctx.uaepass.mode });
  });
  await auditUaePass(ctx, 'merchant:uaepass', 'uaepass.signing_started', `case:${caseId}`, null, { id });
  return { id, signUrl: started.signUrl };
}

export async function syncSigning(ctx: Ctx, caseId: string, id: string) {
  const c = await ctx.store.cases.get(caseId);
  const cur = c?.uaepass?.signing.find((s) => s.id === id);
  if (!c || !cur) return null;
  if (cur.status !== 'pending') return cur;
  const r = await ctx.uaepass.getSigningResult({ transactionId: cur.transactionId }, ctx.now());
  if (r.status === 'pending') return cur;
  let signedFileId: string | null = null;
  if (r.status === 'signed') {
    const original = await ctx.blobs.get(cur.documentKey);
    const sha = createHash('sha256').update(original).digest('hex');
    const idn = c.uaepass!.identity!;
    const stamped = await stampSigned(original, { name: idn.name, eidMasked: idn.emiratesIdMasked, at: r.signedAt ?? uaeNow(ctx).toISOString(), tx: cur.transactionId, sha, mock: ctx.uaepass.mode === 'mock' });
    const res = await ingest(ctx, caseId, [{ name: `merchant-agreement-signed-${cur.id.slice(0, 8)}.pdf`, data: stamped, source: 'uaepass_signed' }]);
    signedFileId = res.added[0]?.id ?? null;
    if (signedFileId) await ctx.store.cases.update(caseId, (x) => void x.files.push(res.added[0]));
  }
  const next = { ...cur, status: r.status, signedAt: r.signedAt ?? null, signedFileId, signatureValid: r.signatureValid ?? null };
  await ctx.store.cases.update(caseId, (x) => {
    const i = x.uaepass?.signing.findIndex((s) => s.id === id) ?? -1;
    if (x.uaepass && i >= 0) x.uaepass.signing[i] = next;
  });
  await auditUaePass(ctx, 'merchant:uaepass', `uaepass.signing_${r.status}`, `case:${caseId}`, null, { id });
  return next;
}

export const providerLabel = (type: ShareDocType) => SHARE_DOC_LABELS[type];
