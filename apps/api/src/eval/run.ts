/**
 * Evaluation harness: npm run eval
 * Runs the full pipeline on every fixture and prints a metrics table. Exits non-zero below the configured floors.
 * Uses in-memory stores so it needs no databases. LLM mode follows env (mock without ANTHROPIC_API_KEY).
 */
import { loadConfig } from '../config';
import { makeLogger } from '../logger';
import { buildCtx } from '../bootstrap';
import { createMemoryStore } from '../db/memory-store';
import { createMemoryRepository } from '../sql/memory-repository';
import { createMemoryBlobStore } from '../storage';
import { evaluateFixture, findFixturesDir, listFixtures, summarise } from './harness';

const FLOORS = {
  fieldAccuracy: Number(process.env.EVAL_FLOOR_FIELDS ?? 0.95),
  classificationAccuracy: Number(process.env.EVAL_FLOOR_CLASS ?? 0.95),
  uboAccuracy: Number(process.env.EVAL_FLOOR_UBO ?? 0.9),
  maxFalseApproveRate: Number(process.env.EVAL_MAX_FALSE_APPROVE ?? 0),
};
export const EVAL_DATE = new Date('2026-10-22T08:00:00Z');

async function main() {
  const cfg = loadConfig({ ...process.env, STORE: 'memory', REPO: 'memory', QUEUE_MODE: 'inline', LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn' });
  const log = makeLogger(cfg.LOG_LEVEL);
  const ctx = await buildCtx(cfg, log, { store: createMemoryStore(), repo: createMemoryRepository(), blobs: createMemoryBlobStore(), now: () => EVAL_DATE });
  const dir = findFixturesDir();
  const results = [];
  for (const slug of listFixtures(dir)) results.push(await evaluateFixture(ctx, dir, slug));
  const s = summarise(results);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  console.log(`\nMoneyBee Onboard eval  |  LLM: ${ctx.llm.isMock ? 'MOCK fixture parser' : ctx.llm.modelName}  |  screening: ${ctx.screening.name}\n`);
  const rows = results.map((r) => ({
    fixture: r.slug,
    fields: `${r.fieldsCorrect}/${r.fieldsTotal}`,
    classes: `${r.classCorrect}/${r.classTotal}`,
    ubo: r.uboCorrect ? 'ok' : 'FAIL',
    entity: r.entityCorrect ? 'ok' : 'FAIL',
    rating: `${r.actualRating}${r.actualRating === r.expectedRating ? '' : ` (exp ${r.expectedRating})`}`,
    checks: r.findingsOk && r.injectionOk && r.screeningOk && r.reviewOk ? 'ok' : 'FAIL',
  }));
  console.table(rows);
  console.table({
    'field extraction accuracy': pct(s.fieldAccuracy),
    'classification accuracy': pct(s.classificationAccuracy),
    'UBO correctness': pct(s.uboAccuracy),
    'rating accuracy': pct(s.ratingAccuracy),
    'false approve rate': pct(s.falseApproveRate),
    'false refer rate': pct(s.falseReferRate),
  });
  for (const r of results) if (r.problems.length) console.log(`  ${r.slug}: ${r.problems.join(' | ')}`);

  const fails: string[] = [];
  if (s.fieldAccuracy < FLOORS.fieldAccuracy) fails.push(`field accuracy ${pct(s.fieldAccuracy)} < ${pct(FLOORS.fieldAccuracy)}`);
  if (s.classificationAccuracy < FLOORS.classificationAccuracy) fails.push(`classification ${pct(s.classificationAccuracy)} < ${pct(FLOORS.classificationAccuracy)}`);
  if (s.uboAccuracy < FLOORS.uboAccuracy) fails.push(`UBO ${pct(s.uboAccuracy)} < ${pct(FLOORS.uboAccuracy)}`);
  if (s.falseApproveRate > FLOORS.maxFalseApproveRate) fails.push(`false approve rate ${pct(s.falseApproveRate)} > ${pct(FLOORS.maxFalseApproveRate)}`);
  if (fails.length) {
    console.error(`\nEVAL FAILED: ${fails.join('; ')}`);
    process.exit(1);
  }
  console.log('\nEval passed all floors.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
