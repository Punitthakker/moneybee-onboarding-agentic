import { z } from 'zod';

/** UAE PASS account levels. Only SOP2 and SOP3 have the Emirates ID verified. */
export const SOP_LEVELS = ['SOP1', 'SOP2', 'SOP3'] as const;
export const SopLevelSchema = z.enum(SOP_LEVELS);
export type SopLevel = z.infer<typeof SopLevelSchema>;
export const isVerifiedSop = (l: SopLevel) => l === 'SOP2' || l === 'SOP3';

/** Documents a share request can ask for. Emirates ID and Residence Visa are the two confirmed from the live app. */
export const SHARE_DOC_TYPES = ['emirates_id', 'residence_visa'] as const;
export const ShareDocTypeSchema = z.enum(SHARE_DOC_TYPES);
export type ShareDocType = z.infer<typeof ShareDocTypeSchema>;

export const SHARE_STATUSES = ['pending', 'shared', 'expired', 'declined'] as const;
export const ShareStatusSchema = z.enum(SHARE_STATUSES);
export type ShareStatus = z.infer<typeof ShareStatusSchema>;

export const CreateShareRequestSchema = z.object({
  documents: z.array(ShareDocTypeSchema).min(1).max(SHARE_DOC_TYPES.length).default(['emirates_id']),
  purpose: z.string().trim().min(3).max(120).optional(),
});

export interface ShareDocLine {
  type: ShareDocType;
  label: string;
  issuerName: string;
  status: 'requested' | 'shared' | 'declined';
}

export interface ShareRequestView {
  requestNo: string;
  providerName: string;
  purpose: string;
  requestedAt: string;
  expiresAt: string;
  sharedAt?: string | null;
  declinedAt?: string | null;
  status: ShareStatus;
  mandatoryDocuments: ShareDocLine[];
  personalDetails: { email?: string; phone?: string };
  ingestedAt?: string | null;
  provider: 'mock' | 'live';
}

export interface SigningView {
  id: string;
  status: 'pending' | 'signed' | 'declined' | 'expired';
  documentName: string;
  createdAt: string;
  expiresAt: string;
  signedAt?: string | null;
  signedFileId?: string | null;
  signatureValid?: boolean | null;
  provider: 'mock' | 'live';
}

export interface IdentityView {
  name: string;
  emiratesIdMasked: string;
  sopLevel: SopLevel;
  mobile?: string;
  email?: string;
  verifiedAt: string;
  provider: 'mock' | 'live';
}

export const ISSUER_NAMES: Record<ShareDocType, string> = {
  emirates_id: 'Federal Authority for Identity, Citizenship, Customs & Port Security',
  residence_visa: 'General Directorate of Residency and Foreigners Affairs',
};
export const SHARE_DOC_LABELS: Record<ShareDocType, string> = {
  emirates_id: 'Emirates ID Card',
  residence_visa: 'Residence Visa',
};
