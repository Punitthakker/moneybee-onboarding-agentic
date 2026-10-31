import { z } from 'zod';
import { DocTypeSchema, EntityTypeSchema } from './enums';

/** Five-tier MCC classification used by the bot. LOW/MEDIUM/HIGH map onto policy.mccRiskTiers for the underwriter. */
export const BOT_MCC_TIERS = ['LOW', 'MEDIUM', 'HIGH', 'RESTRICTED', 'PROHIBITED'] as const;
export const BotMccTierSchema = z.enum(BOT_MCC_TIERS);
export type BotMccTier = z.infer<typeof BotMccTierSchema>;

export const BOT_LANGS = ['en', 'ar'] as const;
export const BotLangSchema = z.enum(BOT_LANGS);
export type BotLang = z.infer<typeof BotLangSchema>;

export const BOT_CHANNELS = ['whatsapp', 'telegram', 'web'] as const;
export const BotChannelSchema = z.enum(BOT_CHANNELS);
export type BotChannel = z.infer<typeof BotChannelSchema>;

export const VOLUME_BANDS = ['V1', 'V2', 'V3', 'V4', 'V5'] as const;
export const VolumeBandSchema = z.enum(VOLUME_BANDS);
export type VolumeBand = z.infer<typeof VolumeBandSchema>;

export const TICKET_BANDS = ['T1', 'T2', 'T3', 'T4', 'T5'] as const;
export const TicketBandSchema = z.enum(TICKET_BANDS);
export type TicketBand = z.infer<typeof TicketBandSchema>;

export const STAGE1_CATEGORIES = [
  'retail',
  'food',
  'fashion_beauty',
  'electronics',
  'professional_services',
  'education',
  'travel',
  'health',
  'software',
  'other',
] as const;
export const Stage1CategorySchema = z.enum(STAGE1_CATEGORIES);
export type Stage1Category = z.infer<typeof Stage1CategorySchema>;

export const ACTIVITY_FLAGS = ['travel_ticketing', 'electronics_luxury', 'forex_crypto', 'gaming_betting', 'pharma_supplements', 'adult', 'charity', 'telemarketing_trials'] as const;
export const ActivityFlagSchema = z.enum(ACTIVITY_FLAGS);
export type ActivityFlag = z.infer<typeof ActivityFlagSchema>;

/** Answers collected in Stage 1. Every field optional so the session can be persisted mid-flow. */
export const BotAnswersSchema = z.object({
  consent: z.boolean().optional(),
  consentAt: z.string().optional(),
  contactName: z.string().optional(),
  companyName: z.string().optional(),
  entityChoice: z.enum(['sole_establishment', 'llc', 'free_zone', 'branch', 'civil', 'unsure']).optional(),
  entityType: EntityTypeSchema.optional(),
  emirate: z.string().optional(),
  freeZone: z.string().optional(),
  description: z.string().optional(),
  category: Stage1CategorySchema.optional(),
  channel: z.enum(['online', 'instore', 'both']).optional(),
  customerType: z.enum(['b2c', 'b2b', 'both']).optional(),
  billing: z.enum(['oneoff', 'subscription', 'both']).optional(),
  customerLocation: z.enum(['uae', 'gcc', 'international']).optional(),
  volumeBand: VolumeBandSchema.optional(),
  ticketBand: TicketBandSchema.optional(),
  currentGateway: z.string().optional(),
  switchReason: z.string().optional(),
  yearsBand: z.enum(['lt1', '1to3', 'gt3']).optional(),
  web: z.string().optional(),
  noWebPresence: z.boolean().optional(),
  activityFlags: z.array(ActivityFlagSchema).default([]),
});
export type BotAnswers = z.infer<typeof BotAnswersSchema>;

export const MccResultSchema = z.object({
  primaryMcc: z.string().regex(/^\d{4}$/),
  secondaryMccs: z.array(z.string().regex(/^\d{4}$/)).max(2).default([]),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300),
  tier: BotMccTierSchema,
  labelEn: z.string(),
  labelAr: z.string(),
  source: z.enum(['llm', 'keyword', 'category_default', 'merchant_pick']),
});
export type MccResult = z.infer<typeof MccResultSchema>;

export const PrescreenSchema = z.object({
  score: z.number().min(0).max(100),
  band: z.enum(['LIKELY', 'REVIEW', 'UNLIKELY']),
  signals: z.array(z.object({ code: z.string(), points: z.number(), note: z.string() })),
  computedAt: z.string(),
  policyVersion: z.number(),
});
export type Prescreen = z.infer<typeof PrescreenSchema>;

export const PricingQuoteSchema = z.object({
  tier: BotMccTierSchema,
  volumeBand: VolumeBandSchema,
  cnp: z.object({ mdrPct: z.number(), fixedFeeAed: z.number() }).nullable(),
  cp: z.object({ mdrPct: z.number(), fixedFeeAed: z.number() }).nullable(),
  /** present when only a range may be shown (REVIEW band or RESTRICTED tier) */
  rangeUpliftPct: z.number().nullable(),
  settlement: z.string(),
  setupFeeAed: z.number(),
  reserve: z.object({ pct: z.number(), days: z.number() }).nullable(),
  custom: z.boolean(),
  currency: z.literal('AED'),
});
export type PricingQuote = z.infer<typeof PricingQuoteSchema>;

