-- PENDING APPROVAL: do not apply to any Supabase project without written owner approval. (Migration D, S-34)
-- The only automatic execution is tests/devin/s34-one-redemption-migration.pg.test.ts on the disposable CI PostgreSQL.
-- Payment reference: S-34 (engineering/security/S-34-etransfer-claim-race.md); release plan entry D
-- (engineering/reviews/s34-one-redemption-per-reference-20261127.md).
--
-- One verified payment (payments.reference_number) produces at most one successful code redemption, so a customer
-- self-activation (/api/claim-purchase), an administrator approval code and a reissued code cannot each give an
-- entitlement for the same payment. Monthly renewals use a new payment and a new reference, so they are unaffected.
-- Codes without a reference (manual/legacy) are unaffected.
--
-- Changes: redeem_access_code_atomic gains the per-reference check (everything else is byte-identical to
-- 20261110004740_preserve_monthly_renewal.sql); new partial unique index access_codes_one_redemption_per_reference.
-- Existing rows and sessions are never modified. If any reference already has two redeemed codes, the migration stops
-- and changes nothing (run access_codes_one_redemption_per_reference.preflight.sql first). Re-runnable.
-- Rollback: access_codes_one_redemption_per_reference.rollback.sql.
begin;

do $$
declare v_dupes integer;
begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'access_codes'
        and column_name in ('reference_number', 'redeemed_session_id', 'used_at', 'code_hash')) <> 4 then
    raise exception 'S-34 migration D: access_codes.reference_number/redeemed_session_id/used_at/code_hash are required (20261110004740 first). Nothing was changed.';
  end if;
  select count(*) into v_dupes from (
    select 1 from public.access_codes
    where used_at is not null and nullif(btrim(reference_number), '') is not null
    group by upper(btrim(reference_number)) having count(*) > 1) d;
  if v_dupes > 0 then
    raise exception 'S-34 migration D: % payment reference(s) already have more than one redeemed code. Resolve them with the owner (no entitlement is changed automatically), then re-run. Nothing was changed.', v_dupes;
  end if;
end $$;

create unique index if not exists access_codes_one_redemption_per_reference
  on public.access_codes ((upper(btrim(reference_number))))
  where used_at is not null and nullif(btrim(reference_number), '') is not null;

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
