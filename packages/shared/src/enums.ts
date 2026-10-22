import { z } from 'zod';

export const ENTITY_TYPES = ['sole_establishment', 'llc', 'free_zone', 'mainland'] as const;
export const EntityTypeSchema = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  sole_establishment: 'Sole establishment',
  llc: 'LLC (mainland)',
  free_zone: 'Free zone company',
  mainland: 'Mainland company (DET / emirate authority)',
};

export const DOC_TYPES = [
  'trade_licence',
  'certificate_of_incorporation',
  'moa_aoa',
  'share_certificate',
  'register_of_shareholders',
  'register_of_directors',
  'authorised_signatory_letter',
  'emirates_id',
  'passport',
  'residence_visa',
  'lease_ejari',
  'bank_letter',
  'bank_statement',
  'vat_certificate',
  'ubo_declaration',
  'website_description',
  'processing_statement',
  'company_profile',
  'corporate_shareholder_docs',
  'unknown',
] as const;
export const DocTypeSchema = z.enum(DOC_TYPES);
export type DocType = z.infer<typeof DocTypeSchema>;

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  trade_licence: 'Trade licence',
  certificate_of_incorporation: 'Certificate of incorporation',
  moa_aoa: 'MOA / AOA',
  share_certificate: 'Share certificate',
  register_of_shareholders: 'Register of shareholders',
  register_of_directors: 'Register of directors',
  authorised_signatory_letter: 'Board resolution / POA / signatory letter',
  emirates_id: 'Emirates ID',
  passport: 'Passport',
  residence_visa: 'UAE residence visa',
  lease_ejari: 'Lease / Ejari',
  bank_letter: 'Bank letter / IBAN certificate',
  bank_statement: 'Bank statement',
  vat_certificate: 'VAT certificate (TRN)',
  ubo_declaration: 'UBO declaration',
  website_description: 'Website / product description',
  processing_statement: 'Processing statement',
  company_profile: 'Company profile',
  corporate_shareholder_docs: 'Corporate shareholder documents',
  unknown: 'Unclassified',
};

export const CASE_STATUSES = [
  'RECEIVED',
  'CLASSIFIED',
  'EXTRACTED',
  'VERIFIED',
  'UBO_RESOLVED',
  'SCREENED',
  'RISK_SCORED',
  'PACK_BUILT',
  'AWAITING_REVIEW',
  'APPROVED',
  'REJECTED',
  'NEEDS_INFO',
  'COMPLETED',
] as const;
export const CaseStatusSchema = z.enum(CASE_STATUSES);
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

/** Statuses the automated pipeline may move a case into. APPROVED and REJECTED are human only. */
export const PIPELINE_STATUSES: CaseStatus[] = [
  'RECEIVED',
  'CLASSIFIED',
  'EXTRACTED',
  'VERIFIED',
  'UBO_RESOLVED',
  'SCREENED',
  'RISK_SCORED',
  'PACK_BUILT',
  'AWAITING_REVIEW',
  'NEEDS_INFO',
];

export const ROLES = ['ADMIN', 'UNDERWRITER', 'SECOND_REVIEWER', 'VIEWER'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const RISK_RATINGS = ['LOW', 'MEDIUM', 'HIGH', 'REFER'] as const;
export const RiskRatingSchema = z.enum(RISK_RATINGS);
export type RiskRating = z.infer<typeof RiskRatingSchema>;

export const PARTY_ROLES = ['DIRECTOR', 'SIGNATORY', 'SHAREHOLDER', 'UBO'] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const TOKEN_SCOPES = ['status', 'claim'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];
