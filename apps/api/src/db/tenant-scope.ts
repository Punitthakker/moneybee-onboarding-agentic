import { DEFAULT_TENANT_ID } from '@moneybee/shared';
import type { CaseListFilter, CaseRec, Store } from './types';

export const tenantOf = (r: { tenantId?: string } | null | undefined) => r?.tenantId ?? DEFAULT_TENANT_ID;

export class TenantAccessError extends Error {
  status = 404;
  constructor() {
    super('case not found');
  }
}

export type TenantCases = ReturnType<typeof tenantCases>;

/**
 * Tenant-scoped view of the case collection. Every user-facing route reads and writes cases through this,
 * so isolation is enforced in one place: a case from another tenant behaves exactly like a missing case.
 * Background agents use ctx.store directly because they only receive ids of cases created inside a tenant.
 */
export function tenantCases(store: Store, tenantId: string) {
  const own = (c: CaseRec | null) => (c && tenantOf(c) === tenantId ? c : null);
  return {
    tenantId,
    async get(id: string): Promise<CaseRec | null> {
      return own(await store.cases.get(id));
    },
    async require(id: string): Promise<CaseRec> {
      const c = own(await store.cases.get(id));
      if (!c) throw new TenantAccessError();
      return c;
    },
    async list(f: Omit<CaseListFilter, 'tenantId'> = {}): Promise<CaseRec[]> {
      return store.cases.list({ ...f, tenantId });
    },
    async create(c: CaseRec): Promise<CaseRec> {
      if (c.tenantId && c.tenantId !== tenantId) throw new Error(`refusing to create a case for tenant ${c.tenantId} from tenant ${tenantId}`);
      return store.cases.create({ ...c, tenantId });
    },
    async update(id: string, mutator: (c: CaseRec) => void | Promise<void>): Promise<CaseRec> {
      await this.require(id);
      return store.cases.update(id, async (draft) => {
        if (tenantOf(draft) !== tenantId) throw new TenantAccessError();
        await mutator(draft);
        draft.tenantId = tenantId; // a mutator can never move a case to another tenant
      });
    },
  };
}
