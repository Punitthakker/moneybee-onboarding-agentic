import type { DocType, ExtractedField, Person } from '@moneybee/shared';
import { DOC_FIELD_KEYS } from '@moneybee/shared';
import { ClassifierOut, ExplainOut, ExtractorOut, GapOut, MemoOut } from '../agents/schemas';
import type { LlmClient, LlmRequest, LlmResult } from './client';

/**
 * MOCK LLM ADAPTER (see docs/MOCKS.md).
 * A deterministic parser for the synthetic fixtures in /fixtures. It reads the PDF text layer passed in
 * `mockContext.pages` and understands "Label: value" lines. It does not understand scans or images, and it is
 * NOT a substitute for the live model. Everything it returns is labelled mock in traces.
 */

const TITLE_RULES: [RegExp, DocType][] = [
  // branch documents first: they also mention incorporation and board resolutions
  [/board\s+resolution.*branch|branch.*board\s+resolution|resolution\s+to\s+(open|establish)\s+a?\s*branch/i, 'branch_board_resolution'],
  [/parent\s+company\s+(documents|certificate|licen[cs]e)/i, 'parent_company_documents'],
  [/(parent|group)\s+(ownership|shareholding|structure)|ownership\s+(and\s+ubo\s+)?chart/i, 'parent_ownership_chart'],
  [/certificate\s+of\s+(incumbency|good\s+standing)|incumbency\s+certificate/i, 'incumbency_certificate'],
  [/chamber\s+of\s+commerce/i, 'chamber_certificate'],
  [/local\s+service\s+agent/i, 'local_service_agent_agreement'],
  [/trade\s+licen[cs]e|commercial\s+licen[cs]e|رخصة\s*تجارية/i, 'trade_licence'],
  [/certificate\s+of\s+incorporation/i, 'certificate_of_incorporation'],
  [/memorandum|articles\s+of\s+association|\bmoa\b|\baoa\b/i, 'moa_aoa'],
  [/share\s+certificate/i, 'share_certificate'],
  [/register\s+of\s+shareholders|shareholders?\s+register/i, 'register_of_shareholders'],
  [/register\s+of\s+directors|directors?\s+register/i, 'register_of_directors'],
  [/board\s+resolution|power\s+of\s+attorney|authori[sz]ed\s+signatory/i, 'authorised_signatory_letter'],
  [/emirates\s+id|identity\s+card|الهوية/i, 'emirates_id'],
  [/\bpassport\b/i, 'passport'],
  [/residence\s+visa|residency/i, 'residence_visa'],
  [/ejari|tenancy|lease\s+(agreement|contract)/i, 'lease_ejari'],
  [/iban\s+certificate|bank\s+letter|account\s+confirmation/i, 'bank_letter'],
  [/bank\s+statement/i, 'bank_statement'],
  [/vat\s+registration|tax\s+registration/i, 'vat_certificate'],
  [/ubo\s+declaration|beneficial\s+owner/i, 'ubo_declaration'],
  [/website\s+and\s+product|product\s+description|business\s+description/i, 'website_description'],
  [/processing\s+statement|merchant\s+statement/i, 'processing_statement'],
  [/company\s+profile/i, 'company_profile'],
  [/corporate\s+shareholder/i, 'corporate_shareholder_docs'],
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const num = (s: string) => {
  const n = Number(s.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function titleOf(page: string): DocType | null {
  const head = page.split('\n').slice(0, 4).join(' ');
  for (const [re, t] of TITLE_RULES) if (re.test(head)) return t;
  return null;
}

function parseLines(text: string): { label: string; value: string; line: string }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .map((line) => {
      const m = /^([^:|]{2,60}):\s*(.+)$/.exec(line);
      return m ? { label: m[1].trim(), value: m[2].trim(), line } : null;
    })
    .filter((x): x is { label: string; value: string; line: string } => !!x);
}

function parsePerson(value: string, defaultRole?: string): Person {
  const [name, a, b, c] = value.split('|').map((s) => s.trim());
  const isCorp = (a ?? '').toLowerCase() === 'corporate';
  const isNat = (a ?? '').toLowerCase() === 'natural';
  if (isCorp || isNat) {
    return { name, type: isCorp ? 'corporate' : 'natural', percentage: b ? num(b) ?? undefined : undefined, nationality: c || undefined, ...(defaultRole ? { role: defaultRole } : {}) };
  }
  return { name, type: 'natural', nationality: a || undefined, role: b || defaultRole };
}

function extract(docType: DocType, pageTexts: { page: number; text: string }[]): { fields: Record<string, ExtractedField>; injectionSuspected: boolean } {
  const keys = DOC_FIELD_KEYS[docType];
  const keyByNorm = new Map(keys.map((k) => [norm(k), k]));
  const fields: Record<string, ExtractedField> = {};
  const lists: Record<string, Person[]> = { shareholders: [], directors: [], signatories: [], declaredUbos: [] };
  const listSrc: Record<string, { page: number; snippet: string }> = {};

  for (const { page, text } of pageTexts) {
    for (const { label, value, line } of parseLines(text)) {
      const nl = norm(label);
      const lowConf = /\[(illegible|unclear)\]|~$/.test(value);
      const clean = value.replace(/\s*\[(illegible|unclear)\]|~$/g, '').trim();
      const confidence = lowConf ? 0.55 : 0.96;
      const src = { page, snippet: line.slice(0, 200) };
      if (/^shareholder\d*$/.test(nl)) { lists.shareholders.push(parsePerson(clean)); listSrc.shareholders ??= src; continue; }
      if (/^director\d*$/.test(nl)) { lists.directors.push(parsePerson(clean, 'Director')); listSrc.directors ??= src; continue; }
      if (/^(authorisedsignatory|authorizedsignatory|signatory)\d*$/.test(nl)) { lists.signatories.push(parsePerson(clean, 'Signatory')); listSrc.signatories ??= src; continue; }
      if (/^(declaredubo|ubo)\d*$/.test(nl)) { lists.declaredUbos.push(parsePerson(clean)); listSrc.declaredUbos ??= src; continue; }
      const key = keyByNorm.get(nl) ?? keyByNorm.get(nl.replace(/^(company|merchant)/, 'legal')) ?? (nl === 'name' ? keyByNorm.get('fullname') : undefined);
      if (!key) continue;
      let value2: unknown = clean;
      if (['mcc', 'iban', 'trn', 'idNumber', 'licenceNumber', 'registrationNumber', 'passportNumber'].includes(key)) value2 = clean.replace(/\s+/g, key === 'mcc' || key === 'trn' || key === 'idNumber' ? '' : ' ');
      if (['expectedMonthlyVolume', 'expectedAvgTicket', 'monthlyVolume', 'avgTicket', 'chargebackRatioPct', 'percentage', 'averageMonthlyCredits', 'shares'].includes(key)) value2 = num(clean) ?? clean;
      if (key === 'controlByOtherMeans') value2 = /^(yes|true)$/i.test(clean);
      if (key === 'ownerNames' || key === 'managerNames' || key === 'activities') value2 = clean.split(/\s*;\s*/).filter(Boolean);
      fields[key] = { value: value2 as ExtractedField['value'], confidence, source: src };
    }
  }
  for (const [k, arr] of Object.entries(lists)) {
    if (arr.length && keys.includes(k)) fields[k] = { value: arr as unknown as ExtractedField['value'], confidence: 0.95, source: listSrc[k] };
  }
  return { fields, injectionSuspected: false };
}

export function createMockLlm(): LlmClient {
  return {
    isMock: true,
    modelName: 'mock-fixture-parser',
    async run<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
      const ctx = (req.mockContext ?? {}) as Record<string, any>;
      let out: unknown;
      switch (req.agent) {
        case 'classifier': {
          const pages: string[] = ctx.pages ?? [];
          const segs: { docType: DocType; pageStart: number; pageEnd: number; language: 'en' | 'ar' | 'bilingual' | 'unknown'; issuingAuthority?: string; confidence: number }[] = [];
          pages.forEach((p, i) => {
            const t = titleOf(p);
            const last = segs[segs.length - 1];
            const lang = /[؀-ۿ]/.test(p) ? (/[A-Za-z]{4}/.test(p) ? 'bilingual' : 'ar') : /[A-Za-z]/.test(p) ? 'en' : 'unknown';
            const auth = /^authority:\s*(.+)$/im.exec(p)?.[1]?.trim();
            if (t && (!last || last.docType !== t || /^(page\s*1\b)/im.test(p.split('\n').slice(0, 6).join('\n')))) {
              segs.push({ docType: t, pageStart: i + 1, pageEnd: i + 1, language: lang, issuingAuthority: auth, confidence: 0.95 });
            } else if (last) {
              last.pageEnd = i + 1;
            } else {
              segs.push({ docType: 'unknown', pageStart: i + 1, pageEnd: i + 1, language: lang, confidence: 0.3 });
            }
          });
          if (!segs.length) segs.push({ docType: 'unknown', pageStart: 1, pageEnd: 1, language: 'unknown', confidence: 0.2 });
          out = ClassifierOut.parse({ segments: segs, injectionSuspected: false });
          break;
        }
        case 'extractor': {
          const docType: DocType = ctx.docType;
          const pageTexts: { page: number; text: string }[] = ctx.pageTexts ?? [];
          if (ctx.isImage) {
            out = ExtractorOut.parse({ fields: {}, injectionSuspected: false, notes: 'MOCK adapter cannot read images; route to human review.' });
          } else {
            out = ExtractorOut.parse({ ...extract(docType, pageTexts), notes: 'MOCK fixture parser' });
          }
          break;
        }
        case 'verifier_explain': {
          const findings: { code: string; message: string }[] = ctx.findings ?? [];
          out = ExplainOut.parse({
            explanations: findings.map((f) => ({ code: f.code, explanation: `Policy check flagged: ${f.message} A reviewer should compare the source documents before relying on this field.` })),
          });
          break;
        }
        case 'underwriter_memo': {
          const r = ctx.risk as { rating: string; score: number; reasonCodes: string[]; breakdown: { code: string; points: number; note: string }[] };
          const lines = r.breakdown.length ? r.breakdown.map((b) => `- ${b.code} (+${b.points}): ${b.note}`).join('\n') : '- No risk drivers fired.';
          out = MemoOut.parse({
            memo: `MOCK-GENERATED MEMO. Rating ${r.rating} (score ${r.score}).\nDrivers:\n${lines}\nThis memo is a recommendation for the human underwriter. It is not a decision.`,
            recommendedAction: r.rating === 'LOW' ? 'Recommend approval after reviewer confirms flagged fields.' : r.rating === 'MEDIUM' ? 'Recommend approval subject to reviewer checks of listed drivers.' : 'Refer for senior review before any approval.',
          });
          break;
        }
        case 'gap_chaser': {
          const items: string[] = ctx.items ?? [];
          out = GapOut.parse({
            message: items.length
              ? `Dear merchant,\n\nTo complete your onboarding we still need the following:\n${items.map((i) => `- ${i}`).join('\n')}\n\nPlease reply with clear copies. Thank you.`
              : 'No outstanding items.',
          });
          break;
        }
      }
      const parsed = req.schema.parse(out);
      return { output: parsed, model: 'mock-fixture-parser', tokensIn: 0, tokensOut: 0, toolCalls: [], isMock: true };
    },
  };
}
