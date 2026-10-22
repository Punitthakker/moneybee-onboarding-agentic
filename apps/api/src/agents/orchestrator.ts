import { randomUUID } from 'node:crypto';
import { DOC_TYPE_LABELS, type CaseStatus, type Person } from '@moneybee/shared';
import type { Ctx } from '../context';
import type { CaseRec, Finding, GapItem } from '../db/types';
import { BudgetExceededError, SchemaParseError } from '../llm/client';
import { classifyFiles } from './classifier';
import { consolidate } from './consolidate';
import { extractDocuments } from './extractor';
import { draftGapMessage } from './gapchaser';
import { PROMPT_VERSIONS, UNDERWRITER_SYSTEM, VERIFIER_EXPLAIN_SYSTEM } from './prompts';
import { ExplainOut, MemoOut } from './schemas';
import { step } from './runtime';
import { scoreRisk } from './underwriter';
import { resolveUbo } from './ubo';
import { verifyCase } from './verifier';
import { nameSimilarity } from './names';
import type { ScreeningSubject } from './screening';

export type Actor = { type: 'system' } | { type: 'human'; id: string; email: string };

/** The state machine guard. The pipeline can NEVER move a case to APPROVED, REJECTED or COMPLETED. */
export function transition(c: CaseRec, to: CaseStatus, actor: Actor): void {
  if ((to === 'APPROVED' || to === 'REJECTED' || to === 'COMPLETED') && actor.type !== 'human') {
    throw new Error(`Automated actors cannot set status ${to}. A human reviewer must decide.`);
  }
  c.status = to;
}

const SOFT = new Set(['NAME_SOFT_MISMATCH', 'NAME_MISMATCH', 'LEGAL_NAME_MISMATCH', 'ADDRESS_MISMATCH']);

export type RunFrom = 'classify' | 'verify';

