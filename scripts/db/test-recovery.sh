#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
for tool in docker python3 gpg; do command -v "$tool" >/dev/null; done

image=${POSTGRES_IMAGE:-postgres:17}
work=$(mktemp -d "${TMPDIR:-/tmp}/cyfsa-recovery.XXXXXXXX")
work=$(realpath "$work")
source_container="cyfsa-source-${work##*.}"
scratch_container="cyfsa-scratch-${work##*.}"
cleanup() {
  docker rm -f "$source_container" "$scratch_container" >/dev/null 2>&1 || true
  GNUPGHOME="$work/gnupg" gpgconf --kill all || true
  rm -r "$work"
}
trap cleanup EXIT

python3 - "$work" <<'PY'
from pathlib import Path
from runpy import run_path
import sys

recovery = run_path("scripts/db/recovery.py")
schema_digest = recovery["schema_digest"]
approved_schemas = recovery["approved_schemas"]
schema = Path(sys.argv[1]) / "schema-test.sql"
header = "-- PostgreSQL database dump\n\\restrict {}\n-- Dumped from database version {}\n-- Dumped by pg_dump version {}\n"
body = "SET statement_timeout = 0;\nCREATE TABLE test (id int);\n-- Dumped from database version function body\n"

def fingerprint(key, version, sql):
    schema.write_text(header.format(key, version, version) + sql + f"\\unrestrict {key}\n")
    return schema_digest(schema, key)

expected = fingerprint("a" * 64, "17.11", body)
assert fingerprint("b" * 64, "17.12", body) == expected
assert fingerprint("b" * 64, "17.12", body.replace("int", "text")) != expected
assert fingerprint("b" * 64, "17.12", body.replace("function body", "changed body")) != expected
print("PASS: schema fingerprint ignores version banners and generated restrict keys, not SQL body changes")

assert approved_schemas(["public", "auth", "public"]) == ["auth", "public"]
for requested in ([], ["public", "unapproved"], ["--format=plain"], "public"):
    try:
        approved_schemas(requested)
    except ValueError:
        continue
    raise AssertionError(f"Expected refusal of schema scope: {requested!r}")
print("PASS: schema allowlist refuses unsupported scopes")
PY

mkdir "$work/bin" "$work/gnupg"
export GNUPGHOME="$work/gnupg"
export CYFSA_RECOVERY_BACKUP_DIR="$work"
export PATH="$work/bin:$PATH"
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGSYSCONFDIR PGOPTIONS PGPASSWORD PGPASSFILE PGSSLMODE
export PGHOST=/var/run/postgresql PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
for tool in psql pg_dump pg_restore; do
  ln -s "$PWD/scripts/db/test-pg-client.sh" "$work/bin/$tool"
done
for container in "$source_container" "$scratch_container"; do
  docker run -d --name "$container" --network none --tmpfs /var/lib/postgresql/data \
    --mount "type=bind,source=$work,target=$work,readonly" -e POSTGRES_HOST_AUTH_METHOD=trust "$image" \
    -c listen_addresses='' >/dev/null
  export DRILL_CONTAINER="$container"
  for (( attempt=0; attempt<40; attempt++ )); do
    if psql -XqAt -c 'select 1' >/dev/null 2>&1 &&
       docker exec "$container" sh -c 'test "$(cat /proc/1/comm)" = postgres'; then break; fi
    sleep 0.25
  done
  psql -Xv ON_ERROR_STOP=1 -c 'select version()' -At
done

pg() { PGDATABASE="$1" psql -XqAt -v ON_ERROR_STOP=1 "${@:2}"; }
assert_sql() {
  local db=$1 expected=$2 actual
  actual=$(pg "$db" -c "$3")
  if [[ "$actual" != "$expected" ]]; then
    printf 'Expected %s, got %s\nQuery: %s\n' "$expected" "$actual" "$3" >&2
    exit 1
  fi
}
must_fail() {
  local pattern=$1
  shift
  if "$@" >"$work/refusal.log" 2>&1 || ! rg_fallback "$pattern" "$work/refusal.log"; then
    cat "$work/refusal.log" >&2
    printf 'Expected command to fail with: %s\n' "$pattern" >&2
    exit 1
  fi
}
rg_fallback() { awk -v pattern="$1" 'index($0, pattern) {print; found=1} END {exit !found}' "$2"; }

