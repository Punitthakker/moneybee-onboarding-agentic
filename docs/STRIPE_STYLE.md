# Stripe-style contract (design, 2026-10-24)

`openapi/design/moneybee.stripe-style.yaml` is the target contract for all 65 operations and 24 webhook events.
It is generated, not hand-edited: the generator is kept with the review tooling and reads the API surface table.
Lint it with `npx spectral lint openapi/design/moneybee.stripe-style.yaml -r .spectral.design.yaml`
(same house rules as the live spec; only pagination differs: `starting_after` instead of `cursor`).

Build the reference: `npx @redocly/cli build-docs openapi/design/moneybee.stripe-style.yaml -o reference.html`

## Adopted
| Convention | Rule |
|---|---|
| Ids | Prefixed by type, e.g. `alt_`, `cas_`, `mnd_`. |
| Every object | `id`, `object`, `livemode`, `created_at`; `metadata` where users create the object. |
| Lists | `{object:"list", data, has_more, url}`; `limit` 1-100; `starting_after`, `ending_before`. |
| Related objects | Ids by default, `expand[]` to inline. |
| Errors | `{error:{type, code, message, param, request_id, doc_url, details[]}}`. |
| Events | `data.object` holds the resource at event time. Signature `t=,v1=` unchanged. |
| Deletes | `{id, object, deleted:true}`. |

## Kept different, on purpose
JSON bodies (nesting), ISO 8601 times (audit readability), OAuth client credentials with a tenant behind each
credential (partners manage merchants), human-only decisions (the product).

## What changes in the built foundation (not yet done)
1. Prefixed ids and `object` on every resource. 2. List envelope and params. 3. Event shape with `data.object`.
4. Error `type` and `param`. 5. Audit and delivery ids. The 133 tests and 65 DB checks move with them.
This is a breaking change of the accepted baseline, so it ships as the first step of the hardening phase,
with `npm run spec:baseline` re-run on purpose. Nobody consumes the current shape yet.
