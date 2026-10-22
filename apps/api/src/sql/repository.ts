import type { EntityType, RiskRating, TokenScope } from '@moneybee/shared';

export interface SqlParty {
  id: string;
  role: 'DIRECTOR' | 'SIGNATORY' | 'SHAREHOLDER' | 'UBO';
  fullName: string;
  nationality: string | null;
  dob: string | null;
  idType: string | null;
  idNumberEnc: string | null;
  piiKeyId: string | null;
  idExpiry: string | null;
  ownershipPct: number | null;
  isPep: boolean;
  screeningStatus: string | null;
}
export interface SqlDocument {
  id: string;
  docType: string;
  fileName: string;
  storageKey: string;
  sha256: string;
  issuedOn: string | null;
  expiresOn: string | null;
  verifiedStatus: string;
}
export interface SqlMerchant {
  id: string;
  legalName: string;
  tradeName: string | null;
  entityType: EntityType;
  licenceNo: string;
  licenceAuthority: string | null;
  licenceExpiry: string | null;
  incorporationDate: string | null;
  trn: string | null;
  registeredAddress: string | null;
  website: string | null;
  mcc: string | null;
  expectedMonthlyVolume: number | null;
  expectedAvgTicket: number | null;
  riskRating: RiskRating | null;
  status: string;
}
export interface SqlScreening {
  subject: string;
  provider: string;
  isMock: boolean;
  result: string;
  category: string | null;
  rawRef: string | null;
}
export interface CompletedRecord {
  merchant: Omit<SqlMerchant, 'id'>;
  parties: Omit<SqlParty, 'id'>[];
  documents: Omit<SqlDocument, 'id'>[];
  case: {
    mongoCaseId: string;
    acquirerCode: string;
    status: string;
    riskRating: RiskRating | null;
    decision: string;
    decidedBy: string;
    decidedAt: string;
    modelVersion: string | null;
    promptVersion: string | null;
  };
  screening: SqlScreening[];
  token: { tokenHash: string; scopes: TokenScope[]; expiresAt: string; createdBy: string };
  audit: { actor: string; action: string; entity: string; ip?: string | null }[];
}
export interface SavedIds {
  merchantId: string;
  sqlCaseId: string;
  tokenId: string;
  partyIds: string[];
  documentIds: string[];
}
export interface TokenRow {
  id: string;
  caseId: string;
  merchantId: string;
  scopes: TokenScope[];
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  tokenHash?: string;
}
export type ClaimOutcome = { ok: true; token: TokenRow } | { ok: false; reason: 'not_found' | 'expired' | 'revoked' | 'redeemed' | 'scope' };

export interface CaseBundle {
  merchant: SqlMerchant;
  parties: SqlParty[];
  documents: SqlDocument[];
  caseRow: { id: string; mongoCaseId: string; acquirerCode: string; status: string; riskRating: string | null; decision: string | null; decidedBy: string | null; decidedAt: string | null };
  screening: SqlScreening[];
}

/** All SQL sits behind this interface so the engine can be swapped (for example to Postgres). */
export interface OnboardingRepository {
  migrate(): Promise<void>;
  ping(): Promise<boolean>;
  /** Writes merchant, parties, documents, case, screening, token and audit rows in ONE transaction. */
  saveCompleted(rec: CompletedRecord): Promise<SavedIds>;
  findTokenByHash(hash: string): Promise<TokenRow | null>;
  findTokenById(id: string): Promise<TokenRow | null>;
  /** Atomically redeems a token for the claim scope. Succeeds at most once. */
  claimToken(hash: string, now: Date): Promise<ClaimOutcome>;
  revokeToken(id: string, now: Date): Promise<boolean>;
  getBundleByCase(sqlCaseId: string): Promise<CaseBundle | null>;
  close(): Promise<void>;
}
