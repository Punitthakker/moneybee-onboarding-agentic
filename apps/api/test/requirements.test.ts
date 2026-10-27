import { describe, expect, it } from 'vitest';
import { PolicySchema, buildChecklist, requirementsFor, type Policy } from '@moneybee/shared';
import { loadPolicyFiles, PolicyService } from '../src/policy/service';
import { TenantService } from '../src/tenancy/service';
import { createMemoryStore } from '../src/db/memory-store';

const { base } = loadPolicyFiles();

describe('requirements engine', () => {
  it('switches conditional documents on from answers, and shows them as "if applicable" otherwise', () => {
    const none = requirementsFor(base, 'free_zone', {});
    expect(none.find((r) => r.docType === 'incumbency_certificate')).toMatchObject({ required: false, ifApplicable: true });
    const adgm = requirementsFor(base, 'free_zone', { free_zone_authority: 'ADGM' });
    expect(adgm.find((r) => r.docType === 'incumbency_certificate')).toMatchObject({ required: true, conditional: true });
    const dmcc = requirementsFor(base, 'free_zone', { free_zone_authority: 'DMCC' });
    expect(dmcc.find((r) => r.docType === 'incumbency_certificate')!.required).toBe(false);
    // all conditions must hold
    expect(requirementsFor(base, 'sole_establishment', { licence_kind: 'professional', owner_uae_national: true }).find((r) => r.docType === 'local_service_agent_agreement')!.required).toBe(false);
    expect(requirementsFor(base, 'sole_establishment', { licence_kind: 'professional', owner_uae_national: false }).find((r) => r.docType === 'local_service_agent_agreement')!.required).toBe(true);
  });

  it('never downgrades a document that is always required', () => {
    // corporate_shareholder_docs is optional for llc, required only with corporate shareholders
    expect(requirementsFor(base, 'llc', { has_corporate_shareholders: true }).find((r) => r.docType === 'corporate_shareholder_docs')!.required).toBe(true);
    expect(requirementsFor(base, 'llc', { has_corporate_shareholders: false }).find((r) => r.docType === 'corporate_shareholder_docs')!.required).toBe(false);
    expect(requirementsFor(base, 'llc', {}).find((r) => r.docType === 'trade_licence')!.required).toBe(true);
  });

  it('matches documents to requirements: exact types first, then substitutes, one document per requirement', () => {
    const reqs = requirementsFor(base, 'branch', { parent_location: 'uae' });
    const s = buildChecklist(reqs, [
      { id: 'd1', docType: 'trade_licence' },
      { id: 'd2', docType: 'certificate_of_incorporation' }, // parent certificate satisfies "parent company documents"
      { id: 'd3', docType: 'ubo_declaration' }, // satisfies the parent ownership chart
      { id: 'd4', docType: 'emirates_id' },
      { id: 'd5', docType: 'emirates_id' }, // several IDs sit under one requirement
      { id: 'd6', docType: 'company_profile' },
    ]);
    const by = Object.fromEntries(s.items.map((i) => [i.docType, i]));
    expect(by.parent_company_documents).toMatchObject({ status: 'received', docIds: ['d2'] });
    expect(by.parent_ownership_chart).toMatchObject({ status: 'received', docIds: ['d3'] });
    expect(by.emirates_id.docIds).toEqual(['d4', 'd5']);
    expect(by.branch_board_resolution.status).toBe('missing');
    expect(s.complete).toBe(false);
    expect(s.requiredDone).toBe(4);
    expect(s.pct).toBe(Math.round((4 / s.requiredTotal) * 100));
  });

  it('marks expired and too-old documents', () => {
    const now = new Date('2026-10-22T00:00:00Z');
    const reqs = requirementsFor(base, 'llc', {});
    const s = buildChecklist(reqs, [
      { id: 'a', docType: 'trade_licence', expiresOn: '2025-01-31' },
      { id: 'b', docType: 'bank_letter', issuedOn: '2026-01-01' }, // older than 90 days
    ], now);
    expect(s.items.find((i) => i.docType === 'trade_licence')!.status).toBe('expired');
    expect(s.items.find((i) => i.docType === 'bank_letter')!.status).toBe('too_old');
  });

  it('older stored policies (no questions, no rules) still parse', () => {
    const old = structuredClone(base) as Record<string, unknown> & { entityTypes: Record<string, Record<string, unknown>> };
    delete old.questions;
    delete old.documentRules;
    delete old.entityTypes.branch;
    for (const e of Object.values(old.entityTypes)) {
      delete e.conditionalDocuments;
      delete e.docRules;
      delete e.label;
    }
    const p = PolicySchema.parse(old);
    expect(p.questions).toEqual([]);
    expect(requirementsFor(p, 'llc', {}).length).toBeGreaterThan(5);
  });
});

