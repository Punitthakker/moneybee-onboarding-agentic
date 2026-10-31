import type { BotAnswers, BotMccTier, BotPolicy, ChecklistState, DocType, EntityType, Policy } from '@moneybee/shared';

/** Ask order: easiest and most-likely-at-hand first. Anything not listed keeps policy order after these. */
const ASK_ORDER: DocType[] = [
  'trade_licence',
  'emirates_id',
  'passport',
  'residence_visa',
  'lease_ejari',
  'bank_letter',
  'website_description',
  'certificate_of_incorporation',
  'moa_aoa',
  'register_of_shareholders',
  'register_of_directors',
  'authorised_signatory_letter',
  'ubo_declaration',
  'vat_certificate',
  'processing_statement',
  'bank_statement',
  'company_profile',
  'corporate_shareholder_docs',
  'share_certificate',
];

const rank = (d: DocType) => {
  const i = ASK_ORDER.indexOf(d);
  return i < 0 ? 999 : i;
};
const uniq = <T>(a: T[]) => Array.from(new Set(a));

/** Build the document checklist from the underwriting policy (source of truth) plus bot-policy risk extras. */
export function buildChecklist(policy: Policy, bot: BotPolicy, entityType: EntityType, tier: BotMccTier, answers: BotAnswers): ChecklistState {
  const et = policy.entityTypes[entityType];
  if (!et) throw new Error(`no checklist for entity type ${entityType}`);
  let required = [...et.requiredDocuments];
  if (tier === 'HIGH' || tier === 'RESTRICTED') {
    required.push(...bot.highRiskExtraDocuments);
    if (answers.currentGateway && answers.currentGateway !== 'none') required.push('processing_statement');
    for (const f of answers.activityFlags ?? []) required.push(...(bot.activityFlagRules[f]?.extraDocuments ?? []));
  }
  // processing_statement only makes sense if they already accept cards
  if (!answers.currentGateway || answers.currentGateway === 'none') required = required.filter((d) => d !== 'processing_statement');
  required = uniq(required).sort((a, b) => rank(a) - rank(b));
  const optional = uniq(et.optionalDocuments.filter((d) => !required.includes(d))).sort((a, b) => rank(a) - rank(b));
  return { required, optional, received: [], deferred: [], current: required[0] ?? null };
}

export function nextToAsk(c: ChecklistState): DocType | null {
  const pending = c.required.filter((d) => !c.received.includes(d) && !c.deferred.includes(d));
  if (pending.length) return pending[0];
  const deferred = c.deferred.filter((d) => !c.received.includes(d));
  return deferred[0] ?? null;
}

export function remaining(c: ChecklistState): DocType[] {
  return c.required.filter((d) => !c.received.includes(d));
}

export function isComplete(c: ChecklistState): boolean {
  return remaining(c).length === 0;
}

/** Mark doc types as received (any that are in required or optional). Returns the ones that were newly ticked. */
export function markReceived(c: ChecklistState, types: DocType[]): DocType[] {
  const ticked: DocType[] = [];
  for (const t of types) {
    if (t === 'unknown') continue;
    if (!c.received.includes(t)) {
      c.received.push(t);
      ticked.push(t);
    }
    c.deferred = c.deferred.filter((d) => d !== t);
  }
  c.current = nextToAsk(c);
  return ticked;
}

export function defer(c: ChecklistState, t: DocType) {
  if (!c.deferred.includes(t) && !c.received.includes(t)) c.deferred.push(t);
  c.current = nextToAsk(c);
}
