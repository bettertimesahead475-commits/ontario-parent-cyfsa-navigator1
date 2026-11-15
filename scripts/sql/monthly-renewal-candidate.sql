-- Candidate only: exercise in transaction-local fixtures before generating an approved migration.
-- Preserve existing session IDs and issued_at so monthly credit scope does not reset early.
begin;
alter table public.access_codes add column if not exists redeemed_session_id uuid references public.navigator_paid_sessions(id);
create or replace function public.redeem_access_code_atomic(p_firebase_uid text, p_code text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  -- Validation: nothing has been read or written yet.
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

  -- Lock the single matching row. A concurrent redemption of the same code waits here, then sees used_at.
  select * into v_row from public.access_codes where code_hash = v_hash for update;
  if not found then
    return jsonb_build_object('status', 'invalid', 'code', 'CODE_NOT_FOUND');
  end if;

  -- Email restriction: a code issued to an email can be redeemed only with that email. Same answer as an unknown
  -- code, so the response does not reveal that the code exists.
  if v_row.email is not null and length(trim(v_row.email)) > 0 and lower(trim(v_row.email)) <> v_email then
    return jsonb_build_object('status', 'invalid', 'code', 'CODE_NOT_FOUND');
  end if;

  if v_row.used_at is not null then
    -- Idempotent retry by the same account: return its live session; never mint a second one.
    select * into v_existing from public.navigator_paid_sessions
    where (access_code_id = v_row.id or id = v_row.redeemed_session_id) and firebase_uid = p_firebase_uid and revoked_at is null and expires_at > v_now;
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

  -- Serialize fresh codes for the same monthly entitlement. Keep its original
  -- session and credit-period anchor; add paid time without overlapping quotas.
  if v_row.tier in ('Pro', 'Community5', 'Community10', 'Community25') then
    perform pg_advisory_xact_lock(hashtextextended('navigator-renewal:' || p_firebase_uid || ':' || v_row.tier, 0));
    select * into v_existing from public.navigator_paid_sessions
      where firebase_uid = p_firebase_uid and tier = v_row.tier
        and revoked_at is null and issued_at <= v_now and expires_at > v_now
      order by expires_at desc, id limit 1 for update;
    if found then
      v_expires_at := v_existing.expires_at + interval '30 days';
      update public.navigator_paid_sessions set expires_at = v_expires_at where id = v_existing.id;
      update public.access_codes set used_at = v_now,
        email = coalesce(nullif(trim(email), ''), v_email), redeemed_session_id = v_existing.id
        where id = v_row.id and used_at is null;
      return jsonb_build_object('status', 'activated', 'session_id', v_existing.id,
        'tier', v_existing.tier, 'expires_at', v_expires_at);
    end if;
  end if;

  -- Claim and mint in the same transaction. No exception handler: if the insert fails, the claim is undone with it.
  update public.access_codes
  set used_at = v_now, email = coalesce(nullif(trim(email), ''), v_email)
  where id = v_row.id and used_at is null;

  v_session_id := gen_random_uuid();
  v_expires_at := v_now + interval '30 days';
  insert into public.navigator_paid_sessions (id, firebase_uid, email, tier, access_code_id, issued_at, expires_at)
  values (v_session_id, p_firebase_uid, v_email, v_row.tier, v_row.id, v_now, v_expires_at);

  update public.access_codes set redeemed_session_id = v_session_id where id = v_row.id;

  return jsonb_build_object('status', 'activated', 'session_id', v_session_id, 'tier', v_row.tier,
                            'expires_at', v_expires_at);
end;
$$;

revoke all on function public.redeem_access_code_atomic(text, text, text) from public;
revoke all on function public.redeem_access_code_atomic(text, text, text) from anon, authenticated;
grant execute on function public.redeem_access_code_atomic(text, text, text) to service_role;

commit;
