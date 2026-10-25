import mongoose, { Schema } from 'mongoose';
import { DEFAULT_TENANT_ID } from '@moneybee/shared';
import type { AuditRec, CaseListFilter, CaseRec, PolicySetRec, SettingsRec, Store, TenantRec, TraceRec, UserRec, WebhookDeliveryRec } from './types';
import { ConflictError } from './types';

/**
 * Records are stored through the native driver collection, not through Mongoose documents.
 * Mongoose casting would drop empty objects (minimize) and treat dotted keys such as
 * "company.legalName" as nested paths, which silently loses extracted fields.
 * Every key that contains a dot or starts with "$" is encoded on write and decoded on read,
 * at any depth (case fields, per-document fields, findings and so on).
 */
const loose = (name: string, indexes: Record<string, 1 | -1>[] = []) => {
  const s = new Schema({ _id: String }, { strict: false, versionKey: false, minimize: false });
  for (const i of indexes) s.index(i);
  return mongoose.models[name] ?? mongoose.model(name, s, name);
};

const encKey = (k: string) => k.replace(/\./g, '%2E').replace(/^\$/, '%24');
const decKey = (k: string) => k.replace(/%2E/g, '.').replace(/^%24/, '$');
const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const deepKeys = (v: unknown, f: (k: string) => string): unknown => {
  if (Array.isArray(v)) return v.map((x) => deepKeys(x, f));
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [f(k), deepKeys(x, f)]));
  return v;
};

export const toDoc = <T extends { id: string }>(o: T): Record<string, unknown> & { _id: string } => {
  const { id, ...rest } = o as T & Record<string, unknown>;
  return { _id: id, ...(deepKeys(rest, encKey) as Record<string, unknown>) };
};
export const fromDoc = <T>(d: Record<string, unknown> | null): T | null => {
  if (!d) return null;
  const { _id, ...rest } = d;
  return { id: _id, ...(deepKeys(rest, decKey) as Record<string, unknown>) } as T;
};

