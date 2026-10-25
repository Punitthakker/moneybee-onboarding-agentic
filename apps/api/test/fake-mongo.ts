import { Query } from 'mingo';
import type { RecordCollection, RecordCollections } from '../src/sql/mongo-repository';

/**
 * In-memory stand-in for a MongoDB collection, used to test the Mongo repository without a server.
 * Query matching uses mingo (MongoDB query language in JS); unique indexes raise E11000 like the real server.
 * Only the operations the repository uses are implemented.
 */
const get = (o: Record<string, any>, path: string) => path.split('.').reduce<any>((v, k) => (v == null ? undefined : v[k]), o);
const set = (o: Record<string, any>, path: string, val: unknown) => {
  const ks = path.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) cur = cur[k] ??= {};
  cur[ks[ks.length - 1]] = val;
};
const clone = <T>(v: T): T => structuredClone(v);

class DuplicateKeyError extends Error {
  code = 11000;
}

export class FakeCollection implements RecordCollection {
  docs: Record<string, any>[] = [];
  private unique: string[][] = [['_id']];

  async createIndex(spec: Record<string, 1 | -1>, opts?: { unique?: boolean; name?: string }) {
    if (opts?.unique) this.unique.push(Object.keys(spec));
    return opts?.name ?? Object.keys(spec).join('_');
  }

  private checkUnique(doc: Record<string, any>, ignore?: Record<string, any>) {
    for (const keys of this.unique) {
      const vals = keys.map((k) => get(doc, k));
      if (vals.some((v) => v === undefined)) continue;
      if (this.docs.some((d) => d !== ignore && keys.every((k, i) => JSON.stringify(get(d, k)) === JSON.stringify(vals[i])))) {
        throw new DuplicateKeyError(`E11000 duplicate key error index: ${keys.join('_')}`);
      }
    }
  }

  async insertOne(doc: Record<string, unknown>) {
    const d = clone(doc) as Record<string, any>;
    this.checkUnique(d);
    this.docs.push(d);
    return { insertedId: d._id };
  }

  async findOne(filter: Record<string, unknown>) {
    const q = new Query(filter);
    const d = this.docs.find((x) => q.test(x));
    return d ? clone(d) : null;
  }

  private apply(d: Record<string, any>, update: Record<string, any>, inserting: boolean) {
    for (const [k, v] of Object.entries(update.$set ?? {})) set(d, k, clone(v));
    if (inserting) for (const [k, v] of Object.entries(update.$setOnInsert ?? {})) set(d, k, clone(v));
  }

  async findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, any>, opts: { upsert?: boolean; returnDocument: 'after' }) {
    const q = new Query(filter);
    const existing = this.docs.find((x) => q.test(x));
    if (existing) {
      const next = clone(existing);
      this.apply(next, update, false);
      this.checkUnique(next, existing);
      Object.assign(existing, next);
      return clone(existing);
    }
    if (!opts.upsert) return null;
    const fresh: Record<string, any> = {};
    for (const [k, v] of Object.entries(filter)) if (typeof v !== 'object' || v === null) set(fresh, k, v);
    this.apply(fresh, update, true);
    this.checkUnique(fresh);
    this.docs.push(fresh);
    return clone(fresh);
  }

  async updateOne(filter: Record<string, unknown>, update: Record<string, any>) {
    const q = new Query(filter);
    const existing = this.docs.find((x) => q.test(x));
    if (!existing) return { modifiedCount: 0 };
    const next = clone(existing);
    this.apply(next, update, false);
    this.checkUnique(next, existing);
    Object.assign(existing, next);
    return { modifiedCount: 1 };
  }
}

export function fakeRecordCollections() {
  const records = new FakeCollection();
  const merchants = new FakeCollection();
  const cols: RecordCollections = { records, merchants, ping: async () => true, close: async () => undefined };
  return { open: async () => cols, records, merchants };
}
