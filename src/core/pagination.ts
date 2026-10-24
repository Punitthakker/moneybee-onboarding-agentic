import { createHmac } from 'node:crypto';
import { E } from './errors.js';
import { safeEqual, sha256Hex } from './util.js';

export interface PageRequest {
  limit: number;
  cursor?: string;
}

export interface Page<T> {
  data: T[];
  page: { limit: number; has_more: boolean; next_cursor: string | null };
}

export interface PaginateOptions<T> {
  req: PageRequest;
  /** Value to sort by. Strings and numbers only. */
  sortKey: (item: T) => string | number;
  id: (item: T) => string;
  dir: 'asc' | 'desc';
  /** Everything that shapes the result set: filters and sort. A cursor only works with the same fingerprint. */
  fingerprintInput: unknown;
  secret: string;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function encodeCursor(k: string | number, i: string, fp: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ k, i, f: fp })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function decodeCursor(cursor: string, fp: string, secret: string): { k: string | number; i: string } {
  const [payload, sig] = cursor.split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload, secret))) throw E.invalidCursor();
  try {
    const v = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (v.f !== fp || (typeof v.k !== 'string' && typeof v.k !== 'number') || typeof v.i !== 'string') throw new Error('bad');
    return { k: v.k, i: v.i };
  } catch {
    throw E.invalidCursor();
  }
}

function cmp(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Keyset pagination over an already filtered list. Sorting is by (sortKey, id), so the order is total and a page
 * never repeats or skips items when new items arrive. The cursor is signed and bound to the filters and sort.
 */
export function paginate<T>(items: T[], o: PaginateOptions<T>): Page<T> {
  const fp = sha256Hex(JSON.stringify(o.fingerprintInput)).slice(0, 16);
  const sign_ = o.dir === 'asc' ? 1 : -1;
  const sorted = [...items].sort((a, b) => sign_ * (cmp(o.sortKey(a), o.sortKey(b)) || cmp(o.id(a), o.id(b))));
  let start = 0;
  if (o.req.cursor) {
    const c = decodeCursor(o.req.cursor, fp, o.secret);
    start = sorted.findIndex((x) => sign_ * (cmp(o.sortKey(x), c.k) || cmp(o.id(x), c.i)) > 0);
    if (start === -1) start = sorted.length;
  }
  const slice = sorted.slice(start, start + o.req.limit);
  const hasMore = start + slice.length < sorted.length;
  const last = slice[slice.length - 1];
  return {
    data: slice,
    page: {
      limit: o.req.limit,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor(o.sortKey(last), o.id(last), fp, o.secret) : null,
    },
  };
}

/** Parses `sort` values such as `-created_at` into a field and direction. */
export function parseSort(sort: string | undefined, fallback: string): { field: string; dir: 'asc' | 'desc' } {
  const s = sort ?? fallback;
  return s.startsWith('-') ? { field: s.slice(1), dir: 'desc' } : { field: s, dir: 'asc' };
}