describe('add-only upgrades of stored config', () => {
  it('adds new company types, questions and rules to a stored policy without touching compliance edits', async () => {
    const store = createMemoryStore();
    const old: Policy = structuredClone(base);
    delete (old.entityTypes as Record<string, unknown>).branch;
    old.questions = [];
    old.documentRules = {};
    old.uboThresholdPct = 10; // a compliance edit that must survive
    for (const e of Object.values(old.entityTypes)) Object.assign(e!, { label: undefined, conditionalDocuments: [], docRules: {} });
    await store.policies.save({ version: 3, base: { ...old, version: 3 }, acquirers: loadPolicyFiles().acquirers, by: 'compliance@x', note: 'edit', at: new Date().toISOString() });
    const svc = new PolicyService(store);
    await svc.init();
    const act = await svc.active();
    expect(act.version).toBe(4);
    expect(act.by).toBe('system');
    expect(act.note).toMatch(/branch/);
    expect(act.base.uboThresholdPct).toBe(10);
    expect(act.base.entityTypes.branch).toBeTruthy();
    expect(act.base.entityTypes.llc!.label).toBe('Mainland LLC');
    expect(act.base.questions.length).toBe(base.questions.length);
    // second boot: nothing to add, no new version
    const again = new PolicyService(store);
    await again.init();
    expect((await again.active()).version).toBe(4);
  });

  it('switches new company types on for stored tenants once; an admin removal sticks', async () => {
    const store = createMemoryStore();
    const now = new Date().toISOString();
    // a tenant stored before branch existed, without seededEntityTypes
    const svc0 = new TenantService(store);
    await svc0.init();
    const bt = (await store.tenants.get('botim'))!;
    await store.tenants.put({ ...bt, enabledEntityTypes: ['sole_establishment', 'llc', 'free_zone', 'mainland'], seededEntityTypes: undefined, updatedAt: now });
    const svc = new TenantService(store);
    await svc.init();
    expect(svc.get('botim')!.enabledEntityTypes).toContain('branch');
    // admin removes branch; it stays removed after a restart
    await svc.update('botim', { enabledEntityTypes: ['llc', 'free_zone'] }, 'admin@botim');
    const svc2 = new TenantService(store);
    await svc2.init();
    expect(svc2.get('botim')!.enabledEntityTypes).toEqual(['llc', 'free_zone']);
  });

  it('fills Arabic texts into stored tenants once and never overwrites an edited text', async () => {
    const store = createMemoryStore();
    const svc0 = new TenantService(store);
    await svc0.init();
    const bt = (await store.tenants.get('botim'))!;
    const { welcomeTitleAr: _a, welcomeBodyAr: _b, supportLineAr: _c, legalFooterAr: _d, ...oldCopy } = bt.copy;
    await store.tenants.put({ ...bt, copy: { ...oldCopy, welcomeTitle: 'Edited by Botim' } });
    const svc = new TenantService(store);
    await svc.init();
    const copy = svc.get('botim')!.copy;
    expect(copy.welcomeTitle).toBe('Edited by Botim');
    expect(copy.welcomeTitleAr).toMatch(/بوتيم/);
    expect(copy.supportLineAr).toBeTruthy();
  });
});
