export type Json = unknown;
export interface UaePassCase { inviteExpiresAt?: string; identity?: { name: string; emiratesIdMasked: string; sopLevel: string; mobile?: string; email?: string; verifiedAt: string; provider: 'mock' | 'live' }; shareRequests: import('@moneybee/shared').ShareRequestView[]; signing: (import('@moneybee/shared').SigningView)[] }
export interface SourceRef { docId?: string; page?: number; snippet?: string }
export interface CaseField { value: Json; confidence: number; source?: SourceRef; needsReview?: boolean; edited?: { by: string; reason: string; at: string; previous: Json } }
export interface Person { name: string; type?: 'natural' | 'corporate'; percentage?: number; nationality?: string; role?: string }
export interface FileRec { id: string; name: string; mime: string; size: number; pageCount?: number; source: string; injectionSuspected?: boolean; injectionMatches?: string[]; originPath?: string }
export interface DocRec { id: string; fileId: string; docType: string; language: string; issuingAuthority?: string; pageStart: number; pageEnd: number; classConfidence: number; issuedOn?: string | null; expiresOn?: string | null; verifiedStatus: string; provenance?: 'issuer_verified'; uaepassRequestNo?: string; fields?: Record<string, CaseField>; injectionSuspected?: boolean; needsReview?: boolean }
export interface Finding { code: string; severity: 'info' | 'warn' | 'fail'; message: string; fields?: string[]; docIds?: string[]; explanation?: string }
export interface UboResult { thresholdPct: number; nodes: { id: string; label: string; kind: 'company' | 'entity' | 'person'; layer: number; isUbo?: boolean; effectivePct?: number }[]; edges: { from: string; to: string; pct: number }[]; ubos: { name: string; effectivePct: number; basis: string; paths: string[] }[]; unresolved: string[]; explanation: string; layers: number }
export interface Screening { provider: string; isMock: boolean; results: { partyKey: string; subject: string; role: string; status: string; category: string | null; detail?: string }[] }
export interface Risk { score: number; rating: 'LOW' | 'MEDIUM' | 'HIGH' | 'REFER'; reasonCodes: string[]; breakdown: { code: string; points: number; note: string }[]; memo: string; recommendedAction: string; requiresSecondReviewer: boolean; memoModel?: string }
export interface Review { reviewerEmail: string; role: string; decision: string; notes: string; at: string }
export interface PackFile { name: string; sha256: string; kind: string }
export interface Case {
  id: string; ref: string; name: string; legalName?: string; status: string; entityType?: string; entityTypeRequested: string; acquirerCode: string; ownerEmail: string; createdAt: string; updatedAt: string;
  files: FileRec[]; documents: DocRec[]; fields: Record<string, CaseField>; directors: Person[]; shareholders: Person[]; signatories: Person[]; findings: Finding[];
  checklist: { docType: string; required: boolean; received: boolean; docIds: string[]; expired: boolean }[]; ubo?: UboResult; screening?: Screening; risk?: Risk;
  gaps?: { items: { kind: string; message: string }[]; draftMessage: string }; pack?: { acquirerCode: string; files: PackFile[]; submission: { mode: string; reference: string | null; isMock: boolean } | null };
  reviews: Review[]; needsReviewFields: string[]; injectionSuspected: boolean; usage: { tokens: number; budget: number; calls: number }; policyVersion?: number; modelVersion?: string; promptVersion?: string;
  run?: { seq: number; state: string; error?: string; startedAt?: string; finishedAt?: string };
  uaepass?: UaePassCase;
  botIntake?: BotIntake;
  completion?: { merchantId: string; sqlCaseId: string; sqlWrittenAt: string; tokenId: string; tokenExpiresAt: string; completedBy: string };
}
export interface Trace { id: string; agent: string; step: string; status: string; startedAt: string; durationMs: number; model?: string; promptVersion?: string; tokensIn?: number; tokensOut?: number; output?: Json; summary?: string; toolCalls?: { name: string; input: Json; resultSummary?: string }[]; error?: string; runSeq: number }
export interface Webhook { id: string; status: string; attempts: number; lastStatusCode?: number; lastError?: string; url: string; createdAt: string; updatedAt: string; payloadRedacted: Record<string, unknown> }
export interface BotIntake {
  sessionId: string; channel: 'whatsapp' | 'telegram' | 'web'; lang: 'en' | 'ar';
  answers: Record<string, unknown> & { contactName?: string; companyName?: string; entityChoice?: string; entityType?: string; emirate?: string; freeZone?: string; description?: string; category?: string; channel?: string; customerType?: string; billing?: string; customerLocation?: string; volumeBand?: string; ticketBand?: string; currentGateway?: string; switchReason?: string; yearsBand?: string; web?: string; noWebPresence?: boolean; activityFlags?: string[]; consentAt?: string };
  mcc: { primaryMcc: string; secondaryMccs: string[]; confidence: number; reason: string; tier: string; labelEn: string; labelAr: string; source: string } | null;
  prescreen: { score: number; band: 'LIKELY' | 'REVIEW' | 'UNLIKELY'; signals: { code: string; points: number; note: string }[]; computedAt: string; policyVersion: number } | null;
  pricing: { tier: string; volumeBand: string; cnp: { mdrPct: number; fixedFeeAed: number } | null; cp: { mdrPct: number; fixedFeeAed: number } | null; rangeUpliftPct: number | null; settlement: string; setupFeeAed: number; reserve: { pct: number; days: number } | null; custom: boolean } | null;
  flags: { extraReview: boolean; extraReviewReason?: string };
  submittedAt: string | null;
  transcript: { at: string; from: 'merchant' | 'bot' | 'system'; step: string; text: string }[];
}
export interface CaseResponse { case: Case; traces: Trace[]; webhooks: Webhook[]; llmIsMock: boolean; policy: { version: number; confidenceThreshold: number; uboThresholdPct: number } }

