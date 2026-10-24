import { randomBytes } from 'node:crypto';
import type { ActorType, Level, Tenant, TenantScope } from './types.js';
import { newId, safeEqual, sha256Hex } from './util.js';

export interface ClientRec {
  clientId: string;
  secretHash: string;
  tenantId: string;
  scopes: string[];
  roles: string[];
  actorType: ActorType;
  active: boolean;
  createdAt: string;
}

export interface EndpointRec {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  description: string | null;
  status: 'active' | 'disabled';
  /** Plain secret. Production keeps this encrypted under a KMS key. */
  secret: string;
  createdAt: string;
}

export interface EventRec {
  id: string;
  type: string;
  apiVersion: string;
  dataVersion: number;
  createdAt: string;
  tenantId: string;
  livemode: boolean;
  data: Record<string, unknown>;
}

export interface AttemptRec {
  number: number;
  at: string;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
}

export interface DeliveryRec {
  id: string;
  eventId: string;
  endpointId: string;
  /** Tenant that owns the endpoint. Used for visibility. */
  tenantId: string;
  status: 'pending' | 'delivered' | 'failed' | 'cancelled';
  attempts: AttemptRec[];
  nextAttemptAt: string | null;
  createdAt: string;
}

export interface AuditRec {
  id: string;
  seq: number;
  tenantId: string;
  occurredAt: string;
  actor: { type: ActorType; id: string };
  clientId: string;
  action: string;
  method: string;
  path: string;
  resource: { type: string; id: string } | null;
  scopesUsed: string[];
  result: 'success' | 'denied' | 'error';
  status: number;
  errorCode: string | null;
  requestId: string;
  idempotentReplay: boolean;
  prevHash: string;
  hash: string;
}

export interface IdemRec {
  fingerprint: string;
  state: 'in_progress' | 'done';
  expiresAt: number;
  response?: { status: number; body: unknown; headers: Record<string, string> };
}

export function scopeFor(store: MemoryStore, tenantId: string): TenantScope {
  return { tenantId, visible: store.descendantsOf(tenantId) };
}

/**
 * In-memory store for the sandbox and tests. Every read and write takes a TenantScope.
 * The Postgres equivalent is db/001_foundation.sql, where the same rule is enforced by row-level security.
 */
export class MemoryStore {
  private tenants = new Map<string, Tenant>();
  private clients = new Map<string, ClientRec>();
  private endpoints = new Map<string, EndpointRec>();
  private events: EventRec[] = [];
  private deliveries = new Map<string, DeliveryRec>();
  private audit = new Map<string, AuditRec[]>();
  private idem = new Map<string, IdemRec>();

  // ---- tenants and clients (platform administration, not tenant-scoped) ----
  createTenant(input: { id?: string; name: string; level: Level; parentId: string | null }): Tenant {
    const parent = input.parentId ? this.tenants.get(input.parentId) : null;
    if (input.parentId && !parent) throw new Error(`unknown parent tenant ${input.parentId}`);
    const expected: Record<Level, Level | null> = { platform: null, partner: 'platform', merchant: 'partner' };
    if ((parent?.level ?? null) !== expected[input.level]) throw new Error(`a ${input.level} tenant needs a ${expected[input.level] ?? 'no'} parent`);
    const id = input.id ?? newId(input.level === 'platform' ? 'tnt_pl' : input.level === 'partner' ? 'tnt_pa' : 'tnt_me');
    const t: Tenant = { id, parentId: input.parentId, level: input.level, name: input.name, path: [...(parent?.path ?? []), id] };
    this.tenants.set(id, t);
    return t;
  }
  getTenant(id: string): Tenant | undefined {
    return this.tenants.get(id);
  }
  /** The tenant itself plus every tenant below it. */
  descendantsOf(tenantId: string): Set<string> {
    const out = new Set<string>();
    for (const t of this.tenants.values()) if (t.path.includes(tenantId)) out.add(t.id);
    return out;
  }

  createClient(input: { tenantId: string; scopes: string[]; actorType?: ActorType; roles?: string[]; env?: 'test' }): { client: ClientRec; secret: string } {
    const clientId = `mb_test_${randomBytes(9).toString('base64url')}`;
    const secret = `mb_test_sec_${randomBytes(24).toString('base64url')}`;
    const client: ClientRec = {
      clientId,
      // High-entropy random secret, so a fast hash is adequate. Human passwords would need a slow hash.
      secretHash: sha256Hex(secret),
      tenantId: input.tenantId,
      scopes: input.scopes,
      roles: input.roles ?? [],
      actorType: input.actorType ?? 'service',
      active: true,
      createdAt: new Date().toISOString(),
    };
    this.clients.set(clientId, client);
    return { client, secret };
  }
  getClient(clientId: string): ClientRec | undefined {
    return this.clients.get(clientId);
  }
  verifyClientSecret(clientId: string, secret: string): ClientRec | null {
    const c = this.clients.get(clientId);
    const ok = safeEqual(sha256Hex(secret), c?.secretHash ?? sha256Hex('x'));
    return c && c.active && ok ? c : null;
  }
  disableClient(clientId: string) {
    const c = this.clients.get(clientId);
    if (c) c.active = false;
  }

