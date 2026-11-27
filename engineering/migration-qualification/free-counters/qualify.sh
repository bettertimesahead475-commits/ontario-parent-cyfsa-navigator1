#!/usr/bin/env bash
set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
applied=067446ab96027f9fc09a606af213e236c4ff5a13
candidate=12d79e04d91006ea49fbfe748c3d6a7af5b5836f
pending=supabase/migrations_pending_approval
pgbin=$(pg_config --bindir)
port=${FREE_COUNTER_TEST_PORT:-54329}
app_checkout=${1:-}
[[ "$port" =~ ^[0-9]{4,5}$ ]] || { echo 'Expected a numeric test port' >&2; exit 1; }
git -C "$repo" cat-file -e "$applied^{commit}"
git -C "$repo" cat-file -e "$candidate^{commit}"
if [[ -n "$app_checkout" && $(git -C "$app_checkout" rev-parse HEAD) != "$candidate" ]]; then
  echo "Expected candidate checkout $candidate" >&2
  exit 1
fi

scratch=$(mktemp -d)
cleanup() {
  "$pgbin/pg_ctl" -D "$scratch/db" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
# Explicit connection options and no inherited PG service/defaults.
unset PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSFILE PGPASSWORD
"$pgbin/initdb" -D "$scratch/db" --locale=en_US.UTF-8 --encoding=UTF8 --auth=trust -U postgres >"$scratch/init.log"
"$pgbin/pg_ctl" -D "$scratch/db" -l "$scratch/server.log" -w start \
  -o "-h 127.0.0.1 -k '$scratch' -p $port" >/dev/null
psql=("$pgbin/psql" -X -v ON_ERROR_STOP=1 -h "$scratch" -p "$port" -U postgres -d postgres)
run() { "${psql[@]}" -q "$@"; }
scalar() { "${psql[@]}" -Atq -c "$1"; }
check() {
  local expected=$1 query=$2 actual
  actual=$(scalar "$query")
  if [[ "$actual" != "$expected" ]]; then
    printf 'Expected %s, got %s: %s\n' "$expected" "$actual" "$query" >&2
    exit 1
  fi
}
extract() { git -C "$repo" show "$1:$pending/$2.sql" >"$scratch/$3.sql"; }
extract "$applied" free_scan_reservation_functions A
extract "$applied" reconcile_skip_live_analyzer_jobs B
extract "$candidate" free_scan_reservation_functions candidate-A
sha256sum "$scratch/"{A,B,candidate-A}.sql
run -f "$here/fixture.sql"
run -f "$repo/supabase/migrations/20261104230000_durable_analyzer_queue.sql"
run -f "$repo/$pending/paid_credit_reservation_functions.sql"
run -c "CREATE INDEX CONCURRENTLY analyzer_jobs_live_reservation_idx
         ON public.analyzer_jobs (reservation_id) WHERE status IN ('queued','running');"
run -f "$scratch/A.sql"
run -f "$scratch/B.sql"
run -f "$here/inspect.sql" >"$scratch/preflight.log"
run -f "$here/verify.sql"
run -f "$here/queue-guard.sql"

# Hold one real transaction, prove another backend is blocked on its lock, and
# require the other mode to complete before permitting the holding commit.
mkfifo "$scratch/input"
exec 3<>"$scratch/input"
PGAPPNAME=counter-holder run <"$scratch/input" >"$scratch/holder.log" 2>&1 &
holder=$!
hold() {
  printf 'BEGIN; SET LOCAL ROLE service_role;\n%s\n' "$1" >&3
}
wait_state() {
  local app=$1 predicate=$2
  for ((i=0; i<100; i++)); do
    if [[ $(scalar "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = '$app' AND ($predicate));") == t ]]; then
      return
    fi
    sleep 0.05
  done
  echo "Timed out waiting for $app: $predicate" >&2
  exit 1
}
reserve() {
  printf "SELECT public.free_reserve_scan('%s','%s',1,now(),interval '15 min')->>'status';" "$1" "$2"
}
for lane in fq ff; do
  other=ff
  [[ "$lane" != ff ]] || other=fq
  hold "$(reserve "$lane:race-$lane" first-doc)"
  wait_state counter-holder "state = 'idle in transaction' AND query LIKE '%free_reserve_scan%'"
  PGAPPNAME=counter-racer scalar "SET ROLE service_role; $(reserve "$lane:race-$lane" second-doc)" >"$scratch/racer.log" &
  racer=$!
  wait_state counter-racer "cardinality(pg_blocking_pids(pid)) = 1"
  check reserved "SET statement_timeout = '2s'; SET ROLE service_role; $(reserve "$other:race-$lane" other-doc)"
  printf 'COMMIT;\n' >&3
  wait "$racer"
  [[ $(<"$scratch/racer.log") == limit ]]
  echo "PASS: $lane same-key contender blocked and lost; $other completed while lock was held"
done
hold "$(reserve ff:interrupted aborted-doc)"
wait_state counter-holder "state = 'idle in transaction' AND query LIKE '%free_reserve_scan%'"
check t "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'counter-holder';"
printf 'SELECT 1;\n\\q\n' >&3
if wait "$holder"; then
  echo 'Expected terminated holder to fail' >&2
  exit 1
fi
exec 3>&-
check 0 "SELECT count(*) FROM public.free_usage
         WHERE uid IN ('ff:interrupted', public.free_marker_uid('ff:interrupted','aborted-doc'));"
check reserved "SET ROLE service_role; $(reserve ff:interrupted retry-doc)"
echo 'PASS: terminated backend rolled back counter and marker; retry succeeded'

snapshot() {
  scalar "SELECT md5(string_agg(to_jsonb(f)::text, ',' ORDER BY uid)) FROM public.free_usage f;"
}
before=$(snapshot)
run -f "$scratch/A.sql"
run -f "$scratch/B.sql"
check "$before" "SELECT md5(string_agg(to_jsonb(f)::text, ',' ORDER BY uid)) FROM public.free_usage f;"
run -f "$here/queue-guard.sql"
echo 'PASS: ordered A+B reapplication leaves all ledger rows unchanged'

"$pgbin/pg_dump" -h "$scratch" -p "$port" -U postgres -d postgres -Fc -f "$scratch/backup.dump"
check reserved "SET ROLE service_role; $(reserve ff:after-backup new-doc)"
before=$(snapshot)
run -c 'CREATE DATABASE restore_check;'
"$pgbin/pg_restore" -h "$scratch" -p "$port" -U postgres -d restore_check --exit-on-error "$scratch/backup.dump"
[[ $("${psql[@]}" -d restore_check -Atq -c "SELECT count(*) FROM public.free_usage WHERE uid = 'ff:after-backup';") == 0 ]]
"${psql[@]}" -d restore_check -q -f "$here/queue-guard.sql"
echo 'PASS: backup restores to a different database; it omits transactions committed after backup'

run -f "$scratch/candidate-A.sql"
if run -f "$here/queue-guard.sql" >"$scratch/guard-failure.log" 2>&1; then
  echo 'Expected reapplying candidate A after B to remove the live-job guard' >&2
  exit 1
fi
grep -F 'another request reclaimed a queued job entitlement: reserved' "$scratch/guard-failure.log"
echo 'FAIL: candidate A alone regresses the live-job guard (reproduced)'
run -f "$scratch/B.sql"
run -f "$here/queue-guard.sql"
[[ $(snapshot) == "$before" ]]
echo 'PASS: forward repair reapplies B; no post-backup rows overwritten'

run -f "$here/compatibility.sql"
run -f "$here/inspect.sql" >"$scratch/postverify.log"

if [[ -n "$app_checkout" ]]; then
  (cd -- "$app_checkout" && CREDIT_PG_URL="postgres://postgres@127.0.0.1:$port/postgres" \
    NODE_OPTIONS=--no-experimental-webstorage npx --no-install vitest run \
      tests/devin/free-trial-entitlements.pg.test.ts api/cloudflare-free-credit-reservation.test.ts \
      api/cloudflare-analyzer-usage.test.ts api/cloudflare-deep-scan.test.ts \
      api/cloudflare-analyzer-queue-producer.test.ts)
fi
