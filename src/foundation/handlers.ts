import { auditToApi } from '../core/audit.js';
import { authed, type HandlerMap } from '../core/context.js';
import { E, type ErrorDetail } from '../core/errors.js';
import { eventToApi } from '../core/events.js';
import { paginate, parseSort } from '../core/pagination.js';
import type { DeliveryRec, EndpointRec } from '../core/store.js';
import { newId } from '../core/util.js';
import { newWebhookSecret, validateWebhookUrl } from '../core/webhooks.js';

const endpointToApi = (e: EndpointRec) => ({
  id: e.id,
  url: e.url,
  events: e.events,
  description: e.description,
  status: e.status,
  tenant_id: e.tenantId,
  created_at: e.createdAt,
});

const deliveryToApi = (d: DeliveryRec) => ({
  id: d.id,
  event_id: d.eventId,
  endpoint_id: d.endpointId,
  status: d.status,
  attempts: d.attempts.map((a) => ({ number: a.number, at: a.at, status_code: a.statusCode, error: a.error, duration_ms: a.durationMs })),
  next_attempt_at: d.nextAttemptAt,
  created_at: d.createdAt,
});

const after = (iso: string | undefined, t: string) => !iso || new Date(t) >= new Date(iso);
const before = (iso: string | undefined, t: string) => !iso || new Date(t) < new Date(iso);

