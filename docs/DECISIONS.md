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
