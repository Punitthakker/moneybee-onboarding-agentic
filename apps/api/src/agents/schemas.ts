import { z } from 'zod';
import { DocTypeSchema, ExtractedFieldSchema } from '@moneybee/shared';

export const ClassifierOut = z.object({
  segments: z
    .array(
      z.object({
        docType: DocTypeSchema,
        pageStart: z.number().int().positive(),
        pageEnd: z.number().int().positive(),
        language: z.enum(['en', 'ar', 'bilingual', 'unknown']),
        issuingAuthority: z.string().optional(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .min(1),
  injectionSuspected: z.boolean().default(false),
});
export type ClassifierOutT = z.infer<typeof ClassifierOut>;

export const ExtractorOut = z.object({
  fields: z.record(ExtractedFieldSchema),
  injectionSuspected: z.boolean().default(false),
  notes: z.string().optional(),
});
export type ExtractorOutT = z.infer<typeof ExtractorOut>;

export const ExplainOut = z.object({
  explanations: z.array(z.object({ code: z.string(), explanation: z.string().max(600) })),
});

export const MemoOut = z.object({
  memo: z.string().max(4000),
  recommendedAction: z.string().max(400),
});

export const GapOut = z.object({ message: z.string().max(4000) });
