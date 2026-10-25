import { CANONICAL_FIELDS, type CaseField, type DocType, type EntityType, type Person, type Policy } from '@moneybee/shared';
import type { CaseRec, DocRec } from '../db/types';

const asStr = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function pickSource(docs: DocRec[], docType: DocType, key: string): { doc: DocRec; f: NonNullable<DocRec['fields']>[string] } | null {
  let best: { doc: DocRec; f: NonNullable<DocRec['fields']>[string] } | null = null;
  for (const d of docs) {
    if (d.docType !== docType) continue;
    const f = d.fields?.[key];
    if (!f || f.value === null || f.value === undefined || f.value === '') continue;
    if (!best || f.confidence > best.f.confidence) best = { doc: d, f };
  }
  return best;
}

function personsFrom(docs: DocRec[], types: DocType[], key: string): Person[] {
  for (const t of types) {
    for (const d of docs) {
      if (d.docType !== t) continue;
      const v = d.fields?.[key]?.value;
      if (Array.isArray(v) && v.length) return v as Person[];
    }
  }
  return [];
}

const BRANCH_DOCS: DocType[] = ['branch_board_resolution', 'parent_company_documents', 'parent_ownership_chart'];
export const isBranchCase = (c: CaseRec) => c.entityTypeRequested === 'branch' || (c.entityTypeRequested === 'auto' && c.documents.some((d) => BRANCH_DOCS.includes(d.docType)));

export function detectEntityType(c: CaseRec): EntityType {
  if (isBranchCase(c)) return 'branch';
  const form = asStr(c.fields['company.legalForm']?.value).toLowerCase();
  const legal = asStr(c.fields['company.legalName']?.value).toLowerCase();
  const auth = asStr(c.fields['licence.authority']?.value).toLowerCase();
  const hasInc = c.documents.some((d) => d.docType === 'certificate_of_incorporation');
  if (/fzco|fze|fz-?llc|free\s*zone|\bfz\b|dmcc|ifza|dafza|rakez|meydan|jafza|adgm|difc/.test(`${form} ${legal} ${auth}`) || hasInc) return 'free_zone';
  if (/sole|establishment|individual|civil/.test(form)) return 'sole_establishment';
  if (/llc|l\.l\.c|limited liability/.test(`${form} ${legal}`)) return 'llc';
  return 'mainland';
}

/** Builds the consolidated case fields, lists and ID holders from per-document extractions. Reviewer edits are preserved. */
export function consolidate(c: CaseRec, policy: Policy): void {
  const prev = c.fields;
  const next: Record<string, CaseField> = {};
  for (const def of CANONICAL_FIELDS) {
    const edited = prev[def.path]?.edited;
    if (edited) {
      next[def.path] = { ...prev[def.path] };
      continue;
    }
    for (const s of def.sources) {
      const hit = pickSource(c.documents, s.docType, s.key);
      if (hit) {
        next[def.path] = {
          value: hit.f.value,
          confidence: hit.f.confidence,
          source: { ...hit.f.source, docId: hit.doc.id },
          needsReview: hit.f.confidence < policy.confidenceThreshold,
        };
        break;
      }
    }
  }
  c.fields = next;
  c.legalName = asStr(next['company.legalName']?.value) || undefined;

  c.directors = personsFrom(c.documents, ['register_of_directors', 'moa_aoa', 'corporate_shareholder_docs'], 'directors');
  if (!c.directors.length) {
    const mgr = pickSource(c.documents, 'trade_licence', 'managerNames');
    if (mgr && Array.isArray(mgr.f.value)) c.directors = (mgr.f.value as string[]).map((name) => ({ name, type: 'natural' as const, role: 'Manager' }));
  }
  c.shareholders = personsFrom(c.documents, ['register_of_shareholders', 'moa_aoa'], 'shareholders');
  if (!c.shareholders.length) {
    const own = pickSource(c.documents, 'trade_licence', 'ownerNames');
    if (own && Array.isArray(own.f.value)) {
      const names = own.f.value as string[];
      c.shareholders = names.map((name) => ({ name, type: 'natural' as const, percentage: Math.round((100 / names.length) * 100) / 100 }));
      if (c.documents.some((d) => d.docType === 'trade_licence')) {
        // sole establishment: the licence owner holds 100 percent. Multiple owners without a register are flagged by the verifier.
        if (names.length === 1) c.shareholders[0].percentage = 100;
      }
    }
  }
  if (isBranchCase(c)) {
    // a branch has no shareholders of its own: the parent company owns 100 percent, and the UBO resolver looks through the parent
    const parent = [pickSource(c.documents, 'parent_ownership_chart', 'legalName'), pickSource(c.documents, 'parent_company_documents', 'legalName'), pickSource(c.documents, 'certificate_of_incorporation', 'legalName'), pickSource(c.documents, 'branch_board_resolution', 'legalName')].find(Boolean);
    if (parent) c.shareholders = [{ name: asStr(parent.f.value), type: 'corporate', percentage: 100 }];
  }
  c.signatories = personsFrom(c.documents, ['authorised_signatory_letter', 'branch_board_resolution'], 'signatories');

  c.idHolders = [];
  for (const d of c.documents) {
    if (!['emirates_id', 'passport', 'residence_visa'].includes(d.docType)) continue;
    const f = d.fields ?? {};
    const name = asStr(f.fullName?.value);
    if (!name) continue;
    c.idHolders.push({
      docId: d.id,
      docType: d.docType,
      name,
      idNumber: asStr(f.idNumber?.value ?? f.passportNumber?.value ?? f.visaNumber?.value) || undefined,
      dob: asStr(f.dob?.value) || undefined,
      nationality: asStr(f.nationality?.value) || undefined,
      expiry: asStr(f.expiryDate?.value) || undefined,
    });
  }

  for (const d of c.documents) {
    const f = d.fields ?? {};
    d.issuedOn = asStr(f.issueDate?.value ?? f.effectiveDate?.value ?? f.startDate?.value) || d.issuedOn || null;
    d.expiresOn = asStr(f.expiryDate?.value) || d.expiresOn || null;
  }

  if (c.entityTypeRequested === 'auto') c.entityType = detectEntityType(c);
  else c.entityType = c.entityTypeRequested;
}
