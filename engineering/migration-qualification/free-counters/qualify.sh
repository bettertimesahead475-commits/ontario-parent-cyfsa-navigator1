#!/usr/bin/env bash
set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
applied=067446ab96027f9fc09a606af213e236c4ff5a13
candidate=71f5b6811d1c6e465286cc2836453a2c1b52a12d
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
chmod 700 "$scratch"
# Explicit connection options and no inherited PG service/defaults.
unset PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSFILE PGPASSWORD
"$pgbin/initdb" -D "$scratch/db" --locale=en_US.UTF-8 --encoding=UTF8 \
  --auth-local=trust --auth-host=scram-sha-256 -U postgres >"$scratch/init.log"
"$pgbin/pg_ctl" -D "$scratch/db" -l "$scratch/server.log" -w start \
  -o "-c listen_addresses='' -c unix_socket_permissions=0700 -k '$scratch' -p $port" >/dev/null
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
check '' 'SHOW listen_addresses;'
check 0700 'SHOW unix_socket_permissions;'
echo 'PASS: PostgreSQL has no TCP listener and uses a private Unix socket'

extract() { git -C "$repo" show "$1:$pending/$2.sql" >"$scratch/$3.sql"; }
extract "$applied" free_scan_reservation_functions A
extract "$applied" reconcile_skip_live_analyzer_jobs B
extract "$candidate" free_scan_reservation_functions candidate-A
sha256sum "$scratch/"{A,B,candidate-A}.sql
sha256sum "$here/"{apply-a-if-absent,free-queue-settlement-compat}.sql
printf '%s  %s\n' \
  89d5e381e00800e1b654130ec32a55b22de1df691f8c40b0d9fd955e619f6e9b "$scratch/A.sql" \
  9c12c84701f22b169329ea6fa2eb3ad21c81f283108de5a8e3e2bf24c504c763 "$scratch/B.sql" \
  | sha256sum --check --status
apply_a() { run -v a_file="$scratch/A.sql" -f "$here/apply-a-if-absent.sql" >/dev/null; }
run -f "$here/fixture.sql"
run -f "$repo/supabase/migrations/20261104230000_durable_analyzer_queue.sql"
run -f "$repo/$pending/paid_credit_reservation_functions.sql"
run -c "CREATE INDEX CONCURRENTLY analyzer_jobs_live_reservation_idx
         ON public.analyzer_jobs (reservation_id) WHERE status IN ('queued','running');"
apply_a
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
fingerprint_query="SELECT md5(prosrc) FROM pg_proc WHERE oid =
  'public.free_reconcile(text,text,timestamptz,interval)'::regprocedure;"
b_fingerprint=$(scalar "$fingerprint_query")
apply_a
check "$b_fingerprint" "$fingerprint_query"
run -f "$here/queue-guard.sql"
echo 'PASS: guarded A retry alone preserves B and its live-job guard'
run -f "$scratch/B.sql"
check "$before" "SELECT md5(string_agg(to_jsonb(f)::text, ',' ORDER BY uid)) FROM public.free_usage f;"
run -f "$here/queue-guard.sql"
echo 'PASS: guarded A+B reapplication leaves all ledger rows unchanged'

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
echo 'UNSAFE (historical control): raw A alone regresses the live-job guard'
run -f "$scratch/B.sql"
run -f "$here/queue-guard.sql"
[[ $(snapshot) == "$before" ]]
echo 'PASS: forward repair reapplies B; no post-backup rows overwritten'

run -f "$here/compatibility.sql"
finalizer='public.free_finalize_scan(text,text,timestamptz)'
releaser='public.free_release_scan(text,text,text,timestamptz)'
{
  printf 'BEGIN;\n'
  scalar "SELECT pg_get_functiondef('$finalizer'::regprocedure) || ';';"
  scalar "SELECT pg_get_functiondef('$releaser'::regprocedure) || ';';"
  printf 'DROP FUNCTION public.free_queue_settlement_key(text,text);\nCOMMIT;\n'
} >"$scratch/settlement-rollback.sql"
bridge="$here/free-queue-settlement-compat.sql"
run -f "$bridge"
run -f "$here/worker-compatibility.sql"

race_key="ff:$(printf '%040d' 6)"
race_job='forensic-settlement-race'
check reserved "SET ROLE service_role; $(reserve "$race_key" "$race_job")"
run -c "SET ROLE service_role; SELECT public.analyzer_create_job('$race_job', 'worker-owner', 'full',
  'input', NULL, public.free_marker_uid('$race_key', '$race_job'), false);" >/dev/null
exec 3<>"$scratch/input"
PGAPPNAME=counter-holder run <"$scratch/input" >"$scratch/settlement-holder.log" 2>&1 &
holder=$!
hold "SELECT public.free_finalize_scan('worker-owner', '$race_job', now())->>'status';"
wait_state counter-holder "state = 'idle in transaction' AND query LIKE '%free_finalize_scan%'"
PGAPPNAME=counter-racer scalar "SET ROLE service_role; SELECT public.free_release_scan('$race_key',
  '$race_job', public.free_marker_uid('$race_key', '$race_job'), now())->>'status';" >"$scratch/settlement-racer.log" &
racer=$!
wait_state counter-racer "cardinality(pg_blocking_pids(pid)) = 1"
printf 'COMMIT;\n\\q\n' >&3
wait "$holder"
wait "$racer"
exec 3>&-
[[ $(<"$scratch/settlement-racer.log") == noop ]]
check consumed "SET ROLE service_role; SELECT public.free_finalize_scan('$race_key', '$race_job', now())->>'status';"
check 1 "SELECT analyses_used FROM public.free_usage WHERE uid = '$race_key';"
echo 'PASS: old-worker finalize and new-worker release serialize on the same Forensic counter'

