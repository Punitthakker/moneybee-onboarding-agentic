import { ApiError } from '../api';

const KEY = 'mb_invite';
export const invite = {
  get: (): string | null => {
    try { return sessionStorage.getItem(KEY); } catch { return null; }
  },
  set: (v: string) => {
    try { sessionStorage.setItem(KEY, v); } catch { /* storage unavailable */ }
  },
  clear: () => {
    try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  },
};

async function call<T>(method: string, path: string, body?: unknown, withInvite = true): Promise<T> {
  const headers: Record<string, string> = { 'x-moneybee-csrf': '1' };
  const inv = invite.get();
  if (withInvite && inv) headers['x-invite'] = inv;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/v1${path}`, { method, headers, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data);
  return data as T;
}
export const m = {
  get: <T>(p: string) => call<T>('GET', p),
  post: <T>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
  /** simulator calls carry no invite */
  sim: {
    get: <T>(p: string) => call<T>('GET', p, undefined, false),
    post: <T>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}, false),
  },
};
