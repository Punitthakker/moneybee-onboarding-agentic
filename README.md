# MoneyBee Open API

Spec-first, multi-tenant API foundation for the MoneyBee white-label payment platform. This repository holds the
**Foundation** (auth, tenancy, audit, webhooks, events, errors, pagination, idempotency) and the **module pattern**
that Onboarding (A), Compliance (B) and Quantum-safe cards (C) plug into.

Status: foundation built and tested against an in-memory store. Nothing here is certified or production-ready.
All hostnames ending in `.moneybee.example` are placeholders. Rate limits and windows are sandbox defaults.

## Run it

```bash
npm install
cp .env.example .env            # then set MB_SIGNING_SECRET (32+ characters)
npm start                       # sandbox on :8080, keys written to .sandbox-keys.json (git-ignored)
bash examples/first-call.sh     # token, /me, webhook registration, ping, replay, errors, audit verification
```

Requires Node 22.9 or newer. `npm run dev` restarts on change.

## Commands

| Command | What it does |
|---|---|
| `npm run ci` | typecheck, Spectral lint, breaking-change check, all tests |
| `npm test` | tests only |
| `npm run spec:bundle` | merges `openapi/` into `dist/openapi.bundled.{json,yaml}` |
| `npm run lint:spec` | Spectral with the house rules in `.spectral.yaml` |
| `npm run spec:breaking` | compares the bundle to `openapi/baseline/` and fails on breaking changes |
| `npm run spec:baseline` | accepts the current spec as the new baseline (after a deliberate version bump) |
| `npm run new:module -- <id> <resource> <plural> [prefix]` | scaffolds a module from the template |
| `bash db/verify.sh` | boots a throwaway PostgreSQL, applies `db/001_foundation.sql`, runs 65 isolation and audit checks |

## Layout

```
openapi/openapi.yaml        Foundation spec (the source of truth)
openapi/modules/*.yaml      One fragment per module; files starting with _ are not shipped
openapi/baseline/           Last accepted bundle, used by the breaking-change check
src/core/                   Pipeline, spec loader, store, audit, tokens, webhooks, pagination, rate limit
src/foundation/handlers.ts  Handlers for the foundation operations
src/modules/                Module registry and the template module
src/sandbox.ts              Synthetic tenants and credentials (sandbox only)
db/                         PostgreSQL schema with row-level security, and its verification
docs/                       ARCHITECTURE, MODULE_PATTERN, DEPRECATION, DECISIONS
test/                       Contract, tenancy, idempotency, webhook, audit, module and tooling tests
```

## Sandbox tenants

`npm start` creates a synthetic tree: one platform, two partners, three merchants, plus a reviewer (human user) and
an agent client under partner A. Keys are in `.sandbox-keys.json`. Production processes (`MB_ENV` other than
`sandbox`) create none of this.

Start with `docs/ARCHITECTURE.md`, then `docs/DECISIONS.md` for what was assumed.
