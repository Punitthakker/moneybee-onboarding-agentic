#!/usr/bin/env bash
# Runs MoneyBee Onboard on a Linux server WITHOUT Docker and without root:
# Node.js runs the API and serves the web app, MongoDB and Mailpit run as the same user from downloaded binaries.
# Use this when the user cannot use Docker; scripts/server-deploy.sh (Docker) remains the standard setup.
#
#   scripts/server-native.sh install <public URL>   build, download MongoDB and Mailpit, create .env, start, add a start-on-reboot entry
#   scripts/server-native.sh start | stop | restart | status | logs
#
# The public URL decides the port, for example http://16.4.81.129:8080 (ports below 1024 need root).
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
RT="${MB_RUNTIME:-$HOME/.local/share/moneybee}"
BIN="$RT/bin"; LOGS="$RT/logs"; RUN="$RT/run"
mkdir -p "$BIN" "$LOGS" "$RUN" "$RT/mongo" "$RT/files"
export PATH="$BIN:$RT/node/bin:$PATH"
cd "$APP"

say() { printf '\n== %s\n' "$*"; }
pid_alive() { [ -f "$RUN/$1.pid" ] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }
public_url() { cat "$RT/public-url" 2>/dev/null || echo "http://127.0.0.1:8080"; }
port_of() { local hp="${1#*://}"; hp="${hp%%/*}"; [[ "$hp" == *:* ]] && echo "${hp##*:}" || { [[ "$1" == https* ]] && echo 443 || echo 80; }; }

ensure_node() {
  if command -v node >/dev/null && command -v npm >/dev/null; then return; fi
  say "Downloading Node.js 22 (npm is not installed on this server)"
  local f; f=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-x64.tar.xz$/{print $2; exit}')
  rm -rf "$RT/node" && mkdir -p "$RT/node"
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$f" | tar -xJ -C "$RT/node" --strip-components=1
  node -v; npm -v
}

