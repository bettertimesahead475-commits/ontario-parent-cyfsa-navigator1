-- Rollback of Migration P (supabase/migrations/20261110004740_preserve_monthly_renewal.sql) on nxfhvebzzobegubefcda.
-- Order: revert any app release that reads redeemed_session_id, roll back D (and E) first, then run this.
-- Restores redeem_access_code_atomic exactly as captured read-only from the live ledger on 2026-11-27
-- (md5(prosrc) ca9f13a85933345f0dfede3b1ab2975e, version 20261030182320) and drops the column P added.
-- Refuses if D's index exists, if the RPC is not P's version, or if any code already records a session link that no
-- other column holds (monthly renewal codes): dropping it would lose which entitlement those codes extended.
-- To accept that loss deliberately, run first in the same session: set navigator.p_rollback_accept_link_loss = 'yes';
begin;

lock table public.access_codes in access exclusive mode;

do $guard$
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'access_codes_one_redemption_per_reference') then
    raise exception 'P rollback refused: Migration D is applied; run its rollback first';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.redeem_access_code_atomic(text,text,text)'::regprocedure)
     is distinct from 'b835b252c9d2b97413e43271c712e5ce' then
    raise exception 'P rollback refused: redeem_access_code_atomic is not the P version';
  end if;
  if exists (select 1 from public.access_codes c where c.redeemed_session_id is not null
             and not exists (select 1 from public.navigator_paid_sessions s where s.access_code_id = c.id))
     and coalesce(current_setting('navigator.p_rollback_accept_link_loss', true), '') <> 'yes' then
    raise exception 'P rollback refused: renewal codes record their entitlement only in redeemed_session_id';
  end if;
end
$guard$;

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
$function$;

revoke all on function public.redeem_access_code_atomic(text, text, text) from public;
revoke all on function public.redeem_access_code_atomic(text, text, text) from anon, authenticated;
grant execute on function public.redeem_access_code_atomic(text, text, text) to service_role;

alter table public.access_codes drop column redeemed_session_id;

commit;
