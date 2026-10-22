import { OnboardingPackageSchema, type OnboardingPackage } from '@moneybee/shared';
import type { Ctx } from './context';
import { maskId } from './crypto/pii';
import { signFileUrl } from './crypto/token';
import type { CaseRec } from './db/types';
import type { CaseBundle, TokenRow } from './sql/repository';

export function signedDownloadUrl(ctx: Ctx, key: string, ttlSeconds = ctx.cfg.FILE_URL_TTL_SECONDS): { url: string; expiresAt: string } {
  const exp = Math.floor(ctx.now().getTime() / 1000) + ttlSeconds;
  const sig = signFileUrl(ctx.fileUrlSecret, key, exp);
  const url = `${ctx.cfg.PUBLIC_API_URL}/api/v1/dl?k=${Buffer.from(key).toString('base64url')}&exp=${exp}&sig=${sig}`;
  return { url, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Builds the onboarding package returned by the claim call. Validated against the shared schema before it leaves. */
export async function buildOnboardingPackage(ctx: Ctx, token: TokenRow, bundle: CaseBundle, c: CaseRec): Promise<OnboardingPackage> {
  const m = bundle.merchant;
  const mask = (enc: string | null) => {
    if (!enc) return null;
    try {
      return maskId(ctx.cipher.decrypt(enc));
    } catch {
      return null;
    }
  };
  const party = (p: CaseBundle['parties'][number]) => ({
    fullName: p.fullName, role: p.role, nationality: p.nationality, dob: p.dob, idType: p.idType, idNumberMasked: mask(p.idNumberEnc),
    idExpiry: p.idExpiry, ownershipPct: p.ownershipPct, isPep: p.isPep, screeningStatus: p.screeningStatus,
  });
  const docs = bundle.documents.map((d) => {
    const u = signedDownloadUrl(ctx, d.storageKey);
    return { id: d.id, docType: d.docType, fileName: d.fileName, sha256: d.sha256, issuedOn: d.issuedOn, expiresOn: d.expiresOn, verifiedStatus: d.verifiedStatus, downloadUrl: u.url, downloadUrlExpiresAt: u.expiresAt };
  });
  const pkg: OnboardingPackage = {
    schemaVersion: '1.0',
    caseId: bundle.caseRow.id,
    merchantId: m.id,
    acquirerCode: bundle.caseRow.acquirerCode,
    generatedAt: ctx.now().toISOString(),
    merchant: { legalName: m.legalName, tradeName: m.tradeName, entityType: m.entityType, trn: m.trn, registeredAddress: m.registeredAddress, website: m.website, incorporationDate: m.incorporationDate },
    licence: { number: m.licenceNo, authority: m.licenceAuthority, expiry: m.licenceExpiry },
    directorsAndSignatories: bundle.parties.filter((p) => p.role === 'DIRECTOR' || p.role === 'SIGNATORY').map(party),
    ubos: bundle.parties.filter((p) => p.role === 'UBO').map(party),
    documents: docs,
    risk: { rating: (m.riskRating ?? c.risk?.rating ?? 'REFER') as OnboardingPackage['risk']['rating'], score: c.risk?.score ?? 0, reasonCodes: c.risk?.reasonCodes ?? [], screeningIsMock: bundle.screening.some((s) => s.isMock) },
    activity: { mcc: m.mcc, expectedMonthlyVolume: m.expectedMonthlyVolume, expectedAvgTicket: m.expectedAvgTicket },
    decision: { decision: 'APPROVED', decidedBy: (bundle.caseRow.decidedBy ?? '').split(',').map((s) => s.trim()).filter(Boolean), decidedAt: bundle.caseRow.decidedAt ?? ctx.now().toISOString() },
    acquirerPack: {
      files: (c.pack?.files ?? []).map((f) => ({ name: f.name, sha256: f.sha256, downloadUrl: signedDownloadUrl(ctx, f.key).url })),
      submission: c.pack?.submission ?? null,
    },
  };
  void token;
  return OnboardingPackageSchema.parse(pkg);
}
