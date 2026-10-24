# Architecture

## One rule

The OpenAPI document is the contract and the code is generated around it. Routes, request validation, response
validation, scopes, idempotency requirements and error shapes all come from the spec. The server refuses to boot if
an `operationId` has no handler, a handler has no operation, or an operation requires an unknown scope.

## Request pipeline

Every operation runs the same steps in this order. A request stops at the first step that fails.

| # | Step | Failure |
|---|---|---|
| 1 | API version header (`MoneyBee-Version`, default is the only supported version) | 400 `unsupported_version` |
| 2 | Bearer token check (HS256 JWT in the sandbox), client re-checked as active | 401 `unauthenticated` |
| 3 | Rate limit, token bucket per client (per source address on `/oauth/token`) | 429 `rate_limited` |
| 4 | Authorisation: scope, human actor (`x-required-actor`), role (`x-required-roles`) | 403, recorded as `denied` |
| 5 | Sandbox force-error header (authenticated sandbox callers only) | the requested error |
| 6 | Path, query and body validation. Unknown parameters and fields are rejected | 422 `validation_failed` with field details |
| 7 | Idempotency (state-changing calls): store, replay, conflict, in-progress | 400, 409 |
| 8 | Handler | handler errors |
| 9 | Response validation against the spec (`off`, `warn`, `strict`; tests run `strict`) | 500 `contract_violation` |
| 10 | Audit record | |

Pipeline errors, 5xx and 429 are never stored for idempotent replay. Handler 4xx answers and successes are.

## Tenancy

Platform, partner, merchant. The tenant comes only from the credential. A caller sees its own tenant and the tenants
below it, and changes only its own rows. Anything else is "not found", never "forbidden", so existence does not leak.

Every store call takes a `TenantScope`. There is no way to read tenant data without one. In PostgreSQL the same rule
is row-level security (`db/001_foundation.sql`), proven by `db/verify.sh`. RLS is a second wall: the application sets
`mb.tenant_id` itself, so it limits mistakes, not a compromised application.

## Audit

One append-only hash chain per tenant. Each record carries the SHA-256 of its canonical JSON and the previous hash.
`GET /audit-events/verification` recomputes the chain and names the first broken sequence number. In PostgreSQL the
database also refuses gaps, forks, updates, deletes and truncates, including for the owner.
Denied attempts (403) are recorded. Rate-limited requests (429) are not, to keep an attacker from filling the log.

## Webhooks and events

- Signature: `MoneyBee-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`, 300 second tolerance.
- Delivery: at least once. Retry schedule 0, 30 s, 2 min, 10 min, 1 h, 6 h with 20 percent jitter; six attempts, then `failed`.
- Redirects are not followed and count as failure. Endpoint URLs are checked against SSRF (https only, no private, loopback or link-local targets; loopback http only in the sandbox).
- A partner endpoint receives events of its own tenant and of every tenant below it.
- Events can be replayed to all endpoints or to one.
- Secrets are returned once, at creation.

## Pagination, errors, idempotency

- Keyset pagination, HMAC-signed cursors bound to the filter and sort. `limit` 1 to 100, default 25. Stable under inserts.
- Error envelope `{error: {code, message, request_id, doc_url, details[]}}`. The token endpoint uses RFC 6749 errors.
- `Idempotency-Key` is required on every state-changing call. Window 24 hours, scoped per tenant and client.
  Same key and same request replays the answer (`Idempotent-Replayed: true`); same key and different request is 409.

## What is different in live

| Concern | Sandbox (this repo) | Live (not built) |
|---|---|---|
| Store | in memory | PostgreSQL with RLS (`db/001_foundation.sql`, not wired yet) |
| Token signing | HS256 shared secret | asymmetric keys with rotation and a JWKS endpoint |
| Rate limiter | in memory, one replica | shared store (Redis) |
| Webhook secrets | plain in memory | encrypted with a KMS data key |
| Audit retention | process memory | database plus WORM export |
| Credentials | seeded synthetic tenants | provisioned by the existing platform auth |
