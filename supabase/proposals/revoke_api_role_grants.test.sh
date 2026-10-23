#!/usr/bin/env bash
# Tests for revoke_api_role_grants.sql, its rollback, and the verification script.
# DISPOSABLE DATABASE ONLY. Never point this at production.
# Usage: TEST_DB=<db> PGHOST=127.0.0.1 PGPORT=<port> PGUSER=postgres ./revoke_api_role_grants.test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB="${TEST_DB:?set TEST_DB to a disposable database}"
SEQ="navigator_matter_access_events_event_sequence_seq"
P=(psql -q -X -v ON_ERROR_STOP=1 -d "$DB")
TABLES="access_codes analysis_results audit_log case_exports cases cyfsa_300rule_access_codes document_walkthroughs documents free_tool_usage free_usage gmail_processed_messages lawyer_leads lawyer_profiles parent_profiles payments reflection_conversations stale_payment_alerts submissions timeline_events users"
LIST="'$(echo $TABLES | sed "s/ /','/g")'"

counts() {
  "${P[@]}" -At -c "select count(*) filter (where has_table_privilege('anon','public.'||t,'TRUNCATE')) || ' ' || count(*) filter (where has_table_privilege('anon','public.'||t,'SELECT')) || ' ' || count(*) filter (where has_table_privilege('authenticated','public.'||t,'SELECT')) || ' ' || count(*) filter (where has_table_privilege('anon','public.'||t,'INSERT')) from unnest(array[$LIST]) t"
}
seq_state() {
  "${P[@]}" -At -c "select (has_sequence_privilege('anon','public.$SEQ','USAGE') or has_sequence_privilege('anon','public.$SEQ','UPDATE') or has_sequence_privilege('authenticated','public.$SEQ','USAGE') or has_sequence_privilege('authenticated','public.$SEQ','UPDATE'))::int"
}
expect() { [[ "$1" == "$2" ]] || { echo "FAIL $3: got '$1', expected '$2'"; exit 1; }; echo "PASS $3: $1"; }

# Setup: stub objects carrying the observed default grants (ALL to anon and authenticated).
for t in $TABLES; do
  "${P[@]}" -c "create table if not exists public.$t (id uuid primary key default gen_random_uuid()); grant all on table public.$t to anon, authenticated;"
done
"${P[@]}" -c "create sequence if not exists public.$SEQ; grant usage, select, update on sequence public.$SEQ to anon, authenticated;"
expect "$(counts)" "20 20 20 20" "tables before (observed default)"
expect "$(seq_state)" "1" "sequence before (API roles hold privileges)"

# Forward fix.
"${P[@]}" -f "$here/revoke_api_role_grants.sql"
expect "$(counts)" "0 1 0 0" "tables after (walkthroughs keeps anon SELECT only)"
expect "$(seq_state)" "0" "sequence after (no API-role privileges)"

# Verification script must report every object as expected.
verify_out="$("${P[@]}" -At -f "$here/revoke_api_role_grants.verify.sql")"
if grep -Eq '\|f$|^unexpected_grantee' <<<"$verify_out"; then echo "FAIL verify.sql reports an unexpected row"; echo "$verify_out"; exit 1; fi
rows=$(grep -cE '\|t$' <<<"$verify_out")
[[ "$rows" == "21" ]] || { echo "FAIL verify.sql: expected 21 ok rows (20 tables + 1 sequence), got $rows"; exit 1; }
echo "PASS verify.sql: 21 of 21 objects in the expected state, no unexpected grantees"

# Mechanism: server definer path works; API roles cannot use the sequence or table.
"${P[@]}" -f "$here/revoke_api_role_grants.mechanism.test.sql" >/dev/null
echo "PASS mechanism: definer path writes; anon and authenticated blocked on sequence and table"

# Rollback restores the observed state exactly.
"${P[@]}" -f "$here/revoke_api_role_grants.rollback.sql"
expect "$(counts)" "20 20 20 20" "tables after rollback (restored)"
expect "$(seq_state)" "1" "sequence after rollback (restored)"

# Cleanup stubs.
for t in $TABLES; do "${P[@]}" -c "drop table if exists public.$t cascade;"; done
"${P[@]}" -c "drop sequence if exists public.$SEQ;"
echo "ALL PASS"
