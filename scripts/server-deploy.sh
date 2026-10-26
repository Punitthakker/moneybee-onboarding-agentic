#!/usr/bin/env bash
# Deploys MoneyBee Onboard on one Linux server with Docker (for example an AWS EC2 Ubuntu instance).
#
#   scripts/server-deploy.sh http://16.4.81.129            plain HTTP on port 80 (or the port in the URL)
#   scripts/server-deploy.sh https://16-4-81-129.sslip.io  HTTPS with an automatic Let's Encrypt certificate (ports 80 and 443 open)
#
# Safe to re-run: it keeps .env (secrets, logins) and the data volumes, and only rebuilds and restarts the containers.
set -euo pipefail
cd "$(dirname "$0")/.."

URL="${1:?usage: scripts/server-deploy.sh <public URL, for example http://16.4.81.129>}"
URL="${URL%/}"
SCHEME="${URL%%://*}"
HOSTPORT="${URL#*://}"; HOSTPORT="${HOSTPORT%%/*}"
HOST="${HOSTPORT%%:*}"
PORT="80"; [[ "$HOSTPORT" == *:* ]] && PORT="${HOSTPORT##*:}"

# 1. Docker Compose v2 for this user if the server does not have it (no root needed)
if ! docker compose version >/dev/null 2>&1; then
  echo "Installing the Docker Compose plugin for $USER ..."
  mkdir -p "$HOME/.docker/cli-plugins"
  curl -fsSL -o "$HOME/.docker/cli-plugins/docker-compose" "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)"
  chmod +x "$HOME/.docker/cli-plugins/docker-compose"
fi
docker compose version

# 2. Docker access
if ! docker info >/dev/null 2>&1; then
  echo
  echo "User $USER cannot use Docker yet. A server admin must run once:"
  echo "    sudo usermod -aG docker $USER"
  echo "then log out and in again (or reconnect over SSH) and re-run this script."
  exit 2
fi

# 3. Secrets and logins (first run only)
if [ ! -f .env ]; then
  if command -v node >/dev/null 2>&1; then node scripts/setup.mjs | tee LOGINS-SERVER.txt
  else docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/app -w /app node:22-bookworm-slim node scripts/setup.mjs | tee LOGINS-SERVER.txt; fi
  chmod 600 .env LOGINS-SERVER.txt
fi

# 4. Server settings (replaces any earlier block)
sed -i '/^# >>> server-deploy/,/^# <<< server-deploy/d' .env
PROFILE=()
{
  echo "# >>> server-deploy (written by scripts/server-deploy.sh)"
  if [ "$SCHEME" = "https" ]; then
    echo "WEB_BIND=127.0.0.1"; echo "WEB_PORT=8080"; echo "PUBLIC_HOST=$HOST"; echo "COOKIE_SECURE=true"
  else
    echo "WEB_BIND=0.0.0.0"; echo "WEB_PORT=$PORT"; echo "COOKIE_SECURE=false"
  fi
  echo "PUBLIC_API_URL=$URL"
  echo "DOCKER_PUBLIC_WEB_URL=$URL"
  echo "CORS_ORIGINS=$URL"
  echo "# <<< server-deploy"
} >> .env
[ "$SCHEME" = "https" ] && PROFILE=(--profile https)

# 5. Build and start (stop the no-Docker setup first if it was used on this server)
[ -x scripts/server-native.sh ] && scripts/server-native.sh stop >/dev/null 2>&1 || true
docker compose "${PROFILE[@]}" up -d --build

# 6. Wait for the app
echo "Waiting for $URL ..."
for i in $(seq 1 90); do
  if curl -fsS -m 5 "http://127.0.0.1:$([ "$SCHEME" = https ] && echo 8080 || echo "$PORT")/api/v1/public/tenant" >/dev/null 2>&1; then
    echo "Ready: $URL   (Botim: $URL/?tenant=botim, merchant portal: $URL/apply?tenant=botim)"
    docker compose ps --format '{{.Service}}  {{.Status}}'
    exit 0
  fi
  sleep 5
done
echo "The app did not answer in time. Check: docker compose logs --tail 100 api web"
exit 1
