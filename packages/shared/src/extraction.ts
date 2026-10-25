import { z } from 'zod';
import type { DocType } from './enums';

export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(JsonValueSchema)]),
);

export const SourceRefSchema = z.object({
  docId: z.string().optional(),
  page: z.number().int().positive().optional(),
  snippet: z.string().max(400).optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const ExtractedFieldSchema = z.object({
  value: JsonValueSchema,
  confidence: z.number().min(0).max(1),
  source: SourceRefSchema.optional(),
});
export type ExtractedField = z.infer<typeof ExtractedFieldSchema>;

export const PersonSchema = z.object({
  name: z.string(),
  type: z.enum(['natural', 'corporate']).default('natural'),
  percentage: z.number().min(0).max(100).optional(),
  nationality: z.string().optional(),
  role: z.string().optional(),
  registrationNo: z.string().optional(),
  idNumber: z.string().optional(),
  dob: z.string().optional(),
});
export type Person = z.infer<typeof PersonSchema>;

/** Field keys the extractor is asked to return per document type. */
export const DOC_FIELD_KEYS: Record<DocType, string[]> = {
  trade_licence: [
    'legalName',
    'tradeName',
    'licenceNumber',
    'licenceAuthority',
    'legalForm',
    'issueDate',
    'expiryDate',
    'activities',
    'registeredAddress',
    'ownerNames',
    'managerNames',
  ],
  certificate_of_incorporation: ['legalName', 'registrationNumber', 'incorporationDate', 'authority', 'legalForm'],
  moa_aoa: ['legalName', 'shareCapital', 'shareholders', 'directors', 'signingAuthority'],
  share_certificate: ['legalName', 'holderName', 'shares', 'percentage', 'issueDate'],
  register_of_shareholders: ['legalName', 'shareholders', 'asOfDate'],
  register_of_directors: ['legalName', 'directors', 'asOfDate'],
  authorised_signatory_letter: ['legalName', 'signatories', 'issueDate', 'expiryDate'],
  emirates_id: ['fullName', 'idNumber', 'nationality', 'dob', 'expiryDate', 'sex'],
  passport: ['fullName', 'passportNumber', 'nationality', 'dob', 'expiryDate', 'issueDate'],
  residence_visa: ['fullName', 'visaNumber', 'expiryDate', 'sponsor'],
  lease_ejari: ['tenantName', 'address', 'ejariNumber', 'startDate', 'expiryDate'],
  bank_letter: ['accountName', 'bankName', 'iban', 'accountOpenedDate'],
  bank_statement: ['accountName', 'bankName', 'iban', 'periodStart', 'periodEnd', 'averageMonthlyCredits'],
  vat_certificate: ['legalName', 'trn', 'registeredAddress', 'effectiveDate'],
  ubo_declaration: ['legalName', 'declaredUbos', 'controlByOtherMeans', 'signedDate'],
  website_description: ['website', 'businessDescription', 'products', 'mcc', 'expectedMonthlyVolume', 'expectedAvgTicket'],
  processing_statement: ['processorName', 'periodStart', 'periodEnd', 'monthlyVolume', 'avgTicket', 'chargebackRatioPct'],
  company_profile: ['legalName', 'tradeName', 'website', 'businessDescription', 'incorporationDate', 'mcc', 'expectedMonthlyVolume', 'expectedAvgTicket'],
  corporate_shareholder_docs: ['legalName', 'registrationNumber', 'jurisdiction', 'shareholders', 'directors'],
  parent_company_documents: ['legalName', 'registrationNumber', 'jurisdiction', 'incorporationDate', 'authority', 'legalForm'],
  branch_board_resolution: ['legalName', 'branchName', 'resolutionDate', 'branchManager', 'signatories'],
  parent_ownership_chart: ['legalName', 'shareholders', 'declaredUbos', 'asOfDate'],
  chamber_certificate: ['legalName', 'membershipNumber', 'issueDate', 'expiryDate'],
  incumbency_certificate: ['legalName', 'registrationNumber', 'directors', 'shareholders', 'issueDate'],
  local_service_agent_agreement: ['legalName', 'agentName', 'agentNationality', 'startDate', 'expiryDate'],
  unknown: [],
};

/** Canonical consolidated field paths shown in the workspace, with the doc types preferred as sources (in order). */
export interface CanonicalFieldDef {
  path: string;
  section: 'Company' | 'Licence' | 'Banking' | 'Expected activity';
  label: string;
  sources: { docType: DocType; key: string }[];
}

export const CANONICAL_FIELDS: CanonicalFieldDef[] = [
  { path: 'company.legalName', section: 'Company', label: 'Legal name', sources: [{ docType: 'trade_licence', key: 'legalName' }, { docType: 'certificate_of_incorporation', key: 'legalName' }, { docType: 'moa_aoa', key: 'legalName' }, { docType: 'vat_certificate', key: 'legalName' }] },
  { path: 'company.tradeName', section: 'Company', label: 'Trade name', sources: [{ docType: 'trade_licence', key: 'tradeName' }, { docType: 'company_profile', key: 'tradeName' }] },
  { path: 'company.legalForm', section: 'Company', label: 'Legal form', sources: [{ docType: 'trade_licence', key: 'legalForm' }, { docType: 'certificate_of_incorporation', key: 'legalForm' }] },
  { path: 'company.incorporationDate', section: 'Company', label: 'Incorporation date', sources: [{ docType: 'certificate_of_incorporation', key: 'incorporationDate' }, { docType: 'trade_licence', key: 'issueDate' }, { docType: 'company_profile', key: 'incorporationDate' }] },
  { path: 'company.trn', section: 'Company', label: 'VAT TRN', sources: [{ docType: 'vat_certificate', key: 'trn' }] },
  { path: 'company.registeredAddress', section: 'Company', label: 'Registered address', sources: [{ docType: 'trade_licence', key: 'registeredAddress' }, { docType: 'lease_ejari', key: 'address' }, { docType: 'vat_certificate', key: 'registeredAddress' }] },
  { path: 'company.website', section: 'Company', label: 'Website', sources: [{ docType: 'website_description', key: 'website' }, { docType: 'company_profile', key: 'website' }] },
  { path: 'licence.number', section: 'Licence', label: 'Licence number', sources: [{ docType: 'trade_licence', key: 'licenceNumber' }] },
  { path: 'licence.authority', section: 'Licence', label: 'Issuing authority', sources: [{ docType: 'trade_licence', key: 'licenceAuthority' }] },
  { path: 'licence.issueDate', section: 'Licence', label: 'Issue date', sources: [{ docType: 'trade_licence', key: 'issueDate' }] },
  { path: 'licence.expiryDate', section: 'Licence', label: 'Expiry date', sources: [{ docType: 'trade_licence', key: 'expiryDate' }] },
  { path: 'licence.activities', section: 'Licence', label: 'Licensed activities', sources: [{ docType: 'trade_licence', key: 'activities' }] },
  { path: 'banking.iban', section: 'Banking', label: 'IBAN', sources: [{ docType: 'bank_letter', key: 'iban' }, { docType: 'bank_statement', key: 'iban' }] },
  { path: 'banking.bankName', section: 'Banking', label: 'Bank', sources: [{ docType: 'bank_letter', key: 'bankName' }, { docType: 'bank_statement', key: 'bankName' }] },
  { path: 'banking.accountName', section: 'Banking', label: 'Account name', sources: [{ docType: 'bank_letter', key: 'accountName' }, { docType: 'bank_statement', key: 'accountName' }] },
  { path: 'activity.description', section: 'Expected activity', label: 'Business description', sources: [{ docType: 'website_description', key: 'businessDescription' }, { docType: 'company_profile', key: 'businessDescription' }] },
  { path: 'activity.mcc', section: 'Expected activity', label: 'MCC', sources: [{ docType: 'website_description', key: 'mcc' }, { docType: 'company_profile', key: 'mcc' }] },
  { path: 'activity.expectedMonthlyVolume', section: 'Expected activity', label: 'Expected monthly volume (AED)', sources: [{ docType: 'website_description', key: 'expectedMonthlyVolume' }, { docType: 'company_profile', key: 'expectedMonthlyVolume' }, { docType: 'processing_statement', key: 'monthlyVolume' }] },
  { path: 'activity.expectedAvgTicket', section: 'Expected activity', label: 'Expected average ticket (AED)', sources: [{ docType: 'website_description', key: 'expectedAvgTicket' }, { docType: 'company_profile', key: 'expectedAvgTicket' }, { docType: 'processing_statement', key: 'avgTicket' }] },
  { path: 'activity.chargebackRatioPct', section: 'Expected activity', label: 'Chargeback ratio (%)', sources: [{ docType: 'processing_statement', key: 'chargebackRatioPct' }] },
];

export const CaseFieldSchema = z.object({
  value: JsonValueSchema,
  confidence: z.number().min(0).max(1),
  source: SourceRefSchema.optional(),
  needsReview: z.boolean().default(false),
  edited: z
    .object({ by: z.string(), reason: z.string(), at: z.string(), previous: JsonValueSchema })
    .optional(),
});
export type CaseField = z.infer<typeof CaseFieldSchema>;
