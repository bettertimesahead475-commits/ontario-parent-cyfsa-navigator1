#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."

archive=$(mktemp -d "$HOME/migration-e-backup.XXXXXXXX")
container="migration-e-backup-${archive##*.}"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf -- "$archive"
}
trap cleanup EXIT
docker run --rm --detach --network none --name "$container" \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:16@sha256:ce81150802644ddfac1db4da9e63be6f2a3818aa6ee98a7a28838aeea65dc37a \
  >/dev/null

for ((attempt=0; attempt<100; attempt++)); do
  if docker exec "$container" pg_isready -q -U postgres -h 127.0.0.1; then break; fi
  sleep 0.1
done
pg() { docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres "$@"; }
create_db() { docker exec "$container" createdb -U postgres "$1"; }
dump() { docker exec "$container" pg_dump -U postgres --format=custom "$1"; }
restore() { docker exec -i "$container" pg_restore -U postgres --exit-on-error --single-transaction -d "$1"; }
pending=supabase/migrations_pending_approval
e="$pending/paid_sessions_early_renewal_keeps_credits.sql"

create_db source_e
pg -q -d source_e < tests/devin/fixtures/live-nxfh-payment-schema.sql
pg -q -d source_e < supabase/migrations/20261110004740_preserve_monthly_renewal.sql
pg -q -d source_e < "$pending/access_codes_one_redemption_per_reference.sql"
pg -q -d source_e <<'SQL'
create table public.free_usage (uid text primary key, email text, analyses_used integer not null default 0,
  first_analysis_at timestamptz, last_analysis_at timestamptz);
alter table public.free_usage enable row level security;
grant select, insert, update on public.free_usage to service_role;
insert into public.navigator_paid_sessions (id, firebase_uid, tier, expires_at)
values ('11111111-1111-4111-8111-111111111111', 'synthetic-backup', 'Premium', now() + interval '30 days');
insert into public.free_usage (uid, analyses_used)
values ('paid_session_11111111-1111-4111-8111-111111111111_total', 2);
SQL
pg -q -d source_e < "$pending/paid_credit_reservation_functions.sql"
dump source_e > "$archive/pre-e.dump"
create_db restored_before_e
restore restored_before_e < "$archive/pre-e.dump"
pre="select tier || ':' || analyses_used from public.navigator_paid_sessions, public.free_usage"
[[ $(pg -At -d restored_before_e -c "$pre") == Premium:2 ]]
[[ $(pg -At -d restored_before_e -c 'select count(*) from public.access_codes') == 0 ]]
[[ $(pg -At -d restored_before_e -c "select to_regclass('public.navigator_paid_session_refunds') is null") == t ]]
echo 'PASS: pre-E backup restored with existing Premium entitlement and 2 used units'

pg -q -d source_e < "$e"
pg -q -d source_e <<'SQL'
set role service_role;
insert into public.access_codes (tier, code_hash, email, reference_number)
values ('Premium', encode(sha256(convert_to('MIG-E-BACKUP', 'UTF8')), 'hex'), 'backup@example.test', 'PS-EBACKUP');
do $$
begin
  assert public.redeem_access_code_atomic('synthetic-backup', 'MIG-E-BACKUP', 'backup@example.test')->>'status' = 'activated';
  assert public.paid_refund_one_off_pack('11111111-1111-4111-8111-111111111111', 'synthetic-refund-key', 30)->>'status' = 'applied';
end $$;
SQL
dump source_e > "$archive/post-e.dump"
create_db restored_after_e
restore restored_after_e < "$archive/post-e.dump"
echo 'PASS: post-E backup restored separately; the pre-E backup does not contain the intervening payment or refund'
pg -q -d restored_after_e < "$e"
pg -q -d restored_after_e <<'SQL'
set role service_role;
do $$
begin
  assert (select count(*) from public.access_codes where used_at is not null and reference_number = 'PS-EBACKUP') = 1;
  assert public.paid_refund_one_off_pack('11111111-1111-4111-8111-111111111111', 'synthetic-refund-key', 30)->>'status' = 'already_applied';
  assert (select count(*) from public.navigator_paid_session_refunds where granted_before = 10 and granted_after = 5) = 1;
  assert (select analyses_used from public.free_usage where uid = 'paid_session_11111111-1111-4111-8111-111111111111_total') = 2;
end $$;
SQL
echo 'PASS: reapplying E after the post-E restore preserves the used payment, original usage, and refund idempotency'
