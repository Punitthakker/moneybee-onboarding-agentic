import { z } from 'zod';
import { DocTypeSchema, EntityTypeSchema, RiskRatingSchema } from './enums';

export const EntityChecklistSchema = z.object({
  requiredDocuments: z.array(DocTypeSchema),
  optionalDocuments: z.array(DocTypeSchema).default([]),
  requiredFields: z.array(z.string()),
});
export type EntityChecklist = z.infer<typeof EntityChecklistSchema>;

export const PolicySchema = z.object({
  version: z.number().int().nonnegative().default(1),
  label: z.string(),
  uboThresholdPct: z.number().min(0).max(100),
  confidenceThreshold: z.number().min(0).max(1),
  docExpiryWarnDays: z.number().int().nonnegative(),
  tokenTtlHours: z.number().positive().default(24),
  entityTypes: z.record(EntityTypeSchema, EntityChecklistSchema),
  licenceNumberPatterns: z.record(z.string(), z.string()).default({}),
  highRiskJurisdictions: z.array(z.string()).default([]),
  mccRiskTiers: z.record(z.string(), z.enum(['LOW', 'MEDIUM', 'HIGH'])),
  defaultMccTier: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  risk: z.object({
    weights: z.object({
      mccMedium: z.number(),
      mccHigh: z.number(),
      jurisdiction: z.number(),
      youngBusiness: z.number(),
      ownershipComplexity: z.number(),
      highVolume: z.number(),
      highTicket: z.number(),
      chargebackHistory: z.number(),
      pepHit: z.number(),
      adverseMedia: z.number(),
      docQuality: z.number(),
      injectionSuspected: z.number(),
      verificationWarn: z.number(),
    }),
    youngBusinessMonths: z.number(),
    highMonthlyVolumeAed: z.number(),
    highAvgTicketAed: z.number(),
    chargebackRatioPct: z.number(),
    lowDocQualityShare: z.number(),
    /** score below this is LOW */
    lowBelow: z.number(),
    /** score below this is MEDIUM, else HIGH */
    mediumBelow: z.number(),
    /** ratings that need a second reviewer */
    secondReviewerRatings: z.array(RiskRatingSchema),
  }),
  retention: z.object({ closedCaseDays: z.number().int().positive(), rejectedCaseDays: z.number().int().positive() }),
});
export type Policy = z.infer<typeof PolicySchema>;

const DeepPartial = <T extends z.ZodTypeAny>(s: T) => s.optional();

export const AcquirerFieldMapEntrySchema = z.object({
  name: z.string(),
  label: z.string(),
  /** canonical field path or special source such as party:ubo:0:fullName */
  source: z.string(),
});

export const AcquirerConfigSchema = z.object({
  code: z.string(),
  label: z.string(),
  example: z.boolean().default(false),
  overrides: z
    .object({
      uboThresholdPct: DeepPartial(z.number()),
      confidenceThreshold: DeepPartial(z.number()),
      docExpiryWarnDays: DeepPartial(z.number()),
      extraRequiredDocuments: DeepPartial(z.array(DocTypeSchema)),
      extraRequiredFields: DeepPartial(z.array(z.string())),
      highRiskJurisdictions: DeepPartial(z.array(z.string())),
      mccRiskTiers: DeepPartial(z.record(z.string(), z.enum(['LOW', 'MEDIUM', 'HIGH']))),
    })
    .default({}),
  form: z.object({
    title: z.string(),
    templatePath: z.string().optional(),
    fields: z.array(AcquirerFieldMapEntrySchema),
  }),
  documentNaming: z.object({
    pattern: z.string(),
    order: z.array(DocTypeSchema),
  }),
});
export type AcquirerConfig = z.infer<typeof AcquirerConfigSchema>;

/** Merge a base policy with an acquirer override into the effective policy for a case. */
export function effectivePolicy(base: Policy, acquirer?: AcquirerConfig | null): Policy {
  if (!acquirer) return base;
  const o = acquirer.overrides;
  const entityTypes = Object.fromEntries(
    Object.entries(base.entityTypes).map(([k, v]) => [
      k,
      {
        ...v,
        requiredDocuments: uniq([...v.requiredDocuments, ...(o.extraRequiredDocuments ?? [])]),
        requiredFields: uniq([...v.requiredFields, ...(o.extraRequiredFields ?? [])]),
      },
    ]),
  ) as Policy['entityTypes'];
  return {
    ...base,
    uboThresholdPct: o.uboThresholdPct ?? base.uboThresholdPct,
    confidenceThreshold: o.confidenceThreshold ?? base.confidenceThreshold,
    docExpiryWarnDays: o.docExpiryWarnDays ?? base.docExpiryWarnDays,
    highRiskJurisdictions: uniq([...base.highRiskJurisdictions, ...(o.highRiskJurisdictions ?? [])]),
    mccRiskTiers: { ...base.mccRiskTiers, ...(o.mccRiskTiers ?? {}) },
    entityTypes,
  };
}

function uniq<T>(a: T[]): T[] {
  return Array.from(new Set(a));
}
