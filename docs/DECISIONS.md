# Decisions, assumptions and open points

Status key: **Decided** (taken as approved), **Assumed** (needs your confirmation), **Open** (not decided).

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | TypeScript on Node 22, Fastify 5, Ajv 2020-12. No FastAPI | The existing onboarding and checkout services are Node; one language for the gateway, SDK and MCP server |
| D2 | Spec first. Server routes, validation and response checks are built from the spec | The spec cannot drift from the behaviour |
| D3 | Sandbox is a stateful server, not a static mock | Idempotency, webhooks, pagination and state transitions cannot be mocked statically |
| D4 | Persistence target is PostgreSQL with row-level security | Matches checkout; RLS gives a second tenancy wall |
| D5 | Marble (AML) is reference only; Module B is built natively | Elastic License 2.0 limits offering it as a managed service |
| D6 | QSS stays in Go behind the gateway | Crypto code stays where it is and gets independent review |
| D7 | Decision-recording operations are human-only, enforced in the pipeline | Agents prepare, humans decide, with a reason code |

## Assumptions (approved by Punit on 24 Oct 2026; still unverified against the real platform)

| # | Assumption | Impact if wrong |
|---|---|---|
| A1 | Tenants are platform, partner, merchant, and a caller sees its subtree. The repos contain no tenant hierarchy or auth platform | Tenancy model, `tenants.path`, scope levels and the token claims change |
| A2 | Credentials are OAuth2 client credentials, optionally narrowed by scope. Human reviewers appear as `user` clients with roles | Needs mapping to the real identity provider and role source |
| A3 | A 12-month deprecation notice is acceptable | Contract and partner commitments |
| A4 | Placeholder hosts (`docs.moneybee.example` and others) | Replace before publishing |
| A5 | Sandbox limits (120 requests a minute, 24 hour idempotency, one hour tokens) are defaults | Live limits are a commercial decision |

## Further decisions (24 Oct 2026, taken by the CTO under delegation; full text in the design review document)

| # | Decision |
|---|---|
| D8 | Build order: harden the foundation (Postgres store, approvals resource, `x-denied-actors`, multipart upload, ES256 with JWKS, 410 after sunset), then Onboarding, Compliance, QSS, stopping after each |
| D9 | Two-person approval is one shared `approvals` resource used by high-risk onboarding approval, rule activation and report filing |
| D10 | Reducing authority (revoking a token or mandate) is never gated; granting or destroying authority is human only |
| D11 | Money is an integer in minor units plus an ISO 4217 code |
| D12 | Slow work (analysis, backtests, exports) is a resource with a status and a webhook, not a long request |
| D13 | Proposed hosts: `api.moneybee.world` and `sandbox.api.moneybee.world` (domain ownership to be confirmed) |
| D14 | The open sandbox accepts synthetic card numbers only; any live card-data path is a separate PCI-scoped deployment (open question for Punit) |
| D15 | The goAML export is goAML-formatted for human review and is never submitted by the API; no validator claim until checked against the official schema |
| D16 | MCP exposes 18 tools: reads, reversible preparation, and mandate-bound payment authorisation. Decision-recording operations are never exposed |

The operation list is in `docs/API_SURFACE.md` (65 operations: 11 built, 54 designed).

## Known gaps in this phase

| Gap | Note |
|---|---|
| PostgreSQL store is not wired to the application | Schema and RLS exist and are verified in isolation (`db/verify.sh`) |
| Token signing is HS256 | Move to asymmetric signing with key rotation and a JWKS endpoint before live |
| Rate limiter is in memory | Single replica only |
| Webhook secrets are stored in clear in memory | Column is `secret_ciphertext`; KMS integration not built |
| Audit hash is SHA-256 with no algorithm field | Add algorithm agility when QSS signatures are applied to audit exports |
| No load, soak or chaos testing | Sandbox correctness only |
| Concurrency on the audit chain is serialised by an advisory lock, tested only for shape | Needs a concurrent-writer test on real PostgreSQL |
| Static analysis, dependency audit and secret scanning are not in CI | Add before the repository is shared |

## For independent review later

- Token design and key management
- Webhook signature scheme (HMAC today; QSS may add a post-quantum signature)
- Audit chain and any WORM export
- Anything in Module C. Written by Claude, not reviewed by a cryptographer. **Do not ship QSS code without independent crypto review.**

## Not done on purpose

Static mock (Prism), Postman collection, TypeScript SDK, getting-started guide, MCP server. They come after the modules,
so they are built once from the final spec.

## D17 - Stripe-style conventions (2026-10-24)
Adopt prefixed ids, `object`, `livemode`, `metadata`, `expand[]`, `has_more` lists with `starting_after`/`ending_before`,
error `type` and `param`, and `data.object` in events. Keep JSON bodies, ISO timestamps, OAuth plus tenant, and human-only
decisions. Contract: `openapi/design/moneybee.stripe-style.yaml`. Foundation migration is step 1 of hardening. Restricted
API keys (`mb_rk_*`) are planned, not designed in detail.
