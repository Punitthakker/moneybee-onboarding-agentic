import Fastify, { type FastifyInstance } from 'fastify';
import { AuditLog } from './core/audit.js';
import type { Config } from './core/config.js';
import type { HandlerMap, Services } from './core/context.js';
import { ApiError, E } from './core/errors.js';
import { EventBus } from './core/events.js';
import { makeRouteHandler } from './core/pipeline.js';
import { RateLimiter } from './core/ratelimit.js';
import { loadSpec } from './core/spec.js';
import { MemoryStore } from './core/store.js';
import { TokenService, deriveKey } from './core/tokens.js';
import { type Clock, systemClock } from './core/util.js';
import { type Sender, WebhookWorker, fetchSender } from './core/webhooks.js';
import { foundationHandlers } from './foundation/handlers.js';
import { loadModules } from './modules/registry.js';
import type { ModuleDef } from './modules/types.js';

export interface BuildOptions {
  config: Config;
  clock?: Clock;
  sender?: Sender;
  logger?: boolean;
  /** Override the openapi directory. Used by tests of the scaffolder and deprecation headers. */
  openapiDir?: string;
}

export interface BuiltApp {
  app: FastifyInstance;
  services: Services;
  modules: ModuleDef[];
}

/** Path in the spec ({id}) to Fastify's syntax (:id). */
const toFastifyPath = (p: string) => p.replace(/\{([^}]+)\}/g, ':$1');

export async function buildApp(opts: BuildOptions): Promise<BuiltApp> {
  const cfg = opts.config;
  const clock = opts.clock ?? systemClock;
  const spec = loadSpec({ includeTemplate: cfg.includeTemplate, openapiDir: opts.openapiDir });
  const store = new MemoryStore();
  const services: Services = {
    cfg,
    clock,
    spec,
    store,
    audit: new AuditLog(store, clock),
    events: new EventBus(store, spec, cfg, clock),
    tokens: new TokenService(cfg, store, clock),
    rate: new RateLimiter(clock),
    worker: new WebhookWorker(store, cfg, clock, opts.sender ?? fetchSender),
    cursorKey: deriveKey(cfg.signingSecret, 'cursor-v1').toString('base64url'),
  };

  const modules = loadModules(services);
  const handlers: HandlerMap = { ...foundationHandlers };
  for (const m of modules) {
    for (const [id, h] of Object.entries(m.handlers)) {
      if (id in handlers) throw new Error(`Duplicate handler for operationId ${id} (module ${m.manifest.id})`);
      handlers[id] = h;
    }
  }

  // The spec and the code must describe the same API. Fail at boot, not in production.
  const opIds = new Set(spec.ops.map((o) => o.operationId));
  for (const id of Object.keys(handlers)) if (!opIds.has(id)) throw new Error(`Handler "${id}" has no operation in the spec`);
  for (const op of spec.ops) {
    if (!handlers[op.operationId]) throw new Error(`Operation "${op.operationId}" has no handler`);
    for (const sc of op.requiredScopes) if (!spec.scopes.has(sc)) throw new Error(`${op.operationId} requires unknown scope "${sc}"`);
    for (const p of spec.validatorsFor(op).params) {
      if (p.in === 'header' && p.name !== 'Idempotency-Key') throw new Error(`${op.operationId}: header parameter "${p.name}" is not supported by the pipeline yet`);
    }
  }

  const app = Fastify({
    logger: opts.logger
      ? { level: 'info', redact: { paths: ['req.headers.authorization', 'req.headers["idempotency-key"]'], remove: true } }
      : false,
    bodyLimit: 1_048_576,
    trustProxy: false,
  });

  // Our own parsers: JSON that tolerates an empty body, and form bodies for the token endpoint.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = body as string;
    if (!text) return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(E.invalidJson(), undefined);
    }
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  const log = {
    info: (o: object, m?: string) => app.log.info(o, m),
    warn: (o: object, m?: string) => app.log.warn(o, m),
    error: (o: object, m?: string) => app.log.error(o, m),
  };

  for (const op of spec.ops) {
    app.route({
      method: op.method.toUpperCase() as 'GET',
      url: spec.basePath + toFastifyPath(op.path),
      handler: makeRouteHandler(op, { services, handlers, log }),
    });
  }

  const standalone = (reply: any, req: any, e: ApiError) => {
    const requestId = typeof req.headers['x-request-id'] === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(req.headers['x-request-id']) ? req.headers['x-request-id'] : `req_${Math.random().toString(36).slice(2, 14)}`;
    reply.header('X-Request-Id', requestId).header('Cache-Control', 'no-store');
    for (const [k, v] of Object.entries(e.headers)) reply.header(k, v);
    return reply.status(e.status).type('application/json; charset=utf-8').send({
      error: { code: e.code, message: e.message, request_id: requestId, doc_url: `${cfg.docsBaseUrl}/errors/${e.code}`, ...(e.details?.length ? { details: e.details } : {}) },
    });
  };

  app.setNotFoundHandler((req, reply) => standalone(reply, req, E.notFound('Route')));
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ApiError) return standalone(reply, req, err);
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return standalone(reply, req, E.unsupportedMediaType(['application/json']));
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return standalone(reply, req, E.invalidRequest('The request body is too large.'));
    app.log.error({ err: err?.message }, 'unhandled error outside pipeline');
    return standalone(reply, req, E.internal());
  });

  return { app, services, modules };
}
