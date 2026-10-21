#!/usr/bin/env bash
# Tests for revoke_api_role_grants.sql and its rollback. DISPOSABLE DATABASE ONLY.
# Usage: PGHOST=127.0.0.1 PGPORT=54331 PGUSER=postgres TEST_DB=revoke_test ./revoke_api_role_grants.test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DB="${TEST_DB:?set TEST_DB to a disposable database}"
P=(psql -q -X -v ON_ERROR_STOP=1 -d "$DB")
TABLES="access_codes analysis_results audit_log case_exports cases cyfsa_300rule_access_codes documents free_tool_usage free_usage gmail_processed_messages lawyer_leads lawyer_profiles parent_profiles payments reflection_conversations stale_payment_alerts submissions timeline_events users document_walkthroughs"
LIST="'$(echo $TABLES | sed "s/ /','/g")'"
counts() {
  "${P[@]}" -At -c "select count(*) filter (where has_table_privilege('anon','public.'||t,'TRUNCATE')) || ' ' || count(*) filter (where has_table_privilege('anon','public.'||t,'SELECT')) || ' ' || count(*) filter (where has_table_privilege('authenticated','public.'||t,'SELECT')) || ' ' || count(*) filter (where has_table_privilege('anon','public.'||t,'INSERT')) from unnest(array[$LIST]) t"
}
expect() { [[ "$1" == "$2" ]] || { echo "FAIL $3: got '$1', expected '$2'"; exit 1; }; echo "PASS $3: anon_truncate/anon_select/auth_select/anon_insert = $1"; }

# Setup: stub tables with the observed default grants (ALL to anon and authenticated).
for t in $TABLES; do
  "${P[@]}" -c "create table if not exists public.$t (id uuid primary key default gen_random_uuid()); grant all on table public.$t to anon, authenticated;"
done
expect "$(counts)" "20 20 20 20" "before revoke (observed default)"

# Forward revoke.
"${P[@]}" -f "$here/revoke_api_role_grants.sql"
expect "$(counts)" "0 1 0 0" "after revoke (walkthroughs keeps anon SELECT only)"
"${P[@]}" -At -c "select has_table_privilege('anon','public.access_codes','TRUNCATE') or has_table_privilege('anon','public.access_codes','INSERT') as anon_writes" | grep -qx f && echo "PASS anon has no write or truncate on access_codes" || { echo "FAIL anon write on access_codes"; exit 1; }

# Post-change verification (the same script intended for production) must report every table as expected.
verify_out="$("${P[@]}" -At -f "$here/revoke_api_role_grants.verify.sql")"
if grep -Eq '\|f$|^unexpected_grantee' <<<"$verify_out"; then echo "FAIL verify.sql reports an unexpected row"; echo "$verify_out"; exit 1; fi
rows=$(grep -cE '\|t$' <<<"$verify_out")
[[ "$rows" == "20" ]] || { echo "FAIL verify.sql: expected 20 ok rows, got $rows"; exit 1; }
echo "PASS verify.sql: 20 of 20 tables in the expected state, no unexpected grantees"

# Rollback restores the observed state.
"${P[@]}" -f "$here/revoke_api_role_grants.rollback.sql"
expect "$(counts)" "20 20 20 20" "after rollback (restored)"

# Cleanup stubs.
for t in $TABLES; do "${P[@]}" -c "drop table if exists public.$t cascade;"; done
echo "ALL PASS"