export const DOC_LABELS: Record<string, string> = {
  trade_licence: 'Trade licence', certificate_of_incorporation: 'Certificate of incorporation', moa_aoa: 'MOA / AOA', share_certificate: 'Share certificate', register_of_shareholders: 'Register of shareholders',
  register_of_directors: 'Register of directors', authorised_signatory_letter: 'Signatory letter / POA', emirates_id: 'Emirates ID', passport: 'Passport', residence_visa: 'Residence visa', lease_ejari: 'Lease / Ejari',
  bank_letter: 'Bank letter / IBAN', bank_statement: 'Bank statement', vat_certificate: 'VAT certificate', ubo_declaration: 'UBO declaration', website_description: 'Website / product', processing_statement: 'Processing statement',
  company_profile: 'Company profile', corporate_shareholder_docs: 'Corporate shareholder docs', unknown: 'Unclassified',
};
export const ENTITY_LABELS: Record<string, string> = { auto: 'Auto-detect', sole_establishment: 'Sole establishment', llc: 'LLC (mainland)', free_zone: 'Free zone company', mainland: 'Mainland (DET / emirate)' };
export const FIELD_LABELS: Record<string, string> = {
  'company.legalName': 'Legal name', 'company.tradeName': 'Trade name', 'company.legalForm': 'Legal form', 'company.incorporationDate': 'Incorporation date', 'company.trn': 'VAT TRN', 'company.registeredAddress': 'Registered address', 'company.website': 'Website',
  'licence.number': 'Licence number', 'licence.authority': 'Issuing authority', 'licence.issueDate': 'Issue date', 'licence.expiryDate': 'Expiry date', 'licence.activities': 'Licensed activities',
  'banking.iban': 'IBAN', 'banking.bankName': 'Bank', 'banking.accountName': 'Account name',
  'activity.description': 'Business description', 'activity.mcc': 'MCC', 'activity.expectedMonthlyVolume': 'Monthly volume (AED)', 'activity.expectedAvgTicket': 'Average ticket (AED)', 'activity.chargebackRatioPct': 'Chargeback ratio (%)',
};
export const SECTIONS: { title: string; prefix: string }[] = [
  { title: 'Company', prefix: 'company.' }, { title: 'Licence', prefix: 'licence.' }, { title: 'Banking', prefix: 'banking.' }, { title: 'Expected activity', prefix: 'activity.' },
];
export const STATUS_TONE: Record<string, string> = {
  RECEIVED: '', CLASSIFIED: '', EXTRACTED: '', VERIFIED: '', UBO_RESOLVED: '', SCREENED: '', RISK_SCORED: '', PACK_BUILT: '', AWAITING_REVIEW: 'warn', NEEDS_INFO: 'warn', APPROVED: 'ok', REJECTED: 'bad', COMPLETED: 'dark',
};
export const fmt = (v: unknown): string => (v === null || v === undefined || v === '' ? '-' : Array.isArray(v) ? v.join('; ') : typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
