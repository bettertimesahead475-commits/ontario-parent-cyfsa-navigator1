#!/usr/bin/env bash
# Tests for prod_default_privileges.sql (tables and sequences) and its rollback.
# DISPOSABLE DATABASE ONLY. Function defaults are intentionally not covered (see the SQL header).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB="${TEST_DB:?set TEST_DB to a disposable database}"
P=(psql -q -X -v ON_ERROR_STOP=1 -d "$DB")
probe() {
  local t s
  t=$("${P[@]}" -At -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='dp_probe_t' and has_table_privilege('anon', c.oid, 'SELECT')")
  s=$("${P[@]}" -At -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='dp_probe_s' and has_sequence_privilege('anon', c.oid, 'USAGE')")
  echo "$t $s"
}
create_probes() { "${P[@]}" -c "create table public.dp_probe_t (id int); create sequence public.dp_probe_s;"; }
drop_probes()   { "${P[@]}" -c "drop table if exists public.dp_probe_t; drop sequence if exists public.dp_probe_s;"; }
expect() { [[ "$1" == "$2" ]] || { echo "FAIL $3: got '$1', expected '$2'"; exit 1; }; echo "PASS $3: $1"; }

# Reproduce the observed production defaults for objects created by postgres.
"${P[@]}" -c "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role; alter default privileges for role postgres in schema public grant usage, select, update on sequences to anon, authenticated, service_role;"
create_probes
expect "$(probe)" "1 1" "before fix: new tables and sequences are granted to anon"
drop_probes

"${P[@]}" -f "$here/prod_default_privileges.sql"
create_probes
expect "$(probe)" "0 0" "after fix: new tables and sequences are not granted to anon"
drop_probes

"${P[@]}" -f "$here/prod_default_privileges.rollback.sql"
create_probes
expect "$(probe)" "1 1" "after rollback: defaults restored"
drop_probes

"${P[@]}" -c "alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated; alter default privileges for role postgres in schema public revoke usage, select, update on sequences from anon, authenticated;"
echo "ALL PASS"
