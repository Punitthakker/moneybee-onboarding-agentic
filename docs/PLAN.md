# MoneyBee Onboard - build plan

## Milestones
1. Scaffold: npm workspaces monorepo, docker compose (mongo, mssql 2022, redis, minio), shared zod schemas, policy JSON, SQL migrations, JWT cookie auth with RBAC. **Done**
2. Case API, upload pipeline (multipart, zip, folder, email), encrypted S3/local storage, dashboard and workspace UI shell in MoneyBee style. **Done**
3. Classifier and extractor agents with per-step traces, confidence UI and source highlighting in the PDF viewer. **Done**
4. Deterministic verifier, per-entity checklist and gap-chaser draft. **Done**
5. UBO resolver (layered ownership, effective percentages, control and SMO fallbacks) and the ownership graph. **Done**
6. Screening interface with a MOCK provider, underwriter scoring and memo, review flow with mandatory notes and second-reviewer rule. **Done**
7. Pack builder and acquirer adapters, single-transaction SQL write, token minting, status and claim API, signed webhook with retries and dead letters. **Done**
8. Synthetic fixtures, eval harness, threat model and docs, Vitest/Supertest suite, Playwright happy path. **Done**

## Folder tree
```
apps/api            Express API, agent runtime, BullMQ worker (same process)
  src/agents        intake, classifier, extractor, verifier, ubo, screening, underwriter, gapchaser, packbuilder, orchestrator
  src/agents/prompts  versioned prompts
  src/llm           Anthropic adapter + MOCK fixture parser
  src/db            Store interface: Mongo (Mongoose) and in-memory
  src/sql           OnboardingRepository: SQL Server (mssql) and in-memory
  src/eval          eval harness (npm run eval)
apps/web            React 18 + Vite + TS UI
packages/shared     zod schemas, types, onboarding package JSON Schema
db/migrations       SQL Server DDL
policies            base.json + acquirers/*.json (examples)
fixtures            synthetic merchant generator and output
e2e                 Playwright happy path
docs
```

## Risks and how they are handled
- **LLM extraction accuracy on real scans.** Mitigated by per-field confidence, forced human review below the threshold, sources on every field, and an eval floor in CI. The bundled MOCK parser only reads the synthetic fixtures.
- **Prompt injection through documents.** Delimited untrusted input, explicit system rules, a deterministic scanner that flags instruction-like text as a risk signal, and a hard state-machine guard so no model output can approve.
- **Token leakage.** 256-bit tokens, only SHA-256 stored, never logged (URL redaction in API and nginx logs), webhook body stored encrypted and cleared after delivery.
- **SQL Server on Apple Silicon.** The 2022 image is amd64 only; Docker Desktop runs it through Rosetta. See README.
- **Data residency.** Configurable storage endpoint and deployment region; documented in SECURITY.md.