ensure_mongod() {
  if [ -x "$BIN/mongod" ] && "$BIN/mongod" --version >/dev/null 2>&1; then return; fi
  say "Downloading MongoDB (server binary only, runs as $USER)"
  local url
  url=$( (curl -fsSL https://downloads.mongodb.org/current.json || true) | python3 -c '
import json, sys
d = json.load(sys.stdin)
for target in ("ubuntu2404", "ubuntu2204"):
    for v in d["versions"]:
        if not v["version"].startswith("8.0.") or not v.get("production_release", True):
            continue
        for dl in v.get("downloads", []):
            if dl.get("target") == target and dl.get("arch") == "x86_64" and dl.get("edition") in ("base", "targeted"):
                print(dl["archive"]["url"]); sys.exit(0)
sys.exit(1)' || true)
  if [ -z "$url" ]; then
    # fallback: probe known release archives
    for v in 8.0.17 8.0.16 8.0.15 8.0.14 8.0.13 8.0.12 8.0.11 8.0.10 8.0.9 8.0.8 8.0.6 8.0.4; do
      for t in ubuntu2404 ubuntu2204; do
        u="https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-$t-$v.tgz"
        if curl -fsIL -m 10 "$u" >/dev/null 2>&1; then url="$u"; break 2; fi
      done
    done
  fi
  [ -n "$url" ] || { echo "could not find a MongoDB download"; exit 1; }
  echo "$url"
  local tmp; tmp=$(mktemp -d)
  curl -fsSL "$url" | tar -xz -C "$tmp"
  cp "$tmp"/*/bin/mongod "$BIN/mongod"; chmod +x "$BIN/mongod"; rm -rf "$tmp"
  "$BIN/mongod" --version | head -1
}

ensure_mailpit() {
  if [ -x "$BIN/mailpit" ]; then return; fi
  say "Downloading Mailpit (local mail catcher for magic links)"
  curl -fsSL https://github.com/axllent/mailpit/releases/latest/download/mailpit-linux-amd64.tar.gz | tar -xz -C "$BIN" mailpit
  chmod +x "$BIN/mailpit"; "$BIN/mailpit" version | head -1
}

build() {
  say "Installing packages and building (a few minutes on a small server)"
  npm ci --no-audit --no-fund
  npm run build -w @moneybee/api
  npm run build -w @moneybee/web
}

ensure_env() {
  if [ ! -f .env ]; then
    say "Creating .env with fresh secrets and demo logins (saved in LOGINS-SERVER.txt)"
    node scripts/setup.mjs | tee LOGINS-SERVER.txt
    chmod 600 .env LOGINS-SERVER.txt
  fi
}

start_mongo() {
  pid_alive mongod && return
  "$BIN/mongod" --dbpath "$RT/mongo" --bind_ip 127.0.0.1 --port 27017 --fork --logpath "$LOGS/mongod.log" --pidfilepath "$RUN/mongod.pid" >/dev/null
  echo "mongod started"
}
start_mailpit() {
  pid_alive mailpit && return
  nohup "$BIN/mailpit" --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025 --database "$RT/mailpit.db" >"$LOGS/mailpit.log" 2>&1 &
  echo $! >"$RUN/mailpit.pid"; echo "mailpit started"
}
start_api() {
  pid_alive api && return
  local url port; url=$(public_url); port=$(port_of "$url")
  # values set here win over .env (node --env-file never overrides variables that are already set)
  NODE_ENV=production PORT="$port" WEB_DIST="$APP/apps/web/dist" \
  STORE=mongo REPO=mongo QUEUE_MODE=inline MONGO_URL=mongodb://127.0.0.1:27017/moneybee_onboard \
  STORAGE=local LOCAL_STORAGE_DIR="$RT/files" SMTP_URL=smtp://127.0.0.1:1025 MAILER=smtp \
  POLICIES_DIR="$APP/policies" TENANTS_DIR="$APP/tenants" MIGRATIONS_DIR="$APP/db/migrations" \
  PUBLIC_API_URL="$url" PUBLIC_WEB_URL="$url" CORS_ORIGINS="$url" COOKIE_SECURE="$([[ "$url" == https* ]] && echo true || echo false)" \
  nohup node --env-file="$APP/.env" "$APP/apps/api/dist/server.js" >>"$LOGS/api.log" 2>&1 &
  echo $! >"$RUN/api.pid"; echo "api started on port $port"
}
wait_ready() {
  local port; port=$(port_of "$(public_url)")
  for _ in $(seq 1 60); do
    if curl -fsS -m 3 "http://127.0.0.1:$port/api/v1/public/tenant" >/dev/null 2>&1; then echo "ready: $(public_url)"; return 0; fi
    pid_alive api || { echo "the API stopped, last log lines:"; tail -40 "$LOGS/api.log"; return 1; }
    sleep 2
  done
  echo "not ready after 2 minutes"; tail -40 "$LOGS/api.log"; return 1
}
stop_all() {
  for s in api mailpit; do pid_alive "$s" && kill "$(cat "$RUN/$s.pid")" && echo "$s stopped"; rm -f "$RUN/$s.pid"; done
  if pid_alive mongod; then "$BIN/mongod" --dbpath "$RT/mongo" --shutdown >/dev/null 2>&1 || kill "$(cat "$RUN/mongod.pid")"; echo "mongod stopped"; fi
}
status() {
  for s in mongod mailpit api; do printf '%-8s %s\n' "$s" "$(pid_alive "$s" && echo running || echo stopped)"; done
  echo "url      $(public_url)"
}
add_reboot_entry() {
  local line="@reboot $APP/scripts/server-native.sh start >> $LOGS/boot.log 2>&1"
  if command -v crontab >/dev/null; then
    (crontab -l 2>/dev/null | grep -v 'server-native.sh start' || true; echo "$line") | crontab - && echo "start-on-reboot entry added to crontab"
  else echo "crontab not available: after a reboot run scripts/server-native.sh start"; fi
}

case "${1:-status}" in
  install)
    url="${2:?usage: scripts/server-native.sh install <public URL, for example http://16.4.81.129:8080>}"
    echo "${url%/}" >"$RT/public-url"
    ensure_node; ensure_mongod; ensure_mailpit; build; ensure_env
    say "Starting"
    stop_all >/dev/null 2>&1 || true
    start_mongo; start_mailpit; start_api; wait_ready
    add_reboot_entry
    status ;;
  start) start_mongo; start_mailpit; start_api; wait_ready; status ;;
  stop) stop_all ;;
  restart) stop_all; start_mongo; start_mailpit; start_api; wait_ready; status ;;
  status) status ;;
  logs) tail -n 80 "$LOGS/api.log" ;;
  *) echo "usage: $0 install <url> | start | stop | restart | status | logs"; exit 2 ;;
esac