source_db=recovery_source_release
scratch_db=recovery_scratch_release
migration=supabase/migrations_pending_approval/payments_service_role_review_update.sql
preflight=${migration%.sql}.preflight.sql
rollback=${migration%.sql}.rollback.sql
# The pending G file has no operational version assigned. This version is only for the drill.
version=20990101000000
recovery=(python3 scripts/db/recovery.py)
release=(--version "$version" --migration "$migration")
artifact=(--artifact "$work/baseline.gpg" --work-dir "$work")

export DRILL_CONTAINER="$source_container"
pg postgres -c "create database $source_db template template0"
pg "$source_db" < tests/devin/fixtures/live-nxfh-payment-schema.sql
for file in supabase/migrations/20261104230000_durable_analyzer_queue.sql \
            supabase/migrations/20261109192000_restore_payment_checkout_service_role_access.sql \
            supabase/migrations/20261109202000_navigator_payment_summary.sql; do
  pg "$source_db" < "$file"
done
pg "$source_db" <<'SQL'
create table public.drill_policy (id bigint generated always as identity primary key, visible boolean not null);
alter table public.drill_policy enable row level security;
create policy visible_rows on public.drill_policy for select to authenticated using (visible);
grant select on public.drill_policy to authenticated;
insert into public.drill_policy(visible) values (true), (false);
insert into public.payments (id,plan,amount,firebase_uid,request_key,submitted_at)
values ('00000000-0000-0000-0000-000000000001','Basic',10,'drill-owner','existing','2026-11-01T00:00Z');
insert into public.navigator_paid_sessions (id,firebase_uid,tier,expires_at)
values ('00000000-0000-0000-0000-000000000011','drill-owner','Basic','2027-01-01T00:00Z');
SQL
assert_sql "$source_db" 'f|f|f|f|1' "$(cat "$preflight")"
PGDATABASE="$source_db" "${recovery[@]}" preflight --local "${release[@]}"
must_fail 'Default requires an explicit local Unix socket' env PGHOST=127.0.0.1 PGDATABASE="$source_db" \
  "${recovery[@]}" preflight --local "${release[@]}"
must_fail 'Require the verified direct Supabase endpoint' env PGDATABASE="$source_db" \
  "${recovery[@]}" preflight --project-ref 'aaaaaaaaaaaaaaaaaaaa' "${release[@]}"
must_fail 'Migration must be in a repository Supabase migration directory' env PGDATABASE="$source_db" \
  "${recovery[@]}" preflight --local "${release[@]}" --migration "$work/schema-test.sql"
must_fail 'Artifact must be a direct, non-symlink child' env PGDATABASE="$source_db" \
  "${recovery[@]}" backup --local "${release[@]}" "${artifact[@]}" --artifact "$work/bin/unapproved.gpg" --schema public --recipient invalid
must_fail 'Provide the approved full GPG key fingerprint' env PGDATABASE="$source_db" \
  "${recovery[@]}" backup --local "${release[@]}" "${artifact[@]}" --schema public --recipient=--version
gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key \
  'Disposable Recovery Test <recovery@example.invalid>' rsa2048 encr 1d >/dev/null 2>&1
key=$(gpg --batch --with-colons --fingerprint --list-keys 2>/dev/null | awk -F: '$1=="fpr" { print $10; exit }')
watermark=$(pg "$source_db" -c 'select max(submitted_at) from public.payments')

coproc HELD { pg "$source_db"; }
held_pid=$HELD_PID
exec {held_in}>&"${HELD[1]}" {held_out}<&"${HELD[0]}"
printf '%s\n' "begin; insert into public.payments (id,plan,amount,firebase_uid,request_key,submitted_at)
values ('00000000-0000-0000-0000-000000000002','Basic',20,'drill-owner','late-commit','2026-10-31T00:00Z');
select 'held';" >&"$held_in"
read -r ready <&"$held_out"
[[ "$ready" == held ]]
hash_output=$(PGDATABASE="$source_db" "${recovery[@]}" backup --local "${release[@]}" \
  "${artifact[@]}" --schema public --recipient "$key")
