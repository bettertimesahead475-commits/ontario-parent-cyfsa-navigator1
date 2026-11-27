-- ROLLBACK for Migration P (supabase/migrations/20261110004740_preserve_monthly_renewal.sql). PENDING APPROVAL: run only
-- with written owner approval, on the verified target, after a backup. Restores redeem_access_code_atomic to the version
-- live on nxfhvebzzobegubefcda before P (pg_get_functiondef captured read-only 2026-11-27, md5(prosrc) = ca9f13a8...,
-- the same text as tests/devin/fixtures/live-nxfh-payment-schema.sql) and drops access_codes.redeemed_session_id.
-- Refuses, changing nothing, unless: P's function is the one installed (so D, which replaces it, was rolled back first)
-- and no code has a redeemed_session_id. Once a customer has renewed after P, dropping the column would lose which
-- entitlement the renewal extended: do not roll back then; forward-repair instead (fix the function, keep the column).
-- No row is read beyond those checks or changed. Self-verifying: if the restored function is not the captured live
-- version, the transaction aborts. Tested by tests/devin/payment-migrations-g-p-d.pg.test.ts.
begin;
set local lock_timeout = '5s';

do $$
declare v_fp text; v_linked bigint;
begin
  select md5(p.prosrc) into v_fp from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'redeem_access_code_atomic'
    and pg_get_function_identity_arguments(p.oid) = 'p_firebase_uid text, p_code text, p_email text';
  if v_fp is distinct from 'b835b252c9d2b97413e43271c712e5ce' then
    raise exception 'P rollback: redeem_access_code_atomic is not P''s version (md5 %). Roll back D first, or this database was never on P. Nothing was changed.', coalesce(v_fp, 'missing');
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'access_codes' and column_name = 'redeemed_session_id') then
    execute 'select count(*) from public.access_codes where redeemed_session_id is not null' into v_linked;
    if v_linked > 0 then
      raise exception 'P rollback: % access code(s) record the entitlement they were redeemed into (renewals after P). Dropping the column would lose them; forward-repair instead. Nothing was changed.', v_linked;
    end if;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.redeem_access_code_atomic(p_firebase_uid text, p_code text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := now();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_hash text;
  v_row public.access_codes%rowtype;
  v_existing public.navigator_paid_sessions%rowtype;
  v_session_id uuid;
  v_expires_at timestamptz;
begin
  if p_firebase_uid is null or length(trim(p_firebase_uid)) = 0 or length(p_firebase_uid) > 128 then
    return jsonb_build_object('status', 'denied', 'code', 'INVALID_UID');
  end if;
  if length(v_code) < 4 or length(v_code) > 64 then
    return jsonb_build_object('status', 'invalid', 'code', 'INVALID_CODE');
  end if;
  if length(v_email) < 3 or position('@' in v_email) = 0 then
    return jsonb_build_object('status', 'invalid', 'code', 'INVALID_EMAIL');
  end if;

  v_hash := encode(sha256(convert_to(v_code, 'UTF8')), 'hex');

  select * into v_row from public.access_codes where code_hash = v_hash for update;
  if not found then
    return jsonb_build_object('status', 'invalid', 'code', 'CODE_NOT_FOUND');
  end if;

  if v_row.email is not null and length(trim(v_row.email)) > 0 and lower(trim(v_row.email)) <> v_email then
    return jsonb_build_object('status', 'invalid', 'code', 'CODE_NOT_FOUND');
  end if;

  if v_row.used_at is not null then
    select * into v_existing from public.navigator_paid_sessions
    where access_code_id = v_row.id and firebase_uid = p_firebase_uid and revoked_at is null and expires_at > v_now;
    if found then
      return jsonb_build_object('status', 'reused', 'session_id', v_existing.id, 'tier', v_existing.tier,
                                'expires_at', v_existing.expires_at);
    end if;
    return jsonb_build_object('status', 'consumed', 'code', 'CODE_ALREADY_USED');
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= v_now then
    return jsonb_build_object('status', 'expired', 'code', 'CODE_EXPIRED');
  end if;

  if v_row.tier is null or v_row.tier not in
     ('Basic', 'AnalyzerBasic', 'Premium', 'AnalyzerPremium', 'Pro', 'Community5', 'Community10', 'Community25') then
    return jsonb_build_object('status', 'denied', 'code', 'TIER_NOT_REDEEMABLE');
  end if;

  update public.access_codes
  set used_at = v_now, email = coalesce(nullif(trim(email), ''), v_email)
  where id = v_row.id and used_at is null;

  v_session_id := gen_random_uuid();
  v_expires_at := v_now + interval '30 days';
  insert into public.navigator_paid_sessions (id, firebase_uid, email, tier, access_code_id, issued_at, expires_at)
  values (v_session_id, p_firebase_uid, v_email, v_row.tier, v_row.id, v_now, v_expires_at);

  return jsonb_build_object('status', 'activated', 'session_id', v_session_id, 'tier', v_row.tier,
                            'expires_at', v_expires_at);
end;
$function$
;
revoke all on function public.redeem_access_code_atomic(text, text, text) from public;
revoke all on function public.redeem_access_code_atomic(text, text, text) from anon, authenticated;
grant execute on function public.redeem_access_code_atomic(text, text, text) to service_role;
alter table public.access_codes drop column if exists redeemed_session_id;

do $$
begin
  if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'redeem_access_code_atomic'
        and pg_get_function_identity_arguments(p.oid) = 'p_firebase_uid text, p_code text, p_email text') is distinct from 'ca9f13a85933345f0dfede3b1ab2975e' then
    raise exception 'P rollback: the restored function does not match the captured live version. Nothing was changed.';
  end if;
end $$;
commit;
