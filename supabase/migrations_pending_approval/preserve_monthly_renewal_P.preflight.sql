-- Migration P read-only preflight: supabase/migrations/20261110004740_preserve_monthly_renewal.sql.
-- Run against nxfhvebzzobegubefcda (the staging-named ledger that serves production). Aggregates only, read-only
-- transaction, rolled back. Go only if every row with blocking = true has ok = true.
begin transaction read only;

with
fn as (
  select md5(p.prosrc) as fingerprint
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'redeem_access_code_atomic'
    and pg_get_function_identity_arguments(p.oid) = 'p_firebase_uid text, p_code text, p_email text'
),
col as (
  select count(*) as n from information_schema.columns
  where table_schema = 'public' and table_name = 'access_codes' and column_name = 'redeemed_session_id'
)
select 'access_codes.redeemed_session_id absent (false = P already applied; do not re-run)' as check_name,
       (select n from col)::text as detail, (select n from col) = 0 as ok, true as blocking
union all
select 'live redeem_access_code_atomic equals the captured 20261030182320 version (P rollback restores it verbatim)',
       coalesce((select fingerprint from fn), 'function missing'),
       (select fingerprint from fn) = 'ca9f13a85933345f0dfede3b1ab2975e', true
union all
select 'navigator_paid_sessions.id is uuid (target of the new foreign key)',
       coalesce((select data_type from information_schema.columns where table_schema = 'public'
                 and table_name = 'navigator_paid_sessions' and column_name = 'id'), 'missing'),
       (select data_type from information_schema.columns where table_schema = 'public'
         and table_name = 'navigator_paid_sessions' and column_name = 'id') = 'uuid', true
union all
select 'Migration D index absent (D must follow P, never precede it)',
       (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'access_codes_one_redemption_per_reference')::text,
       not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'access_codes_one_redemption_per_reference'), true
union all
select 'anon/authenticated cannot execute redeem_access_code_atomic',
       coalesce((select string_agg(grantee, ',') from information_schema.routine_privileges where routine_schema = 'public'
                 and routine_name = 'redeem_access_code_atomic' and grantee in ('anon', 'authenticated', 'PUBLIC')), 'none'),
       not exists (select 1 from information_schema.routine_privileges where routine_schema = 'public'
                   and routine_name = 'redeem_access_code_atomic' and grantee in ('anon', 'authenticated', 'PUBLIC')), true
union all
select 'no view or function already references redeemed_session_id',
       ((select count(*) from pg_views where schemaname = 'public' and definition ilike '%redeemed_session_id%')
        + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosrc ilike '%redeemed_session_id%'))::text,
       not exists (select 1 from pg_views where schemaname = 'public' and definition ilike '%redeemed_session_id%')
       and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.prosrc ilike '%redeemed_session_id%'), true
union all
select 'access_codes rows (adding a nullable column rewrites none)', (select count(*) from public.access_codes)::text, true, false
union all
select 'latest recorded migration version', coalesce((select max(version) from supabase_migrations.schema_migrations), 'none'), true, false;

rollback;
