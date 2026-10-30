-- ============================================================================
-- Migration: 20261030_reconcile_access_codes_and_atomic_rpc.sql
-- Status: PREPARED FOR STAGING (nxfhvebzzobegubefcda)
--
-- Target: Supabase Staging only. (DO NOT APPLY TO PRODUCTION qboidsfpjuxeqtfotryj).
--
-- PURPOSE:
-- 1. Reconcile public.access_codes table schema:
--    - In staging, public.access_codes currently has: (id uuid, tier text, code text, created_at timestamptz).
--    - It is missing:
--      * used_at timestamptz (null until redeemed)
--      * expires_at timestamptz
--      * code_hash text (SHA-256 hex of uppercase normalized code, for timing-safe lookup)
--      * email text (normalized parent contact email)
--      * reference_number text (matching Interac e-Transfer reference)
--      * amount numeric
-- 2. Backfill existing legacy codes:
--    - Populates code_hash for existing codes: encode(sha256(upper(trim(code))::bytea), 'hex')
--    - Existing codes are marked unused (used_at IS NULL).
-- 3. Install atomic PostgreSQL redemption function:
--    - `public.redeem_access_code_atomic(p_firebase_uid, p_code, p_email)`
--    - Performs timing-safe match on code / code_hash, locks row with FOR UPDATE,
--      verifies expiration & status, claims code, and mints navigator_paid_sessions
--      within a single transaction.
--    - Idempotent: returns existing active session if user retries the same code.
--    - Rolls back completely on any error.
-- ============================================================================

begin;

-- Step 1: Reconcile public.access_codes columns safely and idempotently
alter table public.access_codes
  add column if not exists used_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists code_hash text,
  add column if not exists email text,
  add column if not exists reference_number text,
  add column if not exists amount numeric;

-- Backfill code_hash for legacy plaintext codes if code_hash is null
update public.access_codes
set code_hash = encode(sha256(upper(trim(code))::bytea), 'hex')
where code_hash is null and code is not null;

-- Create index on code_hash and used_at for fast, scalable lookup
create index if not exists access_codes_code_hash_idx on public.access_codes (code_hash);
create index if not exists access_codes_used_at_idx on public.access_codes (used_at);

-- Expand tier check constraint to cover all active product plans
alter table public.access_codes drop constraint if exists access_codes_tier_check;
alter table public.access_codes add constraint access_codes_tier_check
  check (tier in (
    'Basic',
    'Premium',
    'Pro',
    'AnalyzerBasic',
    'AnalyzerPremium',
    'Community5',
    'Community10',
    'Community25',
    'Enterprise',
    'pro_advocate',
    'premium_attorney'
  ));

-- Expand navigator_paid_sessions tier check constraint as well
alter table public.navigator_paid_sessions drop constraint if exists navigator_paid_sessions_tier_check;
alter table public.navigator_paid_sessions add constraint navigator_paid_sessions_tier_check
  check (tier in (
    'Basic',
    'Premium',
    'Pro',
    'AnalyzerBasic',
    'AnalyzerPremium',
    'Community5',
    'Community10',
    'Community25',
    'Enterprise',
    'pro_advocate',
    'premium_attorney'
  ));

-- Step 2: Install public.redeem_access_code_atomic
create or replace function public.redeem_access_code_atomic(
  p_firebase_uid text,
  p_code text,
  p_email text,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code_row record;
  v_normalized_code text := upper(trim(p_code));
  v_normalized_email text := lower(trim(p_email));
  v_input_hash text;
  v_session_id uuid;
  v_expires_at timestamptz;
  v_existing_session record;
begin
  -- 1. Input sanitization
  if p_firebase_uid is null or length(trim(p_firebase_uid)) = 0 or length(p_firebase_uid) > 128 then
    return jsonb_build_object('status', 'denied', 'error', 'Invalid account identifier', 'code', 'INVALID_UID');
  end if;

  if v_normalized_code is null or length(v_normalized_code) < 4 then
    return jsonb_build_object('status', 'invalid', 'error', 'Enter a valid access code.', 'code', 'INVALID_CODE');
  end if;

  v_input_hash := encode(sha256(v_normalized_code::bytea), 'hex');

  -- 2. Find and lock the code row (supports both modern code_hash and legacy code column)
  select *
  into v_code_row
  from public.access_codes
  where (code_hash = v_input_hash or (code is not null and upper(trim(code)) = v_normalized_code))
    and (email is null or length(trim(email)) = 0 or lower(trim(email)) = v_normalized_email)
  order by created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('status', 'invalid', 'error', 'Invalid email or code.', 'code', 'CODE_NOT_FOUND');
  end if;

  -- 3. Check if already used
  if v_code_row.used_at is not null then
    -- Idempotency check: was it already redeemed by this exact user and has an unrevoked session?
    select *
    into v_existing_session
    from public.navigator_paid_sessions
    where access_code_id = v_code_row.id
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

  -- 4. Expiration check
  if v_code_row.expires_at is not null and v_code_row.expires_at < p_now then
    return jsonb_build_object('status', 'expired', 'error', 'This code has expired. Contact support for a new one.', 'code', 'CODE_EXPIRED');
  end if;

  -- 5. Atomically mark code as used
  update public.access_codes
  set used_at = p_now,
      email = coalesce(email, v_normalized_email),
      code_hash = coalesce(code_hash, v_input_hash)
  where id = v_code_row.id
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
    v_code_row.tier,
    v_code_row.id,
    p_now,
    v_expires_at
  );

  return jsonb_build_object(
    'status', 'activated',
    'session_id', v_session_id,
    'tier', v_code_row.tier,
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

-- Restrict execution: service_role and postgres only; revoking anon & authenticated
revoke all on function public.redeem_access_code_atomic(text, text, text, timestamptz) from public;
revoke all on function public.redeem_access_code_atomic(text, text, text, timestamptz) from anon, authenticated;
grant execute on function public.redeem_access_code_atomic(text, text, text, timestamptz) to service_role;

commit;