export const foundationHandlers: HandlerMap = {
  // ---------------- Authentication ----------------
  createAccessToken: async (ctx) => {
    const { store, tokens, cfg } = ctx.services;
    const form = ctx.body as { grant_type: string; client_id?: string; client_secret?: string; scope?: string };
    let id = form.client_id;
    let secret = form.client_secret;
    const basic = /^Basic ([A-Za-z0-9+/=]+)$/.exec(ctx.headers.authorization ?? '');
    if (basic) {
      if (id || secret) throw E.oauth(400, 'invalid_request', 'Send client credentials either in the body or as HTTP Basic, not both.');
      const decoded = Buffer.from(basic[1]!, 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      id = i > 0 ? decoded.slice(0, i) : undefined;
      secret = i > 0 ? decoded.slice(i + 1) : undefined;
    }
    if (!id || !secret) throw E.oauth(401, 'invalid_client', 'Client authentication failed.');
    // A credential only works on its own environment's host.
    const client = id.startsWith(cfg.env === 'sandbox' ? 'mb_test_' : 'mb_live_') ? store.verifyClientSecret(id, secret) : null;
    if (!client) throw E.oauth(401, 'invalid_client', 'Client authentication failed.');

    let requested: string[] | null = null;
    if (form.scope !== undefined) {
      requested = form.scope.split(' ').filter(Boolean);
      const bad = requested.filter((s) => !client.scopes.includes(s));
      if (bad.length) throw E.oauth(400, 'invalid_scope', `Scope not allowed for this client: ${bad.join(' ')}.`);
    }
    const issued = await tokens.issue(client, requested);
    ctx.setAuditSubject({ tenantId: client.tenantId, clientId: client.clientId, actor: { type: client.actorType, id: client.clientId } });
    return {
      status: 200,
      headers: { Pragma: 'no-cache' },
      body: { access_token: issued.accessToken, token_type: 'Bearer', expires_in: issued.expiresIn, scope: issued.scopes.join(' ') },
    };
  },

  // ---------------- Tenancy ----------------
  getCurrentContext: (ctx) => {
    const { principal } = authed(ctx);
    return {
      status: 200,
      body: {
        client_id: principal.clientId,
        tenant: { id: principal.tenant.id, level: principal.tenant.level, parent_id: principal.tenant.parentId },
        scopes: principal.scopes,
        actor: { type: principal.actorType, id: principal.actorId, roles: principal.roles },
        environment: principal.env,
      },
    };
  },

  // ---------------- Audit ----------------
  listAuditEvents: (ctx) => {
    const { scope } = authed(ctx);
    const { store, cursorKey } = ctx.services;
    const q = ctx.query;
    if (q.tenant_id !== undefined && !scope.visible.has(q.tenant_id)) throw E.notFound('Tenant');
    const { dir } = parseSort(q.sort, '-occurred_at');
    const items = store.listAudit(scope).filter(
      (a) =>
        (q.tenant_id === undefined || a.tenantId === q.tenant_id) &&
        (q.action === undefined || a.action === q.action) &&
        (q.actor_type === undefined || a.actor.type === q.actor_type) &&
        (q.result === undefined || a.result === q.result) &&
        (q.resource_type === undefined || a.resource?.type === q.resource_type) &&
        (q.resource_id === undefined || a.resource?.id === q.resource_id) &&
        after(q.occurred_after, a.occurredAt) &&
        before(q.occurred_before, a.occurredAt),
    );
    const { limit, cursor, ...filters } = q;
    const page = paginate(items, {
      req: { limit, cursor },
      sortKey: (a) => a.occurredAt,
      id: (a) => a.id,
      dir,
      fingerprintInput: { op: 'audit', filters, scope: scope.tenantId },
      secret: cursorKey,
    });
    return { status: 200, body: { data: page.data.map(auditToApi), page: page.page } };
  },

  verifyAuditChain: (ctx) => {
    const { principal, scope } = authed(ctx);
    const tenantId = ctx.query.tenant_id ?? principal.tenant.id;
    if (!scope.visible.has(tenantId)) throw E.notFound('Tenant');
    const r = ctx.services.audit.verify(tenantId);
    return {
      status: 200,
      body: { tenant_id: r.tenantId, events_checked: r.eventsChecked, valid: r.valid, first_invalid_seq: r.firstInvalidSeq },
    };
  },

  // ---------------- Webhooks ----------------
  createWebhookEndpoint: (ctx) => {
    const { scope } = authed(ctx);
    const { store, spec, cfg, clock } = ctx.services;
    const b = ctx.body as { url: string; events: string[]; description?: string };
    const problems: ErrorDetail[] = validateWebhookUrl(b.url, cfg.allowHttpLoopbackWebhooks);
    b.events.forEach((t, i) => {
      if (t !== '*' && !spec.events.has(t)) problems.push({ field: `body.events.${i}`, code: 'unknown_event_type', message: `Unknown event type "${t}".` });
    });
    if (problems.length) throw E.validation(problems);
    const secret = newWebhookSecret();
    const rec = store.insertEndpoint(scope, {
      id: newId('whe'),
      url: b.url,
      events: b.events,
      description: b.description ?? null,
      status: 'active',
      secret,
      createdAt: clock.now().toISOString(),
    });
    ctx.setAuditResource('webhook_endpoint', rec.id);
    return { status: 201, body: { ...endpointToApi(rec), secret } };
  },

  listWebhookEndpoints: (ctx) => {
    const { scope } = authed(ctx);
    const { store, cursorKey } = ctx.services;
    const { limit, cursor, status } = ctx.query;
    const items = store.listEndpoints(scope).filter((e) => status === undefined || e.status === status);
    const page = paginate(items, {
      req: { limit, cursor },
      sortKey: (e) => e.createdAt,
      id: (e) => e.id,
      dir: 'asc',
      fingerprintInput: { op: 'endpoints', status, scope: scope.tenantId },
      secret: cursorKey,
    });
    return { status: 200, body: { data: page.data.map(endpointToApi), page: page.page } };
  },

  disableWebhookEndpoint: (ctx) => {
    const { scope } = authed(ctx);
    const { store } = ctx.services;
    const ep = store.getOwnedEndpoint(scope, ctx.params.endpoint_id);
    if (!ep) throw E.notFound('Webhook endpoint');
    ep.status = 'disabled';
    for (const d of store.allDeliveriesInternal()) {
      if (d.endpointId === ep.id && d.status === 'pending') {
        d.status = 'cancelled';
        d.nextAttemptAt = null;
      }
    }
    ctx.setAuditResource('webhook_endpoint', ep.id);
    return { status: 200, body: endpointToApi(ep) };
  },

  pingWebhookEndpoint: (ctx) => {
    const { scope, principal } = authed(ctx);
    const { store, events } = ctx.services;
    const ep = store.getOwnedEndpoint(scope, ctx.params.endpoint_id);
    if (!ep || ep.status !== 'active') throw E.notFound('Active webhook endpoint');
    const { event, deliveries } = events.emit(principal.tenant.id, 'webhook.ping', { endpoint_id: ep.id, message: 'ping' }, { onlyEndpointId: ep.id, ignoreSubscription: true });
    ctx.setAuditResource('webhook_endpoint', ep.id);
    return { status: 202, body: { event_id: event.id, delivery_id: deliveries[0]!.id } };
  },

  // ---------------- Events ----------------
  listEvents: (ctx) => {
    const { scope } = authed(ctx);
    const { store, cursorKey } = ctx.services;
    const q = ctx.query;
    const { dir } = parseSort(q.sort, '-created_at');
    const items = store
      .listEvents(scope)
      .filter((e) => (q.type === undefined || e.type === q.type) && after(q.created_after, e.createdAt) && before(q.created_before, e.createdAt));
    const { limit, cursor, ...filters } = q;
    const page = paginate(items, {
      req: { limit, cursor },
      sortKey: (e) => e.createdAt,
      id: (e) => e.id,
      dir,
      fingerprintInput: { op: 'events', filters, scope: scope.tenantId },
      secret: cursorKey,
    });
    return { status: 200, body: { data: page.data.map(eventToApi), page: page.page } };
  },

  replayEvent: (ctx) => {
    const { scope } = authed(ctx);
    const { events } = ctx.services;
    const endpointId = (ctx.body as { endpoint_id?: string } | undefined)?.endpoint_id;
    const deliveries = events.replay(scope, ctx.params.event_id, endpointId);
    if (!deliveries) throw E.notFound('Event');
    if (endpointId && deliveries.length === 0) throw E.notFound('Webhook endpoint for this event');
    ctx.setAuditResource('event', ctx.params.event_id);
    return { status: 202, body: { event_id: ctx.params.event_id, delivery_ids: deliveries.map((d) => d.id) } };
  },

  listWebhookDeliveries: (ctx) => {
    const { scope } = authed(ctx);
    const { store, cursorKey } = ctx.services;
    const q = ctx.query;
    const items = store
      .listDeliveries(scope)
      .filter((d) => (q.event_id === undefined || d.eventId === q.event_id) && (q.endpoint_id === undefined || d.endpointId === q.endpoint_id) && (q.status === undefined || d.status === q.status));
    const { limit, cursor, ...filters } = q;
    // Newest first, fixed.
    const page = paginate(items, {
      req: { limit, cursor },
      sortKey: (d) => d.createdAt,
      id: (d) => d.id,
      dir: 'desc',
      fingerprintInput: { op: 'deliveries', filters, scope: scope.tenantId },
      secret: cursorKey,
    });
    return { status: 200, body: { data: page.data.map(deliveryToApi), page: page.page } };
  },
};
