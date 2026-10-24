# Security

MoneyBee Onboard handles KYB and KYC data. Treat every environment as holding sensitive financial data.

## Controls in the product
- **Transport.** Run behind TLS. Set `COOKIE_SECURE=true` and `PUBLIC_API_URL=https://...` outside localhost. Helmet sets security headers; nginx adds `X-Frame-Options DENY` and `nosniff`.
- **Secrets from env only.** `PII_ENC_KEY`, `JWT_SECRET`, `ONBOARDING_WEBHOOK_SECRET`, `ADMIN_PASSWORD`. Production refuses to boot without the first three of these. `npm run setup` generates them.
- **Auth.** JWT in an httpOnly, SameSite=Lax cookie (8 hours), bcrypt password hashes, login rate limit, CSRF header on writes, CORS locked to `CORS_ORIGINS`.
- **RBAC.** `ADMIN`, `UNDERWRITER`, `SECOND_REVIEWER`, `VIEWER` checked on every route. Viewers see ID numbers masked.
- **Audit.** Every PII read (case, file, pack), every state change, field edit, review, token mint, claim, status check and revoke writes an audit record (Mongo). Completion also writes audit rows in SQL Server, where `audit_log` is append-only (trigger blocks UPDATE and DELETE).
- **Encryption.** ID numbers use field-level AES-256-GCM with a key id (`PII_ENC_KEY_ID`) so keys can rotate: add the new key to the key ring, switch the current id, re-encrypt in a background job. Uploaded files and pack files are AES-256-GCM encrypted before they reach MinIO or disk.
- **Logs.** pino redacts cookies, authorization, passwords, tokens and ID numbers. Token-bearing URLs are rewritten to `[redacted]` in API logs and not logged by nginx.
- **Uploads.** Size limits, magic-byte sniffing (extension is ignored), PDF parse check, zip expansion limits (entry count, entry size, total size, no nested archives, no zip-slip since entries are never written by path), sanitised file names, files served with `nosniff` and a sandbox CSP. Uploaded content is never executed. ClamAV is available as an optional docker profile; wire it into `agents/intake.ts` for production.
- **Tokens.** 256-bit random, URL-safe, opaque, `mb_onb_` prefix. Only SHA-256 hashes are stored. Constant-time comparison, rate limits on status and claim, single atomic redeem in SQL (`UPDATE ... WHERE redeemed_at IS NULL ... OUTPUT`), separate status scope, revocation, 24 hour default TTL.
- **Webhook.** HMAC-SHA256 over `timestamp.body` (`X-MoneyBee-Signature`, `X-MoneyBee-Timestamp`), 5 minute replay window on the receiver, exponential backoff, dead-letter list with manual retry.
- **Signed download URLs.** Documents in the claim package use HMAC-signed links that expire after `FILE_URL_TTL_SECONDS` (default 5 minutes).

## Data retention
`policies/base.json -> retention` holds closed and rejected case retention days (examples). A scheduled deletion job should purge Mongo case data and stored files past retention; SQL Server records follow your record-keeping policy. Retention values must be set by compliance.

## Data residency
All data stays in the configured stores. Choose the region of your MongoDB, SQL Server and S3-compatible bucket to meet residency needs (for example a UAE region). When the live LLM is enabled, document content is sent to the Anthropic API; confirm this fits your data handling policy and your contract before enabling it, or keep `LLM_MODE=mock` for local testing.

## What the product does not claim
The checks are labelled **policy checks**. The product does not assert legal or regulatory compliance. Interpretation of CBUAE, VARA or acquirer rules stays with the compliance team, and screening is only real when a real `ScreeningProvider` is configured.

## UAE PASS
- **Invite links** are 256-bit, stored as a SHA-256 hash, compared in constant time, expire (default 72 h) and travel in an `x-invite` header, never in an API URL that gets logged. The portal keeps it in session storage and strips it from the address bar.
- **Login** uses OAuth state, nonce and PKCE (S256). State is held in a signed, httpOnly, 10 minute cookie. A wrong or replayed state is refused. Codes and tokens are never logged.
- **Account level**: only SOP2 and SOP3 (Emirates ID verified) are accepted.
- **Emirates ID number** is encrypted with the PII cipher, matched by keyed hash, masked on screen, and never sent to the browser in full.
- **Merchant session** is a separate httpOnly cookie. Share requests and signing need both the invite and that session, so the link alone is not enough.
- **Documents** shared through UAE PASS enter intake like any other file (encrypted storage, hashing, dedupe) and carry `provenance: issuer_verified`. The verifier still runs. The no-automatic-approval rule is unchanged.
- **Audit**: login, share request, approval, decline, expiry, ingestion and signing events are all recorded.
