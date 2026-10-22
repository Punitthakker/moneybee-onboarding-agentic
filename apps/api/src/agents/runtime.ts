import { createHash, randomUUID } from 'node:crypto';
import type { Ctx } from '../context';
import type { TraceRec } from '../db/types';
import { BudgetExceededError, type LlmRequest, type LlmResult } from '../llm/client';

export interface StepHandle {
  llm<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
  tool(name: string, input: unknown, resultSummary?: string): void;
  output(o: unknown): void;
  summary(s: string): void;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Wraps one pipeline step. Writes a trace record (input hash, model, prompt version, tokens, latency, output,
 * tool calls), streams it to the UI, and enforces the per-case token budget.
 */
export async function step<T>(
  ctx: Ctx,
  caseId: string,
  runSeq: number,
  agent: string,
  stepName: string,
  fn: (h: StepHandle) => Promise<T>,
): Promise<T> {
  const startedAt = new Date();
  const t0 = performance.now();
  const trace: TraceRec = { id: randomUUID(), caseId, runSeq, agent, step: stepName, status: 'running', startedAt: startedAt.toISOString(), durationMs: 0, toolCalls: [] };
  ctx.bus.emit(caseId, { type: 'trace', trace: { ...trace } });
  const inputs: string[] = [];
  let tokensIn = 0;
  let tokensOut = 0;

  const handle: StepHandle = {
    async llm<R>(req: LlmRequest<R>): Promise<LlmResult<R>> {
      const c = await ctx.store.cases.get(caseId);
      if (c && c.usage.tokens >= c.usage.budget) throw new BudgetExceededError(c.usage.tokens, c.usage.budget);
      inputs.push(sha(req.system) + sha(req.user) + (req.documents ?? []).map((d) => `${d.id}:${sha(d.data.toString('base64').slice(0, 4096))}:${d.pageStart ?? ''}`).join(','));
      const r = await ctx.llm.run(req);
      tokensIn += r.tokensIn;
      tokensOut += r.tokensOut;
      trace.model = r.model + (r.isMock ? ' (MOCK)' : '');
      trace.promptVersion = req.promptVersion;
      trace.toolCalls!.push(...r.toolCalls);
      await ctx.store.cases.update(caseId, (cc) => {
        cc.usage.tokens += r.tokensIn + r.tokensOut;
        cc.usage.calls += 1;
        cc.modelVersion = r.model;
        cc.promptVersion = [...new Set([...(cc.promptVersion ? cc.promptVersion.split(',') : []), req.promptVersion])].join(',');
      });
      return r;
    },
    tool(name, input, resultSummary) {
      trace.toolCalls!.push({ name, input, resultSummary });
    },
    output(o) {
      trace.output = o;
    },
    summary(s) {
      trace.summary = s;
    },
  };

  try {
    const result = await fn(handle);
    trace.status = 'ok';
    return result;
  } catch (e) {
    trace.status = 'error';
    trace.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    trace.durationMs = Math.round(performance.now() - t0);
    trace.tokensIn = tokensIn;
    trace.tokensOut = tokensOut;
    trace.inputHash = inputs.length ? sha(inputs.join('|')) : undefined;
    try {
      await ctx.store.traces.add(trace);
    } catch (e) {
      ctx.log.error({ err: e }, 'failed to persist trace');
    }
    ctx.bus.emit(caseId, { type: 'trace', trace: { ...trace } });
  }
}