export const BOT_STEPS = [
  'S0_LANG',
  'S0_CONSENT',
  'S1_CONTACT',
  'S1_COMPANY',
  'S1_ENTITY',
  'S1_ENTITY_LICENCE',
  'S1_EMIRATE',
  'S1_FREEZONE',
  'S1_DESCRIPTION',
  'S1_CATEGORY_CONFIRM',
  'S1_CATEGORY_LIST',
  'S1_CHANNEL',
  'S1_CUSTOMER_TYPE',
  'S1_BILLING',
  'S1_LOCATION',
  'S1_VOLUME',
  'S1_TICKET',
  'S1_TICKET_CONFIRM',
  'S1_GATEWAY',
  'S1_SWITCH_REASON',
  'S1_YEARS',
  'S1_WEB',
  'S1_FLAGS',
  'S1_SUMMARY',
  'S2_RESTRICTED',
  'S3_INTRO',
  'S3_COLLECT',
  'S3_OPTIONAL',
  'S4_RESULT',
  'S5_SUBMITTED',
  'HOLD',
  'CLOSED_PROHIBITED',
  'CLOSED_DECLINED',
] as const;
export const BotStepSchema = z.enum(BOT_STEPS);
export type BotStep = z.infer<typeof BotStepSchema>;

export const ChecklistStateSchema = z.object({
  required: z.array(DocTypeSchema),
  optional: z.array(DocTypeSchema),
  received: z.array(DocTypeSchema),
  deferred: z.array(DocTypeSchema),
  /** doc type currently being asked for */
  current: DocTypeSchema.nullable(),
});
export type ChecklistState = z.infer<typeof ChecklistStateSchema>;

/** What the bot stores on the case for the underwriter's "Bot intake" panel. */
export const BotIntakeSchema = z.object({
  sessionId: z.string(),
  channel: BotChannelSchema,
  lang: BotLangSchema,
  answers: BotAnswersSchema,
  mcc: MccResultSchema.nullable(),
  prescreen: PrescreenSchema.nullable(),
  pricing: PricingQuoteSchema.nullable(),
  flags: z.object({ extraReview: z.boolean().default(false), extraReviewReason: z.string().optional() }).default({}),
  referral: z.string().optional(),
  submittedAt: z.string().nullable(),
  /** redacted transcript: role, step, text with PII masked */
  transcript: z.array(z.object({ at: z.string(), from: z.enum(['merchant', 'bot', 'system']), step: BotStepSchema, text: z.string() })).default([]),
});
export type BotIntake = z.infer<typeof BotIntakeSchema>;

/* ---------- policies/bot.json ---------- */

export const MccCatalogueEntrySchema = z.object({
  mcc: z.string().regex(/^\d{4}$/),
  labelEn: z.string(),
  labelAr: z.string(),
  tier: BotMccTierSchema,
  category: Stage1CategorySchema,
  keywords: z.array(z.string()).default([]),
});

export const FeeCellSchema = z.object({ mdrPct: z.number(), fixedFeeAed: z.number() });
export const FeeRowSchema = z.object({ V1: FeeCellSchema, V2: FeeCellSchema, V3: FeeCellSchema, V4: FeeCellSchema, V5: FeeCellSchema.nullable() });

export const BotPolicySchema = z.object({
  version: z.number().int().positive(),
  label: z.string(),
  mccCatalogue: z.array(MccCatalogueEntrySchema).min(1),
  categoryDefaultMcc: z.record(Stage1CategorySchema, z.string()),
  /** activity flag -> rule */
  activityFlagRules: z.record(
    ActivityFlagSchema,
    z.object({ floorTier: BotMccTierSchema.optional(), setTier: BotMccTierSchema.optional(), extraDocuments: z.array(DocTypeSchema).default([]) }),
  ),
  highRiskExtraDocuments: z.array(DocTypeSchema).default([]),
  prescreen: z.object({
    likelyAtOrAbove: z.number(),
    reviewAtOrAbove: z.number(),
    extraWeights: z.object({ restrictedUplift: z.number(), noWebPresence: z.number(), activityFlag: z.number(), activityFlagCap: z.number() }),
    reviewSlaEn: z.record(z.enum(['LIKELY', 'REVIEW', 'UNLIKELY']), z.string()),
    reviewSlaAr: z.record(z.enum(['LIKELY', 'REVIEW', 'UNLIKELY']), z.string()),
  }),
  pricing: z.object({
    showExactForLikely: z.boolean().default(true),
    reviewRangeUpliftPct: z.number().default(0.75),
    cnp: z.record(z.enum(['LOW', 'MEDIUM', 'HIGH', 'RESTRICTED']), FeeRowSchema),
    cp: z.record(z.enum(['LOW', 'MEDIUM', 'HIGH', 'RESTRICTED']), FeeRowSchema),
    components: z.record(
      z.enum(['LOW', 'MEDIUM', 'HIGH', 'RESTRICTED']),
      z.object({ settlement: z.string(), setupFeeAed: z.number(), reserve: z.object({ pct: z.number(), days: z.number() }).nullable(), internationalUpliftPct: z.number(), recurringUpliftPct: z.number() }),
    ),
  }),
  session: z.object({ nudgeAfterMinutes: z.number(), templateNudgeAfterHours: z.number(), expireAfterDays: z.number() }),
});
export type BotPolicy = z.infer<typeof BotPolicySchema>;
export type MccCatalogueEntry = z.infer<typeof MccCatalogueEntrySchema>;
