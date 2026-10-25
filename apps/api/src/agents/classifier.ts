import { randomUUID } from 'node:crypto';
import type { DocType } from '@moneybee/shared';
import type { Ctx } from '../context';
import type { CaseRec, DocRec } from '../db/types';
import { ClassifierOut, type ClassifierOutT } from './schemas';
import { CLASSIFIER_SYSTEM, PROMPT_VERSIONS } from './prompts';
import type { StepHandle } from './runtime';
import { SchemaParseError, type LlmResult } from '../llm/client';
import { pdfPages } from '../util/pdf';

const FILENAME_HINTS: [RegExp, DocType][] = [
  [/licen[cs]e/i, 'trade_licence'], [/emirates|eid/i, 'emirates_id'], [/passport/i, 'passport'], [/visa/i, 'residence_visa'], [/ejari|lease/i, 'lease_ejari'],
  [/iban|bank.?letter/i, 'bank_letter'], [/vat|trn/i, 'vat_certificate'], [/moa|aoa|memorandum/i, 'moa_aoa'],
  [/ubo|beneficial/i, 'ubo_declaration'], [/shareholder/i, 'register_of_shareholders'], [/resolution.*branch|branch.*resolution/i, 'branch_board_resolution'],
];

/** Classifier agent: labels each file (and each segment of a multi-document PDF). */
export async function classifyFiles(ctx: Ctx, h: StepHandle, c: CaseRec): Promise<DocRec[]> {
  const done = new Set(c.documents.map((d) => d.fileId));
  const out: DocRec[] = [];
  for (const f of c.files) {
    if (done.has(f.id) || f.duplicateOf || f.mime === 'text/plain' || f.source === 'uaepass_signed') continue;
    const data = await ctx.blobs.get(f.storageKey);
    if (f.mime === 'application/pdf') {
      const pages = ctx.llm.isMock ? await pdfPages(data) : [];
      let r: LlmResult<ClassifierOutT>;
      try {
        r = await h.llm({
        agent: 'classifier',
        promptVersion: PROMPT_VERSIONS.classifier,
        system: CLASSIFIER_SYSTEM,
        user: `File name: ${f.name}\nPage count: ${f.pageCount ?? 'unknown'}\nClassify and split this file into document segments.`,
        documents: [{ id: f.id, mediaType: 'application/pdf', data }],
        schema: ClassifierOut,
        mockContext: { pages, fileName: f.name },
        maxTokens: 2000,
        });
      } catch (e) {
        if (!(e instanceof SchemaParseError)) throw e;
        out.push({ id: randomUUID(), fileId: f.id, docType: 'unknown', language: 'unknown', pageStart: 1, pageEnd: f.pageCount ?? 1, classConfidence: 0, verifiedStatus: 'UNVERIFIED', needsReview: true });
        h.tool('schema_parse_failure', { fileId: f.id }, e.message);
        continue;
      }
      for (const s of r.output.segments) {
        const end = Math.min(s.pageEnd, f.pageCount ?? s.pageEnd);
        out.push({ id: randomUUID(), fileId: f.id, docType: s.docType, language: s.language, issuingAuthority: s.issuingAuthority, pageStart: s.pageStart, pageEnd: Math.max(s.pageStart, end), classConfidence: s.confidence, verifiedStatus: 'UNVERIFIED' });
      }
      if (r.output.injectionSuspected) f.injectionSuspected = true;
    } else {
      // image
      if (ctx.llm.isMock) {
        const hint = FILENAME_HINTS.find(([re]) => re.test(f.name))?.[1] ?? 'unknown';
        out.push({ id: randomUUID(), fileId: f.id, docType: hint, language: 'unknown', pageStart: 1, pageEnd: 1, classConfidence: hint === 'unknown' ? 0.2 : 0.5, verifiedStatus: 'UNVERIFIED', needsReview: true });
        h.tool('mock_filename_classifier', { file: f.name }, `MOCK: images are classified by file name only (${hint})`);
      } else {
        const r = await h.llm({
          agent: 'classifier',
          promptVersion: PROMPT_VERSIONS.classifier,
          system: CLASSIFIER_SYSTEM,
          user: `File name: ${f.name}\nThis is a single image. Classify it.`,
          documents: [{ id: f.id, mediaType: f.mime as 'image/png' | 'image/jpeg', data }],
          schema: ClassifierOut,
          maxTokens: 800,
        });
        const s = r.output.segments[0];
        out.push({ id: randomUUID(), fileId: f.id, docType: s.docType, language: s.language, issuingAuthority: s.issuingAuthority, pageStart: 1, pageEnd: 1, classConfidence: s.confidence, verifiedStatus: 'UNVERIFIED' });
      }
    }
  }
  return out;
}
