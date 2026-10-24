import type { Services } from './core/context.js';
import type { ClientRec } from './core/store.js';
import type { ActorType, Level } from './core/types.js';

/**
 * Creates a client after checking every scope against the scope catalogue: the scope must exist and its allowed
 * levels must include the tenant's level. This is how "scopes per module and per tenant level" is enforced.
 */
export function provisionClient(
  services: Services,
  tenantId: string,
  opts: { scopes: string[]; actorType?: ActorType; roles?: string[] },
): { client: ClientRec; secret: string } {
  const tenant = services.store.getTenant(tenantId);
  if (!tenant) throw new Error(`unknown tenant ${tenantId}`);
  for (const sc of opts.scopes) {
    const def = services.spec.scopes.get(sc);
    if (!def) throw new Error(`unknown scope "${sc}"`);
    if (!def.levels.includes(tenant.level)) throw new Error(`scope "${sc}" cannot be held by a ${tenant.level} tenant`);
  }
  return services.store.createClient({ tenantId, ...opts });
}

export interface SandboxCredential {
  clientId: string;
  secret: string;
  tenantId: string;
  level: Level;
  actorType: string;
  roles: string[];
}

export interface SandboxWorld {
  tenants: Record<string, { id: string; level: Level; parentId: string | null }>;
  credentials: Record<string, SandboxCredential>;
}

/**
 * Seeds a small, synthetic tenant tree for sandbox and tests:
 *
 *   platform
 *   |- partner_a (acquirer)        |- partner_b
 *      |- merchant_a1                 |- merchant_b1
 *      |- merchant_a2
 *
 * Every tenant gets a service credential holding all scopes its level may hold. partner_a also gets a human
 * reviewer credential (actor type user, role reviewer) and an agent credential. Secrets are random per boot.
 */
export function seedSandbox(services: Services): SandboxWorld {
  const { store, spec } = services;
  const t = (name: string, level: Level, parentId: string | null) => store.createTenant({ id: `tnt_${name}`, name, level, parentId });
  const platform = t('platform', 'platform', null);
  const a = t('partner_a', 'partner', platform.id);
  const b = t('partner_b', 'partner', platform.id);
  const a1 = t('merchant_a1', 'merchant', a.id);
  const a2 = t('merchant_a2', 'merchant', a.id);
  const b1 = t('merchant_b1', 'merchant', b.id);

  const allowed = (level: Level) => [...spec.scopes.entries()].filter(([, v]) => v.levels.includes(level)).map(([k]) => k);
  const credentials: SandboxWorld['credentials'] = {};
  const cred = (name: string, tenant: { id: string; level: Level }, extra: { actorType?: 'user' | 'service' | 'agent'; roles?: string[]; scopes?: string[] } = {}) => {
    const { client, secret } = provisionClient(services, tenant.id, { scopes: extra.scopes ?? allowed(tenant.level), actorType: extra.actorType, roles: extra.roles });
    credentials[name] = { clientId: client.clientId, secret, tenantId: tenant.id, level: tenant.level, actorType: client.actorType, roles: client.roles };
  };
  cred('platform', platform);
  cred('partner_a', a);
  cred('partner_b', b);
  cred('merchant_a1', a1);
  cred('merchant_a2', a2);
  cred('merchant_b1', b1);
  cred('partner_a_reviewer', a, { actorType: 'user', roles: ['reviewer'] });
  cred('partner_a_agent', a, { actorType: 'agent' });

  const tenants: SandboxWorld['tenants'] = {};
  for (const x of [platform, a, b, a1, a2, b1]) tenants[x.name] = { id: x.id, level: x.level, parentId: x.parentId };
  return { tenants, credentials };
}