export async function runPipeline(ctx: Ctx, caseId: string, runSeq: number, from: RunFrom = 'classify'): Promise<void> {
  const emitStatus = (s: string) => ctx.bus.emit(caseId, { type: 'status', status: s });
  const sys: Actor = { type: 'system' };
  try {
    await ctx.store.cases.update(caseId, (c) => {
      c.run = { seq: runSeq, state: 'running', startedAt: ctx.now().toISOString() };
    });
    ctx.bus.emit(caseId, { type: 'run', state: 'running' });

    let c = (await ctx.store.cases.get(caseId))!;
    if (['APPROVED', 'REJECTED', 'COMPLETED'].includes(c.status)) throw new Error(`Case is ${c.status}; pipeline will not run`);
    const { policy, acquirer, version } = await ctx.policies.forAcquirer(c.acquirerCode);
    await ctx.store.cases.update(caseId, (x) => {
      x.policyVersion = version;
      if (x.status === 'NEEDS_INFO' || x.status === 'AWAITING_REVIEW') transition(x, 'RECEIVED', sys);
    });

    if (from === 'classify') {
      // 1. classify
      const newDocs = await step(ctx, caseId, runSeq, 'classifier', 'Classify documents', async (h) => {
        const cur = (await ctx.store.cases.get(caseId))!;
        const docs = await classifyFiles(ctx, h, cur);
        h.output({ documents: docs.map((d) => ({ id: d.id, type: d.docType, pages: `${d.pageStart}-${d.pageEnd}`, confidence: d.classConfidence })) });
        h.summary(`${docs.length} document(s) classified`);
        return docs;
      });
      await ctx.store.cases.update(caseId, (x) => {
        x.documents.push(...newDocs);
        for (const f of x.files) if (f.injectionSuspected) x.injectionSuspected = true;
        transition(x, 'CLASSIFIED', sys);
      });
      emitStatus('CLASSIFIED');

      // 2. extract
      c = (await ctx.store.cases.get(caseId))!;
      const extracted = await step(ctx, caseId, runSeq, 'extractor', 'Extract fields', async (h) => {
        const docs = await extractDocuments(ctx, h, c, policy);
        h.output({ documents: docs.map((d) => ({ id: d.id, type: d.docType, fields: Object.keys(d.fields ?? {}).length, needsReview: !!d.needsReview })) });
        h.summary(`${docs.length} document(s) extracted`);
        return docs;
      });
      await ctx.store.cases.update(caseId, (x) => {
        for (const d of extracted) {
          const i = x.documents.findIndex((y) => y.id === d.id);
          if (i >= 0) x.documents[i] = d;
        }
        if (x.documents.some((d) => d.injectionSuspected)) x.injectionSuspected = true;
        consolidate(x, policy);
        transition(x, 'EXTRACTED', sys);
      });
      emitStatus('EXTRACTED');
    } else {
      await ctx.store.cases.update(caseId, (x) => consolidate(x, policy));
    }

    // 3. verify (deterministic first, LLM only explains)
    c = (await ctx.store.cases.get(caseId))!;
    const ver = await step(ctx, caseId, runSeq, 'verifier', 'Policy checks', async (h) => {
      const r = verifyCase(c, policy, ctx.now());
      h.tool('verifyCase', { checks: ['expiry', 'licence_format', 'eid_format', 'trn_format', 'name_match', 'legal_name', 'address', 'share_pct', 'confidence', 'injection', 'checklist'] }, `${r.findings.length} finding(s), code only`);
      const soft = r.findings.filter((f) => SOFT.has(f.code));
      if (soft.length) {
        try {
          const ex = await h.llm({
            agent: 'verifier_explain',
            promptVersion: PROMPT_VERSIONS.verifierExplain,
            system: VERIFIER_EXPLAIN_SYSTEM,
            user: `Explain these findings:\n${soft.map((f) => `${f.code}: ${f.message}`).join('\n')}`,
            schema: ExplainOut,
            mockContext: { findings: soft },
            maxTokens: 1200,
          });
          for (const e of ex.output.explanations) {
            const f = soft.find((s) => s.code === e.code && !s.explanation);
            if (f) f.explanation = e.explanation;
          }
        } catch (e) {
          if (!(e instanceof SchemaParseError)) throw e;
        }
      }
      h.output({ findings: r.findings.map((f) => ({ code: f.code, severity: f.severity })) });
      h.summary(`${r.findings.filter((f) => f.severity === 'fail').length} fail, ${r.findings.filter((f) => f.severity === 'warn').length} warn`);
      return r;
    });
    await ctx.store.cases.update(caseId, (x) => {
      x.findings = ver.findings;
      x.checklist = ver.checklist;
      x.needsReviewFields = ver.needsReviewFields;
      x.gaps = { items: ver.gaps, draftMessage: '' };
      for (const d of x.documents) d.verifiedStatus = ver.docStatus[d.id] ?? d.verifiedStatus;
      transition(x, 'VERIFIED', sys);
    });
    emitStatus('VERIFIED');

    // 4. UBO
    c = (await ctx.store.cases.get(caseId))!;
    const ubo = await step(ctx, caseId, runSeq, 'ubo_resolver', 'Resolve beneficial owners', async (h) => {
      const r = resolveUbo(c, policy);
      h.tool('resolveUbo', { thresholdPct: r.thresholdPct, layers: r.layers }, `${r.ubos.length} UBO(s)`);
      h.output({ ubos: r.ubos.map((u) => ({ name: u.name, pct: u.effectivePct, basis: u.basis })), unresolved: r.unresolved });
      h.summary(r.explanation.slice(0, 160));
      return r;
    });
    const extraFindings: Finding[] = [];
    const extraGaps: GapItem[] = [];
    if (!ubo.sharesSumTo100) extraFindings.push({ code: 'ENTITY_SHARE_PCT_SUM', severity: 'fail', message: 'A shareholder register in the ownership chain does not add up to 100 percent.' });
    for (const u of ubo.ubos.filter((x) => x.basis === 'ownership')) {
      const best = c.idHolders.reduce((m, h) => Math.max(m, nameSimilarity(u.name, h.name)), 0);
      if (best < 0.8) {
        extraFindings.push({ code: 'UBO_NO_ID', severity: 'warn', message: `No identity document found for beneficial owner ${u.name}.` });
        extraGaps.push({ kind: 'missing_document', docType: 'emirates_id', message: `Identity document (Emirates ID or passport) for beneficial owner ${u.name}.` });
      }
    }
    const decl = c.documents.find((d) => d.docType === 'ubo_declaration')?.fields?.declaredUbos?.value as Person[] | undefined;
    if (decl?.length) {
      for (const u of ubo.ubos.filter((x) => x.basis === 'ownership')) {
        if (!decl.some((p) => nameSimilarity(p.name, u.name) >= 0.8)) extraFindings.push({ code: 'UBO_DECLARATION_MISMATCH', severity: 'warn', message: `${u.name} is a computed beneficial owner but is not named in the UBO declaration.` });
      }
    }
    for (const n of ubo.unresolved) {
      extraFindings.push({ code: 'UBO_UNTRACED', severity: 'warn', message: `Ownership cannot be traced past corporate shareholder ${n}.` });
      extraGaps.push({ kind: 'missing_document', docType: 'corporate_shareholder_docs', message: `Shareholder register / documents for corporate shareholder ${n}.` });
    }
    await ctx.store.cases.update(caseId, (x) => {
      x.ubo = ubo;
      x.findings = [...x.findings.filter((f) => !['ENTITY_SHARE_PCT_SUM', 'UBO_NO_ID', 'UBO_DECLARATION_MISMATCH', 'UBO_UNTRACED'].includes(f.code)), ...extraFindings];
      x.gaps = { items: [...(x.gaps?.items ?? []), ...extraGaps], draftMessage: '' };
      transition(x, 'UBO_RESOLVED', sys);
    });
    emitStatus('UBO_RESOLVED');

    // 5. screening
    c = (await ctx.store.cases.get(caseId))!;
    const scr = await step(ctx, caseId, runSeq, 'screening', ctx.screening.isMock ? 'Screening (MOCK)' : 'Screening', async (h) => {
      const subjects: ScreeningSubject[] = [
        { key: 'company', name: c.legalName ?? c.name, role: 'COMPANY', kind: 'company' },
        ...c.directors.map((p, i) => ({ key: `director:${i}`, name: p.name, role: 'DIRECTOR', kind: 'person' as const, nationality: p.nationality })),
        ...c.signatories.map((p, i) => ({ key: `signatory:${i}`, name: p.name, role: 'SIGNATORY', kind: 'person' as const, nationality: p.nationality })),
        ...(c.ubo?.ubos ?? []).map((u, i) => ({ key: `ubo:${i}`, name: u.name, role: 'UBO', kind: 'person' as const })),
        ...c.shareholders.filter((s) => s.type === 'corporate').map((s, i) => ({ key: `corp:${i}`, name: s.name, role: 'SHAREHOLDER', kind: 'company' as const })),
      ];
      const seen = new Set<string>();
      const uniq = subjects.filter((s) => (seen.has(s.name.toLowerCase() + s.role) ? false : (seen.add(s.name.toLowerCase() + s.role), true)));
      const results = await ctx.screening.screen(uniq);
      h.tool('ScreeningProvider.screen', { provider: ctx.screening.name, subjects: uniq.length, isMock: ctx.screening.isMock }, `${results.filter((r) => r.status !== 'CLEAR').length} hit(s)`);
      h.output({ provider: ctx.screening.name, isMock: ctx.screening.isMock, hits: results.filter((r) => r.status !== 'CLEAR').map((r) => ({ subject: r.subject, category: r.category })) });
      h.summary(`${uniq.length} subject(s) screened${ctx.screening.isMock ? ' - MOCK SCREENING, not a real check' : ''}`);
      return results;
    });
    await ctx.store.cases.update(caseId, (x) => {
      x.screening = { provider: ctx.screening.name, isMock: ctx.screening.isMock, results: scr };
      transition(x, 'SCREENED', sys);
    });
    emitStatus('SCREENED');

    // 6. risk
    c = (await ctx.store.cases.get(caseId))!;
    const risk = await step(ctx, caseId, runSeq, 'underwriter', 'Score risk and draft memo', async (h) => {
      const base = scoreRisk(c, policy, ctx.now());
      h.tool('scoreRisk', { rules: base.breakdown.length }, `${base.rating} (${base.score})`);
      let memo = '';
      let action = '';
      let memoModel: string | undefined;
      try {
        const r = await h.llm({
          agent: 'underwriter_memo',
          promptVersion: PROMPT_VERSIONS.underwriter,
          system: UNDERWRITER_SYSTEM,
          user: `Merchant: ${c.legalName ?? c.name} (${c.entityType}). Acquirer: ${acquirer.label}.\nRating: ${base.rating}, score ${base.score}.\nDrivers:\n${base.breakdown.map((b) => `- ${b.code} +${b.points}: ${b.note}`).join('\n') || '- none'}\nHard triggers: ${base.reasonCodes.filter((r) => !base.breakdown.some((b) => b.code === r)).join(', ') || 'none'}\nOwnership: ${c.ubo?.explanation ?? 'n/a'}\nScreening: ${c.screening?.isMock ? 'MOCK SCREENING (no real check performed)' : 'real provider'}; hits: ${(c.screening?.results ?? []).filter((x) => x.status !== 'CLEAR').map((x) => `${x.subject}/${x.category}`).join(', ') || 'none'}\nOpen findings: ${c.findings.filter((f) => f.severity !== 'info').map((f) => f.code).join(', ') || 'none'}`,
          schema: MemoOut,
          heavy: true,
          mockContext: { risk: base },
          maxTokens: 1500,
        });
        memo = r.output.memo;
        action = r.output.recommendedAction;
        memoModel = r.model;
      } catch (e) {
        if (!(e instanceof SchemaParseError)) throw e;
        memo = 'Memo generation failed validation twice. Use the deterministic breakdown above.';
        action = 'Manual review required.';
      }
      h.output({ rating: base.rating, score: base.score, reasonCodes: base.reasonCodes });
      h.summary(`${base.rating} (score ${base.score})`);
      return { ...base, memo, recommendedAction: action, memoModel };
    });
    await ctx.store.cases.update(caseId, (x) => {
      x.risk = risk;
      transition(x, 'RISK_SCORED', sys);
    });
    emitStatus('RISK_SCORED');

    // 7. gap chaser
    c = (await ctx.store.cases.get(caseId))!;
    const gapMsg = await step(ctx, caseId, runSeq, 'gap_chaser', 'Draft merchant request', async (h) => {
      const msg = await draftGapMessage(ctx, h, c, c.gaps?.items ?? []);
      h.summary(c.gaps?.items.length ? `${c.gaps.items.length} outstanding item(s); draft NOT sent` : 'Nothing outstanding');
      return msg;
    });
    await ctx.store.cases.update(caseId, (x) => {
      x.gaps = { items: x.gaps?.items ?? [], draftMessage: gapMsg };
    });

    // 8. pack
    c = (await ctx.store.cases.get(caseId))!;
    const pack = await step(ctx, caseId, runSeq, 'pack_builder', 'Build acquirer pack', async (h) => {
      const adapter = ctx.adapters.file_pack;
      const built = await adapter.buildPack(ctx, c, acquirer);
      h.tool('AcquirerAdapter.buildPack', { adapter: adapter.mode, acquirer: acquirer.code }, `${built.files.length} file(s)`);
      h.output({ files: built.files.map((f) => f.name) });
      h.summary(`${built.files.length} file(s) in pack for ${acquirer.code}${acquirer.example ? ' (example acquirer)' : ''}`);
      return built;
    });
    await ctx.store.cases.update(caseId, (x) => {
      x.pack = { acquirerCode: acquirer.code, files: pack.files, payload: pack.payload, submission: null };
      transition(x, 'PACK_BUILT', sys);
    });
    emitStatus('PACK_BUILT');

    await ctx.store.cases.update(caseId, (x) => {
      transition(x, 'AWAITING_REVIEW', sys);
      x.run = { ...(x.run ?? { seq: runSeq, state: 'done' }), seq: runSeq, state: 'done', finishedAt: ctx.now().toISOString() };
    });
    emitStatus('AWAITING_REVIEW');
    ctx.bus.emit(caseId, { type: 'run', state: 'done' });
    await ctx.store.audit.add({ id: randomUUID(), actor: 'system', action: 'pipeline.completed', entity: `case:${caseId}`, at: ctx.now().toISOString(), meta: { runSeq } });
  } catch (e) {
    const msg = e instanceof BudgetExceededError ? e.message : e instanceof Error ? e.message : String(e);
    ctx.log.error({ err: e, caseId }, 'pipeline failed');
    await ctx.store.cases.update(caseId, (x) => {
      x.run = { seq: runSeq, state: 'failed', error: msg, startedAt: x.run?.startedAt, finishedAt: ctx.now().toISOString() };
    }).catch(() => undefined);
    ctx.bus.emit(caseId, { type: 'run', state: 'failed', error: msg });
    throw e;
  }
}

export { DOC_TYPE_LABELS };
