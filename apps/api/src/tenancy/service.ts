import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_TENANT_ID, TenantSchema, TenantUpdateSchema, type Tenant, type TenantUpdate } from '@moneybee/shared';
import type { Store, TenantRec } from '../db/types';
import type { EntityType } from '@moneybee/shared';

/** company types every tenant record created before seededEntityTypes existed was seeded with */
const LAUNCH_ENTITY_TYPES: EntityType[] = ['sole_establishment', 'llc', 'free_zone', 'mainland'];

function findTenantsDir(root: string): string | null {
  const env = process.env.TENANTS_DIR;
  if (env) return env;
  for (const c of [path.resolve(root, 'tenants'), path.resolve(root, '../../tenants'), path.resolve(root, '../tenants')]) {
    if (fs.existsSync(path.join(c, `${DEFAULT_TENANT_ID}.json`))) return c;
  }
  return null;
}

/** Reads and validates tenants/*.json. Throws at boot if a file is invalid (for example if it tries to set poweredBy). */
export function loadTenantFiles(root = process.cwd()): Tenant[] {
  const dir = findTenantsDir(root);
  if (!dir) throw new Error('tenants directory not found (set TENANTS_DIR)');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      try {
        return TenantSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      } catch (e) {
        throw new Error(`invalid tenant file ${f}: ${(e as Error).message}`);
      }
    });
}

export class TenantService {
  private cache = new Map<string, TenantRec>();
  constructor(private store: Store) {}

  /** Inserts tenants from files that are not in the store yet. Edits made in Settings are never overwritten. */
  async init(root?: string, now = new Date()) {
    const files = loadTenantFiles(root);
    if (!files.some((t) => t.id === DEFAULT_TENANT_ID)) throw new Error(`tenant file ${DEFAULT_TENANT_ID}.json is required`);
    for (const t of files) {
      const existing = await this.store.tenants.get(t.id);
      if (existing) {
        TenantSchema.parse(stripMeta(existing)); // a bad stored edit must fail loudly at boot
        // company types added to the tenant file later (for example branch) are switched on once; an admin who removes one keeps it removed
        const seeded = existing.seededEntityTypes ?? t.enabledEntityTypes.filter((x) => LAUNCH_ENTITY_TYPES.includes(x));
        const added = t.enabledEntityTypes.filter((x) => !seeded.includes(x) && !existing.enabledEntityTypes.includes(x));
        if (added.length || !existing.seededEntityTypes) {
          await this.store.tenants.put({ ...existing, enabledEntityTypes: [...existing.enabledEntityTypes, ...added], seededEntityTypes: Array.from(new Set([...seeded, ...t.enabledEntityTypes])), updatedAt: now.toISOString(), updatedBy: added.length ? 'seed:entity-types' : existing.updatedBy });
        }
        continue;
      }
      await this.store.tenants.put({ ...t, seededEntityTypes: t.enabledEntityTypes, createdAt: now.toISOString(), updatedAt: now.toISOString(), updatedBy: 'seed' });
    }
    await this.reload();
  }

  async reload() {
    this.cache = new Map((await this.store.tenants.list()).map((t) => [t.id, t]));
  }

  get(id: string | undefined | null): TenantRec | null {
    return this.cache.get(id ?? DEFAULT_TENANT_ID) ?? null;
  }

  /** Always returns a tenant: unknown ids fall back to the platform tenant. */
  getOrDefault(id: string | undefined | null): TenantRec {
    return this.get(id) ?? this.cache.get(DEFAULT_TENANT_ID)!;
  }

  list(): TenantRec[] {
    return Array.from(this.cache.values());
  }

  /** Public pages pick a tenant from an explicit id, then the request host name, then the platform default. */
  resolvePublic(opts: { explicit?: string | null; host?: string | null }): TenantRec {
    if (opts.explicit) {
      const t = this.get(opts.explicit.toLowerCase());
      if (t && t.status === 'active') return t;
    }
    const host = (opts.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (host) {
      const byHost = this.list().find((t) => t.status === 'active' && t.hostnames.map((h) => h.toLowerCase()).includes(host));
      if (byHost) return byHost;
      const sub = host.split('.')[0];
      const bySub = this.get(sub);
      if (bySub && bySub.status === 'active' && host.split('.').length > 1) return bySub;
    }
    return this.getOrDefault(DEFAULT_TENANT_ID);
  }

  async update(id: string, patch: unknown, by: string, now = new Date()): Promise<TenantRec> {
    const cur = this.get(id);
    if (!cur) throw new Error(`unknown tenant ${id}`);
    const p: TenantUpdate = TenantUpdateSchema.parse(patch);
    const merged = TenantSchema.parse({ ...stripMeta(cur), ...p });
    const next: TenantRec = { ...merged, seededEntityTypes: cur.seededEntityTypes, createdAt: cur.createdAt, updatedAt: now.toISOString(), updatedBy: by };
    await this.store.tenants.put(next);
    this.cache.set(id, next);
    return next;
  }
}

function stripMeta(t: TenantRec): Tenant {
  const { createdAt: _c, updatedAt: _u, updatedBy: _b, seededEntityTypes: _s, ...rest } = t;
  return rest as Tenant;
}
