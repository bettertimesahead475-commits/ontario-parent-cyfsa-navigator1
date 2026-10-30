-- ============================================================================
-- Migration: atomic_access_code_redemption_rpc.sql
-- Status: PENDING OWNER APPROVAL FOR PRODUCTION. For Staging execution.
-- Target: Supabase Staging (nxfhvebzzobegubefcda) / Production (qboidsfpjuxeqtfotryj)
--
-- PURPOSE:
--   Executes access-code verification, atomic code claim, and paid session
--   minting in ONE single atomic PostgreSQL transaction.
--   Prevents TOCTOU races and guarantees that if session creation or constraint
--   fails, the access code is NOT consumed.
-- ============================================================================

begin;

create or replace function public.redeem_access_code_atomic(
  p_firebase_uid text,
  p_email text,
  p_code_hash text,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code record;
  v_session_id uuid;
  v_expires_at timestamptz;
  v_normalized_email text := lower(trim(p_email));
  v_existing_session record;
begin
  -- 1. Input validation
  if p_firebase_uid is null or length(trim(p_firebase_uid)) = 0 or length(p_firebase_uid) > 128 then
    return jsonb_build_object('status', 'denied', 'error', 'Invalid account identifier', 'code', 'INVALID_UID');
  end if;

  if v_normalized_email is null or length(v_normalized_email) = 0 then
    return jsonb_build_object('status', 'denied', 'error', 'Invalid email address', 'code', 'INVALID_EMAIL');
  end if;

  if p_code_hash is null or length(p_code_hash) != 64 then
    return jsonb_build_object('status', 'denied', 'error', 'Invalid code hash', 'code', 'INVALID_HASH');
  end if;

  -- 2. Select and lock the candidate access code row
  select *
  into v_code
  from public.access_codes
  where lower(trim(email)) = v_normalized_email
    and code_hash = p_code_hash
  for update;

  if not found then
    return jsonb_build_object('status', 'invalid', 'error', 'Invalid email or code.', 'code', 'CODE_NOT_FOUND');
  end if;

  -- 3. Check if already used
  if v_code.used_at is not null then
    -- Check if it was already redeemed by this exact user and session exists
    select *
    into v_existing_session
    from public.navigator_paid_sessions
    where access_code_id = v_code.id
      and firebase_uid = p_firebase_uid
      and (revoked_at is null)
      and expires_at > p_now;

    if found then
      return jsonb_build_object(
        'status', 'reused',
        'session_id', v_existing_session.id,
        'tier', v_existing_session.tier,
        'email', v_normalized_email,
        'expires_at', v_existing_session.expires_at
      );
    end if;

    return jsonb_build_object('status', 'consumed', 'error', 'This code was already redeemed.', 'code', 'CODE_ALREADY_USED');
  end if;

  -- 4. Check expiration
  if v_code.expires_at is not null and v_code.expires_at < p_now then
    return jsonb_build_object('status', 'expired', 'error', 'This code has expired. Contact support for a new one.', 'code', 'CODE_EXPIRED');
  end if;

  -- 5. Atomically mark code as used
  update public.access_codes
  set used_at = p_now
  where id = v_code.id
    and used_at is null;

  if not found then
    return jsonb_build_object('status', 'consumed', 'error', 'This code was already redeemed by a concurrent request.', 'code', 'CONCURRENT_REDEMPTION');
  end if;

  -- 6. Insert new paid session
  v_session_id := gen_random_uuid();
  v_expires_at := p_now + interval '30 days';

  insert into public.navigator_paid_sessions (
    id,
    firebase_uid,
    email,
    tier,
    access_code_id,
    issued_at,
    expires_at
  ) values (
    v_session_id,
    p_firebase_uid,
    v_normalized_email,
    v_code.tier,
    v_code.id,
    p_now,
    v_expires_at
  );

  return jsonb_build_object(
    'status', 'activated',
    'session_id', v_session_id,
    'tier', v_code.tier,
    'email', v_normalized_email,
    'expires_at', v_expires_at
  );

exception
  when unique_violation then
    return jsonb_build_object('status', 'consumed', 'error', 'A paid session for this code already exists.', 'code', 'SESSION_ALREADY_EXISTS');
  when others then
    return jsonb_build_object('status', 'error', 'error', SQLERRM, 'code', SQLSTATE);
end;
$$;

-- Restrict execution: only service_role and postgres can execute
revoke all on function public.redeem_access_code_atomic(text, text, text, timestamptz) from public;
revoke all on function public.redeem_access_code_atomic(text, text, text, timestamptz) from anon, authenticated;
grant execute on function public.redeem_access_code_atomic(text, text, text, timestamptz) to service_role;

commit;
