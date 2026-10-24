import { authed } from '../../core/context.js';
import { ApiError, E } from '../../core/errors.js';
import { paginate, parseSort } from '../../core/pagination.js';
import { newId } from '../../core/util.js';
import type { ModuleDef, ModuleFactory } from '../types.js';

interface ExampleRec {
  id: string;
  tenantId: string;
  name: string;
  amountMinor: number;
  currency: string;
  flagged: boolean;
  status: 'pending' | 'approved' | 'declined';
  decision: null | {
    outcome: 'approve' | 'decline';
    reasonCode: string;
    note: string | null;
    decidedBy: { type: 'user' | 'service' | 'agent'; id: string };
    decidedAt: string;
  };
  createdAt: string;
}

const toApi = (r: ExampleRec) => ({
  id: r.id,
  tenant_id: r.tenantId,
  name: r.name,
  amount_minor: r.amountMinor,
  currency: r.currency,
  flagged: r.flagged,
  status: r.status,
  decision: r.decision
    ? {
        outcome: r.decision.outcome,
        reason_code: r.decision.reasonCode,
        note: r.decision.note,
        decided_by: r.decision.decidedBy,
        decided_at: r.decision.decidedAt,
      }
    : null,
  created_at: r.createdAt,
});

/**
 * THE MODULE PATTERN. Every module is a factory that takes the shared services and returns a manifest plus one
 * handler per operationId. Rules a module follows:
 *  1. Own tenant comes from ctx.principal, never from the body or query.
 *  2. Reads go through ctx.scope.visible. Writes record the caller's own tenant.
 *  3. Unknown or foreign resources return not_found, never forbidden, so existence does not leak.
 *  4. State changes emit events through services.events and name the audit resource with ctx.setAuditResource.
 *  5. Decision-recording operations are declared human-only in the spec; the pipeline enforces it.
 *  6. Persistence sits behind a small repository. This template keeps a Map; real modules use Postgres with row-level security.
 */
export const createTemplateModule: ModuleFactory = (services): ModuleDef => {
  const rows = new Map<string, ExampleRec>();
  const visible = (scopeIds: ReadonlySet<string>, r: ExampleRec) => scopeIds.has(r.tenantId);

  return {
    manifest: {
      id: 'template',
      tag: 'Template',
      scopes: ['template:examples.read', 'template:examples.write', 'template:examples.decide'],
      events: ['example.created', 'example.decided'],
      errorCodes: ['example_already_decided'],
      sandboxBehaviours: [{ id: 'name-sandbox-flag', description: 'A name of SANDBOX_FLAG sets flagged to true on creation.' }],
    },
    handlers: {
      createExample: (ctx) => {
        const { principal } = authed(ctx);
        const b = ctx.body as { name: string; amount_minor: number; currency: string };
        const rec: ExampleRec = {
          id: newId('ex'),
          tenantId: principal.tenant.id,
          name: b.name,
          amountMinor: b.amount_minor,
          currency: b.currency,
          flagged: b.name === 'SANDBOX_FLAG',
          status: 'pending',
          decision: null,
          createdAt: services.clock.now().toISOString(),
        };
        rows.set(rec.id, rec);
        services.events.emit(rec.tenantId, 'example.created', { example_id: rec.id, flagged: rec.flagged });
        ctx.setAuditResource('example', rec.id);
        return { status: 201, body: toApi(rec) };
      },

      listExamples: (ctx) => {
        const { scope } = authed(ctx);
        const { limit, cursor, sort, status } = ctx.query;
        const { dir } = parseSort(sort, '-created_at');
        const items = [...rows.values()].filter((r) => visible(scope.visible, r) && (status === undefined || r.status === status));
        const page = paginate(items, {
          req: { limit, cursor },
          sortKey: (r) => r.createdAt,
          id: (r) => r.id,
          dir,
          fingerprintInput: { op: 'examples', sort, status, scope: scope.tenantId },
          secret: services.cursorKey,
        });
        return { status: 200, body: { data: page.data.map(toApi), page: page.page } };
      },

      getExample: (ctx) => {
        const { scope } = authed(ctx);
        const r = rows.get(ctx.params.example_id);
        if (!r || !visible(scope.visible, r)) throw E.notFound('Example');
        return { status: 200, body: toApi(r) };
      },

      decideExample: (ctx) => {
        const { scope, principal } = authed(ctx);
        const r = rows.get(ctx.params.example_id);
        if (!r || !visible(scope.visible, r)) throw E.notFound('Example');
        if (r.decision) throw new ApiError(409, 'example_already_decided', 'A decision was already recorded on this example.');
        const b = ctx.body as { outcome: 'approve' | 'decline'; reason_code: string; note?: string };
        r.decision = {
          outcome: b.outcome,
          reasonCode: b.reason_code,
          note: b.note ?? null,
          decidedBy: { type: principal.actorType, id: principal.actorId },
          decidedAt: services.clock.now().toISOString(),
        };
        r.status = b.outcome === 'approve' ? 'approved' : 'declined';
        services.events.emit(r.tenantId, 'example.decided', { example_id: r.id, outcome: b.outcome, reason_code: b.reason_code });
        ctx.setAuditResource('example', r.id);
        return { status: 200, body: toApi(r) };
      },
    },
  };
};
