import { ApiError } from '../api';
import type { PublicTenant } from '../tenant';

/** Keeps ?tenant= on public calls so pages before sign-in are themed correctly (host name works too). */
export function tenantQuery(): string {
  const t = new URLSearchParams(window.location.search).get('tenant');
  return t ? `?tenant=${encodeURIComponent(t)}` : '';
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const headers: Record<string, string> = { 'x-moneybee-csrf': '1' };
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/v1${path}`, { method, headers, credentials: 'include', body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const issues = data?.issues?.map((i: { message: string }) => i.message).join('. ');
    throw new ApiError(res.status, issues || data?.error || res.statusText, data);
  }
  return data as T;
}
export const p = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, b?: unknown) => call<T>('POST', path, b ?? {}),
  patch: <T>(path: string, b: unknown) => call<T>('PATCH', path, b),
  del: <T>(path: string) => call<T>('DELETE', path),
  form: <T>(path: string, fd: FormData) => call<T>('POST', path, fd),
};

export type EntityType = 'sole_establishment' | 'llc' | 'free_zone' | 'mainland' | 'branch';
export interface Question { id: string; label: string; labelAr?: string; help?: string; helpAr?: string; type: 'boolean' | 'select'; options?: { value: string; label: string; labelAr?: string }[] }
export interface ReqDoc { docType: string; label: string; required: boolean; ifApplicable: boolean; reason: string | null; reasonAr: string | null; hint: string | null; hintAr: string | null }
export interface EntityOption { id: EntityType; label: string; labelAr: string | null; description: string | null; descriptionAr: string | null; questions: Question[]; documents: ReqDoc[] }
export interface Requirements { tenant: PublicTenant; entityTypes: EntityOption[]; uboThresholdPct: number }

export type Phase = 'collecting' | 'submitted' | 'in_review' | 'needs_info' | 'approved' | 'rejected' | 'completed';
export interface ChecklistItem extends ReqDoc { conditional: boolean; perPerson: string | null; status: 'missing' | 'received' | 'expired' | 'too_old'; files: string[] }
export interface AppFile { id: string; name: string; size: number; at: string; source: string; detected: { docType: string; label: string }[]; slot: string | null; state: 'checking' | 'recognised' | 'unrecognised' }
export interface AppView {
  tenant: PublicTenant;
  application: {
    ref: string; businessName: string; entityType: EntityType | null; entityLabel: string | null; entityLabelAr: string | null; answers: Record<string, string | boolean>; questions: Question[];
    phase: Phase; canEdit: boolean; canUpload: boolean; canSubmit: boolean; submittedAt: string | null; contact: { name: string; emailMasked: string } | null; locale: 'en' | 'ar'; createdAt: string; updatedAt: string;
  };
  checklist: { requiredTotal: number; requiredDone: number; pct: number; complete: boolean; items: ChecklistItem[] };
  files: AppFile[];
  requests: { docType: string | null; message: string }[];
  timeline: { at: string; kind: string; detail?: string }[];
}
