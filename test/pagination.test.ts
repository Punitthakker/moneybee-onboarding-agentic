import { beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLE, type World, makeWorld } from './helpers.js';

describe('cursor pagination', () => {
  let w: World;
  beforeEach(async () => {
    w = await makeWorld();
  });

  const seed = async (n: number) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push((await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE })).body.id);
      w.clock.advance(1000);
    }
    return ids;
  };

  const walk = async (query: Record<string, string | number>) => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await w.call('merchant_a1', 'GET', '/template/examples', { query: { ...query, ...(cursor ? { cursor } : {}) } });
      expect(res.status).toBe(200);
      w.expectSpec('listExamples', res);
      seen.push(...res.body.data.map((x: any) => x.id));
      cursor = res.body.page.next_cursor;
      expect(res.body.page.has_more).toBe(cursor !== null);
      pages++;
    } while (cursor && pages < 50);
    return seen;
  };

  it('walks every item once, newest first by default', async () => {
    const ids = await seed(7);
    const seen = await walk({ limit: 3 });
    expect(seen).toEqual([...ids].reverse());
  });

  it('supports ascending order', async () => {
    const ids = await seed(5);
    expect(await walk({ limit: 2, sort: 'created_at' })).toEqual(ids);
  });

  it('returns a null cursor on the last page and on an empty list', async () => {
    const empty = await w.call('merchant_a1', 'GET', '/template/examples');
    expect(empty.body).toMatchObject({ data: [], page: { has_more: false, next_cursor: null } });
    await seed(2);
    const all = await w.call('merchant_a1', 'GET', '/template/examples', { query: { limit: 2 } });
    expect(all.body.page).toMatchObject({ has_more: false, next_cursor: null });
  });

  it('stays stable when items are inserted between pages', async () => {
    const ids = await seed(6);
    const first = await w.call('merchant_a1', 'GET', '/template/examples', { query: { limit: 3 } });
    await seed(2); // newer items arrive after the first page was read
    const second = await w.call('merchant_a1', 'GET', '/template/examples', { query: { limit: 3, cursor: first.body.page.next_cursor } });
    const got = [...first.body.data, ...second.body.data].map((x: any) => x.id);
    expect(got).toEqual([...ids].reverse());
  });

  it('breaks ties on identical timestamps by id, with no duplicates or gaps', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await w.call('merchant_a1', 'POST', '/template/examples', { body: EXAMPLE })).body.id); // same fake time
    const seen = await walk({ limit: 2 });
    expect(new Set(seen).size).toBe(6);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('paginates the audit log and events too', async () => {
    await seed(4);
    for (const path of ['/audit-events', '/events']) {
      const a = await w.call('merchant_a1', 'GET', path, { query: { limit: 2 } });
      expect(a.status, path).toBe(200);
      expect(a.body.data).toHaveLength(2);
      const b = await w.call('merchant_a1', 'GET', path, { query: { limit: 2, cursor: a.body.page.next_cursor } });
      expect(b.status, path).toBe(200);
      const ids = new Set([...a.body.data, ...b.body.data].map((x: any) => x.id));
      expect(ids.size, path).toBe(a.body.data.length + b.body.data.length);
    }
  });
});
