import mongoose, { Schema } from 'mongoose';
import type { AuditRec, BotSessionRec, CaseListFilter, CaseRec, PolicySetRec, SettingsRec, Store, TraceRec, UserRec, WebhookDeliveryRec } from './types';
import { ConflictError } from './types';

const loose = (name: string, indexes: Record<string, 1 | -1>[] = []) => {
  const s = new Schema({ _id: String }, { strict: false, versionKey: false });
  for (const i of indexes) s.index(i);
  return mongoose.models[name] ?? mongoose.model(name, s, name);
};

const enc = (k: string) => k.replace(/\./g, '%2E');
const dec = (k: string) => k.replace(/%2E/g, '.');
const mapKeys = (o: Record<string, unknown> | undefined, f: (k: string) => string) =>
  o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v])) : o;

// Canonical field paths contain dots ("company.legalName"); encode them for storage.
const toDoc = <T extends { id: string }>(o: T) => {
  const { id, ...restAny } = o as T & Record<string, unknown>;
  const rest = restAny as Record<string, unknown>;
  if ('fields' in rest && rest.fields && typeof rest.fields === 'object' && 'needsReviewFields' in rest) {
    rest.fields = mapKeys(rest.fields as Record<string, unknown>, enc);
  }
  return { _id: id, ...rest };
};
const fromDoc = <T>(d: Record<string, unknown> | null): T | null => {
  if (!d) return null;
  const { _id, ...rest } = d;
  if ('needsReviewFields' in rest && rest.fields) rest.fields = mapKeys(rest.fields as Record<string, unknown>, dec);
  return { id: _id, ...rest } as T;
};

export async function createMongoStore(url: string): Promise<Store> {
  await mongoose.connect(url, { serverSelectionTimeoutMS: 15000 });
  const Cases = loose('cases', [{ createdAt: -1 }, { status: 1 }]);
  const Traces = loose('traces', [{ caseId: 1, startedAt: 1 }]);
  const Audit = loose('audit', [{ entity: 1, at: -1 }]);
  const Users = loose('users', [{ email: 1 }]);
  const Policies = loose('policy_versions', [{ version: -1 }]);
  const Settings = loose('settings');
  const Hooks = loose('webhook_deliveries', [{ caseId: 1 }, { status: 1 }]);
  const BotSessions = loose('bot_sessions', [{ step: 1 }, { lastInboundAt: 1 }, { updatedAt: -1 }]);

  const lean = <T>(q: unknown) => q as unknown as Promise<T>;

  return {
    cases: {
      async create(c) {
        await Cases.create(toDoc(c));
        return c;
      },
      async get(id) {
        return fromDoc<CaseRec>(await lean(Cases.findById(id).lean()));
      },
      async list(f: CaseListFilter = {}) {
        const q: Record<string, unknown> = {};
        if (f.status) q.status = f.status;
        if (f.acquirer) q.acquirerCode = f.acquirer;
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
          const res = await Cases.replaceOne({ _id: id, version: cur.version }, toDoc(draft));
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
        await Traces.create(toDoc(t));
      },
      async listByCase(caseId) {
        const rows = await lean<Record<string, unknown>[]>(Traces.find({ caseId }).sort({ startedAt: 1 }).lean());
        return rows.map((r) => fromDoc<TraceRec>(r)!);
      },
    },
    audit: {
      async add(a) {
        await Audit.create(toDoc(a));
      },
      async list(f = {}) {
        const rows = await lean<Record<string, unknown>[]>(Audit.find(f.entity ? { entity: f.entity } : {}).sort({ at: -1 }).limit(f.limit ?? 200).lean());
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
        await Users.create(toDoc(u));
        return u;
      },
      async update(id, patch) {
        const { id: _i, ...rest } = patch as Record<string, unknown>;
        return fromDoc<UserRec>(await lean(Users.findByIdAndUpdate(id, { $set: rest }, { new: true }).lean()));
      },
      async list() {
        const rows = await lean<Record<string, unknown>[]>(Users.find().lean());
        return rows.map((r) => fromDoc<UserRec>(r)!);
      },
    },
    policies: {
      async active() {
        const r = await lean<Record<string, unknown> | null>(Policies.findOne().sort({ version: -1 }).lean());
        if (!r) return null;
        const { _id, ...rest } = r;
        return rest as unknown as PolicySetRec;
      },
      async save(p) {
        await Policies.create({ _id: `v${p.version}`, ...p });
      },
      async versions() {
        const rows = await lean<Record<string, unknown>[]>(Policies.find({}, { base: 0, acquirers: 0 }).sort({ version: -1 }).lean());
        return rows.map(({ _id, ...rest }) => rest as unknown as Omit<PolicySetRec, 'base' | 'acquirers'>);
      },
      async get(version) {
        const r = await lean<Record<string, unknown> | null>(Policies.findById(`v${version}`).lean());
        if (!r) return null;
        const { _id, ...rest } = r;
        return rest as unknown as PolicySetRec;
      },
    },
    botSessions: {
      async get(id) {
        return fromDoc<BotSessionRec>(await lean<Record<string, unknown> | null>(BotSessions.findById(id).lean()));
      },
      async put(s) {
        await BotSessions.replaceOne({ _id: s.id }, toDoc(s), { upsert: true });
      },
      async list(f = {}) {
        const q: Record<string, unknown> = {};
        if (f.step) q.step = f.step;
        if (f.idleBefore) q.lastInboundAt = { $lt: f.idleBefore };
        const rows = await lean<Record<string, unknown>[]>(BotSessions.find(q).sort({ updatedAt: -1 }).limit(f.limit ?? 200).lean());
        return rows.map((r) => fromDoc<BotSessionRec>(r)!);
      },
    },
    settings: {
      async get() {
        const r = await lean<Record<string, unknown> | null>(Settings.findById('main').lean());
        if (!r) return {};
        const { _id, ...rest } = r;
        return rest as SettingsRec;
      },
      async set(s) {
        await Settings.replaceOne({ _id: 'main' }, { _id: 'main', ...s }, { upsert: true });
      },
    },
    webhooks: {
      async create(d) {
        await Hooks.create(toDoc(d));
      },
      async update(id, patch) {
        await Hooks.updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date().toISOString() } });
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
