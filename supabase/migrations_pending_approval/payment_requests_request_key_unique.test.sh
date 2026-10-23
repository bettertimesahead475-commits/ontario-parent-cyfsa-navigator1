#!/usr/bin/env bash
# Disposable-cluster test: builds a throwaway PostgreSQL 16 cluster, applies a minimal payments
# table, runs migration, the SQL assertions, a rollback, and re-applies the migration.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"
PORT="${PGPORT:-55432}"
trap 'su postgres -s /bin/sh -c "$PGBIN/pg_ctl -D $WORK/data stop -m fast" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
chmod 777 "$WORK"
su postgres -s /bin/sh -c "$PGBIN/initdb -D $WORK/data -U postgres >/dev/null"
su postgres -s /bin/sh -c "$PGBIN/pg_ctl -D $WORK/data -o '-p $PORT -k $WORK' -l $WORK/log -w start >/dev/null"
P="su postgres -s /bin/sh -c"
psql_q() { $P "$PGBIN/psql -h $WORK -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f $1"; }
cat > "$WORK/base.sql" <<'SQL'
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan text NOT NULL, amount numeric NOT NULL, reference_number text, status text DEFAULT 'pending',
  notes text, submitted_at timestamptz DEFAULT now()
);
SQL
chmod 644 "$WORK"/*.sql "$HERE"/*.sql
psql_q "$WORK/base.sql"
psql_q "$HERE/payment_requests_request_key_unique.sql"
psql_q "$HERE/payment_requests_request_key_unique.test.sql"
echo "PASS: migration + assertions"
psql_q "$HERE/payment_requests_request_key_unique.rollback.sql"
echo "PASS: rollback"
kept=$($P "$PGBIN/psql -h $WORK -p $PORT -U postgres -d postgres -tAc \"select count(*) from information_schema.columns where table_name='payments' and column_name='firebase_uid'\"")
[ "$(echo $kept)" = "1" ] || { echo "FAIL: rollback removed firebase_uid"; exit 1; }
echo "PASS: rollback keeps firebase_uid"
psql_q "$HERE/payment_requests_request_key_unique.sql"
echo "PASS: re-apply after rollback"
