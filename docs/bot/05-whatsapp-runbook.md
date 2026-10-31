# WhatsApp runbook - from zero to a live MoneyBee onboarding number

The adapter talks to the official Meta WhatsApp Cloud API directly (no BSP, no third-party library). What you need from Meta, in the order you need it, and what to paste where.

## 0. Try it locally first (no Meta account)
```bash
cp .env.example .env && npm run setup            # if not done
WHATSAPP_MODE=mock npm run dev                   # API on :4000, outbound printed as [WHATSAPP MOCK]
npm run wa:sim                                   # second terminal: chat with the bot
```
In the simulator: type text, `/btn <id>` to press a button or list row (ids are printed next to each prompt), `/file fixtures/merchants/03-free-zone-fzco/trade_licence.pdf` to send a document, `/from 9715xxxxxxx` to start a new merchant. The case appears in the back office under owner `bot@moneybee.local` with a **Bot intake** tab.

## 1. Meta prerequisites (business side, start now - this is the long pole)
1. **Meta Business Manager** for MoneyBee, with **Business verification** completed (trade licence upload; typically 2 to 10 working days).
2. A **phone number** that is not registered on any WhatsApp app (a fresh landline or virtual number works; it only needs to receive one SMS/voice code). Decide now whether partners get their own numbers later; the adapter maps one number per deployment today.
3. **Display name** approval (must match the business: "MoneyBee").
4. Optional but recommended for scale: Official Business Account (green tick) once live.

## 2. Meta App setup (developer side)
1. developers.facebook.com > Create app > Business type > add the **WhatsApp** product.
2. WhatsApp > API setup: note the **Phone number ID** (not the number itself) -> `WHATSAPP_PHONE_NUMBER_ID`.
3. Business settings > System users > create a system user with Admin role > Generate token with `whatsapp_business_messaging` and `whatsapp_business_management`, no expiry -> `WHATSAPP_ACCESS_TOKEN`. (Temporary tokens from the API setup page expire in 24h; do not use them in prod.)
4. App settings > Basic > **App secret** -> `WHATSAPP_APP_SECRET`. Every webhook is HMAC-verified against it; a wrong value means every inbound is rejected with 401.
5. Pick any random string -> `WHATSAPP_VERIFY_TOKEN`.

## 3. Webhook
1. The API must be reachable over HTTPS: `https://<your-api-host>/api/v1/channels/whatsapp/webhook`. For local testing use `ngrok http 4000` or Cloudflare Tunnel.
2. WhatsApp > Configuration > Webhook: paste the URL and the verify token, click Verify and save. The adapter answers the `hub.challenge` handshake (`GET`).
3. Subscribe to the **messages** field only.
4. Set `WHATSAPP_MODE=live` and restart. Check the log line `WhatsApp onboarding bot enabled`.
5. Send "hi" from a test phone (during the unpublished phase only numbers added under API setup > "To" can message the app; add your testers there).

## 4. Message templates (needed before any merchant waits more than 24 hours)
Free-form messages are only allowed within 24 hours of the merchant's last message. Decisions and nudges almost always fall outside that window, so these four templates must be created and approved under WhatsApp > Message templates, category **Utility**, in both `en` and `ar`. Names are fixed in `apps/api/src/bot/notify.ts`; language codes are configurable (`WHATSAPP_TEMPLATE_LANG_EN/AR`).

| name | body (en) | params |
|---|---|---|
| `moneybee_needs_info_v1` | Hi {{1}}, a quick update on your MoneyBee application {{2}}: our team needs a few more documents to continue. Reply here and we will tell you exactly which ones. | 1 contact name, 2 case ref |
| `moneybee_approved_v1` | Congratulations {{1}}, {{2}} is approved with MoneyBee. Your merchant ID is {{3}}. Reply here for your onboarding details. | 1 name, 2 company, 3 case ref |
| `moneybee_rejected_v1` | Thank you for applying, {{1}}. After review we are not able to onboard {{2}} at this time. Reply here if you have questions. | 1 name, 2 company |
| `moneybee_resume_v1` | Hi {{1}}, your MoneyBee application is saved at step {{2}}. Reply "continue" to finish it. | 1 name, 2 step label |

Arabic bodies are in `docs/bot/01-conversation-script.md` (NUDGE.2 and S5.x). Template bodies are deliberately short: once the merchant replies, the 24h window reopens and the full message (with the actual gap list or reason) is sent as free text by the next outbox sweep.

## 5. How outbound works
- Replies to an inbound message are sent immediately (text, up to 3 reply buttons, or a list for 4 to 10 options).
- Human decisions (`request_info`, `approve`, `reject` on the Risk and decision tab) go to the session **outbox** and are sent right away if inside the 24h window, otherwise as the matching template.
- A sweep every `BOT_TICK_SECONDS` (default 60) sends anything still pending and composes nudges: a free-text nudge after 2 hours idle (if inside the window), the `moneybee_resume_v1` template after 48 hours. Sessions expire for nudging after 30 days (`policies/bot.json > session`).

## 6. Operations checklist
- Secrets: `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_APP_SECRET` are production secrets; keep them in the deployment's secret store, never in `.env` committed to git.
- Rotate the access token by generating a new system-user token and restarting; old tokens can be invalidated in Business settings.
- Meta retries webhooks that are not acknowledged within a few seconds; the adapter acknowledges first and processes after, and deduplicates by message id, so retries are safe.
- Rate limits: new numbers start at 250 business-initiated conversations per 24h and scale with quality rating. Merchant-initiated replies are not limited.
- Quality rating drops if merchants block the number: keep nudges to the two defined, never add marketing templates to this number.
- Monitoring: `GET /api/v1/stats` (funnel per stage, Deliverable 6) and the API log lines `whatsapp send failed`, `media download failed`, `outbox ... left pending`.

## 7. Known limits in this version
- One phone number per deployment. Per-partner numbers need a `phone_number_id -> partner` map (planned with the partner model).
- Media over 25 MB (`MAX_UPLOAD_MB`) is rejected with the "only photos and PDFs" message.
- Audio, video, stickers, locations and contacts are answered with the unsupported-media line.
- Telegram adapter: Deliverable 5.
