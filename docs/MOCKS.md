# Mocks in MoneyBee Onboard

Every mock is labelled in the UI and in agent traces. None of them may be described as a real check.

| Mock | Where | What it does | Replace with |
|---|---|---|---|
| **MOCK LLM fixture parser** | `apps/api/src/llm/mock.ts` | Used when `ANTHROPIC_API_KEY` is empty or `LLM_MODE=mock`. Reads the PDF text layer and parses `Label: value` lines from the synthetic fixtures. Images are classified by file name only and always sent to human review. Model name shows as `mock-fixture-parser (MOCK)` in traces and a banner shows in the case workspace. | Set `ANTHROPIC_API_KEY` (live Anthropic Messages API with native PDF and image input). |
| **MOCK screening provider** | `apps/api/src/agents/screening.ts` | Matches subjects against four obviously fake names. Every result row is stored with `is_mock = 1` in SQL Server, the claim package carries `screeningIsMock: true`, and the UI shows a "MOCK SCREENING" banner. | Implement `ScreeningProvider` for your vendor (sanctions, PEP, adverse media) and register it in `createScreeningProvider`. Set `isMock: false` only for real checks. |
| **MOCK acquirer API submit** | `apps/api/src/agents/packbuilder.ts` (`apiSubmitMockAdapter`) | "Submit via API (mock)" returns a `MOCK-<ref>` reference without calling anything. | Implement `AcquirerAdapter.submit` per acquirer. The file-pack adapter is real. |
| **Example acquirers** | `policies/acquirers/example_acquirer_*.json` | Two illustrative overrides. They are not real acquirers and their field maps are not real forms. | Add one JSON per real acquirer with its field map and naming rules. |
| **Mail intake** | `POST /cases/:id/documents` with `email` or an `.eml` upload | Email is attached by upload or paste. No IMAP or Gmail polling runs. | Implement a mail adapter behind the same intake call (`MAIL_*` env is reserved). |
| **Webhook sink** | `scripts/webhook-sink.mjs` (docker service `webhook-sink`) | Demo receiver that verifies the signature and logs the event with the token redacted. | Point `ONBOARDING_WEBHOOK_URL` at the real payment / onboarding notification service. |
| **Antivirus** | docker profile `av` | ClamAV container is available but not wired into intake by default. | Add a scan call in `agents/intake.ts` before storage. |
