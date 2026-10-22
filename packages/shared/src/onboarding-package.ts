import { z } from 'zod';
import { EntityTypeSchema, RiskRatingSchema } from './enums';

export const PartyOut = z.object({
  fullName: z.string(),
  role: z.enum(['DIRECTOR', 'SIGNATORY', 'SHAREHOLDER', 'UBO']),
  nationality: z.string().nullable(),
  dob: z.string().nullable(),
  idType: z.string().nullable(),
  /** masked: only last 4 characters are returned */
  idNumberMasked: z.string().nullable(),
  idExpiry: z.string().nullable(),
  ownershipPct: z.number().nullable(),
  isPep: z.boolean(),
  screeningStatus: z.string().nullable(),
});

export const OnboardingPackageSchema = z.object({
  schemaVersion: z.literal('1.0'),
  caseId: z.string(),
  merchantId: z.string(),
  acquirerCode: z.string(),
  generatedAt: z.string(),
  merchant: z.object({
    legalName: z.string(),
    tradeName: z.string().nullable(),
    entityType: EntityTypeSchema,
    trn: z.string().nullable(),
    registeredAddress: z.string().nullable(),
    website: z.string().nullable(),
    incorporationDate: z.string().nullable(),
  }),
  licence: z.object({
    number: z.string(),
    authority: z.string().nullable(),
    expiry: z.string().nullable(),
  }),
  directorsAndSignatories: z.array(PartyOut),
  ubos: z.array(PartyOut),
  documents: z.array(
    z.object({
      id: z.string(),
      docType: z.string(),
      fileName: z.string(),
      sha256: z.string(),
      issuedOn: z.string().nullable(),
      expiresOn: z.string().nullable(),
      verifiedStatus: z.string(),
      downloadUrl: z.string(),
      downloadUrlExpiresAt: z.string(),
    }),
  ),
  risk: z.object({
    rating: RiskRatingSchema,
    score: z.number(),
    reasonCodes: z.array(z.string()),
    screeningIsMock: z.boolean(),
  }),
  activity: z.object({
    mcc: z.string().nullable(),
    expectedMonthlyVolume: z.number().nullable(),
    expectedAvgTicket: z.number().nullable(),
  }),
  decision: z.object({
    decision: z.literal('APPROVED'),
    decidedBy: z.array(z.string()),
    decidedAt: z.string(),
  }),
  acquirerPack: z.object({
    files: z.array(z.object({ name: z.string(), sha256: z.string(), downloadUrl: z.string() })),
    submission: z.object({ mode: z.string(), reference: z.string().nullable(), isMock: z.boolean() }).nullable(),
  }),
});
export type OnboardingPackage = z.infer<typeof OnboardingPackageSchema>;

export const WebhookPayloadSchema = z.object({
  event: z.literal('onboarding.completed'),
  caseId: z.string(),
  merchantId: z.string(),
  token: z.string(),
  tokenExpiresAt: z.string(),
  claimUrl: z.string(),
});
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
