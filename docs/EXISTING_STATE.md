# Existing state (Step Zero, October 2026)

Inspection of `moneybee-onboarding-agentic` before the Botim white-label and MoneyBee Risk API work. Baseline: `npm test` passes 24 of 24 tests (Vitest and Supertest, in-memory stores).

## What already exists

| Area | Where | State |
|---|---|---|
| Monorepo | npm workspaces: `apps/api`, `apps/web`, `packages/shared` | Node 20+, TypeScript, zod schemas shared by API and UI |
| Working database | `apps/api/src/db` (`Store` interface: Mongo via Mongoose, plus in-memory) | **MongoDB is already the system of work**: cases, traces, audit, users, policy versions, settings, webhook deliveries |
| System of record | `apps/api/src/sql` (`OnboardingRepository`: SQL Server, plus in-memory) | Written once, in one transaction, when a case is completed: merchant, parties, documents, screening, token, audit |
| Agent pipeline | `apps/api/src/agents` | intake, classifier, extractor, verifier, consolidate, UBO resolver, screening, underwriter (score and memo), gap chaser, pack builder, orchestrator. Deterministic scoring; the LLM never changes a score |
| LLM | `apps/api/src/llm` | Anthropic adapter (native PDF and image input) and a MOCK fixture parser when no key is set |
| Requirements by company type | `policies/base.json` (`entityTypes`), `packages/shared/src/policy.ts` | Config-driven required documents and fields per entity type, per-acquirer overrides, versioned in Mongo. Types today: `sole_establishment`, `llc`, `free_zone`, `mainland` |
| UBO | `agents/ubo.ts` | Layered look-through, effective percentages, threshold from policy (25% default), control and senior-managing-official fallbacks, "shares sum to 100" check |
| Screening | `agents/screening.ts` | `ScreeningProvider` interface with a MOCK provider only |
| Risk | `agents/underwriter.ts`, `policies/base.json` (`risk`) | Explainable points breakdown, reason codes, hard REFER triggers, second reviewer for HIGH / REFER / PEP / sanctions |
| Review | `routes/cases.ts` | Mandatory notes, low-confidence fields must be confirmed, four-eyes rule |
| Completion | `complete.ts`, `routes/onboarding.ts`, `webhook.ts` | SQL write, single-use onboarding token, HMAC-signed webhook with retries and dead letters |
| Merchant portal | `apps/web/src/uaepass/Portal.tsx` at `/m/:invite` | Invite link from the ops console, UAE PASS sign-in and document sharing (simulator by default), English and Arabic |
| Ops console | `apps/web/src/pages` | Dashboard, new case (upload, zip, folder, email paste), case workspace (documents, fields, ownership graph, risk, output), settings (policy, users, webhook) |
| Email intake | `POST /cases/:id/documents` | Paste or `.eml` upload only. No inbound address, no IMAP |
| Security | `crypto/pii.ts`, `auth.ts`, `docs/SECURITY.md`, `docs/THREAT_MODEL.md` | AES-GCM PII and file encryption, cookie JWT with CSRF header, RBAC (ADMIN, UNDERWRITER, SECOND_REVIEWER, VIEWER), PII reads audited, prompt-injection detection |
| Brand | `apps/web/src/styles.css`, `docs/DECISIONS.md` | Tokens measured from the live MoneyBee site (Instrument Sans, IBM Plex Mono, cream and gold) |
| Docker | `docker-compose.yml` | mongo, mssql, redis, minio, clamav (profile `av`), api, web, webhook-sink |
| Quality | `apps/api/test`, `e2e`, `src/eval` | Unit and API tests, Playwright happy path, accuracy eval on 10 synthetic merchants |

## Gaps against the build prompt

| Prompt section | Gap |
|---|---|
| 3. Multi-tenant white-label | No tenant model. Cases and users are global. No theming per partner, no "Powered by MoneyBee" lock |
| 4. Entity types | No mainland **branch** type yet |
| 5. Input channels | No channel adapter layer, no WhatsApp, no per-application inbound email address or IMAP, no partner API key channel, no unified timeline across channels |
| 7. Onboarding agent | Pipeline exists, but no merchant-facing conversation state machine, nudge scheduler, drop-off recovery or funnel analytics |
| 8a. Risk data providers | Only MOCK screening. No Watchman, UN / UAE / OFAC lists, GLEIF, IBAN, MRZ, BIN rules or device risk |
| 8b. MoneyBee Risk API | Not started (to be built in `moneybee-risk-datasources/api`) |
| 10. Frontend | Merchant portal only reachable through a UAE PASS invite; no upload-first journey, entity picker or UBO builder for merchants |
| 12. Docker | No mail catcher, no Watchman, no OCR sidecar |

## Reuse versus replace

- **Reuse everything that works.** The agent pipeline, review rules, completion, token, webhook, UAE PASS flow, policies, fixtures, eval and tests stay as they are and are extended, not forked.
- **Database decision.** The prompt asks for MongoDB as the database. Mongo already holds all working data behind the `Store` interface, so nothing is migrated off SQL Server for the extension: every new entity (tenants, channel identities, messages, nudges, watchlists, API clients and so on) goes into Mongo through the same interface. SQL Server stays the system of record for completed onboardings, behind `OnboardingRepository`, because the acquirer hand-off already depends on it. **Open decision for MoneyBee:** add a Mongo implementation of `OnboardingRepository` so the whole stack can run without SQL Server (simpler on Apple Silicon, pure MERN). Proposed for phase 7.
- **Tenancy is added in the data-access layer.** `tenantId` on cases and users, a tenant-scoped case accessor that every user-facing route goes through, and existing records treated as tenant `moneybee`. Background agents keep addressing cases by id because they only ever receive ids that were created inside a tenant.
- **Merchant portal is extended, not rebuilt.** The `/m` portal gains tenant theming now and the upload-first journey in phase 2.
- **Roles.** The prompt's roles map to existing ones: admin to ADMIN, reviewer to UNDERWRITER and SECOND_REVIEWER, read_only to VIEWER. RELATIONSHIP_MANAGER is added with assisted upload in phase 4.
- **Entity types.** Prompt names map as: sole proprietorship to `sole_establishment`, mainland LLC to `llc`, mainland DET company to `mainland`, free zone to `free_zone`. `branch` is added in phase 2 through config.

## Build environment note

The cloud machine used for this build cannot pull Docker images or download MongoDB, so every phase is verified with the in-memory stores (the same way the existing test suite runs), TypeScript type checks, and `docker compose config`. The full stack must be started once on a machine with Docker Desktop (`npm run up`) to confirm the containers.
