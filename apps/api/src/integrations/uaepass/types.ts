import type { ShareDocType, ShareRequestView, SopLevel } from '@moneybee/shared';

export class NotConfiguredError extends Error {
  status = 501;
  constructor(what: string) {
    super(`UAE PASS live provider: ${what} is not configured`);
  }
}

export interface IdentityClaims {
  name: string;
  /** Emirates ID number. PII: never logged. */
  emiratesId: string;
  sopLevel: SopLevel;
  mobile?: string;
  email?: string;
  nationality?: string;
  dob?: string;
}

export interface SharedDocument {
  type: ShareDocType;
  issuerName: string;
  fileName: string;
  data: Buffer;
  /** structured fields from the issuer, so no OCR is needed */
  fields: Record<string, string>;
  expiresOn?: string;
}

export interface CreateShareInput {
  purpose: string;
  providerName: string;
  documents: ShareDocType[];
  ttlMinutes: number;
  applicantEmail?: string;
  applicantPhone?: string;
}

/**
 * Everything the product needs from UAE PASS, behind one interface.
 * MockUaePassProvider is the default. LiveUaePassProvider implements login and throws NotConfigured for the
 * document-sharing and signing APIs until the UAE PASS team grants access and shares the specification.
 */
export interface UaePassProvider {
  readonly mode: 'mock' | 'live';
  buildAuthorizeUrl(p: { state: string; nonce: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ accessToken: string }>;
  getUserInfo(accessToken: string): Promise<IdentityClaims>;
  createShareRequest(p: CreateShareInput, now: Date): Promise<ShareRequestView>;
  /** returns the current provider-side status of a request previously created */
  getShareRequest(req: ShareRequestView, now: Date): Promise<ShareRequestView>;
  fetchSharedDocuments(req: ShareRequestView, identity: IdentityClaims | null): Promise<SharedDocument[]>;
  startSigning(p: { transactionId: string; documentName: string; documentSha256: string; ttlMinutes: number }, now: Date): Promise<{ signUrl: string; expiresAt: string }>;
  getSigningResult(p: { transactionId: string }, now: Date): Promise<{ status: 'pending' | 'signed' | 'declined' | 'expired'; signedAt?: string; signatureValid?: boolean }>;
  /** mock only: simulated clock so expiry can be demonstrated */
  now?(real: Date): Date;
}
