import type { BotAnswers, BotPolicy, MccResult, Policy, Prescreen, PricingQuote, VolumeBand } from '@moneybee/shared';
import type { CaseRec } from '../db/types';

/**
 * Pre-approval score. Reuses the underwriting policy's risk weights over the Stage 1 answers and whatever
 * the classifier already saw in Stage 3, so the merchant-facing band never points the opposite way from
 * the underwriter's score. Never shown to the merchant as a number.
 */
export function prescreen(policy: Policy, bot: BotPolicy, answers: BotAnswers, mcc: MccResult, c: CaseRec | null, now: Date): Prescreen {
  const w = policy.risk.weights;
  const x = bot.prescreen.extraWeights;
  const signals: Prescreen['signals'] = [];
  const add = (code: string, points: number, note: string) => points > 0 && signals.push({ code, points, note });

  if (mcc.tier === 'MEDIUM') add('MCC_MEDIUM', w.mccMedium, `MCC ${mcc.primaryMcc} medium tier`);
  if (mcc.tier === 'HIGH') add('MCC_HIGH', w.mccHigh, `MCC ${mcc.primaryMcc} high tier`);
  if (mcc.tier === 'RESTRICTED') add('MCC_RESTRICTED', w.mccHigh + x.restrictedUplift, `MCC ${mcc.primaryMcc} restricted tier`);

  if (answers.customerLocation === 'international' && answers.volumeBand === 'V1') add('JURISDICTION', w.jurisdiction, 'international customers with small, new volume');
  if (answers.yearsBand === 'lt1') add('YOUNG_BUSINESS', w.youngBusiness, 'operating under 1 year');
  if ((answers.volumeBand === 'V4' || answers.volumeBand === 'V5') && answers.yearsBand !== 'gt3') add('HIGH_VOLUME', w.highVolume, 'high volume for business age');
  if (answers.ticketBand === 'T4' || answers.ticketBand === 'T5') add('HIGH_TICKET', w.highTicket, 'average ticket over AED 2,000');
  if (answers.noWebPresence) add('NO_WEB_PRESENCE', x.noWebPresence, 'no website or social presence');
  const flags = (answers.activityFlags ?? []).length;
  if (flags) add('ACTIVITY_FLAGS', Math.min(flags * x.activityFlag, x.activityFlagCap), `${flags} activity flag(s)`);

  if (c) {
    const lowConf = c.documents.filter((d) => d.classConfidence < policy.confidenceThreshold).length;
    const soon = c.documents.filter((d) => d.expiresOn && daysUntil(d.expiresOn, now) <= policy.docExpiryWarnDays).length;
    if (lowConf || soon) add('DOC_QUALITY', w.docQuality, `${lowConf} low-confidence, ${soon} expiring document(s)`);
    if (c.injectionSuspected) add('INJECTION_SUSPECTED', w.injectionSuspected, 'a file was flagged by the safety scan');
  }

  const score = Math.max(0, Math.min(100, 100 - signals.reduce((s, g) => s + g.points, 0)));
  let band: Prescreen['band'] = score >= bot.prescreen.likelyAtOrAbove ? 'LIKELY' : score >= bot.prescreen.reviewAtOrAbove ? 'REVIEW' : 'UNLIKELY';
  if (mcc.tier === 'RESTRICTED' && band === 'LIKELY') band = 'REVIEW';
  return { score, band, signals, computedAt: now.toISOString(), policyVersion: policy.version };
}

function daysUntil(iso: string, now: Date): number {
  return Math.round((new Date(iso).getTime() - now.getTime()) / 86400000);
}

/** Indicative pricing lookup. EXAMPLE VALUES live in policies/bot.json. */
export function quote(bot: BotPolicy, mcc: MccResult, answers: BotAnswers, band: Prescreen['band']): PricingQuote | null {
  if (mcc.tier === 'PROHIBITED' || band === 'UNLIKELY') return null;
  const tier = mcc.tier as Exclude<MccResult['tier'], 'PROHIBITED'>;
  const vb: VolumeBand = answers.volumeBand ?? 'V1';
  const comp = bot.pricing.components[tier];
  if (!comp) return null;
  const upl = (answers.customerLocation === 'international' ? comp.internationalUpliftPct : 0) + (answers.billing === 'subscription' || answers.billing === 'both' ? comp.recurringUpliftPct : 0);
  const cell = (table: typeof bot.pricing.cnp) => {
    const c = table[tier]?.[vb];
    return c ? { mdrPct: round2(c.mdrPct + upl), fixedFeeAed: c.fixedFeeAed } : null;
  };
  const wantCnp = answers.channel !== 'instore';
  const wantCp = answers.channel === 'instore' || answers.channel === 'both';
  const cnp = wantCnp ? cell(bot.pricing.cnp) : null;
  const cp = wantCp ? cell(bot.pricing.cp) : null;
  const custom = vb === 'V5';
  const range = band === 'REVIEW' || tier === 'RESTRICTED' || !bot.pricing.showExactForLikely ? bot.pricing.reviewRangeUpliftPct : null;
  return { tier, volumeBand: vb, cnp, cp, rangeUpliftPct: range, settlement: comp.settlement, setupFeeAed: comp.setupFeeAed, reserve: comp.reserve, custom, currency: 'AED' };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
