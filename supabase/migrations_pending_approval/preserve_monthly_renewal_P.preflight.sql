-- READ-ONLY PREFLIGHT for Migration P (supabase/migrations/20261110004740_preserve_monthly_renewal.sql). Safe on any
-- project: a read-only transaction that is rolled back. One row per check; apply P only if every blocking row is ok.
-- After P, the same query shows the post-migration state: p_applied = true and the fingerprint b835b252...
begin transaction read only;

with fn as (
  select md5(p.prosrc) as fingerprint from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'redeem_access_code_atomic'
    and pg_get_function_identity_arguments(p.oid) = 'p_firebase_uid text, p_code text, p_email text')
select 'redeem_access_code_atomic is the captured live version ca9f13a8 (P''s rollback restores exactly that text)' as check_name,
       coalesce((select fingerprint from fn), 'function missing') as detail,
       (select fingerprint from fn) = 'ca9f13a85933345f0dfede3b1ab2975e' as ok, true as blocking
union all
select 'access_codes.redeemed_session_id absent (false = P already applied)',
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'access_codes' and column_name = 'redeemed_session_id')::text,
       not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'access_codes' and column_name = 'redeemed_session_id'), false
union all
select 'navigator_paid_sessions.id is the primary key (target of the new foreign key)',
       (select string_agg(conname, ', ') from pg_constraint where conrelid = 'public.navigator_paid_sessions'::regclass and contype = 'p'),
       exists (select 1 from pg_constraint where conrelid = 'public.navigator_paid_sessions'::regclass and contype = 'p'), true
union all
select 'D not applied yet (index access_codes_one_redemption_per_reference absent)',
       (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'access_codes_one_redemption_per_reference')::text,
       not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'access_codes_one_redemption_per_reference'), true
union all
select 'latest applied migration version (record it; P is 20261110004740 but lands after it)',
       coalesce((select max(version) from supabase_migrations.schema_migrations), 'none'), true, false
union all
select 'rows: access_codes / navigator_paid_sessions / live entitlements (P changes none of them)',
       (select count(*) from public.access_codes)::text || ' / ' || (select count(*) from public.navigator_paid_sessions)::text || ' / ' ||
       (select count(*) from public.navigator_paid_sessions where revoked_at is null and expires_at > now())::text, true, false
union all
select 'other sessions holding locks on access_codes or navigator_paid_sessions (P waits for them; run with lock_timeout)',
       (select count(*) from pg_locks l where l.relation in ('public.access_codes'::regclass, 'public.navigator_paid_sessions'::regclass) and l.pid <> pg_backend_pid())::text,
       true, false;

rollback;
