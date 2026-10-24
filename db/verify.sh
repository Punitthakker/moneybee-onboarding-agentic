#!/usr/bin/env bash
# Boots a throwaway PostgreSQL cluster, applies db/001_foundation.sql and runs db/verify.sql as the runtime roles.
# Needs PostgreSQL server binaries (default /usr/lib/postgresql/16/bin; override with PGBIN). Works as root by
# re-running itself as an unprivileged user, because postgres refuses to run as root.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "PostgreSQL server binaries not found (set PGBIN)"; exit 2; }

if [ "$(id -u)" = 0 ]; then
  id mbverify >/dev/null 2>&1 || useradd -m mbverify
  WORK="$(mktemp -d)"; chmod 755 "$WORK"
  cp -r db "$WORK/db"; chown -R mbverify "$WORK"
  exec su mbverify -c "PGBIN='$PGBIN' bash '$WORK/db/verify.sh'"
fi

DIR="$(mktemp -d)"
PORT="${PGPORT:-54329}"
cleanup() { "$PGBIN/pg_ctl" -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
"$PGBIN/initdb" -D "$DIR" -A trust -U postgres >/dev/null
"$PGBIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
export PGHOST="$DIR" PGPORT="$PORT" PGUSER=postgres
psql -v ON_ERROR_STOP=1 -q -f db/001_foundation.sql >/dev/null
psql -v ON_ERROR_STOP=1 -q -f db/verify.sql
