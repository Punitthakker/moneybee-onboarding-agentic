# Telegram runbook

Telegram is the cheap channel: no business verification, no templates, no 24-hour window. Good for internal testing, partner demos and merchants who prefer it. Same bot, same cases, same back office.

## 0. Try it locally (no token)
```bash
TELEGRAM_MODE=mock npm run dev
npm run tg:sim            # second terminal; /start pemo, /btn <id>, /file <path>
```

## 1. Create the bot (5 minutes)
1. In Telegram, open **@BotFather** > `/newbot` > name "MoneyBee Onboarding" > username ending in `bot`, for example `MoneyBeeOnboardBot`.
2. Copy the token -> `TELEGRAM_BOT_TOKEN`.
3. `/setdescription` and `/setabouttext` with one line each ("Set up card and online payments for your UAE business in 10 minutes."). `/setuserpic` with the MoneyBee logo.
4. `/setcommands`: `start - Start or continue your application`, `status - Check your application`, `agent - Talk to a person`.
5. Keep `/setprivacy` at the default (the bot only works in private chats; groups are ignored by the adapter).

## 2. Webhook
1. Pick a random string -> `TELEGRAM_WEBHOOK_SECRET`.
2. Set `TELEGRAM_MODE=live`, `PUBLIC_API_URL=https://<your-api-host>` and restart. With `TELEGRAM_SET_WEBHOOK_ON_BOOT=true` (default) the API calls `setWebhook` itself and logs `Telegram webhook registered`.
3. Telegram requires a public HTTPS URL with a valid certificate (Railway domains qualify; for local use `ngrok http 4000` and set `PUBLIC_API_URL` to the ngrok URL).
4. Verify: `curl https://api.telegram.org/bot<token>/getWebhookInfo` should show your URL and no `last_error_message`.

## 3. Deep links (partner and referral codes)
`https://t.me/<botusername>?start=<code>` opens the bot with `/start <code>`. The adapter stores the code as `referral` on the session and the case (`botIntake.referral`), visible on the Bot intake tab. Codes are `[A-Za-z0-9_-]`, max 64 characters. Use one per partner (`pemo`, `stc`), campaign (`seamless2026`) or sales person.

On WhatsApp the equivalent is a `wa.me/<number>?text=START%20pemo` link: the prefilled first message `START pemo` is captured the same way.

## 4. Behaviour differences from WhatsApp
| | WhatsApp | Telegram |
|---|---|---|
| Choices | up to 3 reply buttons, otherwise a list | inline keyboard, two short buttons per row |
| Decision messages | free text inside 24h, approved template outside | always free text, any time |
| Nudges | 2h free text, 48h template | both free text |
| Files | images and PDFs, 25 MB cap | documents (PDF, PNG, JPG) and photos (largest size taken), 20 MB Bot API cap |
| Identity | phone number | chat id (numeric) |
| Language detect | first message script | Telegram `language_code` seeds it, first message can switch |

## 5. Operations
- Rotate the token with BotFather `/revoke`; restart the API so the new token and webhook take effect.
- Telegram retries undelivered updates for up to 24h; the adapter deduplicates by `update_id`.
- Rate limit: about 30 messages per second per bot overall and 1 per second per chat. The bot's turn-based replies stay well under this.
- Logs to watch: `telegram sendMessage failed`, `telegram file download failed`, `Telegram webhook registration FAILED`.
