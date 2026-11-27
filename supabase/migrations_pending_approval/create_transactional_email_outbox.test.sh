#!/usr/bin/env bash
# Disposable-cluster test: throwaway PostgreSQL 16 cluster with the Supabase roles and the tables the preflight reads;
# runs the preflight, migration, assertions, rollback, preflight again, and re-applies the migration.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"
PORT="${PGPORT:-55433}"
trap 'su postgres -s /bin/sh -c "$PGBIN/pg_ctl -D $WORK/data stop -m fast" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
chmod 777 "$WORK"
su postgres -s /bin/sh -c "$PGBIN/initdb -D $WORK/data -U postgres >/dev/null"
su postgres -s /bin/sh -c "$PGBIN/pg_ctl -D $WORK/data -o '-p $PORT -k $WORK' -l $WORK/log -w start >/dev/null"
P="su postgres -s /bin/sh -c"
psql_q() { $P "$PGBIN/psql -h $WORK -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f $1"; }
psql_v() { $P "$PGBIN/psql -h $WORK -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q -tA -F, -f $1"; }
cat > "$WORK/base.sql" <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE TABLE payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference_number text, status text);
CREATE TABLE navigator_paid_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, expires_at timestamptz);
INSERT INTO payments (reference_number, status) VALUES ('PS-KEEP0001', 'approved');
SQL
chmod 644 "$WORK"/*.sql "$HERE"/create_transactional_email_outbox*.sql
psql_q "$WORK/base.sql"
pre=$(psql_v "$HERE/create_transactional_email_outbox.preflight.sql")
[[ "$pre" == "postgres,f,t,t,t,t,3" ]] || { echo "FAIL: preflight before apply: $pre"; exit 1; }
echo "PASS: preflight (read-only) before apply"
psql_q "$HERE/create_transactional_email_outbox.sql"
psql_q "$HERE/create_transactional_email_outbox.test.sql"
echo "PASS: migration + assertions"
psql_q "$HERE/create_transactional_email_outbox.sql"
echo "PASS: migration is re-runnable"
psql_q "$HERE/create_transactional_email_outbox.down.sql"
kept=$($P "$PGBIN/psql -h $WORK -p $PORT -U postgres -d postgres -tAc \"select count(*) from payments where reference_number='PS-KEEP0001'\"")
[[ "$(echo $kept)" = "1" ]] || { echo "FAIL: rollback touched payments"; exit 1; }
pre=$(psql_v "$HERE/create_transactional_email_outbox.preflight.sql")
[[ "$pre" == postgres,f,* ]] || { echo "FAIL: rollback left the outbox: $pre"; exit 1; }
echo "PASS: rollback drops only the outbox"
psql_q "$HERE/create_transactional_email_outbox.sql"
echo "PASS: re-apply after rollback"
