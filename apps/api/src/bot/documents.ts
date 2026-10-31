import type { DocType, Policy } from '@moneybee/shared';
import { classifyFiles } from '../agents/classifier';
import { extractDocuments } from '../agents/extractor';
import { ingest } from '../agents/intake';
import { step } from '../agents/runtime';
import type { Ctx } from '../context';
import type { DocRec } from '../db/types';

export interface UploadOutcome {
  kind: 'ok' | 'duplicate' | 'rejected' | 'unreadable';
  /** doc types detected in the file (a bundle can carry several) */
  detected: DocType[];
  docs: DocRec[];
  injectionSuspected: boolean;
  reason?: string;
}

/**
 * One merchant upload: same intake path as POST /cases/:id/documents (sniff, dedupe, store, injection scan),
 * then classify and extract just the new file so the bot can tell the merchant what it got and whether it is expired.
 * Pipeline later skips what is already classified and extracted.
 */
export async function handleUpload(ctx: Ctx, caseId: string, policy: Policy, name: string, data: Buffer): Promise<UploadOutcome> {
  const r = await ingest(ctx, caseId, [{ name, data, originPath: `bot:${name}` }]);
  if (r.rejected.length && !r.added.length) return { kind: 'rejected', detected: [], docs: [], injectionSuspected: false, reason: r.rejected[0].reason };
  if (!r.added.length) return { kind: 'duplicate', detected: [], docs: [], injectionSuspected: false };

  await ctx.store.cases.update(caseId, (x) => {
    x.files.push(...r.added);
    if (r.added.some((f) => f.injectionSuspected)) x.injectionSuspected = true;
  });

  const c = (await ctx.store.cases.get(caseId))!;
  const runSeq = c.run?.seq ?? 0;
  const newDocs = await step(ctx, caseId, runSeq, 'bot', `Classify upload ${name}`, async (h) => {
    const docs = await classifyFiles(ctx, h, c);
    h.summary(`${docs.length} document(s) in upload`);
    return docs;
  });
  await ctx.store.cases.update(caseId, (x) => {
    x.documents.push(...newDocs);
    if (x.files.some((f) => f.injectionSuspected) || newDocs.some((d) => d.injectionSuspected)) x.injectionSuspected = true;
  });

  // extract only the new docs (expiry dates, names) so the bot can react; marks them extracted for the pipeline
  const fresh = (await ctx.store.cases.get(caseId))!;
  const extracted = await step(ctx, caseId, runSeq, 'bot', `Extract upload ${name}`, async (h) => {
    const docs = await extractDocuments(ctx, h, { ...fresh, documents: newDocs }, policy);
    h.summary(`${docs.length} document(s) extracted`);
    return docs;
  });
  await ctx.store.cases.update(caseId, (x) => {
    for (const d of extracted) {
      const i = x.documents.findIndex((y) => y.id === d.id);
      if (i >= 0) x.documents[i] = d;
    }
  });

  const injection = r.added.some((f) => f.injectionSuspected) || newDocs.some((d) => d.injectionSuspected);
  const docs = extracted.length ? extracted : newDocs;
  const detected = docs.map((d) => d.docType).filter((t) => t !== 'unknown');
  if (!detected.length && docs.every((d) => d.classConfidence < 0.3)) return { kind: 'unreadable', detected: [], docs, injectionSuspected: injection };
  return { kind: 'ok', detected: Array.from(new Set(detected)), docs, injectionSuspected: injection };
}
