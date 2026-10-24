#!/usr/bin/env bash
# First calls against a locally running sandbox (npm start). Needs curl and jq.
# Reads the sandbox key for a merchant from .sandbox-keys.json (git-ignored, created at boot).
set -euo pipefail
cd "$(dirname "$0")/.."
uuid() { if command -v uuidgen >/dev/null 2>&1; then uuidgen; else cat /proc/sys/kernel/random/uuid; fi; }
BASE="${MB_BASE_URL:-http://localhost:${PORT:-8080}/v1}"
CRED="${1:-merchant_a1}"
CLIENT_ID=$(jq -r ".${CRED}.clientId" .sandbox-keys.json)
CLIENT_SECRET=$(jq -r ".${CRED}.secret" .sandbox-keys.json)

echo "1. Get an access token (credential: $CRED)"
TOKEN=$(curl -sS "$BASE/oauth/token" \
  -d grant_type=client_credentials -d "client_id=$CLIENT_ID" -d "client_secret=$CLIENT_SECRET" | jq -r .access_token)
echo "   token: ${TOKEN:0:24}..."

echo "2. Who am I? (tenant comes from the credential, never from a header)"
curl -sS "$BASE/me" -H "Authorization: Bearer $TOKEN" | jq .

echo "3. Register a webhook endpoint (the secret is shown once)"
HOOK_URL="${HOOK_URL:-http://127.0.0.1:9099/hook}"
curl -sS "$BASE/webhook-endpoints" -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuid)" \
  -H 'Content-Type: application/json' -d "{\"url\":\"$HOOK_URL\",\"events\":[\"*\"]}" | tee /tmp/mb-endpoint.json | jq '{id, url, events, status, secret: (.secret[0:10] + "...")}'
EP=$(jq -r .id /tmp/mb-endpoint.json)

echo "4. Send a ping, then look at the delivery"
curl -sS -X POST "$BASE/webhook-endpoints/$EP/ping" -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuid)" | jq .
sleep 2.5
curl -sS "$BASE/webhook-deliveries?endpoint_id=$EP" -H "Authorization: Bearer $TOKEN" | jq '.data[] | {status, attempts: [.attempts[] | {number, status_code}]}'

echo "5. Retrying the same ping with the same Idempotency-Key replays the stored answer"
KEY=$(uuid)
curl -sS -i -X POST "$BASE/webhook-endpoints/$EP/ping" -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $KEY" | grep -iE '^(HTTP|idempotent)' || true
curl -sS -i -X POST "$BASE/webhook-endpoints/$EP/ping" -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $KEY" | grep -iE '^(HTTP|idempotent)' || true

echo "6. Errors use one envelope"
curl -sS "$BASE/webhook-endpoints?limit=500" -H "Authorization: Bearer $TOKEN" | jq .

echo "7. The audit chain verifies"
curl -sS "$BASE/audit-events/verification" -H "Authorization: Bearer $TOKEN" | jq .
