import type { AuditRec, BotSessionRec, CaseListFilter, CaseRec, PolicySetRec, SettingsRec, Store, TraceRec, UserRec, WebhookDeliveryRec } from './types';

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory Store used for tests and for running without Mongo (STORE=memory). */
export function createMemoryStore(): Store {
  const cases = new Map<string, CaseRec>();
  const traces: TraceRec[] = [];
  const audit: AuditRec[] = [];
  const users = new Map<string, UserRec>();
  const policies: PolicySetRec[] = [];
  let settings: SettingsRec = {};
  const botSessions = new Map<string, BotSessionRec>();
  const hooks = new Map<string, WebhookDeliveryRec>();
  // Serialise updates per case so concurrent mutators do not interleave across awaits.
  const locks = new Map<string, Promise<unknown>>();

  return {
    cases: {
      async create(c) {
        cases.set(c.id, clone(c));
        return clone(c);
      },
      async get(id) {
        const c = cases.get(id);
        return c ? clone(c) : null;
      },
      async list(f: CaseListFilter = {}) {
        let a = Array.from(cases.values());
        if (f.status) a = a.filter((c) => c.status === f.status);
        if (f.entityType) a = a.filter((c) => (c.entityType ?? c.entityTypeRequested) === f.entityType);
        if (f.acquirer) a = a.filter((c) => c.acquirerCode === f.acquirer);
        if (f.q) {
          const q = f.q.toLowerCase();
          a = a.filter((c) => c.name.toLowerCase().includes(q) || c.ref.toLowerCase().includes(q) || (c.legalName ?? '').toLowerCase().includes(q));
        }
        a.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
        return clone(a.slice(0, f.limit ?? 200));
      },
      async update(id, mutator) {
        const prev = locks.get(id) ?? Promise.resolve();
        const run = prev.then(async () => {
          const cur = cases.get(id);
          if (!cur) throw new Error('Case not found');
          const draft = clone(cur);
          await mutator(draft);
          draft.version = cur.version + 1;
          draft.updatedAt = new Date().toISOString();
          cases.set(id, clone(draft));
          return clone(draft);
        });
        locks.set(id, run.catch(() => undefined));
        return run;
      },
      async count() {
        return cases.size;
      },
    },
    traces: {
      async add(t) {
        traces.push(clone(t));
      },
      async listByCase(caseId) {
        return clone(traces.filter((t) => t.caseId === caseId));
      },
    },
    audit: {
      async add(a) {
        audit.push(clone(a));
      },
      async list(f = {}) {
        let a = audit;
        if (f.entity) a = a.filter((x) => x.entity === f.entity);
        return clone(a.slice(-(f.limit ?? 200)).reverse());
      },
    },
    users: {
      async findByEmail(email) {
        const u = Array.from(users.values()).find((x) => x.email.toLowerCase() === email.toLowerCase());
        return u ? clone(u) : null;
      },
      async findById(id) {
        const u = users.get(id);
        return u ? clone(u) : null;
      },
      async create(u) {
        users.set(u.id, clone(u));
        return clone(u);
      },
      async update(id, patch) {
        const u = users.get(id);
        if (!u) return null;
        const n = { ...u, ...patch };
        users.set(id, n);
        return clone(n);
      },
      async list() {
        return clone(Array.from(users.values()));
      },
    },
    policies: {
      async active() {
        return policies.length ? clone(policies[policies.length - 1]) : null;
      },
      async save(p) {
        policies.push(clone(p));
      },
      async versions() {
        return policies.map(({ base: _b, acquirers: _a, ...rest }) => clone(rest)).reverse();
      },
      async get(version) {
        const p = policies.find((x) => x.version === version);
        return p ? clone(p) : null;
      },
    },
    botSessions: {
      async get(id) {
        const s = botSessions.get(id);
        return s ? clone(s) : null;
      },
      async put(s) {
        botSessions.set(s.id, clone(s));
      },
      async list(f = {}) {
        let all = [...botSessions.values()].map(clone);
        if (f.step) all = all.filter((s) => s.step === f.step);
        if (f.idleBefore) all = all.filter((s) => s.lastInboundAt < f.idleBefore!);
        all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        return all.slice(0, f.limit ?? 200);
      },
    },
    settings: {
      async get() {
        return clone(settings);
      },
      async set(s) {
        settings = clone(s);
      },
    },
    webhooks: {
      async create(d) {
        hooks.set(d.id, clone(d));
      },
      async update(id, patch) {
        const d = hooks.get(id);
        if (d) hooks.set(id, { ...d, ...patch, updatedAt: new Date().toISOString() });
      },
      async get(id) {
        const d = hooks.get(id);
        return d ? clone(d) : null;
      },
      async listByCase(caseId) {
        return clone(Array.from(hooks.values()).filter((h) => h.caseId === caseId));
      },
      async listDead() {
        return clone(Array.from(hooks.values()).filter((h) => h.status === 'DEAD'));
      },
    },
    async close() {},
  };
}
