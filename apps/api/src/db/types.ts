import type {
  AcquirerConfig,
  BotAnswers,
  BotIntake,
  BotChannel,
  BotLang,
  BotStep,
  ChecklistState,
  MccResult,
  Prescreen,
  PricingQuote,
  CaseField,
  CaseStatus,
  DocType,
  EntityType,
  ExtractedField,
  Person,
  Policy,
  RiskRating,
  Role,
  ShareRequestView,
  SigningView,
  SopLevel,
} from '@moneybee/shared';

export interface FileRec {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  storageKey: string;
  pageCount?: number;
  source: 'upload' | 'zip' | 'email' | 'email_body' | 'uaepass' | 'uaepass_signed';
  /** original path inside a zip or folder upload */
  originPath?: string;
  duplicateOf?: string;
  injectionSuspected?: boolean;
  injectionMatches?: string[];
  createdAt: string;
}

export interface DocRec {
  id: string;
  fileId: string;
  docType: DocType;
  language: 'en' | 'ar' | 'bilingual' | 'unknown';
  issuingAuthority?: string;
  pageStart: number;
  pageEnd: number;
  classConfidence: number;
  issuedOn?: string | null;
  expiresOn?: string | null;
  verifiedStatus: 'UNVERIFIED' | 'VERIFIED' | 'FLAGGED' | 'EXPIRED';
  extracted?: boolean;
  /** issuer_verified: delivered by the issuer through UAE PASS. Still passes through the deterministic verifier. */
  provenance?: 'issuer_verified';
  uaepassRequestNo?: string;
  fields?: Record<string, ExtractedField>;
  injectionSuspected?: boolean;
  needsReview?: boolean;
}

export type Severity = 'info' | 'warn' | 'fail';
export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  fields?: string[];
  docIds?: string[];
  explanation?: string;
}

export interface UboNode {
  id: string;
  label: string;
  kind: 'company' | 'entity' | 'person';
  layer: number;
  isUbo?: boolean;
  effectivePct?: number;
}
export interface UboEdge {
  from: string;
  to: string;
  pct: number;
}
export interface UboResult {
  thresholdPct: number;
  nodes: UboNode[];
  edges: UboEdge[];
  ubos: { name: string; effectivePct: number; basis: 'ownership' | 'control' | 'senior_managing_official'; paths: string[] }[];
  unresolved: string[];
  explanation: string;
  layers: number;
  sharesSumTo100: boolean;
}

export interface ScreeningResultRec {
  partyKey: string;
  subject: string;
  role: string;
  status: 'CLEAR' | 'HIT' | 'POSSIBLE_MATCH';
  category: 'SANCTIONS' | 'PEP' | 'ADVERSE_MEDIA' | null;
  detail?: string;
  rawRef?: string;
}

export interface RiskResult {
  score: number;
  rating: RiskRating;
  reasonCodes: string[];
  breakdown: { code: string; points: number; note: string }[];
  memo: string;
  recommendedAction: string;
  requiresSecondReviewer: boolean;
  memoModel?: string;
}

export interface GapItem {
  kind: 'missing_document' | 'expired_document' | 'low_confidence' | 'missing_field' | 'mismatch';
  message: string;
  docType?: DocType;
  fieldPath?: string;
}

export interface PackFile {
  name: string;
  key: string;
  sha256: string;
  kind: 'form' | 'document' | 'payload' | 'archive';
  docId?: string;
}

export interface ReviewRec {
  reviewerId: string;
  reviewerEmail: string;
  role: Role;
  decision: 'approve' | 'reject' | 'request_info';
  notes: string;
  at: string;
}

export interface ChecklistItem {
  docType: DocType;
  required: boolean;
  received: boolean;
  docIds: string[];
  expired: boolean;
}

/** UAE PASS state for a case. Emirates ID number is stored encrypted plus a keyed hash, never in plain text. */
export interface CaseUaePass {
  inviteHash?: string;
  inviteExpiresAt?: string;
  identity?: {
    name: string;
    emiratesIdEnc: string;
    emiratesIdHash: string;
    emiratesIdMasked: string;
    sopLevel: SopLevel;
    mobile?: string;
    email?: string;
    verifiedAt: string;
    provider: 'mock' | 'live';
  };
  shareRequests: ShareRequestView[];
  signing: (SigningView & { documentKey: string; transactionId: string })[];
}

export interface CaseRec {
  id: string;
  ref: string;
  version: number;
  name: string;
  legalName?: string;
  status: CaseStatus;
  entityTypeRequested: EntityType | 'auto';
  entityType?: EntityType;
  acquirerCode: string;
  ownerId: string;
  ownerEmail: string;
  createdAt: string;
  updatedAt: string;
  files: FileRec[];
  documents: DocRec[];
  fields: Record<string, CaseField>;
  directors: Person[];
  shareholders: Person[];
  signatories: Person[];
  idHolders: { docId: string; docType: DocType; name: string; idNumber?: string; dob?: string; nationality?: string; expiry?: string }[];
  findings: Finding[];
  checklist: ChecklistItem[];
  ubo?: UboResult;
  screening?: { provider: string; isMock: boolean; results: ScreeningResultRec[] };
  risk?: RiskResult;
  gaps?: { items: GapItem[]; draftMessage: string };
  pack?: { acquirerCode: string; files: PackFile[]; payload: unknown; submission: { mode: string; reference: string | null; isMock: boolean } | null };
  reviews: ReviewRec[];
  needsReviewFields: string[];
  injectionSuspected: boolean;
  usage: { tokens: number; budget: number; calls: number };
  policyVersion?: number;
  modelVersion?: string;
  promptVersion?: string;
  run?: { seq: number; state: 'idle' | 'queued' | 'running' | 'failed' | 'done'; startedAt?: string; finishedAt?: string; error?: string };
  uaepass?: CaseUaePass;
  botIntake?: BotIntake;
  completion?: {
    merchantId: string;
    sqlCaseId: string;
    sqlWrittenAt: string;
    tokenId: string;
    tokenExpiresAt: string;
    completedBy: string;
  };
}

