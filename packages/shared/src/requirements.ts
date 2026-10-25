import { z } from 'zod';
import { DOC_TYPE_LABELS, DocTypeSchema, EntityTypeSchema, type DocType, type EntityType } from './enums';

/**
 * Document Requirements Engine.
 * Everything a merchant must provide is data in the policy (policies/base.json, versioned in MongoDB):
 * required and optional documents per company type, documents that become required from the merchant's
 * answers, which other document types can satisfy a requirement, and hints shown in the portal.
 * Adding a company type or a rule is a config change, not a code change.
 */

export const AnswerValueSchema = z.union([z.string().max(200), z.boolean()]);
export const AnswersSchema = z.record(z.string().max(60), AnswerValueSchema);
export type Answers = z.infer<typeof AnswersSchema>;

export const QuestionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/),
  label: z.string(),
  labelAr: z.string().optional(),
  help: z.string().optional(),
  helpAr: z.string().optional(),
  type: z.enum(['boolean', 'select']),
  options: z.array(z.object({ value: z.string(), label: z.string(), labelAr: z.string().optional() })).optional(),
  /** company types that ask this question; absent means all */
  entityTypes: z.array(EntityTypeSchema).optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const ConditionSchema = z.object({
  question: z.string(),
  equals: AnswerValueSchema.optional(),
  notEquals: AnswerValueSchema.optional(),
  in: z.array(z.string()).optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ConditionalDocSchema = z.object({
  docType: DocTypeSchema,
  /** all conditions must hold */
  when: z.array(ConditionSchema).min(1),
  reason: z.string(),
  reasonAr: z.string().optional(),
});

export const DocRuleSchema = z.object({
  /** other document types that also satisfy this requirement (for example a parent certificate of incorporation) */
  satisfiedBy: z.array(DocTypeSchema).optional(),
  hint: z.string().optional(),
  hintAr: z.string().optional(),
  /** who the document is needed for, shown to the merchant */
  perPerson: z.enum(['owner', 'each_ubo_and_signatory', 'branch_manager']).optional(),
  /** documents older than this (by issue date) are not accepted, for example bank letters */
  maxAgeDays: z.number().int().positive().optional(),
});
export type DocRule = z.infer<typeof DocRuleSchema>;

/** Optional presentation and rule fields added to each company type. All default, so older stored policies still parse. */
export const EntityRequirementExtras = {
  label: z.string().optional(),
  labelAr: z.string().optional(),
  description: z.string().optional(),
  descriptionAr: z.string().optional(),
  conditionalDocuments: z.array(ConditionalDocSchema).default([]),
  docRules: z.record(z.string(), DocRuleSchema).default({}),
};

export interface RequirementsPolicyView {
  entityTypes: Partial<Record<EntityType, {
    requiredDocuments: DocType[];
    optionalDocuments: DocType[];
    conditionalDocuments?: z.infer<typeof ConditionalDocSchema>[];
    docRules?: Record<string, DocRule>;
    label?: string; labelAr?: string; description?: string; descriptionAr?: string;
  }>>;
  questions?: Question[];
  documentRules?: Record<string, DocRule>;
}

export function conditionHolds(c: Condition, answers: Answers): boolean {
  const v = answers[c.question];
  if (v === undefined) return false; // unanswered: the document is shown as "if applicable", never silently required
  if (c.equals !== undefined && v !== c.equals) return false;
  if (c.notEquals !== undefined && v === c.notEquals) return false;
  if (c.in && !c.in.includes(String(v))) return false;
  return true;
}

export interface DocRequirement {
  docType: DocType;
  label: string;
  required: boolean;
  /** true when required because of an answer */
  conditional: boolean;
  /** conditional document whose question is unanswered or false: shown as "if applicable" */
  ifApplicable?: boolean;
  reason?: string;
  reasonAr?: string;
  rule: DocRule;
  accepts: DocType[];
}

export function questionsFor(policy: RequirementsPolicyView, entityType: EntityType): Question[] {
  return (policy.questions ?? []).filter((q) => !q.entityTypes || q.entityTypes.includes(entityType));
}

/** The documents a merchant of this company type must, may, or (depending on answers) might need to provide. */
export function requirementsFor(policy: RequirementsPolicyView, entityType: EntityType, answers: Answers = {}): DocRequirement[] {
  const def = policy.entityTypes[entityType];
  if (!def) return [];
  const ruleOf = (t: DocType): DocRule => ({ ...(policy.documentRules?.[t] ?? {}), ...(def.docRules?.[t] ?? {}) });
  const mk = (t: DocType, required: boolean, extra: Partial<DocRequirement> = {}): DocRequirement => {
    const rule = ruleOf(t);
    return { docType: t, label: DOC_TYPE_LABELS[t], required, conditional: false, rule, accepts: [t, ...(rule.satisfiedBy ?? [])], ...extra };
  };
  const out = new Map<DocType, DocRequirement>();
  for (const t of def.requiredDocuments) out.set(t, mk(t, true));
  for (const cd of def.conditionalDocuments ?? []) {
    const holds = cd.when.every((w) => conditionHolds(w, answers));
    const cur = out.get(cd.docType);
    if (cur?.required) continue;
    out.set(cd.docType, mk(cd.docType, holds, { conditional: holds, ifApplicable: !holds, reason: cd.reason, reasonAr: cd.reasonAr }));
  }
  for (const t of def.optionalDocuments) if (!out.has(t)) out.set(t, mk(t, false));
  return Array.from(out.values());
}

export interface ChecklistDocInput {
  id: string;
  docType: DocType;
  expiresOn?: string | null;
  issuedOn?: string | null;
  expired?: boolean;
}

export interface ChecklistEntry extends DocRequirement {
  status: 'missing' | 'received' | 'expired' | 'too_old';
  docIds: string[];
}

export interface ChecklistSummary {
  items: ChecklistEntry[];
  requiredTotal: number;
  requiredDone: number;
  /** 0 to 100 */
  pct: number;
  complete: boolean;
  /** received documents that match no requirement (kept, shown as "extra") */
  extraDocIds: string[];
}

const DAY = 86400000;

/** Matches received documents against the requirements. Each document counts for one requirement only. */
export function buildChecklist(reqs: DocRequirement[], docs: ChecklistDocInput[], now: Date = new Date()): ChecklistSummary {
  const used = new Set<string>();
  // exact type matches first, then substitutes, so a real trade licence is never consumed by a substitute rule
  const items: ChecklistEntry[] = reqs.map((r) => ({ ...r, status: 'missing' as const, docIds: [] as string[] }));
  for (const pass of [0, 1]) {
    for (const it of items) {
      const types = pass === 0 ? [it.docType] : it.accepts.filter((t) => t !== it.docType);
      if (pass === 1 && it.docIds.length) continue;
      for (const d of docs) {
        if (used.has(d.id) || !types.includes(d.docType)) continue;
        // several ID documents can sit under one requirement (one per person); other types take one document each
        if (it.docIds.length && !(it.docType === 'emirates_id' || it.docType === 'passport' || it.docType === 'residence_visa')) break;
        it.docIds.push(d.id);
        used.add(d.id);
      }
    }
  }
  for (const it of items) {
    if (!it.docIds.length) continue;
    const mine = docs.filter((d) => it.docIds.includes(d.id));
    const expired = mine.every((d) => d.expired || (d.expiresOn ? new Date(d.expiresOn).getTime() < now.getTime() : false));
    const tooOld = !!it.rule.maxAgeDays && mine.every((d) => d.issuedOn && now.getTime() - new Date(d.issuedOn).getTime() > it.rule.maxAgeDays! * DAY);
    it.status = expired ? 'expired' : tooOld ? 'too_old' : 'received';
  }
  const required = items.filter((i) => i.required);
  const done = required.filter((i) => i.status === 'received').length;
  return {
    items,
    requiredTotal: required.length,
    requiredDone: done,
    pct: required.length ? Math.round((done / required.length) * 100) : 100,
    complete: done === required.length,
    extraDocIds: docs.filter((d) => !used.has(d.id) && d.docType !== 'unknown').map((d) => d.id),
  };
}

/** Company types a tenant offers that the policy defines, in the tenant's order. */
export function offeredEntityTypes(policy: RequirementsPolicyView, enabled: EntityType[]): EntityType[] {
  return enabled.filter((t) => !!policy.entityTypes[t]);
}
