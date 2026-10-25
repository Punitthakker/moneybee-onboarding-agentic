import fs from 'node:fs';
import path from 'node:path';
import { AcquirerConfigSchema, PolicySchema, effectivePolicy, type AcquirerConfig, type Policy } from '@moneybee/shared';
import type { PolicySetRec, Store } from '../db/types';

function findPoliciesDir(root: string): string {
  const env = process.env.POLICIES_DIR;
  if (env) return env;
  for (const c of [path.resolve(root, 'policies'), path.resolve(root, '../../policies'), path.resolve(root, '../policies')]) {
    if (fs.existsSync(path.join(c, 'base.json'))) return c;
  }
  throw new Error('policies directory not found (set POLICIES_DIR)');
}

/** Reads and validates /policies/*.json. Throws at boot if any file is invalid. */
export function loadPolicyFiles(root = process.cwd()): { base: Policy; acquirers: AcquirerConfig[] } {
  const dir = findPoliciesDir(root);
  const base = PolicySchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'base.json'), 'utf8')));
  const adir = path.join(dir, 'acquirers');
  const acquirers = fs
    .readdirSync(adir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => AcquirerConfigSchema.parse(JSON.parse(fs.readFileSync(path.join(adir, f), 'utf8'))));
  return { base, acquirers };
}

export class PolicyService {
  private cache: PolicySetRec | null = null;
  constructor(private store: Store) {}

  async init(root?: string) {
    const active = await this.store.policies.active();
    if (active) {
      // validate what is stored so a bad edit cannot take the system down silently
      PolicySchema.parse(active.base);
      active.acquirers.forEach((a) => AcquirerConfigSchema.parse(a));
      this.cache = active;
      await this.addNewFromFiles(root);
      return;
    }
    const files = loadPolicyFiles(root);
    const seed: PolicySetRec = { version: 1, base: { ...files.base, version: 1 }, acquirers: files.acquirers, by: 'system', note: 'Seeded from /policies', at: new Date().toISOString() };
    await this.store.policies.save(seed);
    this.cache = seed;
  }

  /**
   * Add-only upgrade: company types, questions and document rules that exist in /policies but not in the stored
   * active version are added as a new version by "system". Nothing a compliance user edited is changed or removed.
   */
  private async addNewFromFiles(root?: string) {
    let files: { base: Policy };
    try {
      files = loadPolicyFiles(root);
    } catch {
      return; // no policy files next to this build: keep what is stored
    }
    const cur = this.cache!;
    const stored = PolicySchema.parse(cur.base);
    const addTypes = (Object.keys(files.base.entityTypes) as (keyof Policy['entityTypes'])[]).filter((k) => !stored.entityTypes[k]);
    const haveQ = new Set(stored.questions.map((q) => q.id));
    const addQ = files.base.questions.filter((q) => !haveQ.has(q.id));
    const addRules = Object.keys(files.base.documentRules).filter((k) => !stored.documentRules[k]);
    // company types without the newer presentation fields get labels and conditional rules from the file
    const enrich = (Object.keys(stored.entityTypes) as (keyof Policy['entityTypes'])[]).filter((k) => !stored.entityTypes[k]!.label && files.base.entityTypes[k]?.label);
    if (!addTypes.length && !addQ.length && !addRules.length && !enrich.length) return;
    const base: Policy = structuredClone(stored);
    for (const k of addTypes) base.entityTypes[k] = files.base.entityTypes[k];
    for (const k of enrich) {
      const f = files.base.entityTypes[k]!;
      const e = base.entityTypes[k]!;
      Object.assign(e, { label: f.label, labelAr: f.labelAr, description: f.description, descriptionAr: f.descriptionAr });
      if (!e.conditionalDocuments.length) e.conditionalDocuments = f.conditionalDocuments;
      e.docRules = { ...f.docRules, ...e.docRules };
    }
    base.questions = [...base.questions, ...addQ];
    for (const k of addRules) base.documentRules[k] = files.base.documentRules[k];
    const note = `Added from /policies: ${[addTypes.length ? `company types ${addTypes.join(', ')}` : '', addQ.length ? `${addQ.length} question(s)` : '', addRules.length ? `${addRules.length} document rule(s)` : '', enrich.length ? `labels and conditional documents for ${enrich.join(', ')}` : ''].filter(Boolean).join('; ')}`;
    await this.save(base, cur.acquirers, 'system', note);
  }

  async active(): Promise<PolicySetRec> {
    if (!this.cache) await this.init();
    return this.cache!;
  }

  async save(base: unknown, acquirers: unknown, by: string, note: string): Promise<PolicySetRec> {
    const cur = await this.active();
    const b = PolicySchema.parse(base);
    const a = (acquirers as unknown[]).map((x) => AcquirerConfigSchema.parse(x));
    const next: PolicySetRec = { version: cur.version + 1, base: { ...b, version: cur.version + 1 }, acquirers: a, by, note, at: new Date().toISOString() };
    await this.store.policies.save(next);
    this.cache = next;
    return next;
  }

  async acquirers(): Promise<AcquirerConfig[]> {
    return (await this.active()).acquirers;
  }

  async forAcquirer(code: string): Promise<{ policy: Policy; acquirer: AcquirerConfig; version: number }> {
    const set = await this.active();
    const acquirer = set.acquirers.find((a) => a.code === code) ?? set.acquirers[0];
    return { policy: effectivePolicy(set.base, acquirer), acquirer, version: set.version };
  }
}