export interface TraceRec {
  id: string;
  caseId: string;
  runSeq: number;
  agent: string;
  step: string;
  status: 'running' | 'ok' | 'error' | 'skipped';
  startedAt: string;
  durationMs: number;
  inputHash?: string;
  model?: string;
  promptVersion?: string;
  tokensIn?: number;
  tokensOut?: number;
  output?: unknown;
  summary?: string;
  toolCalls?: { name: string; input: unknown; resultSummary?: string }[];
  error?: string;
}

export interface AuditRec {
  id: string;
  actor: string;
  action: string;
  entity: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  ip?: string | null;
  meta?: unknown;
  at: string;
}

export interface UserRec {
  id: string;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  active: boolean;
  createdAt: string;
}

export interface PolicySetRec {
  version: number;
  base: Policy;
  acquirers: AcquirerConfig[];
  by: string;
  note: string;
  at: string;
}

export interface SettingsRec {
  tokenTtlHours?: number;
  webhookUrl?: string;
  /** stored encrypted with the PII cipher */
  webhookSecretEnc?: string;
}

/** One merchant conversation on one channel. Keyed by a hash of channel + channel identity. */
export interface BotSessionRec {
  id: string;
  channel: BotChannel;
  /** channel identity (phone number / telegram id) encrypted with the PII cipher */
  channelIdEnc: string;
  /** last 4 digits for display */
  channelIdMasked: string;
  lang: BotLang;
  step: BotStep;
  prevStep?: BotStep;
  answers: BotAnswers;
  caseId?: string;
  caseRef?: string;
  mcc?: MccResult | null;
  checklist?: ChecklistState | null;
  prescreen?: Prescreen | null;
  pricing?: PricingQuote | null;
  extraReview?: { on: boolean; reason?: string };
  /** partner or referral code from a deep link (Telegram /start payload, WhatsApp wa.me prefilled text) */
  referral?: string;
  transcript: { at: string; from: 'merchant' | 'bot' | 'system'; step: BotStep; text: string }[];
  /** messages composed for events outside an inbound turn (underwriter decisions); adapters drain this */
  outbox: { id: string; at: string; text: string; template?: { name: string; params: string[] }; sentAt?: string }[];
  nudges: { twoHourSentAt?: string; templateSentAt?: string };
  createdAt: string;
  updatedAt: string;
  lastInboundAt: string;
  lastOutboundAt?: string;
}

export interface WebhookDeliveryRec {
  id: string;
  caseId: string;
  event: string;
  url: string;
  status: 'PENDING' | 'DELIVERED' | 'RETRYING' | 'DEAD';
  attempts: number;
  lastStatusCode?: number;
  lastError?: string;
  nextAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
  /** payload with the token REDACTED (the token itself is never persisted in plain text) */
  payloadRedacted: Record<string, unknown>;
  /** request body (contains the token) encrypted with the PII cipher; cleared once delivered */
  bodyEnc?: string | null;
}

export interface CaseListFilter {
  status?: CaseStatus;
  q?: string;
  entityType?: EntityType;
  acquirer?: string;
  limit?: number;
}

export interface Store {
  cases: {
    create(c: CaseRec): Promise<CaseRec>;
    get(id: string): Promise<CaseRec | null>;
    list(f?: CaseListFilter): Promise<CaseRec[]>;
    /** optimistic-concurrency update; mutator may be re-run on conflict */
    update(id: string, mutator: (c: CaseRec) => void | Promise<void>): Promise<CaseRec>;
    count(): Promise<number>;
  };
  traces: {
    add(t: TraceRec): Promise<void>;
    listByCase(caseId: string): Promise<TraceRec[]>;
  };
  audit: {
    add(a: AuditRec): Promise<void>;
    list(filter?: { entity?: string; limit?: number }): Promise<AuditRec[]>;
  };
  users: {
    findByEmail(email: string): Promise<UserRec | null>;
    findById(id: string): Promise<UserRec | null>;
    create(u: UserRec): Promise<UserRec>;
    update(id: string, patch: Partial<UserRec>): Promise<UserRec | null>;
    list(): Promise<UserRec[]>;
  };
  policies: {
    active(): Promise<PolicySetRec | null>;
    save(p: PolicySetRec): Promise<void>;
    versions(): Promise<Omit<PolicySetRec, 'base' | 'acquirers'>[]>;
    get(version: number): Promise<PolicySetRec | null>;
  };
  settings: {
    get(): Promise<SettingsRec>;
    set(s: SettingsRec): Promise<void>;
  };
  botSessions: {
    get(id: string): Promise<BotSessionRec | null>;
    put(s: BotSessionRec): Promise<void>;
    list(filter?: { step?: string; idleBefore?: string; limit?: number }): Promise<BotSessionRec[]>;
  };
  webhooks: {
    create(d: WebhookDeliveryRec): Promise<void>;
    update(id: string, patch: Partial<WebhookDeliveryRec>): Promise<void>;
    get(id: string): Promise<WebhookDeliveryRec | null>;
    listByCase(caseId: string): Promise<WebhookDeliveryRec[]>;
    listDead(): Promise<WebhookDeliveryRec[]>;
  };
  close(): Promise<void>;
}

export class ConflictError extends Error {
  constructor() {
    super('Version conflict');
  }
}
