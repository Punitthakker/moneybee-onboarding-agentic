# Adding a module

A module is three things that must agree: a spec fragment, a factory with handlers, and a test file. A conformance
test fails if they drift apart.

## Steps

1. `npm run new:module -- <id> <resource> <plural> [id-prefix]`
   (example: `npm run new:module -- onboarding application applications app`). It copies the template, renames it,
   and registers the factory in `src/modules/registry.ts`.
2. Edit `openapi/modules/<id>.yaml`: real fields, scopes, events, error codes.
3. Edit `src/modules/<id>/index.ts`: implement every operation; keep `manifest` in sync with the fragment.
4. Edit `test/modules/<id>.test.ts`: replace the placeholder payload with a valid body for the resource.
5. `npm run ci`. Lint, conformance and tests must pass.
6. When the change is additive, nothing else. When it is breaking, see `DEPRECATION.md`.

## Rules every operation follows

| Rule | Enforced by |
|---|---|
| `x-mcp-risk` declared: `read`, `write`, `money-moving`, `decision-recording` | Spectral |
| Reads are `read`; decision-recording is human-only (`x-required-actor: user` and `x-required-roles`) | Spectral, conformance |
| Scopes declared in `x-scope-catalogue` with the levels that may hold them | Spectral, boot check, provisioning |
| Scope names start with the module id, e.g. `onboarding:applications.read` | conformance |
| State-changing calls take `Idempotency-Key` | Spectral |
| Lists use `limit` and `cursor` | Spectral |
| Free text from outside is marked `x-untrusted: true` and treated as data, never as instructions to an agent | Spectral |
| Webhook events carry `x-event-version` | Spectral |
| Errors use the shared envelope | Spectral |
| Every store call takes a `TenantScope` | code structure, tenancy tests |
| A decision records a reason code and the deciding human | module tests |

## Agent-specific rules

- An agent client can prepare work (draft, score, summarise) but cannot record a decision. The pipeline rejects it
  with `human_actor_required` before the handler runs.
- Anything an agent reads from a user or counterparty is `x-untrusted`. Do not put it in a field an agent treats as
  an instruction.
- `x-mcp-risk` is what the future MCP server uses to decide which tools an agent may call without a human.

## Sandbox behaviour

Magic inputs that trigger documented sandbox outcomes are listed in `manifest.sandboxBehaviours` and must never change
live behaviour. They are guarded by `MB_ENV`.
