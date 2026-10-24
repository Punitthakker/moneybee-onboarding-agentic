import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorObject } from 'ajv';
import type { HandlerCtx, HandlerMap, Services } from './context.js';
import { ApiError, E, type ErrorDetail } from './errors.js';
import type { HandlerResult, Operation, Principal } from './types.js';
import { canonicalJson, sha256Hex } from './util.js';
import { scopeFor } from './store.js';

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

/** Errors thrown by a handler (as opposed to the pipeline). Only these are stored for idempotent replay. */
const handlerErrors = new WeakSet<ApiError>();
/** Thrown internally to leave the pipeline after preparing a replayed response. Never escapes. */
const REPLAY = Symbol('idempotent-replay');
const FORCE_ERROR_HEADER = 'moneybee-sandbox-force-error';

function pickRequestId(h: unknown): string {
  return typeof h === 'string' && REQUEST_ID_RE.test(h) ? h : `req_${randomBytes(12).toString('base64url')}`;
}

/** Turns Ajv errors into field-level details with stable codes. */
export function toDetails(where: 'body' | 'query' | 'path' | 'header', errors: ErrorObject[] | null | undefined): ErrorDetail[] {
  const out: ErrorDetail[] = [];
  for (const e of errors ?? []) {
    let path = e.instancePath
      .split('/')
      .slice(1)
      .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
      .join('.');
    let code: string = e.keyword;
    let message = e.message ?? 'Invalid value.';
    if (e.keyword === 'required') {
      path = [path, (e.params as any).missingProperty].filter(Boolean).join('.');
      message = 'Required.';
    } else if (e.keyword === 'additionalProperties') {
      path = [path, (e.params as any).additionalProperty].filter(Boolean).join('.');
      code = 'unknown_field';
      message = where === 'body' ? 'Unknown field.' : 'Unknown parameter.';
    } else if (e.keyword === 'enum') {
      message = `Must be one of: ${((e.params as any).allowedValues as unknown[]).join(', ')}.`;
    }
    out.push({ field: [where, path].filter(Boolean).join('.'), code, message });
  }
  return out;
}

function oauthDescription(details: ErrorDetail[] | undefined, fallback: string) {
  return details?.length ? details.map((d) => `${d.field}: ${d.message}`).join('; ') : fallback;
}

export interface PipelineDeps {
  services: Services;
  handlers: HandlerMap;
  log: { info(o: object, m?: string): void; warn(o: object, m?: string): void; error(o: object, m?: string): void };
}

/**
 * The one request pipeline every operation runs through. Order matters:
 * version, authentication, rate limit, authorisation (scope, actor, role), sandbox error injection,
 * input validation, idempotency, handler, response validation, audit.
 */