  // ---- webhook endpoints ----
  insertEndpoint(scope: TenantScope, rec: Omit<EndpointRec, 'tenantId'>): EndpointRec {
    const full: EndpointRec = { ...rec, tenantId: scope.tenantId };
    this.endpoints.set(full.id, full);
    return full;
  }
  /** Visible to the caller (own tenant or below). */
  getEndpoint(scope: TenantScope, id: string): EndpointRec | undefined {
    const e = this.endpoints.get(id);
    return e && scope.visible.has(e.tenantId) ? e : undefined;
  }
  /** Owned by the caller's own tenant. Mutations need ownership. */
  getOwnedEndpoint(scope: TenantScope, id: string): EndpointRec | undefined {
    const e = this.endpoints.get(id);
    return e && e.tenantId === scope.tenantId ? e : undefined;
  }
  listEndpoints(scope: TenantScope): EndpointRec[] {
    return [...this.endpoints.values()].filter((e) => scope.visible.has(e.tenantId));
  }
  /** Used by the event dispatcher: active endpoints whose owner is the event tenant or one of its ancestors. */
  endpointsForEventTenant(eventTenantId: string): EndpointRec[] {
    const t = this.tenants.get(eventTenantId);
    if (!t) return [];
    return [...this.endpoints.values()].filter((e) => e.status === 'active' && t.path.includes(e.tenantId));
  }

  // ---- events ----
  insertEvent(e: EventRec) {
    this.events.push(e);
  }
  listEvents(scope: TenantScope): EventRec[] {
    return this.events.filter((e) => scope.visible.has(e.tenantId));
  }
  getEvent(scope: TenantScope, id: string): EventRec | undefined {
    const e = this.events.find((x) => x.id === id);
    return e && scope.visible.has(e.tenantId) ? e : undefined;
  }
  /** Dispatcher access, bypassing scope. Internal only. */
  getEventInternal(id: string): EventRec | undefined {
    return this.events.find((x) => x.id === id);
  }

  // ---- deliveries ----
  insertDelivery(d: DeliveryRec) {
    this.deliveries.set(d.id, d);
  }
  listDeliveries(scope: TenantScope): DeliveryRec[] {
    return [...this.deliveries.values()].filter((d) => scope.visible.has(d.tenantId));
  }
  /** Dispatcher access, bypassing scope. Internal only. */
  allDeliveriesInternal(): DeliveryRec[] {
    return [...this.deliveries.values()];
  }
  getEndpointInternal(id: string): EndpointRec | undefined {
    return this.endpoints.get(id);
  }

  // ---- audit (append only) ----
  auditChain(tenantId: string): readonly AuditRec[] {
    return this.audit.get(tenantId) ?? [];
  }
  appendAudit(rec: AuditRec) {
    const chain = this.audit.get(rec.tenantId) ?? [];
    chain.push(rec);
    this.audit.set(rec.tenantId, chain);
  }
  listAudit(scope: TenantScope): AuditRec[] {
    const out: AuditRec[] = [];
    for (const id of scope.visible) out.push(...(this.audit.get(id) ?? []));
    return out;
  }
  /** Test hook only. Never exposed through the API. Simulates tampering with storage. */
  __tamperAudit(tenantId: string, seq: number, patch: Partial<AuditRec>) {
    const rec = this.audit.get(tenantId)?.find((r) => r.seq === seq);
    if (rec) Object.assign(rec, patch);
  }

  // ---- idempotency ----
  idemKey(tenantId: string, clientId: string, key: string) {
    return `${tenantId}|${clientId}|${key}`;
  }
  getIdem(k: string, now: number): IdemRec | undefined {
    const r = this.idem.get(k);
    if (r && r.expiresAt <= now) {
      this.idem.delete(k);
      return undefined;
    }
    return r;
  }
  putIdem(k: string, r: IdemRec) {
    this.idem.set(k, r);
  }
  deleteIdem(k: string) {
    this.idem.delete(k);
  }
}