export async function createMongoStore(url: string): Promise<Store> {
  await mongoose.connect(url, { serverSelectionTimeoutMS: 15000 });
  const Cases = loose('cases', [{ createdAt: -1 }, { status: 1 }, { tenantId: 1, createdAt: -1 }, { tenantId: 1, status: 1 }, { 'portal.contact.emailHash': 1 }]);
  const Traces = loose('traces', [{ caseId: 1, startedAt: 1 }]);
  const Audit = loose('audit', [{ entity: 1, at: -1 }, { tenantId: 1, at: -1 }]);
  const Users = loose('users', [{ email: 1 }, { tenantId: 1 }]);
  const Policies = loose('policy_versions', [{ version: -1 }]);
  const Settings = loose('settings');
  const Hooks = loose('webhook_deliveries', [{ caseId: 1 }, { status: 1 }]);
  const Tenants = loose('tenants');

  // Records written before tenancy belong to the platform tenant. Idempotent, runs on every boot.
  for (const M of [Cases, Users, Audit]) await M.updateMany({ tenantId: { $exists: false } }, { $set: { tenantId: DEFAULT_TENANT_ID } });

  const lean = <T>(q: unknown) => q as unknown as Promise<T>;

  return {
    cases: {
      async create(c) {
        await Cases.collection.insertOne(toDoc(c) as never);
        return c;
      },
      async get(id) {
        return fromDoc<CaseRec>(await lean(Cases.findById(id).lean()));
      },
      async list(f: CaseListFilter = {}) {
        const q: Record<string, unknown> = {};
        if (f.tenantId) q.tenantId = f.tenantId;
        if (f.status) q.status = f.status;
        if (f.acquirer) q.acquirerCode = f.acquirer;
        if (f.portalEmailHash) q['portal.contact.emailHash'] = f.portalEmailHash;
        if (f.entityType) q.$or = [{ entityType: f.entityType }, { entityType: { $exists: false }, entityTypeRequested: f.entityType }];
        if (f.q) {
          const re = new RegExp(f.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          q.$and = [{ $or: [{ name: re }, { ref: re }, { legalName: re }] }];
        }
        const rows = await lean<Record<string, unknown>[]>(Cases.find(q).sort({ createdAt: -1 }).limit(f.limit ?? 200).lean());
        return rows.map((r) => fromDoc<CaseRec>(r)!);
      },
      async update(id, mutator) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const cur = fromDoc<CaseRec>(await lean(Cases.findById(id).lean()));
          if (!cur) throw new Error('Case not found');
          const draft = structuredClone(cur);
          await mutator(draft);
          draft.version = cur.version + 1;
          draft.updatedAt = new Date().toISOString();
          const res = await Cases.collection.replaceOne({ _id: id, version: cur.version } as never, toDoc(draft));
          if (res.matchedCount === 1) return draft;
          await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
        }
        throw new ConflictError();
      },
      async count() {
        return Cases.countDocuments();
      },
    },
    traces: {
      async add(t) {
        await Traces.collection.insertOne(toDoc(t) as never);
      },
      async listByCase(caseId) {
        const rows = await lean<Record<string, unknown>[]>(Traces.find({ caseId }).sort({ startedAt: 1 }).lean());
        return rows.map((r) => fromDoc<TraceRec>(r)!);
      },
    },
    audit: {
      async add(a) {
        await Audit.collection.insertOne(toDoc(a) as never);
      },
      async list(f = {}) {
        const q: Record<string, unknown> = {};
        if (f.entity) q.entity = f.entity;
        if (f.tenantId) q.tenantId = f.tenantId;
        const rows = await lean<Record<string, unknown>[]>(Audit.find(q).sort({ at: -1 }).limit(f.limit ?? 200).lean());
        return rows.map((r) => fromDoc<AuditRec>(r)!);
      },
    },
    users: {
      async findByEmail(email) {
        return fromDoc<UserRec>(await lean(Users.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean()));
      },
      async findById(id) {
        return fromDoc<UserRec>(await lean(Users.findById(id).lean()));
      },
      async create(u) {
        await Users.collection.insertOne(toDoc(u) as never);
        return u;
      },
      async update(id, patch) {
        const { _id: _i, ...rest } = toDoc({ ...(patch as Record<string, unknown>), id: id });
        return fromDoc<UserRec>(await lean(Users.collection.findOneAndUpdate({ _id: id } as never, { $set: rest }, { returnDocument: 'after' })));
      },
      async list(f = {}) {
        const rows = await lean<Record<string, unknown>[]>(Users.find(f.tenantId ? { tenantId: f.tenantId } : {}).lean());
        return rows.map((r) => fromDoc<UserRec>(r)!);
      },
    },
    tenants: {
      async get(id) {
        return fromDoc<TenantRec>(await lean(Tenants.findById(id).lean()));
      },
      async list() {
        const rows = await lean<Record<string, unknown>[]>(Tenants.find().sort({ _id: 1 }).lean());
        return rows.map((r) => fromDoc<TenantRec>(r)!);
      },
      async put(t) {
        await Tenants.collection.replaceOne({ _id: t.id } as never, toDoc(t), { upsert: true });
      },
    },
    policies: {
      async active() {
        const r = await lean<Record<string, unknown> | null>(Policies.findOne().sort({ version: -1 }).lean());
        if (!r) return null;
        const { id: _id, ...rest } = fromDoc<Record<string, unknown>>(r)!;
        return rest as unknown as PolicySetRec;
      },
      async save(p) {
        await Policies.collection.insertOne(toDoc({ ...p, id: `v${p.version}` }) as never);
      },
      async versions() {
        const rows = await lean<Record<string, unknown>[]>(Policies.find({}, { base: 0, acquirers: 0 }).sort({ version: -1 }).lean());
        return rows.map((r) => { const { id: _id, ...rest } = fromDoc<Record<string, unknown>>(r)!; return rest as unknown as Omit<PolicySetRec, 'base' | 'acquirers'>; });
      },
      async get(version) {
        const r = await lean<Record<string, unknown> | null>(Policies.findById(`v${version}`).lean());
        if (!r) return null;
        const { id: _id, ...rest } = fromDoc<Record<string, unknown>>(r)!;
        return rest as unknown as PolicySetRec;
      },
    },
    settings: {
      async get() {
        const r = await lean<Record<string, unknown> | null>(Settings.findById('main').lean());
        if (!r) return {};
        const { id: _id, ...rest } = fromDoc<Record<string, unknown>>(r)!;
        return rest as SettingsRec;
      },
      async set(s) {
        await Settings.collection.replaceOne({ _id: 'main' } as never, toDoc({ ...s, id: 'main' }), { upsert: true });
      },
    },
    webhooks: {
      async create(d) {
        await Hooks.collection.insertOne(toDoc(d) as never);
      },
      async update(id, patch) {
        const { _id: _h, ...set } = toDoc({ ...(patch as Record<string, unknown>), updatedAt: new Date().toISOString(), id });
        await Hooks.collection.updateOne({ _id: id } as never, { $set: set });
      },
      async get(id) {
        return fromDoc<WebhookDeliveryRec>(await lean(Hooks.findById(id).lean()));
      },
      async listByCase(caseId) {
        const rows = await lean<Record<string, unknown>[]>(Hooks.find({ caseId }).sort({ createdAt: 1 }).lean());
        return rows.map((r) => fromDoc<WebhookDeliveryRec>(r)!);
      },
      async listDead() {
        const rows = await lean<Record<string, unknown>[]>(Hooks.find({ status: 'DEAD' }).sort({ createdAt: -1 }).lean());
        return rows.map((r) => fromDoc<WebhookDeliveryRec>(r)!);
      },
    },
    async close() {
      await mongoose.disconnect();
    },
  };
}
