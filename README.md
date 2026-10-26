# MoneyBee Onboard

Agentic merchant onboarding for UAE acquirers. Drop a merchant's documents in; agents classify, extract, cross-check, resolve beneficial owners, screen, score and build the acquirer pack. A human underwriter reviews and approves. On completion the record is written to MongoDB (the system of record) in one atomic write, a secure single-use onboarding token is minted, and a signed webhook carries the token to your payment / onboarding notification flow.

> The agents recommend and prepare. They never approve or decline. Screening is a **MOCK** until a real provider is plugged in (see `docs/MOCKS.md`).

## Run it on Docker (recommended)

Requirements: Docker Desktop, Node 20+ (only for the setup script), about 4 GB free RAM for Docker. SQL Server is no longer needed (see below).

```bash
git clone https://github.com/Punitthakker/moneybee-onboarding-agentic.git
cd moneybee-onboarding-agentic
node scripts/setup.mjs            # creates .env with fresh secrets and prints the logins
docker compose up -d --build      # first build takes a few minutes
```

Open **http://localhost:8080** and sign in with the admin or demo login printed by the setup script.

| Service | URL |
|---|---|
| App | http://localhost:8080 |
| API | http://localhost:4000 (`/health`, `/ready`) |
| MongoDB | localhost:27017 (database `moneybee_onboard`; completed onboardings in `onboarding_records`) |
| Webhook sink logs | `docker compose logs -f webhook-sink` |
| Mail catcher (Mailpit) | http://localhost:8025 |
| Sanctions screening (Watchman, internal) | http://localhost:8084 |

Add your `ANTHROPIC_API_KEY` to `.env` and run `docker compose up -d api` to switch from the MOCK fixture parser to live Claude.

### Try it
1. `npm install && npm run fixtures` generates eleven synthetic merchants (11 is a branch of a foreign company) in `fixtures/merchants` (or use the zips you make from them).
2. New case, drop a fixture folder (for example `05-layered-ubo`), choose an acquirer, click **Create case and run agents**.
3. Watch the agent timeline. When the case reaches AWAITING_REVIEW, check flagged fields, open Ownership, then Risk and decision.
4. Approve with notes (HIGH / REFER cases need a second reviewer: sign in as `second@moneybee.local`).
5. Output, then **Complete and mint token**. Copy the claim URL (shown once), then:
```bash
curl -s http://localhost:8080/api/v1/onboarding/<token>/status
curl -s -X POST http://localhost:8080/api/v1/onboarding/<token>/claim   # works once
```

## Deploy on a server (single Linux host)

For a demo or pilot on one machine (for example an AWS EC2 Ubuntu instance with Docker):

```bash
git clone https://github.com/Punitthakker/moneybee-onboarding-agentic.git && cd moneybee-onboarding-agentic   # or copy a release tarball
scripts/server-deploy.sh http://<server-ip>                 # plain HTTP on port 80
scripts/server-deploy.sh https://<ip-with-dashes>.sslip.io  # HTTPS with an automatic certificate (ports 80 and 443 open)
```

The script installs the Docker Compose plugin for the user if it is missing, creates `.env` with fresh secrets on the first run (logins in `LOGINS-SERVER.txt`, owner-only), writes the public address into `.env`, builds and starts the stack, and waits until it answers. Re-running it updates the app and keeps the data. The user must be allowed to use Docker (`sudo usermod -aG docker <user>` once). Only the web port (or 80 and 443 with HTTPS) is published; MongoDB, Redis, the API, Mailpit and Watchman stay on the server's loopback interface. Read the demo mailbox through an SSH tunnel: `ssh -L 8025:127.0.0.1:8025 <user>@<server>` then http://localhost:8025.

## Develop
```bash
npm install
npm run dev        # starts infra in Docker, API on :4000 (watch), UI on :5173
npm test           # Vitest + Supertest (no infrastructure needed)
npm run eval       # pipeline accuracy on the fixtures; fails below the floors
npm run e2e        # Playwright happy path (needs the stack running)
npm run typecheck
```

## System of record: MongoDB (SQL Server optional)

Completed onboardings are stored in MongoDB (`onboarding_records`), one document per completion holding the merchant snapshot, parties, documents, decision, screening, hashed token and audit trail. A single-document write is atomic in MongoDB, so a completion is fully stored or not at all, without a replica set. Token claims are one atomic update, so a token redeems at most once. The same contract tests run against every engine (`apps/api/test/repository.contract.test.ts`; set `MONGO_TEST_URL` to also run them on a real MongoDB).

To keep SQL Server instead: `REPO=mssql docker compose --profile mssql up -d --build`.

## White-label tenants (MoneyBee and Botim)

