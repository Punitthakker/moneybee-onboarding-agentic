import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../context';
import type { CaseRec } from '../db/types';
import { ingest } from '../agents/intake';
import { runPipeline } from '../agents/orchestrator';
import { nameSimilarity } from '../agents/names';

export interface FixtureExpected {
  entityType: string;
  classification: Record<string, number>;
  fields: Record<string, string | number>;
  ubos: string[];
  rating: 'LOW' | 'MEDIUM' | 'HIGH' | 'REFER';
  mustHaveFindings: string[];
  mustNotHaveFindings?: string[];
  injectionFlagged: boolean;
  screeningHit: boolean;
  needsReviewFields?: string[];
  description: string;
}

export interface FixtureResult {
  slug: string;
  fieldsCorrect: number;
  fieldsTotal: number;
  classCorrect: number;
  classTotal: number;
  uboCorrect: boolean;
  entityCorrect: boolean;
  expectedRating: string;
  actualRating: string;
  falseApprove: boolean;
  falseRefer: boolean;
  findingsOk: boolean;
  injectionOk: boolean;
  screeningOk: boolean;
  reviewOk: boolean;
  status: string;
  problems: string[];
}

export function findFixturesDir(): string {
  for (const c of [path.resolve(process.cwd(), 'fixtures/merchants'), path.resolve(process.cwd(), '../../fixtures/merchants'), path.resolve(__dirname, '../../../../fixtures/merchants')]) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('fixtures/merchants not found. Run `npm run fixtures` first.');
}

export function listFixtures(dir = findFixturesDir()): string[] {
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'expected.json'))).sort();
}

export async function createFixtureCase(ctx: Ctx, dir: string, slug: string, acquirerCode = 'EXAMPLE_ACQUIRER_A'): Promise<CaseRec> {
  const now = ctx.now().toISOString();
  const c: CaseRec = {
    id: randomUUID(), ref: `EVAL-${slug}`, version: 1, name: slug, status: 'RECEIVED', entityTypeRequested: 'auto', acquirerCode, ownerId: 'eval', ownerEmail: 'eval@moneybee.local',
    createdAt: now, updatedAt: now, files: [], documents: [], fields: {}, directors: [], shareholders: [], signatories: [], idHolders: [], findings: [], checklist: [], reviews: [],
    needsReviewFields: [], injectionSuspected: false, usage: { tokens: 0, budget: ctx.cfg.CASE_TOKEN_BUDGET, calls: 0 }, run: { seq: 0, state: 'idle' },
  };
  await ctx.store.cases.create(c);
  const files = fs.readdirSync(path.join(dir, slug)).filter((f) => !f.endsWith('.json'));
  const r = await ingest(ctx, c.id, files.map((f) => ({ name: f, data: fs.readFileSync(path.join(dir, slug, f)) })));
  return ctx.store.cases.update(c.id, (x) => {
    x.files.push(...r.added);
    if (r.added.some((f) => f.injectionSuspected)) x.injectionSuspected = true;
  });
}

