# Decisions

1. **Brand tokens come from the live MoneyBee site.** The brief says the live site wins. Measured on moneybee-navy.vercel.app (Oct 2026): white page, ink `#17140f`, body `#6e675c`, muted `#a39c90`, cream `#f6f1e6`, gold `#915f17`, footer `#15120d`; Instrument Sans (headings weight 400, about -0.045em tracking, second line greyed) and IBM Plex Mono; dark gradient pill buttons, outlined pill chips, cream gradient cards, frosted header with a gold glow, radii 20 to 48px. The Figma file could not be read (no editor access for the connected Figma account), so Figma was not used.
2. **One process runs API and worker.** BullMQ workers start inside the API process so the SSE timeline gets events in-process. Scale out later by splitting the worker and moving the event bus to Redis pub/sub.
3. **Store and repository interfaces with in-memory implementations.** Mongo and SQL Server sit behind `Store` and `OnboardingRepository`. In-memory versions power tests and the eval harness with no infrastructure.
4. **Deterministic first.** Verification, UBO maths, risk score and rating are code. The LLM classifies, extracts, explains soft mismatches and writes the memo. It never changes a score.
5. **Hard REFER triggers.** Expired licence, sanctions hit, name mismatch, no UBO determined and suspected prompt injection force REFER regardless of score. HIGH, REFER, PEP and sanctions need two distinct approvers; the second must hold SECOND_REVIEWER (or ADMIN).
6. **Approval needs clean fields.** A case cannot be approved while any field is below the confidence threshold. The reviewer must confirm or correct it with a reason.
7. **Webhook body encrypted at rest, cleared after delivery.** The token never sits in Redis (jobs carry only the delivery id) and the stored body is AES-GCM encrypted until it is delivered.
8. **Token TTL and webhook settings live in Mongo settings** (editable in Settings), falling back to env. Policy edits create a new version; old versions stay readable.
9. **Merchant upsert by licence number and authority.** Re-onboarding the same merchant updates the merchant row and replaces its parties and documents within the same transaction; every case keeps its own row.
10. **CSRF.** Cookie sessions plus a required `X-MoneyBee-CSRF` header on writes; CORS is locked to configured origins.
11. **PDF text via pdfjs-dist 4.** pdf-parse bundles an old pdf.js that cannot read modern PDFs with object streams.
12. **Node 22 in Docker** (Node 20+ supported for development).

## UAE PASS (Oct 2026)
- **Provider interface with a mock default.** The share and signing APIs are not publicly documented, so the product is built against one interface and a simulator. The live provider implements login only.
- **Merchant portal added to this repo** at `/m` (public routes next to the ops console), reached through an invite link created by an underwriter, because the repo had no merchant-facing surface.
- **Issuer-verified is evidence, not a decision.** Documents skip OCR (confidence 1.0, source UAE PASS) but still go through the verifier and the human review rules.
- **Signing behind `UAEPASS_SIGNING_ENABLED`**, default off.
- **No official UAE PASS logo or assets** are used until brand-usage approval is in place. The button shows a neutral text mark.
- **Open questions for the UAE PASS team**: document sharing API and scopes for a private service provider, which documents can be requested (trade licence?), webhook or polling, staging credentials, pricing, branding rules, and whether SOP3 is required for financial-services KYC.

## White-label tenancy (Oct 2026, Botim)
- **Tenancy lives in the data-access layer.** Cases, users and audit records carry `tenantId`. Ops routes reach cases only through `tenantCases()` (set on the request by `authenticate`), so another tenant's case is indistinguishable from a missing one (404). Background agents keep using `ctx.store` because they only receive ids of cases created inside a tenant. Records created before tenancy are backfilled to `moneybee` on boot.
- **Mongo stays the system of work, SQL Server the system of record.** The extension adds every new entity to Mongo behind the `Store` interface. A Mongo `OnboardingRepository` (to run without SQL Server) is an open decision, proposed for phase 7. See `docs/EXISTING_STATE.md`.
- **Platform versus white-label.** Only the `platform` tenant (MoneyBee) may change global settings, policies, acquirer config and the webhook, because those apply to every tenant. White-label admins manage their own users, brand, copy, contacts, nudges and enabled company types.
- **"Powered by MoneyBee" is a constant, not config.** `POWERED_BY` in `packages/shared/src/tenant.ts` is appended by `publicTenantView` and rendered by `PoweredByMoneyBee`. Tenant schemas are strict, so a `poweredBy` key (or any unknown key) is rejected at boot and in `PUT /tenant`.
- **Theme by CSS variables.** The tenant palette is mapped onto the existing design tokens at runtime. The platform tenant keeps the original MoneyBee stylesheet; white-label tenants also replace the warm neutrals and use solid primary buttons.
- **Placeholder partner assets.** The Botim logo, colours, support email, WhatsApp number and email domain are placeholders (`branding.isPlaceholder: true`, shown as a "placeholder brand" tag) until Botim supplies approved assets. No Botim artwork is used.
- **Mailpit instead of MailHog.** Same purpose and ports, actively maintained.