One codebase serves several brands. Each tenant has its own cases, users, audit log, brand, copy, contact details, nudge cadence and enabled company types, configured in `tenants/*.json` (loaded on first boot, then edited by the tenant's ADMIN).

| Tenant | Kind | Open | Demo logins |
|---|---|---|---|
| MoneyBee | platform (default) | http://localhost:8080 | `admin@moneybee.local`, `underwriter@`, `second@`, `viewer@moneybee.local` |
| Botim | white-label | http://botim.localhost:8080 (or http://localhost:8080/?tenant=botim) | `admin@botim.local`, `underwriter@`, `second@`, `viewer@botim.local` |

- **Isolation.** Every user-facing case query goes through a tenant-scoped accessor (`apps/api/src/db/tenant-scope.ts`). A case from another tenant answers 404, exactly like a missing case. Global settings, policies and acquirer config can only be changed by platform (MoneyBee) admins.
- **Branding.** Login, ops console and merchant portal take the tenant's logo, colours, fonts and copy. The merchant portal always uses the brand of the tenant that owns the case. The Botim logo and colours are **placeholders** until Botim supplies approved assets (see `tenants/README.md`).
- **"Powered by MoneyBee"** is fixed: it comes from a platform constant, appears on every page, and any tenant update that tries to set it is rejected.
- **API:** `GET /api/v1/public/tenant` (brand for a public page, by `?tenant=`, `x-moneybee-tenant` header or host name), `GET /api/v1/tenant` and `PUT /api/v1/tenant` (own tenant, ADMIN to edit).

## Merchant self-serve portal (`/apply`)

Merchants start on their own, upload in any order and come back on any device. No password.

1. Open **http://localhost:8080/apply?tenant=botim** (or `/apply` for MoneyBee). Pick the company type, answer a few questions (they decide which documents are needed), enter the business name and contact, start.
2. The browser is signed in straight away, and a private link is emailed. Read it in Mailpit: **http://localhost:8025**. The link opens `/apply/link#...` and works for 72 hours on any device. "Already started? Get a new link" sends a fresh one (the old one stops working).
3. The checklist shows every document with a hint in plain words. Upload against an item or drop everything at once: files are classified on arrival and the count bar ("6 of 11 documents in") fills up. Answers can be changed and wrong files removed until the application is sent.
4. **Send my application** runs the agents. The case appears in the ops console (status `DRAFT` before sending, then the usual flow), and the merchant sees "with our team", "we need a little more" or the decision.

Underwriters can also email the portal to the merchant of a case they created: case, tab **Merchant portal**, **Email upload link**.

Requirements per company type live in `policies/base.json` (`entityTypes`, `questions`, `documentRules`); see `docs/DECISIONS.md`. Company types: sole establishment, mainland LLC, free zone company, other mainland forms and **branch of a UAE or foreign company**.

API: `GET /public/requirements`, `POST /public/applications`, `POST /public/applications/resume`, `POST /portal/session`, `GET|PATCH /portal/application`, `POST /portal/application/documents`, `DELETE /portal/application/files/:id`, `POST /portal/application/submit`, `POST /cases/:id/portal-link`.

## UAE PASS (mock and live)

Merchants can sign in with UAE PASS, share their Emirates ID and Residence Visa from the UAE PASS app, and (behind a flag) sign the merchant agreement. It runs on a built-in simulator by default, so the demo needs no credentials.

Flow: an underwriter opens a case, tab **UAE PASS**, and creates a **merchant link**. The merchant opens `/m/<invite>`, continues with UAE PASS (only SOP2 and SOP3 accounts pass, because only they have the Emirates ID verified), then sends a share request. They approve it in the app (the simulator at `/sim/uaepass/...`). The documents arrive in the case marked **issuer verified**, with the request number. They go through the same deterministic verifier as every other document, and nothing is approved automatically.

| Setting | Meaning |
|---|---|
| `UAEPASS_MODE=mock` (default) | Simulator for login, document sharing and signing. Screens carry a "SIMULATED" strip. Mock-only routes under `/api/v1/mock/uaepass` include a demo clock so the expired screen can be shown. |
| `UAEPASS_MODE=live` | Login is implemented against the public OAuth/OpenID flow. Document sharing and signing throw `NotConfigured` until UAE PASS grants access and shares the specification. |
| `UAEPASS_SIGNING_ENABLED=true` | Shows the review-and-sign step and enables `/merchant/signing`. |

Demo users in the simulator: a verified SOP3 user, a SOP3 user whose name differs from the trade licence owner (verifier finding), and an SOP1 user (blocked).

Screens for every state (English and Arabic) are in `docs/screens/uaepass/`.

## API (`/api/v1`)
```
POST   /cases                              create a case
POST   /cases/:id/documents                upload files (multipart field "files") or attach an email (field "email")
POST   /cases/:id/run                      start or resume the agent pipeline
GET    /cases/:id                          full case state, fields, confidence, traces
PATCH  /cases/:id/fields                   reviewer edit or confirm {path, value | confirm, reason}
POST   /cases/:id/review                   {decision: approve|reject|request_info, notes}
POST   /cases/:id/complete                 finalise, write the system of record, mint token
GET    /onboarding/:token/status           read-only status by token
POST   /onboarding/:token/claim            single use: returns the onboarding package
POST   /tokens/:id/revoke                  revoke a token
GET    /cases/:id/events                   SSE agent timeline
```
The onboarding package JSON Schema is in `packages/shared/onboarding-package.schema.json`; the webhook schema is next to it.

### Webhook
`POST ONBOARDING_WEBHOOK_URL` with headers `X-MoneyBee-Signature: sha256=<hex>` (HMAC-SHA256 of `"<timestamp>.<raw body>"` with `ONBOARDING_WEBHOOK_SECRET`), `X-MoneyBee-Timestamp` (unix seconds; reject if older than 5 minutes) and `X-MoneyBee-Delivery`. Body:
```json
{ "event": "onboarding.completed", "caseId": "...", "merchantId": "...", "token": "mb_onb_...", "tokenExpiresAt": "...", "claimUrl": "https://.../api/v1/onboarding/<token>/claim" }
```
`scripts/webhook-sink.mjs` is a working receiver to copy from.

## Layout
`apps/web` React UI · `apps/api` API and agents · `packages/shared` schemas · `db/migrations` SQL Server DDL (optional engine) · `policies` base policy and example acquirer overrides · `fixtures` synthetic merchants · `docs` plan, decisions, mocks, security, threat model.

All fixture data is synthetic. Policy values and example acquirers are illustrative and must be set by compliance.
