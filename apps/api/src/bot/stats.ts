import type { BotChannel, BotStep } from '@moneybee/shared';
import type { Ctx } from '../context';
import type { BotSessionRec } from '../db/types';

/** Funnel stages in order. A session counts in every stage it has passed. */
export const FUNNEL = ['started', 'consented', 'profile_done', 'docs_complete', 'prescreened', 'submitted', 'approved', 'rejected', 'dropped'] as const;
export type FunnelStage = (typeof FUNNEL)[number];

const S1_ORDER: BotStep[] = ['S1_CONTACT', 'S1_COMPANY', 'S1_ENTITY', 'S1_ENTITY_LICENCE', 'S1_EMIRATE', 'S1_FREEZONE', 'S1_DESCRIPTION', 'S1_CATEGORY_CONFIRM', 'S1_CATEGORY_LIST', 'S1_CHANNEL', 'S1_CUSTOMER_TYPE', 'S1_BILLING', 'S1_LOCATION', 'S1_VOLUME', 'S1_TICKET', 'S1_TICKET_CONFIRM', 'S1_GATEWAY', 'S1_SWITCH_REASON', 'S1_YEARS', 'S1_WEB', 'S1_FLAGS', 'S1_SUMMARY'];

export interface BotStats {
  sessions: number;
  byChannel: Record<string, Record<FunnelStage, number>>;
  total: Record<FunnelStage, number>;
  /** median seconds from first message to each milestone, per channel */
  medianSeconds: Record<string, { consented: number | null; profile_done: number | null; docs_complete: number | null; submitted: number | null }>;
  /** where live (not finished) sessions currently sit */
  openByStep: Record<string, number>;
  prohibitedExits: number;
  holds: number;
}

const zero = (): Record<FunnelStage, number> => Object.fromEntries(FUNNEL.map((f) => [f, 0])) as Record<FunnelStage, number>;

function firstAt(s: BotSessionRec, pred: (step: BotStep, from: string) => boolean): number | null {
  const t0 = new Date(s.createdAt).getTime();
  const hit = s.transcript.find((x) => pred(x.step, x.from));
  return hit ? Math.round((new Date(hit.at).getTime() - t0) / 1000) : null;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

/** Aggregates the bot funnel from sessions and the cases they created. Cheap enough to run on every /stats call for now. */
export async function botStats(ctx: Ctx, expireAfterDays: number): Promise<BotStats> {
  const sessions = await ctx.store.botSessions.list({ limit: 5000 });
  const caseIds = sessions.map((s) => s.caseId).filter((x): x is string => !!x);
  const cases = new Map<string, { status: string }>();
  for (const id of caseIds) {
    const c = await ctx.store.cases.get(id);
    if (c) cases.set(id, { status: c.status });
  }
  const now = ctx.now().getTime();
  const byChannel: Record<string, Record<FunnelStage, number>> = {};
  const total = zero();
  const times: Record<string, Record<string, number[]>> = {};
  const openByStep: Record<string, number> = {};
  let prohibitedExits = 0;
  let holds = 0;

  for (const s of sessions) {
    const ch: BotChannel = s.channel;
    byChannel[ch] ??= zero();
    times[ch] ??= { consented: [], profile_done: [], docs_complete: [], submitted: [] };
    const bump = (f: FunnelStage) => {
      byChannel[ch][f]++;
      total[f]++;
    };
    bump('started');
    const consented = !!s.answers.consent;
    const profileDone = !!s.checklist || s.step === 'S2_RESTRICTED' || s.step === 'CLOSED_PROHIBITED' || s.step.startsWith('S3') || s.step.startsWith('S4') || s.step.startsWith('S5');
    const docsDone = !!s.prescreen || s.step === 'S4_RESULT' || s.step === 'S5_SUBMITTED';
    const submitted = s.step === 'S5_SUBMITTED' || (!!s.caseId && ['AWAITING_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'COMPLETED'].includes(cases.get(s.caseId)?.status ?? ''));
    if (consented) bump('consented');
    if (profileDone) bump('profile_done');
    if (docsDone) bump('docs_complete');
    if (s.prescreen) bump('prescreened');
    if (submitted) bump('submitted');
    const st = s.caseId ? cases.get(s.caseId)?.status : undefined;
    if (st === 'APPROVED' || st === 'COMPLETED') bump('approved');
    if (st === 'REJECTED') bump('rejected');
    if (s.step === 'CLOSED_PROHIBITED') prohibitedExits++;
    if (s.step === 'HOLD') holds++;
    const idleDays = (now - new Date(s.lastInboundAt).getTime()) / 86400000;
    const finished = submitted || s.step.startsWith('CLOSED');
    if (!finished && idleDays > expireAfterDays) bump('dropped');
    if (!finished && idleDays <= expireAfterDays) {
      const bucket = s.step.startsWith('S0') ? 'S0' : S1_ORDER.includes(s.step) ? 'S1' : s.step.startsWith('S3') ? 'S3' : s.step;
      openByStep[bucket] = (openByStep[bucket] ?? 0) + 1;
    }
    // milestone timings from the transcript
    const tc = firstAt(s, (step) => step === 'S1_CONTACT');
    const tp = firstAt(s, (step) => step === 'S3_INTRO' || step === 'S2_RESTRICTED' || step === 'CLOSED_PROHIBITED');
    const td = firstAt(s, (step) => step === 'S4_RESULT');
    const ts = firstAt(s, (step) => step === 'S5_SUBMITTED');
    if (tc != null) times[ch].consented.push(tc);
    if (tp != null) times[ch].profile_done.push(tp);
    if (td != null) times[ch].docs_complete.push(td);
    if (ts != null) times[ch].submitted.push(ts);
  }

  const medianSeconds = Object.fromEntries(Object.entries(times).map(([ch, t]) => [ch, { consented: median(t.consented), profile_done: median(t.profile_done), docs_complete: median(t.docs_complete), submitted: median(t.submitted) }]));
  return { sessions: sessions.length, byChannel, total, medianSeconds, openByStep, prohibitedExits, holds };
}