export function makeRouteHandler(op: Operation, deps: PipelineDeps) {
  const { services: s, handlers, log } = deps;
  const handler = handlers[op.operationId];
  if (!handler) throw new Error(`No handler registered for operationId ${op.operationId}`);
  const validators = s.spec.validatorsFor(op);
  const oauthFormat = op.raw['x-error-format'] === 'oauth';

  return async function route(req: FastifyRequest, reply: FastifyReply) {
    const t0 = performance.now();
    const requestId = pickRequestId(req.headers['x-request-id']);
    const headers = req.headers as Record<string, string | undefined>;
    const appliedVersion = (headers['moneybee-version'] as string | undefined) ?? s.cfg.supportedVersions[0]!;
    const out: Record<string, string> = {
      'X-Request-Id': requestId,
      'MoneyBee-Version': appliedVersion,
      'Cache-Control': 'no-store',
    };
    if (op.deprecated) {
      out.Deprecation = 'true';
      if (op.sunset) out.Sunset = new Date(op.sunset).toUTCString();
    }

    let principal: Principal | null = null;
    let resource: { type: string; id: string } | null = null;
    let subject: Parameters<HandlerCtx['setAuditSubject']>[0] | null = null;
    let idemKey: string | null = null;
    let replayed = false;
    let rateLimited = false;
    let status = 500;
    let errorCode: string | null = null;
    let sendBody: unknown;

    const send = () => {
      for (const [k, v] of Object.entries(out)) reply.header(k, v);
      return reply.status(status).type('application/json; charset=utf-8').send(sendBody === undefined ? '' : JSON.stringify(sendBody));
    };

    const render = (err: ApiError) => {
      let e = err;
      // The token endpoint speaks RFC 6749 for everything except rate limiting and server errors.
      if (oauthFormat && e.format === 'envelope' && e.status < 500 && e.status !== 429) {
        e = E.oauth(400, 'invalid_request', oauthDescription(e.details, e.message));
      }
      status = e.status;
      errorCode = e.code;
      Object.assign(out, e.headers);
      if (e.format === 'oauth') {
        sendBody = { error: e.code, error_description: e.message, request_id: requestId };
      } else {
        sendBody = {
          error: {
            code: e.code,
            message: e.message,
            request_id: requestId,
            doc_url: `${s.cfg.docsBaseUrl}/errors/${e.code}`,
            ...(e.details?.length ? { details: e.details } : {}),
          },
        };
      }
    };

    try {
      // 1. Version
      if (headers['moneybee-version'] && !s.cfg.supportedVersions.includes(appliedVersion)) throw E.unsupportedVersion(appliedVersion);

      // 2. Authentication. Tenant context comes from the credential and nothing else.
      if (op.requiresAuth) {
        const m = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(headers.authorization ?? '');
        if (!m) throw E.unauthenticated();
        principal = await s.tokens.verify(m[1]!);
      }

      // 3. Rate limit, per credential (or per address for unauthenticated calls)
      const key = principal ? `c:${principal.clientId}` : `ip:${req.ip}`;
      const limit = principal ? s.cfg.rateLimitPerMin : s.cfg.tokenRateLimitPerMin;
      const rl = s.rate.take(`${op.requiresAuth ? 'api' : 'auth'}|${key}`, limit);
      out['RateLimit-Limit'] = String(rl.limit);
      out['RateLimit-Remaining'] = String(rl.remaining);
      out['RateLimit-Reset'] = String(rl.resetSeconds);
      if (!rl.allowed) {
        rateLimited = true;
        throw E.rateLimited(rl.retryAfterSeconds);
      }

      // 4. Authorisation
      if (principal) {
        const missing = op.requiredScopes.filter((sc) => !principal!.scopes.includes(sc));
        if (missing.length) throw E.insufficientScope(missing);
        if (op.requiredActor && principal.actorType !== op.requiredActor) throw E.humanActorRequired();
        if (op.requiredRoles.length && !op.requiredRoles.some((r) => principal!.roles.includes(r))) throw E.roleRequired(op.requiredRoles);
      }

      // 5. Sandbox error injection, for testing client error handling. Only for authenticated sandbox callers.
      const forced = headers[FORCE_ERROR_HEADER];
      if (forced && principal && s.cfg.env === 'sandbox') {
        const def = s.spec.errors[forced];
        if (!def) throw E.invalidRequest(`Unknown error code in ${FORCE_ERROR_HEADER}.`);
        throw new ApiError(def.status, forced, `Forced by ${FORCE_ERROR_HEADER} (sandbox only).`, undefined, def.status === 429 ? { 'Retry-After': '1' } : {});
      }

      // 6. Input validation against the spec
      const params = { ...(req.params as Record<string, unknown>) };
      if (!validators.path(params)) throw E.validation(toDetails('path', validators.path.errors));
      const query = { ...(req.query as Record<string, unknown>) };
      if (!validators.query(query)) throw E.validation(toDetails('query', validators.query.errors));

      let body: unknown = undefined;
      if (validators.contentTypes.length) {
        const ct = (headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
        const raw = req.body;
        if (raw === undefined || raw === null || raw === '') {
          if (validators.bodyRequired) throw E.validation([{ field: 'body', code: 'required', message: 'A request body is required.' }]);
        } else {
          if (!validators.contentTypes.includes(ct)) throw E.unsupportedMediaType(validators.contentTypes);
          body = raw;
          const v = validators.bodies.get(ct)!;
          if (!v(body)) throw E.validation(toDetails('body', v.errors));
        }
      }

      // 7. Idempotency
      if (op.idempotent) {
        const rawKey = headers['idempotency-key'];
        if (!rawKey) throw E.idempotencyKeyMissing();
        const keyParam = validators.params.find((p) => p.in === 'header' && p.name === 'Idempotency-Key');
        if (keyParam && !/^[A-Za-z0-9._:-]{8,255}$/.test(rawKey)) {
          throw E.validation([{ field: 'header.Idempotency-Key', code: 'pattern', message: 'Must be 8 to 255 characters of A-Za-z0-9._:-' }]);
        }
        const fingerprint = sha256Hex(canonicalJson({ m: op.method, p: op.path, params, query, body }));
        idemKey = s.store.idemKey(principal!.tenant.id, principal!.clientId, rawKey);
        const now = s.clock.now().getTime();
        const existing = s.store.getIdem(idemKey, now);
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            idemKey = null;
            throw E.idempotencyConflict();
          }
          if (existing.state === 'in_progress' || !existing.response) {
            idemKey = null;
            throw E.idempotencyInProgress();
          }
          replayed = true;
          status = existing.response.status;
          sendBody = existing.response.body;
          Object.assign(out, existing.response.headers, { 'Idempotent-Replayed': 'true' });
          idemKey = null;
          throw REPLAY; // response is ready; skip the handler but still audit below
        }
        s.store.putIdem(idemKey, { fingerprint, state: 'in_progress', expiresAt: now + s.cfg.idempotencyWindowMs });
        (req as any).__fp = fingerprint;
      }

      // 8. Handler
      const ctx: HandlerCtx = {
        op,
        services: s,
        requestId,
        principal,
        scope: principal ? scopeFor(s.store, principal.tenant.id) : null,
        params,
        query,
        body,
        headers,
        setAuditResource: (type, id) => {
          resource = { type, id };
        },
        setAuditSubject: (x) => {
          subject = x;
        },
      };
      let result: HandlerResult;
      try {
        result = await handler(ctx);
      } catch (e) {
        // A 4xx raised by the handler is a business answer, so it is stored for idempotent replay.
        if (e instanceof ApiError && e.status < 500) handlerErrors.add(e);
        throw e;
      }

      // 9. Response validation against the spec
      if (s.cfg.responseValidation !== 'off') {
        const v = validators.response(result.status);
        const problem = v === undefined ? `status ${result.status} is not declared` : v && !v(result.body) ? JSON.stringify(v.errors) : null;
        if (problem) {
          log.error({ requestId, op: op.operationId, problem }, 'response does not match spec');
          if (s.cfg.responseValidation === 'strict') throw E.contractViolation();
        }
      }

      status = result.status;
      sendBody = result.body;
      Object.assign(out, result.headers ?? {});
      if (idemKey) {
        s.store.putIdem(idemKey, {
          fingerprint: (req as any).__fp,
          state: 'done',
          expiresAt: s.clock.now().getTime() + s.cfg.idempotencyWindowMs,
          response: { status, body: sendBody, headers: { ...(result.headers ?? {}) } },
        });
        idemKey = null;
      }
    } catch (err) {
      const api = err instanceof ApiError ? err : null;
      if (err !== REPLAY) {
        if (!api) log.error({ requestId, op: op.operationId, err: err instanceof Error ? err.message : 'unknown' }, 'unhandled error');
        render(api ?? E.internal());
      }
      if (err !== REPLAY && idemKey) {
        // Business errors from the handler (4xx) are remembered so a retry sees the same answer.
        // Pipeline errors and 5xx are not: the client may fix the request or try again.
        if (api !== null && handlerErrors.has(api)) {
          s.store.putIdem(idemKey, {
            fingerprint: (req as any).__fp,
            state: 'done',
            expiresAt: s.clock.now().getTime() + s.cfg.idempotencyWindowMs,
            response: { status, body: sendBody, headers: {} },
          });
        } else {
          s.store.deleteIdem(idemKey);
        }
      }
    }

    // Audit every authenticated action, including refusals. Rate-limited calls are not actions and are not recorded.
    const subj = principal
      ? { tenantId: principal.tenant.id, clientId: principal.clientId, actor: { type: principal.actorType, id: principal.actorId } }
      : (subject as Parameters<HandlerCtx['setAuditSubject']>[0] | null);
    if (subj && !rateLimited) {
      s.audit.record({
        tenantId: subj.tenantId,
        actor: subj.actor,
        clientId: subj.clientId,
        action: op.operationId,
        method: op.method.toUpperCase(),
        path: req.url.split('?')[0]!,
        resource,
        scopesUsed: op.requiredScopes,
        result: status < 400 ? 'success' : status === 403 ? 'denied' : 'error',
        status,
        errorCode,
        requestId,
        idempotentReplay: replayed,
      });
    }
    log.info({ requestId, op: op.operationId, status, client: principal?.clientId, ms: Math.round(performance.now() - t0) }, 'request');
    return send();
  };
}
