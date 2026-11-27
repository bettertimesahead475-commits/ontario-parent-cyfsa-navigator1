-- ============================================================================
-- Migration: 20261030_reconcile_access_codes_and_atomic_rpc.sql
-- Target: Supabase STAGING only (nxfhvebzzobegubefcda). Never production (qboidsfpjuxeqtfotryj).
--
-- Revised 2026-10-30 after review of the first draft:
-- * The draft's `exception when others` handler returned SQLERRM to the caller. PL/pgSQL rolls back a block's
--   changes when its handler catches, so no partial commit followed, but the raw database error reached the API and
--   the customer, and a failure looked like an ordinary result. There is now NO exception handler: any error aborts
--   the call and its transaction, so the code is never consumed without a session, and the API returns a generic
--   message.
-- * The caller-supplied `p_now` parameter is removed: a service-role caller could have passed a past time to get past
--   the expiry check. The function uses the transaction's own clock.
-- * Matching is by `code_hash` only (unique), not "hash OR plaintext ... order by created_at limit 1", so one code
--   can never match two rows.
-- * Tier constraints follow api/services/tierTypes.ts. `Enterprise` (in the draft) is not a product tier and is not
--   added. Existing legacy values on access_codes (`pro_advocate`, `premium_attorney`) are kept so no existing row is
--   invalidated; codes of a tier that cannot become a paid session are refused before anything is written.
--
-- Staging state when written (verified): access_codes(id, tier, code UNIQUE, created_at), 0 rows;
-- navigator_paid_sessions with UNIQUE(access_code_id), 0 rows; RLS on both, no policies, no anon/authenticated grants.
-- ============================================================================

begin;

-- 1. Columns the application uses (idempotent).
alter table public.access_codes
  add column if not exists used_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists code_hash text,
  add column if not exists email text,
  add column if not exists reference_number text,
  add column if not exists amount numeric;

-- 2. Hash legacy plaintext codes the same way api/services/access.ts hashCode() does:
--    sha256(code.toUpperCase().trim()) as lowercase hex.
update public.access_codes
set code_hash = encode(sha256(convert_to(upper(trim(code)), 'UTF8')), 'hex')
where code_hash is null and code is not null;

-- 3. One row per code. Stop instead of guessing if existing data has collisions.
do $$
begin
  if exists (select 1 from public.access_codes where code_hash is not null group by code_hash having count(*) > 1) then
    raise exception 'access_codes contains duplicate codes; resolve them before applying this migration';
  end if;
end $$;
create unique index if not exists access_codes_code_hash_key on public.access_codes (code_hash) where code_hash is not null;
create index if not exists access_codes_used_at_idx on public.access_codes (used_at);

-- 4. Tier constraints. access_codes keeps its current legacy values; paid sessions take the application's tiers
--    (a superset of the current 'Pro', 'Premium').
alter table public.access_codes drop constraint if exists access_codes_tier_check;
alter table public.access_codes add constraint access_codes_tier_check check (tier in (
  'Basic', 'AnalyzerBasic', 'Premium', 'AnalyzerPremium', 'Pro', 'Community5', 'Community10', 'Community25',
  'pro_advocate', 'premium_attorney'
));
alter table public.navigator_paid_sessions drop constraint if exists navigator_paid_sessions_tier_check;
alter table public.navigator_paid_sessions add constraint navigator_paid_sessions_tier_check check (tier in (
  'Basic', 'AnalyzerBasic', 'Premium', 'AnalyzerPremium', 'Pro', 'Community5', 'Community10', 'Community25'
));

-- 5. The draft's signature, in case it was installed anywhere.
drop function if exists public.redeem_access_code_atomic(text, text, text, timestamptz);

-- 6. Atomic redemption. The caller (the API) has already verified the Firebase ID token; p_firebase_uid is the
--    token's subject, never a client-supplied value.
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

  -- Claim and mint in the same transaction. No exception handler: if the insert fails, the claim is undone with it.
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
$$;

revoke all on function public.redeem_access_code_atomic(text, text, text) from public;
revoke all on function public.redeem_access_code_atomic(text, text, text) from anon, authenticated;
grant execute on function public.redeem_access_code_atomic(text, text, text) to service_role;

commit;