echo "$hash_output"
hash=${hash_output##* }
printf '%s\n' 'commit;' '\q' >&"$held_in"
exec {held_in}>&- {held_out}<&-
wait "$held_pid"
echo 'PASS: encrypted backup taken while an older-timestamp payment was uncommitted'

pg "$source_db" < "$migration"
pg "$source_db" < "$migration"
assert_sql "$source_db" 't|t|f|f|2' "$(cat "$preflight")"
pg "$source_db" -c "set role service_role; update public.payments set status='approved', approved_at='2026-11-27T18:00Z' where request_key='late-commit'"
must_fail 'division by zero' pg "$source_db" -c "begin; update public.payments set status='rejected' where request_key='late-commit'; select 1/0; commit;"
assert_sql "$source_db" approved "select status from public.payments where request_key='late-commit'"
assert_sql "$source_db" 0 "select count(*) from public.payments where submitted_at > '$watermark'"
echo 'PASS: G re-applied; committed approval survived interrupted SQL; timestamp-only delta missed the late commit'

# Stand-in for an owner-approved delta from quiesced systems: stable-key set difference for this insert-only cohort.
pg "$source_db" -c "\copy (select * from public.payments where id <> '00000000-0000-0000-0000-000000000001' order by id) to stdout with (format csv)" >"$work/delta.csv"
export DRILL_CONTAINER="$scratch_container"
pg postgres -c 'create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;'
restore=( "${recovery[@]}" restore --local "${release[@]}" "${artifact[@]}" --artifact-sha256 "$hash" )
must_fail 'Require a disposable' env PGDATABASE=postgres "${restore[@]}"
must_fail 'Remote restore is prohibited' env PGDATABASE="$scratch_db" "${recovery[@]}" restore \
  --project-ref aaaaaaaaaaaaaaaaaaaa "${release[@]}" "${artifact[@]}" --artifact-sha256 "$hash"
cp "$work/baseline.gpg" "$work/tampered.gpg"
printf x >>"$work/tampered.gpg"
must_fail 'Encrypted artifact SHA-256 mismatch' env PGDATABASE="$scratch_db" "${restore[@]}" --artifact "$work/tampered.gpg"
assert_sql postgres 0 "select count(*) from pg_database where datname='$scratch_db'"
PGDATABASE="$scratch_db" "${restore[@]}"
must_fail 'already exists' env PGDATABASE="$scratch_db" "${restore[@]}"
assert_sql "$scratch_db" 'f|f|f|f|1' "$(cat "$preflight")"
assert_sql "$scratch_db" 1 'set role authenticated; select count(*) from public.drill_policy'
assert_sql "$scratch_db" t "select relrowsecurity and to_regclass('public.payments_firebase_uid_request_key_uidx') is not null from pg_class where oid='public.payments'::regclass"
must_fail 'permission denied' pg "$scratch_db" -c 'set role anon; select count(*) from public.payments'
must_fail 'duplicate key' pg "$scratch_db" -c "insert into public.payments(plan,amount,firebase_uid,request_key) values ('Basic',10,'drill-owner','existing')"
must_fail 'check constraint' pg "$scratch_db" -c "insert into public.payments(plan,amount,status) values ('Basic',10,'invalid')"
assert_sql "$scratch_db" 'drill-owner|Basic|2027-01-01' 'select firebase_uid,tier,expires_at::date from public.navigator_paid_sessions'
echo 'PASS: scratch refusal gates, RLS and policy visibility, ACLs, unique index, check constraint and existing entitlement'

# Scratch only. Refuse conflicting payloads for IDs already present; identical repeats are a no-op.
for run in 1 2; do
  {
    printf '%s\n' 'begin;' 'create temporary table delta (like public.payments) on commit drop;' \
      '\copy delta from stdin with (format csv)'
    cat "$work/delta.csv"
    printf '%s\n' '\.'
    cat <<'SQL'
do $$ begin
  if exists (select 1 from delta d join public.payments p using (id) where row(d.*) is distinct from row(p.*)) then
    raise exception 'conflicting delta row';
  end if;
end $$;
insert into public.payments select * from delta on conflict (id) do nothing;
commit;
SQL
  } | pg "$scratch_db"
  assert_sql "$scratch_db" 'approved|20|2026-11-27' "select status,amount,approved_at::date from public.payments where request_key='late-commit'"
  assert_sql "$scratch_db" 2 'select count(*) from public.payments'
done
pg "$scratch_db" < "$migration"
pg "$scratch_db" < "$rollback"
assert_sql "$scratch_db" 'f|f|f|f|1' "$(cat "$preflight")"
assert_sql "$scratch_db" approved "select status from public.payments where request_key='late-commit'"
echo 'PASS: stable-key reconciliation replayed twice; G rollback removed privilege, not committed approval'
echo 'PASS: disposable PostgreSQL backup/recovery drill'
