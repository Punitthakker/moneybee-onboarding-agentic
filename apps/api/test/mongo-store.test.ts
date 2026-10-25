import { describe, expect, it } from 'vitest';
import { fromDoc, toDoc } from '../src/db/mongo-store';

/**
 * Working-store encoding. Case records hold dotted keys ("company.legalName") at several depths and
 * start with empty objects; both must survive a round trip through MongoDB unchanged.
 */
const sample = {
  id: 'c1',
  version: 0,
  fields: {} as Record<string, unknown>,
  documents: [{ id: 'd1', fields: { 'company.legalName': { value: 'Desert Rose LLC' }, 'licence.no': { value: 'X-1' } }, meta: {} }],
  nested: { a: { '$weird': 1, 'b.c': [{ 'd.e': true }] } },
  skip: undefined,
};

describe('mongo store encoding', () => {
  it('encodes dotted and $ keys at every depth and keeps empty objects', () => {
    const d = toDoc(sample);
    expect(d._id).toBe('c1');
    expect(d.fields).toEqual({});
    const docs = d.documents as { fields: Record<string, unknown>; meta: unknown }[];
    expect(Object.keys(docs[0].fields)).toEqual(['company%2ElegalName', 'licence%2Eno']);
    expect(docs[0].meta).toEqual({});
    expect(JSON.stringify(d)).not.toMatch(/"[^"]*\.[^"]*":/);
    expect('skip' in d).toBe(false);
    expect(fromDoc(d)).toEqual({ ...sample, skip: undefined, id: 'c1' });
  });
});

const url = process.env.MONGO_TEST_URL;
describe.runIf(!!url)('mongo store against a real server', () => {
  it('round-trips a case with dotted keys and empty objects, and updates it', async () => {
    const { createMongoStore } = await import('../src/db/mongo-store');
    const db = url!.replace(/\/?(\?|$)/, `/mb_store_${Date.now()}$1`);
    const store = await createMongoStore(db);
    const now = new Date().toISOString();
    const rec = { ...sample, tenantId: 'moneybee', ref: 'MB-1', name: 'x', status: 'NEW', createdAt: now, updatedAt: now, needsReviewFields: [] } as never;
    await store.cases.create(rec);
    const got = (await store.cases.get('c1')) as unknown as typeof sample & { needsReviewFields: unknown[] };
    expect(got.fields).toEqual({});
    expect(got.documents[0].fields['company.legalName']).toEqual({ value: 'Desert Rose LLC' });
    const upd = await store.cases.update('c1', (c) => {
      (c as unknown as typeof sample).fields['company.legalName'] = { value: 'Desert Rose LLC' };
    });
    expect(upd.version).toBe(1);
    const again = (await store.cases.get('c1')) as unknown as typeof sample;
    expect(again.fields['company.legalName']).toEqual({ value: 'Desert Rose LLC' });
    expect(again.nested).toEqual(sample.nested);
    await store.close();
  });
});
