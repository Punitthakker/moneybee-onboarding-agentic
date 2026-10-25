export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = { 'x-moneybee-csrf': '1' };
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/v1${path}`, { method, headers, credentials: 'include', body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const issues = data?.issues?.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join('; ');
    throw new ApiError(res.status, issues || data?.error || res.statusText, data);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => req<T>('GET', p),
  post: <T>(p: string, b?: unknown) => req<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => req<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => req<T>('PATCH', p, b ?? {}),
  form: <T>(p: string, fd: FormData) => req<T>('POST', p, fd, true),
};

export type Role = 'ADMIN' | 'UNDERWRITER' | 'SECOND_REVIEWER' | 'VIEWER';
export interface Me { id: string; email: string; name: string; role: Role; tenantId: string }
export const can = {
  write: (u?: Me | null) => !!u && (u.role === 'ADMIN' || u.role === 'UNDERWRITER'),
  review: (u?: Me | null) => !!u && u.role !== 'VIEWER',
  admin: (u?: Me | null) => u?.role === 'ADMIN',
};
