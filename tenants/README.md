# Tenants

One JSON file per tenant, validated against `TenantSchema` in `packages/shared/src/tenant.ts`. Files are loaded into Mongo on first boot; after that, tenant admins edit branding, copy, contact details, nudge cadence and enabled company types in **Settings > Brand**, and the stored version wins.

| File | Tenant | Kind |
|---|---|---|
| `moneybee.json` | MoneyBee (platform, default) | `platform`: may change global settings and policies |
| `botim.json` | Botim (white-label partner) | `white_label`: own cases, users, brand and nudges only |

## Botim placeholders

The Botim logo (`apps/web/public/tenants/botim/logo-placeholder.svg`), colours, support email, WhatsApp number and email domain are **placeholders** (`branding.isPlaceholder: true`). They are not Botim's brand assets. Replace them with the assets and contact details Botim approves, then set `isPlaceholder` to `false`.

## Powered by MoneyBee

"Powered by MoneyBee" is not a tenant setting. The platform adds it to every merchant-facing page, message, email and PDF from a constant (`POWERED_BY`). A tenant file or Settings update that tries to include a `poweredBy` key is rejected.

## Adding a tenant

Copy `botim.json`, change `id`, `casePrefix`, `hostnames`, brand and contacts, and restart the API. Hostnames let public pages (merchant portal, login) pick the right brand, for example `botim.localhost:5173` in development.
