import { DOC_TYPE_LABELS, buildChecklist, requirementsFor, type Policy } from '@moneybee/shared';
import type { CaseRec, ChecklistItem, Finding, GapItem } from '../db/types';
import { addressSimilarity, companySimilarity, nameSimilarity } from './names';

const asStr = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const DAY = 86400000;
const EID_RE = /^784-?\d{4}-?\d{7}-?\d$/;
const TRN_RE = /^\d{15}$/;

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) ?? /^(\d{2})[\/.-](\d{2})[\/.-](\d{4})/.exec(s);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = m[1].length === 4 ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}
export { parseDate };

export interface VerifyResult {
  findings: Finding[];
  checklist: ChecklistItem[];
  gaps: GapItem[];
  docStatus: Record<string, 'VERIFIED' | 'FLAGGED' | 'EXPIRED'>;
  needsReviewFields: string[];
}

/** Deterministic checks. No LLM in here: code decides, the LLM may later only explain. */
export function verifyCase(c: CaseRec, policy: Policy, now: Date): VerifyResult {
  const findings: Finding[] = [];
  const gaps: GapItem[] = [];
  const docStatus: VerifyResult['docStatus'] = {};
  const entityType = c.entityType && policy.entityTypes[c.entityType] ? c.entityType : 'llc';
  const checklistDef = policy.entityTypes[entityType]!;

  // 1. expiry
  for (const d of c.documents) {
    const exp = parseDate(d.expiresOn);
    if (!exp) continue;
    const days = Math.floor((exp.getTime() - now.getTime()) / DAY);
    const isLicence = d.docType === 'trade_licence';
    if (days < 0) {
      docStatus[d.id] = 'EXPIRED';
      findings.push({ code: isLicence ? 'LICENCE_EXPIRED' : 'DOC_EXPIRED', severity: 'fail', message: `${DOC_TYPE_LABELS[d.docType]} expired on ${d.expiresOn}.`, docIds: [d.id] });
      gaps.push({ kind: 'expired_document', docType: d.docType, message: `${DOC_TYPE_LABELS[d.docType]} has expired (${d.expiresOn}). Please provide a valid copy.` });
    } else if (days <= policy.docExpiryWarnDays) {
      findings.push({ code: 'DOC_EXPIRING_SOON', severity: 'warn', message: `${DOC_TYPE_LABELS[d.docType]} expires in ${days} days (${d.expiresOn}).`, docIds: [d.id] });
    }
  }

  // 2. licence number format
  const licNo = asStr(c.fields['licence.number']?.value);
  if (licNo) {
    const auth = asStr(c.fields['licence.authority']?.value);
    const pattern = policy.licenceNumberPatterns[auth] ?? policy.licenceNumberPatterns.default;
    if (pattern && !new RegExp(pattern).test(licNo)) findings.push({ code: 'LICENCE_NO_FORMAT', severity: 'warn', message: `Licence number "${licNo}" does not match the expected format for ${auth || 'the issuing authority'}.`, fields: ['licence.number'] });
  }

  // 3. Emirates ID and TRN formats
  for (const h of c.idHolders) {
    if (h.docType === 'emirates_id' && h.idNumber && !EID_RE.test(h.idNumber.replace(/\s/g, ''))) {
      findings.push({ code: 'EID_FORMAT', severity: 'warn', message: `Emirates ID number for ${h.name} is not in the expected 784-YYYY-NNNNNNN-C format.`, docIds: [h.docId] });
    }
  }
  const trn = asStr(c.fields['company.trn']?.value).replace(/\s/g, '');
  if (trn && !TRN_RE.test(trn)) findings.push({ code: 'TRN_FORMAT', severity: 'warn', message: `TRN "${trn}" is not a 15 digit number.`, fields: ['company.trn'] });

  // 4. person name match across documents
  if (c.idHolders.length) {
    const subjects: { name: string; why: string }[] = [];
    const licOwners = c.documents.filter((d) => d.docType === 'trade_licence').flatMap((d) => (Array.isArray(d.fields?.ownerNames?.value) ? (d.fields!.ownerNames.value as string[]) : []));
    const corpNames = c.shareholders.filter((p) => p.type === 'corporate').map((p) => p.name);
    const looksCorporate = (n: string) => corpNames.some((x) => companySimilarity(x, n) >= 0.9) || /\b(llc|fze|fzco|fz-llc|ltd|limited|holdings?|inc|plc|pjsc|capital|group|trading|company|co)\b\.?$/i.test(n.trim());
    licOwners.filter((n) => !looksCorporate(n)).forEach((n) => subjects.push({ name: n, why: 'licence owner' }));
    c.directors.filter((p) => p.type === 'natural').forEach((p) => subjects.push({ name: p.name, why: 'director' }));
    c.signatories.filter((p) => p.type === 'natural').forEach((p) => subjects.push({ name: p.name, why: 'authorised signatory' }));
    c.shareholders.filter((p) => p.type === 'natural' && (p.percentage ?? 0) >= policy.uboThresholdPct).forEach((p) => subjects.push({ name: p.name, why: 'shareholder' }));
    const seen = new Set<string>();
    for (const s of subjects) {
      const key = s.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const best = c.idHolders.reduce((a, h) => {
        const sim = nameSimilarity(s.name, h.name);
        return sim > a.sim ? { sim, h } : a;
      }, { sim: 0, h: c.idHolders[0] });
      if (best.sim < 0.7) {
        findings.push({ code: 'NAME_MISMATCH', severity: 'fail', message: `${s.why} "${s.name}" does not match any identity document (closest: "${best.h.name}", similarity ${best.sim.toFixed(2)}).`, docIds: [best.h.docId] });
        gaps.push({ kind: 'mismatch', message: `The name "${s.name}" on the company documents does not match the identity documents provided. Please confirm or provide the correct ID.` });
      } else if (best.sim < 0.88) {
        findings.push({ code: 'NAME_SOFT_MISMATCH', severity: 'warn', message: `${s.why} "${s.name}" is close to but not identical with "${best.h.name}" (similarity ${best.sim.toFixed(2)}). Possible transliteration difference.`, docIds: [best.h.docId] });
      }
    }
  }

  // 5. legal name consistency
  const legal = asStr(c.fields['company.legalName']?.value);
  if (legal) {
    for (const d of c.documents) {
      const other = asStr(d.fields?.legalName?.value ?? (d.docType === 'bank_letter' || d.docType === 'bank_statement' ? d.fields?.accountName?.value : '') ?? '');
      // corporate shareholder documents describe a different (parent) entity by design
      if (!other || ['trade_licence', 'corporate_shareholder_docs', 'parent_company_documents', 'parent_ownership_chart', 'incumbency_certificate', 'branch_board_resolution'].includes(d.docType)) continue;
      if (entityType === 'branch' && d.docType === 'certificate_of_incorporation') continue; // the parent's certificate
      const sim = companySimilarity(legal, other);
      if (sim < 0.85) findings.push({ code: 'LEGAL_NAME_MISMATCH', severity: 'warn', message: `Company name on ${DOC_TYPE_LABELS[d.docType]} ("${other}") differs from the licence ("${legal}").`, docIds: [d.id] });
    }
  }

  // 6. address consistency (licence vs lease)
  const lic = c.documents.find((d) => d.docType === 'trade_licence');
  const lease = c.documents.find((d) => d.docType === 'lease_ejari');
  const a1 = asStr(lic?.fields?.registeredAddress?.value);
  const a2 = asStr(lease?.fields?.address?.value);
  if (a1 && a2 && addressSimilarity(a1, a2) < 0.6) findings.push({ code: 'ADDRESS_MISMATCH', severity: 'warn', message: `Registered address on the licence differs from the lease / Ejari address.`, docIds: [lic!.id, lease!.id] });

  // 7. shareholder percentages
  if (c.shareholders.length) {
    const sum = c.shareholders.reduce((s, p) => s + (p.percentage ?? 0), 0);
    if (Math.abs(sum - 100) > 0.01) findings.push({ code: 'SHARE_PCT_SUM', severity: 'fail', message: `Shareholder percentages add up to ${sum.toFixed(2)}, not 100.` });
  }

  // 8. low confidence fields
  const needsReviewFields = Object.entries(c.fields).filter(([, f]) => f.needsReview).map(([k]) => k);
  for (const k of needsReviewFields) {
    findings.push({ code: 'LOW_CONFIDENCE', severity: 'warn', message: `Low confidence extraction for ${k} (${Math.round(c.fields[k].confidence * 100)}%). Human review required.`, fields: [k] });
    gaps.push({ kind: 'low_confidence', fieldPath: k, message: `Please provide a clearer copy showing ${k}.` });
  }

  // 9. injection
  const injected = [...c.files.filter((f) => f.injectionSuspected).map((f) => f.name), ...c.documents.filter((d) => d.injectionSuspected).map((d) => d.id)];
  if (injected.length || c.injectionSuspected) {
    findings.push({ code: 'INJECTION_SUSPECTED', severity: 'warn', message: 'A document contains instruction-like text aimed at an AI system. It was treated as data and ignored; this is recorded as a risk signal.', docIds: c.documents.filter((d) => d.injectionSuspected).map((d) => d.id) });
  }

  // 10. checklist: the same requirements engine the merchant portal uses (answers switch conditional documents on)
  const checklist: ChecklistItem[] = [];
  const reqs = requirementsFor(policy, entityType, c.portal?.answers ?? {});
  const summary = buildChecklist(reqs, c.documents.map((d) => ({ id: d.id, docType: d.docType, issuedOn: d.issuedOn, expired: docStatus[d.id] === 'EXPIRED' })), now);
  for (const it of summary.items) {
    if (it.required) {
      checklist.push({ docType: it.docType, required: true, received: it.docIds.length > 0, docIds: it.docIds, expired: it.status === 'expired', ...(it.conditional ? { reason: it.reason } : {}) });
      if (!it.docIds.length) {
        findings.push({ code: 'MISSING_DOC', severity: 'fail', message: `Required document missing: ${DOC_TYPE_LABELS[it.docType]}.${it.conditional && it.reason ? ` (${it.reason})` : ''}` });
        gaps.push({ kind: 'missing_document', docType: it.docType, message: `Missing: ${DOC_TYPE_LABELS[it.docType]}.` });
      } else if (it.status === 'too_old') {
        findings.push({ code: 'DOC_TOO_OLD', severity: 'warn', message: `${DOC_TYPE_LABELS[it.docType]} is older than ${it.rule.maxAgeDays} days.`, docIds: it.docIds });
        gaps.push({ kind: 'expired_document', docType: it.docType, message: `Please send a ${DOC_TYPE_LABELS[it.docType]} issued in the last ${it.rule.maxAgeDays} days.` });
      }
    } else if (it.docIds.length) {
      checklist.push({ docType: it.docType, required: false, received: true, docIds: it.docIds, expired: false });
    }
  }

  // 11. required fields
  for (const f of checklistDef.requiredFields) {
    const v = c.fields[f]?.value;
    if (v === undefined || v === null || v === '') {
      findings.push({ code: 'MISSING_FIELD', severity: 'warn', message: `Required field not found: ${f}.`, fields: [f] });
      gaps.push({ kind: 'missing_field', fieldPath: f, message: `Information needed: ${f}.` });
    }
  }

  for (const d of c.documents) {
    if (docStatus[d.id]) continue;
    const flagged = findings.some((f) => f.docIds?.includes(d.id));
    docStatus[d.id] = flagged || d.needsReview ? 'FLAGGED' : 'VERIFIED';
  }

  return { findings, checklist, gaps, docStatus, needsReviewFields };
}
