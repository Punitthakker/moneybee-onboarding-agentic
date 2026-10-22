import { randomUUID } from 'node:crypto';
import type {
  CaseBundle,
  ClaimOutcome,
  CompletedRecord,
  OnboardingRepository,
  SavedIds,
  SqlDocument,
  SqlMerchant,
  SqlParty,
  SqlScreening,
  TokenRow,
} from './repository';

interface TokenStore extends TokenRow {
  tokenHash: string;
}

/** In-memory OnboardingRepository for tests and for running without SQL Server (REPO=memory). */
export function createMemoryRepository(): OnboardingRepository & { _dump(): unknown } {
  const merchants = new Map<string, SqlMerchant>();
  const parties = new Map<string, SqlParty & { merchantId: string }>();
  const docs = new Map<string, SqlDocument & { merchantId: string }>();
  const cases = new Map<string, CaseBundle['caseRow'] & { merchantId: string }>();
  const screening = new Map<string, SqlScreening[]>();
  const tokens = new Map<string, TokenStore>();
  const audit: unknown[] = [];

  return {
    async migrate() {},
    async ping() {
      return true;
    },
    async saveCompleted(rec: CompletedRecord): Promise<SavedIds> {
      // Build everything first, then commit, to mimic a single transaction.
      const existing = Array.from(merchants.values()).find((m) => m.licenceNo === rec.merchant.licenceNo && m.licenceAuthority === rec.merchant.licenceAuthority);
      if (Array.from(cases.values()).some((c) => c.mongoCaseId === rec.case.mongoCaseId)) throw new Error('case already written (unique constraint)');
      const merchantId = existing?.id ?? randomUUID();
      const sqlCaseId = randomUUID();
      const tokenId = randomUUID();
      const partyIds = rec.parties.map(() => randomUUID());
      const documentIds = rec.documents.map(() => randomUUID());
      const tokenHashTaken = Array.from(tokens.values()).some((t) => t.tokenHash === rec.token.tokenHash);
      if (tokenHashTaken) throw new Error('token hash collision');

      merchants.set(merchantId, { id: merchantId, ...rec.merchant });
      for (const [id, p] of parties) if (p.merchantId === merchantId) parties.delete(id);
      for (const [id, d] of docs) if (d.merchantId === merchantId) docs.delete(id);
      rec.parties.forEach((p, i) => parties.set(partyIds[i], { id: partyIds[i], merchantId, ...p }));
      rec.documents.forEach((d, i) => docs.set(documentIds[i], { id: documentIds[i], merchantId, ...d }));
      cases.set(sqlCaseId, {
        id: sqlCaseId,
        merchantId,
        mongoCaseId: rec.case.mongoCaseId,
        acquirerCode: rec.case.acquirerCode,
        status: rec.case.status,
        riskRating: rec.case.riskRating,
        decision: rec.case.decision,
        decidedBy: rec.case.decidedBy,
        decidedAt: rec.case.decidedAt,
      });
      screening.set(sqlCaseId, rec.screening);
      tokens.set(tokenId, {
        id: tokenId,
        caseId: sqlCaseId,
        merchantId,
        scopes: rec.token.scopes,
        expiresAt: rec.token.expiresAt,
        redeemedAt: null,
        revokedAt: null,
        createdBy: rec.token.createdBy,
        tokenHash: rec.token.tokenHash,
      });
      audit.push(...rec.audit);
      return { merchantId, sqlCaseId, tokenId, partyIds, documentIds };
    },
    async findTokenByHash(hash) {
      const t = Array.from(tokens.values()).find((x) => x.tokenHash === hash);
      if (!t) return null;
      return { ...t };
    },
    async findTokenById(id) {
      const t = tokens.get(id);
      if (!t) return null;
      const { tokenHash: _h, ...row } = t;
      return { ...row };
    },
    async claimToken(hash, now): Promise<ClaimOutcome> {
      const t = Array.from(tokens.values()).find((x) => x.tokenHash === hash);
      if (!t) return { ok: false, reason: 'not_found' };
      if (!t.scopes.includes('claim')) return { ok: false, reason: 'scope' };
      if (t.revokedAt) return { ok: false, reason: 'revoked' };
      if (new Date(t.expiresAt) <= now) return { ok: false, reason: 'expired' };
      if (t.redeemedAt) return { ok: false, reason: 'redeemed' };
      t.redeemedAt = now.toISOString(); // synchronous check-and-set: atomic in a single-threaded runtime
      const { tokenHash: _h, ...row } = t;
      return { ok: true, token: { ...row } };
    },
    async revokeToken(id, now) {
      const t = tokens.get(id);
      if (!t || t.revokedAt) return false;
      t.revokedAt = now.toISOString();
      return true;
    },
    async getBundleByCase(sqlCaseId) {
      const c = cases.get(sqlCaseId);
      if (!c) return null;
      const m = merchants.get(c.merchantId)!;
      return {
        merchant: { ...m },
        parties: Array.from(parties.values()).filter((p) => p.merchantId === c.merchantId).map(({ merchantId: _m, ...p }) => p),
        documents: Array.from(docs.values()).filter((d) => d.merchantId === c.merchantId).map(({ merchantId: _m, ...d }) => d),
        caseRow: { id: c.id, mongoCaseId: c.mongoCaseId, acquirerCode: c.acquirerCode, status: c.status, riskRating: c.riskRating, decision: c.decision, decidedBy: c.decidedBy, decidedAt: c.decidedAt },
        screening: screening.get(sqlCaseId) ?? [],
      };
    },
    async close() {},
    _dump() {
      return { merchants: [...merchants.values()], parties: [...parties.values()], docs: [...docs.values()], cases: [...cases.values()], tokens: [...tokens.values()], audit };
    },
  };
}
