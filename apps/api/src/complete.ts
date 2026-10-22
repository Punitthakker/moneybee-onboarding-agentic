import type { WebhookPayload } from '@moneybee/shared';
import type { Ctx } from './context';
import { mintToken } from './crypto/token';
import { ConflictError, type CaseRec } from './db/types';
import { nameSimilarity } from './agents/names';
import { parseDate } from './agents/verifier';
import type { CompletedRecord } from './sql/repository';
import type { JobQueue } from './queue';
import { createDelivery } from './webhook';
import { getRuntimeSettings } from './settings';

const s = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));
const n = (v: unknown): number | null => {
  const x = Number(v);
  return v === undefined || v === null || v === '' || !Number.isFinite(x) ? null : x;
};
const d = (v: unknown): string | null => {
  const x = parseDate(s(v));
  return x ? x.toISOString().slice(0, 10) : null;
};

export class CompletionError extends Error {
  constructor(message: string, public status = 422) {
    super(message);
  }
}

export function buildCompletedRecord(ctx: Ctx, c: CaseRec, tokenHash: string, expiresAt: string, actorEmail: string): CompletedRecord {
  const f = c.fields;
  const legalName = s(f['company.legalName']?.value);
  const licenceNo = s(f['licence.number']?.value);
  if (!legalName || !licenceNo) throw new CompletionError('Cannot complete: legal name and licence number are required.');
  if (!c.entityType) throw new CompletionError('Cannot complete: entity type is unknown.');
  if (!c.risk) throw new CompletionError('Cannot complete: risk assessment missing.');

  const pii = (idNumber?: string) => (idNumber ? ctx.cipher.encrypt(idNumber) : null);
  const idFor = (name: string) => c.idHolders.map((h) => ({ h, sim: nameSimilarity(name, h.name) })).filter((x) => x.sim >= 0.85).sort((a, b) => b.sim - a.sim)[0]?.h;
  const pepFor = (name: string) => (c.screening?.results ?? []).some((r) => r.category === 'PEP' && r.status !== 'CLEAR' && nameSimilarity(r.subject, name) >= 0.9);
  const scrFor = (name: string) => (c.screening?.results ?? []).find((r) => nameSimilarity(r.subject, name) >= 0.9)?.status ?? null;
  const party = (name: string, role: 'DIRECTOR' | 'SIGNATORY' | 'SHAREHOLDER' | 'UBO', nationality?: string, pct?: number | null): CompletedRecord['parties'][number] => {
    const id = idFor(name);
    return {
      role, fullName: name, nationality: nationality ?? id?.nationality ?? null, dob: d(id?.dob), idType: id ? (id.docType === 'emirates_id' ? 'EMIRATES_ID' : id.docType === 'passport' ? 'PASSPORT' : 'RESIDENCE_VISA') : null,
      idNumberEnc: pii(id?.idNumber), piiKeyId: id?.idNumber ? ctx.cipher.keyId : null, idExpiry: d(id?.expiry), ownershipPct: pct ?? null, isPep: pepFor(name), screeningStatus: scrFor(name),
    };
  };
  const parties: CompletedRecord['parties'] = [
    ...c.directors.map((p) => party(p.name, 'DIRECTOR', p.nationality)),
    ...c.signatories.map((p) => party(p.name, 'SIGNATORY', p.nationality)),
    ...c.shareholders.filter((p) => p.type === 'natural').map((p) => party(p.name, 'SHAREHOLDER', p.nationality, p.percentage ?? null)),
    ...(c.ubo?.ubos ?? []).map((u) => party(u.name, 'UBO', undefined, u.basis === 'ownership' ? u.effectivePct : null)),
  ];
  const approvers = c.reviews.filter((r) => r.decision === 'approve');
  const decidedAt = approvers[approvers.length - 1]?.at ?? ctx.now().toISOString();

  return {
    merchant: {
      legalName, tradeName: s(f['company.tradeName']?.value), entityType: c.entityType, licenceNo, licenceAuthority: s(f['licence.authority']?.value), licenceExpiry: d(f['licence.expiryDate']?.value),
      incorporationDate: d(f['company.incorporationDate']?.value), trn: s(f['company.trn']?.value), registeredAddress: s(f['company.registeredAddress']?.value), website: s(f['company.website']?.value),
      mcc: s(f['activity.mcc']?.value), expectedMonthlyVolume: n(f['activity.expectedMonthlyVolume']?.value), expectedAvgTicket: n(f['activity.expectedAvgTicket']?.value), riskRating: c.risk.rating, status: 'ONBOARDED',
    },
    parties,
    documents: c.documents
      .filter((x) => x.docType !== 'unknown')
      .map((x) => {
        const file = c.files.find((y) => y.id === x.fileId)!;
        return { docType: x.docType, fileName: file.name, storageKey: file.storageKey, sha256: file.sha256, issuedOn: d(x.issuedOn), expiresOn: d(x.expiresOn), verifiedStatus: x.verifiedStatus };
      }),
    case: {
      mongoCaseId: c.id, acquirerCode: c.acquirerCode, status: 'COMPLETED', riskRating: c.risk.rating, decision: 'APPROVED', decidedBy: approvers.map((a) => a.reviewerEmail).join(', '), decidedAt,
      modelVersion: c.modelVersion ?? null, promptVersion: c.promptVersion ?? null,
    },
    screening: (c.screening?.results ?? []).map((r) => ({ subject: r.subject, provider: c.screening!.provider, isMock: c.screening!.isMock, result: r.status, category: r.category, rawRef: r.rawRef ?? null })),
    token: { tokenHash, scopes: ['status', 'claim'], expiresAt, createdBy: actorEmail },
    audit: [
      { actor: actorEmail, action: 'case.completed', entity: `case:${c.id}` },
      ...c.reviews.map((r) => ({ actor: r.reviewerEmail, action: `review.${r.decision}`, entity: `case:${c.id}` })),
    ],
  };
}