before=$(snapshot)
run -f "$bridge"
apply_a
check "$b_fingerprint" "$fingerprint_query"
check consumed "SET ROLE service_role; SELECT public.free_finalize_scan('worker-owner', '$race_job', now())->>'status';"
run -f "$here/queue-guard.sql"
[[ $(snapshot) == "$before" ]]
echo 'PASS: bridge reapplication and guarded A leave the settlement bridge and B intact'

run -f "$scratch/settlement-rollback.sql"
check missing "SET ROLE service_role; SELECT public.free_finalize_scan('worker-owner', '$race_job', now())->>'status';"
check consumed "SET ROLE service_role; SELECT public.free_finalize_scan('$race_key', '$race_job', now())->>'status';"
run -f "$bridge"
check consumed "SET ROLE service_role; SELECT public.free_finalize_scan('worker-owner', '$race_job', now())->>'status';"
[[ $(snapshot) == "$before" ]]
echo 'PASS: function-only rollback and forward repair preserve settled transactions'

pause_sql="$here/pause-free-admission.sql"
resume_sql="$here/resume-free-admission.sql"
admission_acl="SELECT has_function_privilege('service_role',
  'public.free_reserve_scan(text,text,integer,timestamptz,interval)', 'EXECUTE');"
sha256sum "$pause_sql" "$resume_sql"
check t "$admission_acl"
run -c "CREATE ROLE alternate_reserver NOLOGIN;
  GRANT EXECUTE ON FUNCTION public.free_reserve_scan(text,text,integer,timestamptz,interval) TO alternate_reserver;
  GRANT alternate_reserver TO service_role;"
if run -f "$pause_sql" >"$scratch/admission-grant-error.log" 2>&1; then
  echo 'Pause reported success despite an inherited grant' >&2
  exit 1
fi
grep -F 'Free admission still executable through another grant; pause not established' "$scratch/admission-grant-error.log"
run -c 'REVOKE alternate_reserver FROM service_role;'
check t "$admission_acl"
echo 'PASS: pause aborts on inherited execute and rolls back the direct grant change'

drain_key="ff:$(printf '%040d' 7)"
check reserved "SET ROLE service_role; $(reserve "$drain_key" drain-queued-job)"
run -c "SET ROLE service_role; SELECT public.analyzer_create_job('drain-queued-job', 'worker-owner', 'full',
  'input', NULL, public.free_marker_uid('$drain_key', 'drain-queued-job'), false);" >/dev/null
check reserved "SET ROLE service_role; $(reserve paused-legacy-uid drain-direct-job)"
before=$(snapshot)
run -f "$pause_sql"
run -f "$pause_sql"
apply_a
check f "$admission_acl"
run -f "$here/verify-admission-pause.sql"
[[ $(snapshot) == "$before" ]]
echo 'PASS: paused legacy Quick and new split calls fail without changing counters; retry and guarded A keep pause intact'

check consumed "SET ROLE service_role; SELECT public.free_finalize_scan('worker-owner', 'drain-queued-job', now())->>'status';"
check released "SET ROLE service_role; SELECT public.free_release_scan('paused-legacy-uid', 'drain-direct-job',
  public.free_marker_uid('paused-legacy-uid', 'drain-direct-job'), now())->>'status';"
check reserved "SET ROLE service_role; SELECT public.paid_reserve_credit('pause-paid-session','paid-job',
  'total',1,now(),interval '15 min',interval '1 min')->>'status';"
echo 'PASS: in-flight settlement and the separate paid credit RPC still work during pause'

before=$(snapshot)
run -f "$resume_sql"
run -f "$resume_sql"
check t "$admission_acl"
[[ $(snapshot) == "$before" ]]
check reserved "SET ROLE service_role; $(reserve "fq:$(printf '%040d' 8)" resume-new-quick)"
check limit "SET ROLE service_role; $(reserve "fq:$(printf '%040d' 8)" resume-second-quick)"
old_after_resume=$(run -At -c 'BEGIN; SET LOCAL ROLE service_role;' \
  -c "SELECT public.free_reserve_scan('resume-old-uid','unsafe-old-quick',3,now(),interval '15 min')->>'status';" \
  -c 'ROLLBACK;')
[[ "$old_after_resume" == reserved ]]
echo 'PASS: new Quick resumes at its limit; the old call also works after resume, so old routes must be fenced first'

run -f "$here/inspect.sql" >"$scratch/postverify.log"

if [[ -n "$app_checkout" ]]; then
  # The candidate test requires a loopback URL; node-postgres uses the host query argument for the socket.
  socket_url=$(node -p 'const [port, host] = process.argv.slice(1);
    const url = new URL("postgres://postgres@127.0.0.1:" + port + "/postgres");
    url.searchParams.set("host", host); url.href' "$port" "$scratch")
  (cd -- "$app_checkout" && CREDIT_PG_URL="$socket_url" \
    NODE_OPTIONS=--no-experimental-webstorage npx --no-install vitest run \
      tests/devin/free-trial-entitlements.pg.test.ts api/cloudflare-free-credit-reservation.test.ts \
      api/cloudflare-analyzer-usage.test.ts api/cloudflare-deep-scan.test.ts \
      api/cloudflare-analyzer-queue-producer.test.ts api/cloudflare-analyzer-queue-worker.test.ts)
fi
