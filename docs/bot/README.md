# Onboarding bot - core (Deliverable 3)

Merchant-facing conversational intake in front of the underwriting engine. Channel adapters (WhatsApp, Telegram) are separate and only translate messages; everything here is channel-agnostic.

## Layout
| path | what |
|---|---|
| `policies/bot.json` | MCC catalogue (5 tiers), category defaults, activity-flag rules, pre-screen bands, indicative pricing, session timings. EXAMPLE VALUES. |
| `policies/base.json` | `mccRiskTiers` extended with every catalogue MCC (RESTRICTED/PROHIBITED map to HIGH for the underwriter). |
| `packages/shared/src/bot.ts` | zod schemas: answers, MCC result, prescreen, pricing quote, checklist state, bot intake, bot policy. |
| `apps/api/src/bot/machine.ts` | `BotMachine.handle(session, inbound)` - the conversation state machine (steps in `BOT_STEPS`). |
| `apps/api/src/bot/strings.ts` | every merchant-facing string, EN and AR, plus document labels and hints. |
| `apps/api/src/bot/mcc.ts` | MCC classifier: LLM (`bot_mcc`) when live, keyword table in mock mode and as fallback/validator. |
| `apps/api/src/bot/checklist.ts` | document checklist from `policies/base.json` entity types + risk extras. |
| `apps/api/src/bot/prescreen.ts` | pre-approval score (reuses `risk.weights`) and indicative pricing lookup. |
| `apps/api/src/bot/documents.ts` | one upload: `ingest()` (same intake path as the API) + classify + extract the new file only. |
| `apps/api/src/bot/notify.ts` | composes messages for HUMAN decisions (needs_info / approved / rejected) into the session outbox; nudges. |
| `apps/api/src/bot/session.ts` | session id (hash of channel + identity), creation, PII redaction for transcripts. |
| `apps/api/src/db/types.ts` | `BotSessionRec`, `Store.botSessions`, `CaseRec.botIntake`. Memory and Mongo stores implement it. |
| `apps/api/src/auth.ts` | `ensureBotUser()` - inactive service principal `bot@moneybee.local` that owns bot-created cases. |

## Guarantees kept
- `transition()` untouched: the bot never sets APPROVED / REJECTED / COMPLETED. Decisions reach the merchant only via `notifyDecision()`, called from the human review route (wired in Deliverable 4).
- The gap-chaser draft is still never auto-sent; `notifyDecision({kind:'needs_info'})` takes the underwriter's (editable) text.
- Numeric pre-screen score, screening results and risk reasons are never in a merchant message.
- All LLM calls go through `llm/client.ts` (`bot_mcc`, `bot_faq` agents) so mock mode and the token budget apply; `npm test` runs with no key.
- Case fields the bot sets (`activity.mcc`, volume, ticket) carry `edited.by = bot@moneybee.local` so `consolidate()` preserves them and the reviewer sees their origin.

## Flow (one line)
S0 language + consent -> S1 profile Q&A -> MCC (S2 restricted warning / prohibited exit) -> case created, S3 checklist collection (per-upload classify, wrong/expired/bundle/duplicate handling, UAE PASS link) -> S3 optional extras -> S4 pre-screen + indicative pricing -> S5 submit: fields written, pipeline enqueued, case lands in AWAITING_REVIEW -> underwriter decides -> outbox message.

## Tests
`apps/api/test/bot.test.ts`: policy load, keyword classifier, flag overrides, checklist per entity type and tier, pre-screen bands, pricing (exact vs range, uplifts, reserve), session helpers, and three conversations in mock mode: free zone merchant end to end (fixture 03) to AWAITING_REVIEW, prohibited exit with no case, restricted + Arabic + branch-of-foreign-company.

## WhatsApp adapter (Deliverable 4)
| path | what |
|---|---|
| `apps/api/src/channels/whatsapp/client.ts` | Meta Cloud API client (text, buttons, lists, templates, media download, mark read) and the in-memory mock. |
| `apps/api/src/channels/whatsapp/adapter.ts` | webhook verify handshake, HMAC signature check, payload to `Inbound`, per-sender ordering, message-id dedupe, reply rendering (3 buttons or list), outbox drain with the 24h-window rule, nudge sweep. |
| `apps/api/src/channels/whatsapp/index.ts` | builds the adapter from `WHATSAPP_MODE` (off / mock / live), sets `ctx.onBotOutbox`, starts the sweep timer. |
| `apps/api/src/routes/cases.ts` (review) | after a human decision on a bot case: `notifyDecision()` then immediate outbox drain. `merchantMessage` body field carries the edited gap text or the merchant-safe rejection reason; internal notes are never sent. |
| `apps/web/src/pages/CaseWorkspace.tsx` | **Bot intake** tab (pre-approval, MCC, pricing offered, answers, redacted transcript) and the "Message to the merchant" field on the decision form. |
| `scripts/wa-sim.mjs` | terminal simulator for `WHATSAPP_MODE=mock` (`npm run wa:sim`). |
| `docs/bot/05-whatsapp-runbook.md` | Meta setup, templates, operations. |

Decision taken: the adapter runs inside the API process (`apps/api/src/channels/whatsapp`) rather than as a separate `apps/channels/whatsapp` service. It needs the store, cipher, LLM budget and queue, and a second process would have meant an internal HTTP API for all of that before there is a second channel. The module has no imports from the routes layer, so it can be lifted out later.

## Next (Deliverable 5)
Telegram Bot API adapter on the same `Inbound`/`Reply` contract.
