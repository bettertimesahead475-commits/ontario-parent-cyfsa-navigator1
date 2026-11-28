-- READ-ONLY PREFLIGHT for access_codes_one_redemption_per_reference.sql (Migration D, S-34). Safe to run on any
-- project: a read-only transaction that is rolled back; it changes nothing. Output: one row per check.
-- Apply D only if every row has ok = true (blocking checks), after the owner has reviewed `detail`.
begin transaction read only;

with
cols as (
  select count(*) filter (where column_name in ('reference_number', 'redeemed_session_id', 'used_at', 'code_hash')) as n
  from information_schema.columns where table_schema = 'public' and table_name = 'access_codes'),
dupes as (
  select upper(btrim(reference_number)) as ref, count(*) as used_codes
  from public.access_codes
  where used_at is not null and nullif(btrim(reference_number), '') is not null
  group by 1 having count(*) > 1),
fn as (
  select md5(p.prosrc) as fingerprint from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'redeem_access_code_atomic'
    and pg_get_function_identity_arguments(p.oid) = 'p_firebase_uid text, p_code text, p_email text')
select 'access_codes has reference_number, redeemed_session_id, used_at, code_hash' as check_name,
       (select n from cols)::text as detail, (select n from cols) = 4 as ok, true as blocking
union all
select 'references with more than one redeemed code (must be 0; resolve with the owner, never automatically)',
       coalesce((select string_agg(ref || ' x' || used_codes, ', ' order by ref) from dupes), 'none'),
       not exists (select 1 from dupes), true
union all
select 'live redeem_access_code_atomic equals 20261110004740_preserve_monthly_renewal.sql (rollback restores that version)',
       coalesce((select fingerprint from fn), 'function missing'),
       (select fingerprint from fn) = 'b835b252c9d2b97413e43271c712e5ce', true
union all
select 'index access_codes_one_redemption_per_reference not yet present (false = D already applied)',
       (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'access_codes_one_redemption_per_reference')::text,
       not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'access_codes_one_redemption_per_reference'), false
union all
select 'redeemed codes with a reference (rows the new index covers; index build holds a brief table lock)',
       (select count(*) from public.access_codes where used_at is not null and nullif(btrim(reference_number), '') is not null)::text,
       true, false
union all
select 'unused, unexpired codes of an already-activated reference (D will refuse them; listed for the owner)',
       (select count(*) from public.access_codes c where c.used_at is null and (c.expires_at is null or c.expires_at > now())
          and exists (select 1 from public.access_codes u where u.used_at is not null
                      and nullif(btrim(u.reference_number), '') is not null
                      and upper(btrim(u.reference_number)) = upper(btrim(c.reference_number))))::text,
       true, false;

rollback;
