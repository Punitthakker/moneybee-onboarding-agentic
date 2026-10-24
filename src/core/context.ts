import type { Config } from './config.js';
import type { AuditLog } from './audit.js';
import type { EventBus } from './events.js';
import type { RateLimiter } from './ratelimit.js';
import type { LoadedSpec } from './spec.js';
import type { MemoryStore } from './store.js';
import type { TokenService } from './tokens.js';
import type { ActorType, HandlerResult, Operation, Principal, TenantScope } from './types.js';
import type { WebhookWorker } from './webhooks.js';
import type { Clock } from './util.js';

export interface Services {
  cfg: Config;
  clock: Clock;
  spec: LoadedSpec;
  store: MemoryStore;
  audit: AuditLog;
  events: EventBus;
  tokens: TokenService;
  rate: RateLimiter;
  worker: WebhookWorker;
  /** Key for signing pagination cursors. Derived from the signing secret. */
  cursorKey: string;
}

export interface HandlerCtx {
  op: Operation;
  services: Services;
  requestId: string;
  /** Null only for operations declared with `security: []`. */
  principal: Principal | null;
  /** Tenant scope for data access. Null only when principal is null. */
  scope: TenantScope | null;
  params: Record<string, any>;
  query: Record<string, any>;
  body: any;
  /** Lower-cased request headers. */
  headers: Record<string, string | undefined>;
  /** Records which resource this call acted on, for the audit log. */
  setAuditResource(type: string, id: string): void;
  /** For operations without a principal (the token endpoint): who to attribute the audit record to. */
  setAuditSubject(s: { tenantId: string; clientId: string; actor: { type: ActorType; id: string } }): void;
}

export type Handler = (ctx: HandlerCtx) => Promise<HandlerResult> | HandlerResult;
export type HandlerMap = Record<string, Handler>;

/** Non-null principal and scope, for operations that require auth. */
export function authed(ctx: HandlerCtx): { principal: Principal; scope: TenantScope } {
  if (!ctx.principal || !ctx.scope) throw new Error(`${ctx.op.operationId} ran without a principal`);
  return { principal: ctx.principal, scope: ctx.scope };
}
