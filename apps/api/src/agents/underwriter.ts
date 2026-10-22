import type { Policy, RiskRating } from '@moneybee/shared';
import type { CaseRec, RiskResult } from '../db/types';
import { parseDate } from './verifier';

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Deterministic score and rating. The LLM only writes the memo on top of this result. */
export function scoreRisk(c: CaseRec, policy: Policy, now: Date): Omit<RiskResult, 'memo' | 'recommendedAction' | 'memoModel'> {
  const w = policy.risk.weights;
  const breakdown: RiskResult['breakdown'] = [];
  const add = (code: string, points: number, note: string) => breakdown.push({ code, points, note });
  const refer: string[] = [];

  // MCC tier
  const mcc = String(c.fields['activity.mcc']?.value ?? '');
  const tier = policy.mccRiskTiers[mcc] ?? policy.defaultMccTier;
  if (tier === 'HIGH') add('MCC_HIGH', w.mccHigh, `MCC ${mcc || 'unknown'} is in the high risk tier.`);
  else if (tier === 'MEDIUM') add('MCC_MEDIUM', w.mccMedium, `MCC ${mcc || 'unknown'} is in the medium risk tier.`);

  // jurisdiction (UBO / director / ID holder nationality, licence authority)
  const hr = new Set(policy.highRiskJurisdictions.map((j) => j.toLowerCase()));
  const nationalities = [
    ...c.idHolders.map((h) => h.nationality ?? ''),
    ...c.directors.map((d) => d.nationality ?? ''),
    ...c.shareholders.map((s) => s.nationality ?? ''),
  ].filter(Boolean);
  const jur = nationalities.find((n) => hr.has(n.toLowerCase()));
  if (jur) add('JURISDICTION', w.jurisdiction, `A related party has high risk jurisdiction link: ${jur}.`);

  // business age
  const inc = parseDate(String(c.fields['company.incorporationDate']?.value ?? ''));
  if (inc) {
    const months = (now.getTime() - inc.getTime()) / (30.44 * 86400000);
    if (months < policy.risk.youngBusinessMonths) add('YOUNG_BUSINESS', w.youngBusiness, `Business is ${Math.max(0, Math.floor(months))} months old.`);
  }

  // ownership complexity
  if ((c.ubo?.layers ?? 0) >= 2 || (c.ubo?.unresolved.length ?? 0) > 0) add('OWNERSHIP_COMPLEX', w.ownershipComplexity, `Ownership spans ${c.ubo?.layers ?? 0} layers${c.ubo?.unresolved.length ? ' with untraced entities' : ''}.`);

  // volume and ticket
  const vol = num(c.fields['activity.expectedMonthlyVolume']?.value);
  const tkt = num(c.fields['activity.expectedAvgTicket']?.value);
  if (vol !== null && vol >= policy.risk.highMonthlyVolumeAed) add('HIGH_VOLUME', w.highVolume, `Expected monthly volume AED ${vol.toLocaleString('en-US')}.`);
  if (tkt !== null && tkt >= policy.risk.highAvgTicketAed) add('HIGH_TICKET', w.highTicket, `Expected average ticket AED ${tkt.toLocaleString('en-US')}.`);

  // chargeback history
  const cb = num(c.fields['activity.chargebackRatioPct']?.value);
  if (cb !== null && cb >= policy.risk.chargebackRatioPct) add('CHARGEBACKS', w.chargebackHistory, `Previous chargeback ratio ${cb}%.`);

  // screening
  const hits = c.screening?.results.filter((r) => r.status !== 'CLEAR') ?? [];
  if (hits.some((h) => h.category === 'SANCTIONS')) refer.push('SANCTIONS_HIT');
  if (hits.some((h) => h.category === 'PEP')) add('PEP_HIT', w.pepHit, 'A related party is a politically exposed person.');
  if (hits.some((h) => h.category === 'ADVERSE_MEDIA')) add('ADVERSE_MEDIA', w.adverseMedia, 'Adverse media match on a related party.');

  // doc quality
  const lowConf = Object.values(c.fields).filter((f) => f.needsReview).length;
  const total = Math.max(1, Object.keys(c.fields).length);
  if (lowConf / total >= policy.risk.lowDocQualityShare) add('DOC_QUALITY', w.docQuality, `${lowConf} of ${total} fields are low confidence.`);

  // verification findings
  const fails = c.findings.filter((f) => f.severity === 'fail');
  const warns = c.findings.filter((f) => f.severity === 'warn' && f.code !== 'INJECTION_SUSPECTED' && f.code !== 'LOW_CONFIDENCE');
  if (fails.length) add('VERIFICATION_FAIL', Math.min(30, fails.length * w.verificationWarn * 2), `${fails.length} failed policy check(s): ${Array.from(new Set(fails.map((f) => f.code))).join(', ')}.`);
  if (warns.length) add('VERIFICATION_WARN', Math.min(15, warns.length * w.verificationWarn), `${warns.length} policy check warning(s).`);

  // injection
  if (c.injectionSuspected) add('INJECTION_SUSPECTED', w.injectionSuspected, 'Instruction-like text was found inside a document (treated as data, flagged as a risk signal).');

  // hard REFER triggers
  if (c.findings.some((f) => f.code === 'LICENCE_EXPIRED')) refer.push('LICENCE_EXPIRED');
  if (c.injectionSuspected) refer.push('INJECTION_SUSPECTED');
  if (c.ubo && c.ubo.ubos.length === 0) refer.push('NO_UBO_DETERMINED');
  if (c.findings.some((f) => f.code === 'NAME_MISMATCH')) refer.push('NAME_MISMATCH');

  const score = Math.min(100, breakdown.reduce((s, b) => s + b.points, 0));
  let rating: RiskRating = score < policy.risk.lowBelow ? 'LOW' : score < policy.risk.mediumBelow ? 'MEDIUM' : 'HIGH';
  if (refer.length) rating = 'REFER';

  const reasonCodes = [...refer, ...breakdown.map((b) => b.code)];
  const pep = hits.some((h) => h.category === 'PEP');
  const sanctions = hits.some((h) => h.category === 'SANCTIONS');
  const requiresSecondReviewer = policy.risk.secondReviewerRatings.includes(rating) || pep || sanctions;
  return { score, rating, reasonCodes: Array.from(new Set(reasonCodes)), breakdown, requiresSecondReviewer };
}