const eq = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase().replace(/\s+/g, ' ') === String(b ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function evaluateFixture(ctx: Ctx, dir: string, slug: string): Promise<FixtureResult> {
  const exp = JSON.parse(fs.readFileSync(path.join(dir, slug, 'expected.json'), 'utf8')) as FixtureExpected;
  const created = await createFixtureCase(ctx, dir, slug);
  await runPipeline(ctx, created.id, 1);
  const c = (await ctx.store.cases.get(created.id))!;
  const problems: string[] = [];

  let fieldsCorrect = 0;
  const fieldKeys = Object.keys(exp.fields);
  for (const k of fieldKeys) {
    if (eq(c.fields[k]?.value, exp.fields[k])) fieldsCorrect++;
    else problems.push(`field ${k}: expected "${exp.fields[k]}", got "${c.fields[k]?.value ?? ''}"`);
  }

  const counts: Record<string, number> = {};
  for (const d of c.documents) counts[d.docType] = (counts[d.docType] ?? 0) + 1;
  let classCorrect = 0;
  let classTotal = 0;
  for (const [t, n] of Object.entries(exp.classification)) {
    classTotal += n;
    classCorrect += Math.min(n, counts[t] ?? 0);
    if ((counts[t] ?? 0) !== n) problems.push(`classification ${t}: expected ${n}, got ${counts[t] ?? 0}`);
  }
  const extra = c.documents.length - classCorrect;
  if (extra > 0) {
    classTotal += extra;
    problems.push(`${extra} unexpected or misclassified document(s)`);
  }

  const gotUbos = (c.ubo?.ubos ?? []).map((u) => u.name);
  const uboCorrect = gotUbos.length === exp.ubos.length && exp.ubos.every((n) => gotUbos.some((g) => nameSimilarity(g, n) >= 0.95));
  if (!uboCorrect) problems.push(`UBOs: expected [${exp.ubos.join(', ')}], got [${gotUbos.join(', ')}]`);

  const entityCorrect = c.entityType === exp.entityType;
  if (!entityCorrect) problems.push(`entity type: expected ${exp.entityType}, got ${c.entityType}`);

  const actual = c.risk?.rating ?? 'NONE';
  if (actual !== exp.rating) problems.push(`rating: expected ${exp.rating}, got ${actual}`);
  // false approve = system recommends a clean path (LOW/MEDIUM) where a REFER/HIGH was required
  const lenient = (r: string) => r === 'LOW' || r === 'MEDIUM';
  const falseApprove = !lenient(exp.rating) && lenient(actual);
  const falseRefer = lenient(exp.rating) && !lenient(actual);

  const codes = new Set(c.findings.map((f) => f.code));
  const missingF = exp.mustHaveFindings.filter((x) => !codes.has(x));
  const forbiddenF = (exp.mustNotHaveFindings ?? []).filter((x) => codes.has(x));
  if (missingF.length) problems.push(`missing findings: ${missingF.join(', ')}`);
  if (forbiddenF.length) problems.push(`unexpected findings: ${forbiddenF.join(', ')}`);

  const injectionOk = c.injectionSuspected === exp.injectionFlagged;
  if (!injectionOk) problems.push(`injection flag: expected ${exp.injectionFlagged}, got ${c.injectionSuspected}`);
  const hit = (c.screening?.results ?? []).some((r) => r.status !== 'CLEAR');
  const screeningOk = hit === exp.screeningHit;
  if (!screeningOk) problems.push(`screening hit: expected ${exp.screeningHit}, got ${hit}`);
  const reviewOk = (exp.needsReviewFields ?? []).every((f) => c.needsReviewFields.includes(f));
  if (!reviewOk) problems.push(`needs review: expected ${exp.needsReviewFields?.join(', ')}, got ${c.needsReviewFields.join(', ')}`);
  if (c.status !== 'AWAITING_REVIEW') problems.push(`status: expected AWAITING_REVIEW, got ${c.status}`);

  return {
    slug, fieldsCorrect, fieldsTotal: fieldKeys.length, classCorrect, classTotal, uboCorrect, entityCorrect, expectedRating: exp.rating, actualRating: actual, falseApprove, falseRefer,
    findingsOk: !missingF.length && !forbiddenF.length, injectionOk, screeningOk, reviewOk, status: c.status, problems,
  };
}

export interface EvalSummary {
  results: FixtureResult[];
  fieldAccuracy: number;
  classificationAccuracy: number;
  uboAccuracy: number;
  ratingAccuracy: number;
  falseApproveRate: number;
  falseReferRate: number;
}

export function summarise(results: FixtureResult[]): EvalSummary {
  const sum = (f: (r: FixtureResult) => number) => results.reduce((s, r) => s + f(r), 0);
  const n = Math.max(1, results.length);
  const shouldRefer = results.filter((r) => r.expectedRating === 'REFER' || r.expectedRating === 'HIGH').length;
  const shouldPass = results.length - shouldRefer;
  return {
    results,
    fieldAccuracy: sum((r) => r.fieldsCorrect) / Math.max(1, sum((r) => r.fieldsTotal)),
    classificationAccuracy: sum((r) => r.classCorrect) / Math.max(1, sum((r) => r.classTotal)),
    uboAccuracy: sum((r) => (r.uboCorrect ? 1 : 0)) / n,
    ratingAccuracy: sum((r) => (r.expectedRating === r.actualRating ? 1 : 0)) / n,
    falseApproveRate: shouldRefer ? sum((r) => (r.falseApprove ? 1 : 0)) / shouldRefer : 0,
    falseReferRate: shouldPass ? sum((r) => (r.falseRefer ? 1 : 0)) / shouldPass : 0,
  };
}