export interface CompletionResult {
  merchantId: string;
  sqlCaseId: string;
  tokenId: string;
  token: string;
  tokenExpiresAt: string;
  claimUrl: string;
  webhookDeliveryId: string | null;
}

/** Finalise an APPROVED case: ONE SQL transaction, mint the token (hash only stored), fire the signed webhook. */
export async function completeCase(ctx: Ctx, queue: JobQueue, caseId: string, actor: { id: string; email: string }, ip: string | null): Promise<CompletionResult> {
  const c = await ctx.store.cases.get(caseId);
  if (!c) throw new CompletionError('Case not found', 404);
  if (c.status === 'COMPLETED') throw new CompletionError('Case is already completed. Tokens are shown once.', 409);
  if (c.status !== 'APPROVED') throw new CompletionError(`Case must be APPROVED by a human reviewer (current: ${c.status}).`, 409);
  const settings = await getRuntimeSettings(ctx);
  const { token, hash } = mintToken();
  const expiresAt = new Date(ctx.now().getTime() + settings.tokenTtlHours * 3600 * 1000).toISOString();
  const rec = buildCompletedRecord(ctx, c, hash, expiresAt, actor.email);
  rec.audit.push({ actor: actor.email, action: 'token.minted', entity: `case:${c.id}`, ip });

  const saved = await ctx.repo.saveCompleted(rec); // single transaction; throws and rolls back as one
  try {
    await ctx.store.cases.update(caseId, (x) => {
      if (x.status !== 'APPROVED') throw new ConflictError();
      x.status = 'COMPLETED';
      x.completion = { merchantId: saved.merchantId, sqlCaseId: saved.sqlCaseId, sqlWrittenAt: ctx.now().toISOString(), tokenId: saved.tokenId, tokenExpiresAt: expiresAt, completedBy: actor.email };
    });
  } catch (e) {
    // SQL committed but Mongo state did not move: revoke the token so nothing dangles, surface the error
    await ctx.repo.revokeToken(saved.tokenId, ctx.now());
    throw e;
  }
  ctx.bus.emit(caseId, { type: 'status', status: 'COMPLETED' });

  const claimUrl = `${ctx.cfg.PUBLIC_API_URL}/api/v1/onboarding/${token}/claim`;
  let deliveryId: string | null = null;
  if (settings.webhookUrl) {
    const payload: WebhookPayload = { event: 'onboarding.completed', caseId: saved.sqlCaseId, merchantId: saved.merchantId, token, tokenExpiresAt: expiresAt, claimUrl };
    deliveryId = await createDelivery(ctx, caseId, settings.webhookUrl, payload);
    await queue.enqueueWebhook({ deliveryId });
  }
  await ctx.store.audit.add({ id: crypto.randomUUID(), actor: actor.email, action: 'case.completed', entity: `case:${caseId}`, ip, at: ctx.now().toISOString(), meta: { merchantId: saved.merchantId, tokenId: saved.tokenId } });
  return { merchantId: saved.merchantId, sqlCaseId: saved.sqlCaseId, tokenId: saved.tokenId, token, tokenExpiresAt: expiresAt, claimUrl, webhookDeliveryId: deliveryId };
}
