export type Level = 'platform' | 'partner' | 'merchant';
export type ActorType = 'user' | 'service' | 'agent';
export type Env = 'sandbox' | 'live';
export type McpRisk = 'read' | 'write' | 'money-moving' | 'decision-recording';

export interface Tenant {
  id: string;
  parentId: string | null;
  level: Level;
  name: string;
  /** Ancestors from the platform down to and including this tenant. */
  path: string[];
}

export interface Principal {
  clientId: string;
  tenant: Tenant;
  scopes: string[];
  roles: string[];
  actorType: ActorType;
  actorId: string;
  env: Env;
}

/**
 * Tenant scope for data access. Every store read and write takes one of these.
 * `visible` is the caller's tenant and all tenants below it. This mirrors the row-level
 * security policy in db/001_foundation.sql.
 */
export interface TenantScope {
  tenantId: string;
  visible: ReadonlySet<string>;
}

export interface HandlerResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Operation {
  operationId: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Path relative to the server base, for example /webhook-endpoints/{endpoint_id}. */
  path: string;
  tags: string[];
  summary: string;
  mcpRisk: McpRisk;
  requiredScopes: string[];
  requiredActor: ActorType | null;
  requiredRoles: string[];
  requiresAuth: boolean;
  idempotent: boolean;
  deprecated: boolean;
  sunset: string | null;
  raw: Record<string, any>;
}
