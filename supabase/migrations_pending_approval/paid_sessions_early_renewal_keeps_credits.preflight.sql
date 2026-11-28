-- READ-ONLY PREFLIGHT for paid_sessions_early_renewal_keeps_credits.sql (Migration E). Safe on any project: a
-- read-only transaction that is rolled back. Apply E only if every blocking row has ok = true.
begin transaction read only;

with
fn as (
  select md5(p.prosrc) as fingerprint from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'redeem_access_code_atomic'
    and pg_get_function_identity_arguments(p.oid) = 'p_firebase_uid text, p_code text, p_email text'),
reserve as (
  select md5(p.prosrc) as fingerprint from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'paid_reserve_credit'),
stacked as (
  select firebase_uid, tier from public.navigator_paid_sessions
  where revoked_at is null and expires_at > now() and tier in ('Basic', 'AnalyzerBasic', 'Premium', 'AnalyzerPremium')
  group by 1, 2 having count(*) > 1)
select 'Migration D applied (index access_codes_one_redemption_per_reference present)' as check_name,
       (to_regclass('public.access_codes_one_redemption_per_reference') is not null)::text as detail,
       to_regclass('public.access_codes_one_redemption_per_reference') is not null as ok, true as blocking
union all
select 'live redeem_access_code_atomic equals Migration D (rollback restores that version)',
       coalesce((select fingerprint from fn), 'function missing'),
       (select fingerprint from fn) = '76dd0fe56ba742c3f50fbfef7dcfa536', true
union all
select 'paid_reserve_credit equals paid_credit_reservation_functions.sql (rollback restores that version)',
       coalesce((select string_agg(fingerprint, ',') from reserve), 'function missing'),
       (select count(*) from reserve) = 1 and (select fingerprint from reserve) = 'b79c9a9d06a0375c8ab0036711e17c50', true
union all
select 'paid_reserve_credit_tier_default not yet present (false = E already applied)',
       (to_regproc('public.paid_reserve_credit_tier_default') is not null)::text,
       to_regproc('public.paid_reserve_credit_tier_default') is null, true
union all
select 'navigator_paid_sessions.granted_credits not yet present (false = E already applied)',
       (select count(*) from information_schema.columns where table_schema = 'public'
          and table_name = 'navigator_paid_sessions' and column_name = 'granted_credits')::text,
       not exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'navigator_paid_sessions' and column_name = 'granted_credits'), false
union all
select 'accounts with two active sessions of one one-off tier (E extends the latest-expiring one; listed for the owner)',
       (select count(*) from stacked)::text, true, false;

rollback;
