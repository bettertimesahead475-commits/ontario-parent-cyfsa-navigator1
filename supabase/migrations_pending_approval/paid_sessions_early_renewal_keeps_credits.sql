-- PENDING APPROVAL: do not apply to any Supabase project without written owner approval. (Migration E)
-- The only automatic execution is tests/devin/early-renewal-credits-migration.pg.test.ts on the disposable CI PostgreSQL.
-- Release plan entry E (engineering/reviews/e-early-renewal-keeps-credits-20261127.md). Requires P, D and
-- paid_credit_reservation_functions.sql; run paid_sessions_early_renewal_keeps_credits.preflight.sql first.
--
-- A customer who buys the same one-off pack (Basic/AnalyzerBasic 3 analyses, Premium/AnalyzerPremium 5) again with a
-- new verified payment while the previous pack is still active keeps the unused analyses: the new pack is added to
-- the active session (granted_credits) and its expiry moves 30 days later. Monthly tiers are unchanged. D's
-- one-redemption-per-reference guard is unchanged and runs first, so a second code of the same payment adds nothing.
--
-- Changes: navigator_paid_sessions.granted_credits (nullable, null = tier default; existing rows stay null);
-- redeem_access_code_atomic = D's version plus the one-off block; paid_reserve_credit wrapper (see below).
-- No existing row is changed. Re-runnable. Rollback: paid_sessions_early_renewal_keeps_credits.rollback.sql.
begin;

do $$
begin
  if to_regclass('public.access_codes_one_redemption_per_reference') is null then
    raise exception 'Migration E: Migration D (access_codes_one_redemption_per_reference) must be applied first. Nothing was changed.';
  end if;
  if to_regprocedure('public.paid_reserve_credit(text, text, text, integer, timestamptz, interval, interval)') is null then
    raise exception 'Migration E: paid_reserve_credit (paid_credit_reservation_functions.sql) is required. Nothing was changed.';
  end if;
end $$;

alter table public.navigator_paid_sessions add column if not exists granted_credits integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'navigator_paid_sessions_granted_credits_positive') then
    alter table public.navigator_paid_sessions
      add constraint navigator_paid_sessions_granted_credits_positive check (granted_credits is null or granted_credits > 0);
  end if;
end $$;

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
  v_reference text;
  v_other public.access_codes%rowtype;
  v_pack integer;
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

  -- S-34: one payment reference gives at most one redemption, whichever of its codes is presented (the customer's
  -- self-activation code, the administrator's approval code or a reissued one). Serialised per reference, after the
  -- code row lock and before the renewal lock (fixed order, no deadlock); the unique index is the backstop. It runs before
  -- the expiry check so that resending a code this guard already retired still returns the same entitlement.
  v_reference := nullif(upper(btrim(coalesce(v_row.reference_number, ''))), '');
  if v_reference is not null then
    perform pg_advisory_xact_lock(hashtextextended('navigator-reference:' || v_reference, 0));
    select * into v_other from public.access_codes
      where used_at is not null and upper(btrim(reference_number)) = v_reference and id <> v_row.id
      order by used_at, id limit 1;
    if found then
      -- This order is already activated. Retire the presented code so it can never be used later.
      update public.access_codes set expires_at = least(coalesce(expires_at, v_now), v_now)
        where id = v_row.id and used_at is null;
      -- The same account asking again gets the entitlement it already has; never a second one.
      select * into v_existing from public.navigator_paid_sessions
        where (access_code_id = v_other.id or id = v_other.redeemed_session_id) and firebase_uid = p_firebase_uid
          and revoked_at is null and expires_at > v_now
        order by expires_at desc, id limit 1;
      if found then
        return jsonb_build_object('status', 'reused', 'session_id', v_existing.id, 'tier', v_existing.tier,
                                  'expires_at', v_existing.expires_at);
      end if;
      return jsonb_build_object('status', 'consumed', 'code', 'ORDER_ALREADY_ACTIVATED');
    end if;
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

  -- Migration E: an early re-purchase of a one-off pack (new verified payment, same tier, previous pack still active)
  -- adds the pack's analyses and 30 days to that session instead of minting a second session, which would strand the
  -- first one's unused analyses. Same lock and row as a monthly renewal. null granted_credits = the tier default.
  if v_row.tier in ('Basic', 'AnalyzerBasic', 'Premium', 'AnalyzerPremium') then
    perform pg_advisory_xact_lock(hashtextextended('navigator-renewal:' || p_firebase_uid || ':' || v_row.tier, 0));
    select * into v_existing from public.navigator_paid_sessions
      where firebase_uid = p_firebase_uid and tier = v_row.tier
        and revoked_at is null and issued_at <= v_now and expires_at > v_now
      order by expires_at desc, id limit 1 for update;
    if found then
      v_pack := case when v_row.tier in ('Basic', 'AnalyzerBasic') then 3 else 5 end;
      v_expires_at := v_existing.expires_at + interval '30 days';
      update public.navigator_paid_sessions
        set expires_at = v_expires_at, granted_credits = coalesce(granted_credits, v_pack) + v_pack
        where id = v_existing.id;
      update public.access_codes set used_at = v_now,
        email = coalesce(nullif(trim(email), ''), v_email), redeemed_session_id = v_existing.id
        where id = v_row.id and used_at is null;
      return jsonb_build_object('status', 'activated', 'session_id', v_existing.id, 'tier', v_existing.tier,
        'expires_at', v_expires_at, 'granted_credits', coalesce(v_existing.granted_credits, v_pack) + v_pack);
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

-- Enforcement: paid_reserve_credit keeps its signature (the application is unchanged) and becomes a thin wrapper.
-- For the one-off 'total' scope it uses the session's granted_credits when larger than the tier default the
-- application passes; it never lowers an allowance. The original body is kept unchanged under a new name.
do $$
begin
  if to_regprocedure('public.paid_reserve_credit_tier_default(text, text, text, integer, timestamptz, interval, interval)') is null then
    alter function public.paid_reserve_credit(text, text, text, integer, timestamptz, interval, interval) rename to paid_reserve_credit_tier_default;
  end if;
end $$;

create or replace function public.paid_reserve_credit(
  p_session text, p_request text, p_scope text, p_granted integer, p_now timestamptz, p_ttl interval, p_claim_window interval)
returns jsonb
language sql
as $$
  select public.paid_reserve_credit_tier_default(p_session, p_request, p_scope,
    case when p_scope = 'total' then greatest(p_granted, coalesce(
      (select s.granted_credits from public.navigator_paid_sessions s where s.id::text = p_session), p_granted))
    else p_granted end,
    p_now, p_ttl, p_claim_window)
$$;

revoke all on function public.paid_reserve_credit(text, text, text, integer, timestamptz, interval, interval) from public, anon, authenticated;
grant execute on function public.paid_reserve_credit(text, text, text, integer, timestamptz, interval, interval) to service_role;
commit;
