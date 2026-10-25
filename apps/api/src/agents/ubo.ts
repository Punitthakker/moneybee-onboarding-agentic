import type { Person, Policy } from '@moneybee/shared';
import type { CaseRec, UboEdge, UboNode, UboResult } from '../db/types';
import { companySimilarity, normalizeNameTokens } from './names';

const pk = (n: string) => normalizeNameTokens(n).sort().join('-');
const ck = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Builds the ownership graph from the shareholder register and corporate shareholder documents,
 * multiplies percentages through the layers, and flags persons at or above the threshold.
 * Falls back to control by other means, then to the senior managing official.
 */
export function resolveUbo(c: CaseRec, policy: Policy): UboResult {
  const threshold = policy.uboThresholdPct;
  const rootName = String(c.fields['company.legalName']?.value ?? c.name);
  const registers = new Map<string, { name: string; holders: Person[] }>();
  for (const d of c.documents) {
    // documents that describe a corporate owner and who holds it (for a branch: the parent company)
    if (!['corporate_shareholder_docs', 'parent_ownership_chart', 'incumbency_certificate'].includes(d.docType)) continue;
    const name = String(d.fields?.legalName?.value ?? '');
    const holders = d.fields?.shareholders?.value;
    if (name && Array.isArray(holders)) registers.set(ck(name), { name, holders: holders as Person[] });
  }

  const nodes = new Map<string, UboNode>();
  const edges: UboEdge[] = [];
  const effective = new Map<string, { name: string; pct: number; paths: string[] }>();
  const unresolved: string[] = [];
  let sharesSumTo100 = true;
  let maxLayer = 0;

  const rootId = 'company';
  nodes.set(rootId, { id: rootId, label: rootName, kind: 'company', layer: 0 });

  const walk = (entityId: string, entityLabel: string, holders: Person[], mult: number, pathLabels: string[], depth: number, stack: Set<string>) => {
    const sum = holders.reduce((s, h) => s + (h.percentage ?? 0), 0);
    if (holders.length && Math.abs(sum - 100) > 0.01) sharesSumTo100 = false;
    for (const h of holders) {
      const direct = (h.percentage ?? 0) / 100;
      const contribution = mult * direct;
      const layer = depth + 1;
      maxLayer = Math.max(maxLayer, layer);
      const reg = registers.get(ck(h.name)) ?? Array.from(registers.values()).find((r) => companySimilarity(r.name, h.name) >= 0.9);
      const isEntity = h.type === 'corporate' || !!reg;
      if (isEntity) {
        const id = `e:${ck(h.name)}`;
        if (!nodes.has(id) || nodes.get(id)!.layer < layer) nodes.set(id, { id, label: h.name, kind: 'entity', layer });
        edges.push({ from: id, to: entityId, pct: h.percentage ?? 0 });
        if (reg && !stack.has(id) && depth < 10) {
          walk(id, h.name, reg.holders, contribution, [...pathLabels, `${h.name} ${h.percentage ?? 0}%`], layer, new Set([...stack, id]));
        } else if (!reg) {
          unresolved.push(h.name);
        }
      } else {
        const id = `p:${pk(h.name)}`;
        if (!nodes.has(id) || nodes.get(id)!.layer < layer) nodes.set(id, { id, label: h.name, kind: 'person', layer });
        edges.push({ from: id, to: entityId, pct: h.percentage ?? 0 });
        const cur = effective.get(id) ?? { name: h.name, pct: 0, paths: [] };
        cur.pct += contribution * 100;
        cur.paths.push(`${[...pathLabels, `${h.name} ${h.percentage ?? 0}%`].join(' > ')} = ${(contribution * 100).toFixed(2)}%`);
        effective.set(id, cur);
      }
    }
  };

  walk(rootId, rootName, c.shareholders, 1, [rootName], 0, new Set([rootId]));

  const ubos: UboResult['ubos'] = [];
  for (const [id, e] of effective) {
    const pct = Math.round(e.pct * 10000) / 10000;
    const n = nodes.get(id)!;
    n.effectivePct = pct;
    if (pct + 1e-9 >= threshold) {
      n.isUbo = true;
      ubos.push({ name: e.name, effectivePct: pct, basis: 'ownership', paths: e.paths });
    }
  }
  ubos.sort((a, b) => b.effectivePct - a.effectivePct);

  let explanation = '';
  if (ubos.length) {
    explanation = `Ownership was traced through ${maxLayer} layer${maxLayer === 1 ? '' : 's'} to natural persons. ` +
      ubos.map((u) => `${u.name} holds ${u.effectivePct.toFixed(2)}% effective ownership (${u.paths.join('; ')})`).join('. ') +
      `. Persons at or above the ${threshold}% policy threshold are flagged as beneficial owners.`;
  } else {
    const decl = c.documents.find((d) => d.docType === 'ubo_declaration');
    const control = decl?.fields?.controlByOtherMeans?.value === true;
    const declared = (decl?.fields?.declaredUbos?.value as Person[] | undefined) ?? [];
    if (control && declared.length) {
      declared.forEach((p) => ubos.push({ name: p.name, effectivePct: 0, basis: 'control', paths: ['Declared control by other means'] }));
      explanation = `No natural person reaches the ${threshold}% threshold. The UBO declaration states control by other means; the declared person(s) are listed as beneficial owners for the underwriter to confirm.`;
    } else {
      const smo = c.directors[0] ?? c.signatories[0];
      if (smo) {
        ubos.push({ name: smo.name, effectivePct: 0, basis: 'senior_managing_official', paths: ['Fallback: senior managing official'] });
        explanation = `No natural person reaches the ${threshold}% threshold and no control by other means was declared. As a fallback, the senior managing official (${smo.name}) is listed; the underwriter must confirm.`;
      } else {
        explanation = `No natural person reaches the ${threshold}% threshold, no control by other means was declared and no managing official was identified. This case needs manual UBO determination.`;
      }
    }
  }
  if (unresolved.length) explanation += ` Ownership could not be traced past: ${Array.from(new Set(unresolved)).join(', ')} (no shareholder documents provided).`;

  return {
    thresholdPct: threshold,
    nodes: Array.from(nodes.values()),
    edges,
    ubos,
    unresolved: Array.from(new Set(unresolved)),
    explanation,
    layers: maxLayer,
    sharesSumTo100,
  };
}
