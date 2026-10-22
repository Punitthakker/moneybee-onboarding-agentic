import type { DocType, ExtractedField, Policy } from '@moneybee/shared';
import type { Ctx } from '../context';
import type { CaseRec, DocRec } from '../db/types';
import { ExtractorOut, type ExtractorOutT } from './schemas';
import { PROMPT_VERSIONS, extractorSystem } from './prompts';
import type { StepHandle } from './runtime';
import { SchemaParseError, type LlmResult } from '../llm/client';
import { extractPages, pdfPages } from '../util/pdf';
import { scanForInjection } from '../util/safety';

/** Extractor agent: per-document-type extraction with value, confidence and source for every field. */
export async function extractDocuments(ctx: Ctx, h: StepHandle, c: CaseRec, policy: Policy): Promise<DocRec[]> {
  const pageCache = new Map<string, string[]>();
  const out: DocRec[] = [];
  for (const d of c.documents) {
    if (d.extracted) continue;
    const f = c.files.find((x) => x.id === d.fileId)!;
    const copy: DocRec = { ...d };
    if (d.docType === 'unknown') {
      copy.extracted = true;
      copy.needsReview = true;
      copy.fields = {};
      out.push(copy);
      continue;
    }
    const raw = await ctx.blobs.get(f.storageKey);
    const isPdf = f.mime === 'application/pdf';
    let data = raw;
    let pageTexts: { page: number; text: string }[] = [];
    if (isPdf) {
      if (!pageCache.has(f.id) && ctx.llm.isMock) pageCache.set(f.id, await pdfPages(raw));
      if (d.pageStart !== 1 || d.pageEnd !== (f.pageCount ?? d.pageEnd)) data = await extractPages(raw, d.pageStart, d.pageEnd);
      pageTexts = (pageCache.get(f.id) ?? []).slice(d.pageStart - 1, d.pageEnd).map((text, i) => ({ page: d.pageStart + i, text }));
    }
    let r: LlmResult<ExtractorOutT>;
    try {
      r = await h.llm({
      agent: 'extractor',
      promptVersion: PROMPT_VERSIONS.extractor,
      system: extractorSystem(d.docType as DocType),
      user: `Extract the fields from document ${d.id} (pages ${d.pageStart}-${d.pageEnd} of file "${f.name}"). Page numbers in sources are relative to the original file.`,
      documents: [{ id: d.id, mediaType: f.mime as 'application/pdf', data, pageStart: d.pageStart, pageEnd: d.pageEnd }],
      schema: ExtractorOut,
      mockContext: { docType: d.docType, pageTexts, isImage: !isPdf },
      maxTokens: 4096,
      });
    } catch (e) {
      if (!(e instanceof SchemaParseError)) throw e;
      // parse failed twice: no guessing, route this document to a human
      copy.fields = {};
      copy.extracted = true;
      copy.needsReview = true;
      h.tool('schema_parse_failure', { docId: d.id }, e.message);
      out.push(copy);
      continue;
    }
    const fields: Record<string, ExtractedField> = {};
    for (const [k, v] of Object.entries(r.output.fields)) {
      fields[k] = { ...v, source: { ...v.source, docId: d.id } };
    }
    copy.fields = fields;
    copy.extracted = true;
    copy.injectionSuspected = r.output.injectionSuspected || f.injectionSuspected || scanForInjection(JSON.stringify(fields)).length > 0 || undefined;
    copy.needsReview = d.needsReview || Object.values(fields).some((x) => x.confidence < policy.confidenceThreshold) || (Object.keys(fields).length === 0 && !r.isMock) || (r.isMock && !isPdf);
    out.push(copy);
  }
  return out;
}
