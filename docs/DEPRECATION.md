# Versioning and deprecation

## Version

The API version is a date, sent as `MoneyBee-Version`. The current and only version is `2026-10-24`. Omitting the
header uses it. An unknown version returns 400 `unsupported_version`.

## What counts as breaking

A change is breaking if a client written against the previous spec can stop working. `npm run spec:breaking` checks
this against `openapi/baseline/` and fails the build. It flags, among others:

- removed paths, operations, parameters, request or response properties, events, scopes, error codes
- changed `operationId` (SDK and MCP tool names depend on it)
- type changes, tightened request constraints, new required request fields or parameters
- a new value in a **response** enum (clients that switch on it break)
- a new required scope, role or actor type; an escalated `x-mcp-risk` (agent permissions must be re-reviewed)
- a changed event version or removed event data property

Additive changes are allowed: new optional request fields, new response fields, new operations, new events, new error codes.
Clients must ignore unknown response fields.

## Process

1. Introduce the change under a **new** version or a **new** operation or event version. Never edit in place.
2. Mark the old operation `deprecated: true` and set `x-sunset` (ISO 8601). Responses then carry `Deprecation: true`
   and `Sunset: <HTTP date>`.
3. Give at least **12 months** between the first `Deprecation` header and the sunset date (target; confirm with Legal
   and key partners before the first real deprecation).
4. Notify partners by email and in the changelog when the header first appears, then at 6, 3 and 1 months.
5. After the sunset date return `410 Gone` for a further 90 days before removing the route. (Policy only: the pipeline sets the `Deprecation` and `Sunset` headers today but does not yet return 410 after the date. Build that before the first real sunset.)
6. Run `npm run spec:baseline` in the same pull request that completes the removal, and commit the new baseline.

## Events

Events are versioned separately (`x-event-version`, `data_version` in the payload). A breaking payload change is a new
event version delivered alongside the old one for the whole deprecation window.
