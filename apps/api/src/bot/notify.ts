import { randomUUID } from 'node:crypto';
import type { Ctx } from '../context';
import type { BotSessionRec, CaseRec } from '../db/types';
import { t } from './strings';

export type DecisionEvent = { kind: 'needs_info'; message: string } | { kind: 'approved' } | { kind: 'rejected'; merchantSafeReason: string };

/** WhatsApp template names (must be approved in Meta Business Manager before go-live). */
export const TEMPLATES = { needsInfo: 'moneybee_needs_info_v1', approved: 'moneybee_approved_v1', rejected: 'moneybee_rejected_v1', resume: 'moneybee_resume_v1' } as const;

/**
 * Composes the merchant message for a HUMAN decision and places it in the session outbox.
 * Called from the review route after the underwriter decides. Never called by an agent.
 * Adapters drain the outbox; outside WhatsApp's 24h window they send the template instead of free text.
 */
export async function notifyDecision(ctx: Ctx, c: CaseRec, ev: DecisionEvent): Promise<BotSessionRec | null> {
  const sid = c.botIntake?.sessionId;
  if (!sid) return null;
  const s = await ctx.store.botSessions.get(sid);
  if (!s) return null;
  const l = s.lang;
  const name = s.answers.contactName ?? '';
  const company = s.answers.companyName ?? c.legalName ?? c.name;
  let text: string;
  let template: { name: string; params: string[] };
  if (ev.kind === 'needs_info') {
    text = t('S5_NEEDS_INFO', l, { contactName: name, caseRef: c.ref, items: ev.message });
    template = { name: TEMPLATES.needsInfo, params: [name, c.ref] };
    s.step = 'S5_SUBMITTED';
  } else if (ev.kind === 'approved') {
    const q = s.pricing;
    const pricingLine = q?.cnp ? (l === 'en' ? `Confirmed pricing: ${q.cnp.mdrPct.toFixed(2)}% + AED ${q.cnp.fixedFeeAed.toFixed(2)}, settlement ${q.settlement}.\n` : `الأسعار المؤكدة: ${q.cnp.mdrPct.toFixed(2)}% + ${q.cnp.fixedFeeAed.toFixed(2)} درهم، التسوية ${q.settlement}.\n`) : '';
    text = t('S5_APPROVED', l, { contactName: name, companyName: company, caseRef: c.ref, pricingLine });
    template = { name: TEMPLATES.approved, params: [name, company, c.ref] };
  } else {
    text = t('S5_REJECTED', l, { contactName: name, companyName: company, reason: ev.merchantSafeReason });
    template = { name: TEMPLATES.rejected, params: [name, company] };
    s.step = 'CLOSED_DECLINED';
  }
  s.outbox.push({ id: randomUUID(), at: ctx.now().toISOString(), text, template });
  s.transcript.push({ at: ctx.now().toISOString(), from: 'system', step: s.step, text });
  s.updatedAt = ctx.now().toISOString();
  await ctx.store.botSessions.put(s);
  return s;
}

/** Nudge composition for idle sessions. 2h nudge is free text (inside the 24h window); 48h nudge is a template. */
export async function composeNudges(ctx: Ctx, policy: { nudgeAfterMinutes: number; templateNudgeAfterHours: number; expireAfterDays: number }): Promise<number> {
  const now = ctx.now();
  const idle = await ctx.store.botSessions.list({ idleBefore: new Date(now.getTime() - policy.nudgeAfterMinutes * 60000).toISOString(), limit: 500 });
  let n = 0;
  for (const s of idle) {
    if (!s.step.startsWith('S1') && !s.step.startsWith('S3') && s.step !== 'S4_RESULT') continue;
    const ageH = (now.getTime() - new Date(s.lastInboundAt).getTime()) / 3600000;
    if (ageH > policy.expireAfterDays * 24) continue;
    const stepLabel = s.lang === 'en' ? (s.step.startsWith('S3') ? 'documents' : 'your business profile') : s.step.startsWith('S3') ? 'المستندات' : 'ملف نشاطك';
    if (!s.nudges.twoHourSentAt) {
      s.outbox.push({ id: randomUUID(), at: now.toISOString(), text: t('NUDGE_1', s.lang, { contactName: s.answers.contactName ?? '', stepLabel }) });
      s.nudges.twoHourSentAt = now.toISOString();
      n++;
    } else if (!s.nudges.templateSentAt && ageH >= policy.templateNudgeAfterHours) {
      s.outbox.push({ id: randomUUID(), at: now.toISOString(), text: t('NUDGE_1', s.lang, { contactName: s.answers.contactName ?? '', stepLabel }), template: { name: TEMPLATES.resume, params: [s.answers.contactName ?? '', stepLabel] } });
      s.nudges.templateSentAt = now.toISOString();
      n++;
    } else continue;
    await ctx.store.botSessions.put(s);
  }
  return n;
}
