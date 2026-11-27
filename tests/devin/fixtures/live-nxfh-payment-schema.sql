-- Payment tables and redeem_access_code_atomic as they exist on the live-bound Supabase project nxfhvebzzobegubefcda,
-- captured read-only on 2026-11-27 (information_schema, pg_constraint, pg_indexes, pg_get_functiondef; no rows).
-- Latest applied migration: 20261127163309. P (20261110004740) is NOT applied: no access_codes.redeemed_session_id, and
-- md5(prosrc) of redeem_access_code_atomic = ca9f13a85933345f0dfede3b1ab2975e. For disposable PostgreSQL only.
-- Roles: as on Supabase. service_role bypasses RLS; RLS is enabled with no policies; anon/authenticated have no grants.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
alter role service_role bypassrls;

create table public.access_codes (
  id uuid not null default gen_random_uuid() primary key,
  tier text check (tier = any (array['Basic','AnalyzerBasic','Premium','AnalyzerPremium','Pro','Community5','Community10','Community25','pro_advocate','premium_attorney'])),
  code text constraint access_codes_code_key unique,
  created_at timestamptz default now(),
  used_at timestamptz,
  expires_at timestamptz,
  code_hash text,
  email text,
  reference_number text,
  amount numeric
);
create unique index access_codes_code_hash_key on public.access_codes (code_hash) where (code_hash is not null);
create index access_codes_used_at_idx on public.access_codes (used_at);

create table public.navigator_paid_sessions (
  id uuid not null default gen_random_uuid() primary key,
  firebase_uid text not null,
  email text,
  tier text not null check (tier = any (array['Basic','AnalyzerBasic','Premium','AnalyzerPremium','Pro','Community5','Community10','Community25'])),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text,
  access_code_id uuid constraint navigator_paid_sessions_access_code_id_key unique
    constraint navigator_paid_sessions_access_code_id_fkey references public.access_codes(id) on delete set null,
  constraint navigator_paid_sessions_revocation_consistency_check check ((revoked_at is not null) or (revocation_reason is null))
);
create index navigator_paid_sessions_firebase_uid_idx on public.navigator_paid_sessions (firebase_uid);
create index navigator_paid_sessions_access_code_id_idx on public.navigator_paid_sessions (access_code_id);

create table public.payments (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid,
  plan text not null,
  user_role text check (user_role = any (array['parent','lawyer'])),
  amount numeric not null,
  payment_method text default 'interac_etransfer'::text,
  payment_email text,
  reference_number text,
  status text default 'pending'::text check (status = any (array['pending','approved','rejected'])),
  notes text,
  submitted_at timestamptz default now(),
  approved_at timestamptz,
  approved_by uuid,
  firebase_uid text,
  request_key text,
  client_ip text,
  user_agent text
);
create index idx_payments_status on public.payments (status);
create unique index payments_firebase_uid_request_key_uidx on public.payments (firebase_uid, request_key) where (request_key is not null);

alter table public.access_codes enable row level security;
alter table public.navigator_paid_sessions enable row level security;
alter table public.payments enable row level security;
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.access_codes, public.navigator_paid_sessions to service_role;
grant select, insert on public.payments to service_role;

-- Verbatim pg_get_functiondef of the live function (md5(prosrc) = ca9f13a85933345f0dfede3b1ab2975e). Pre-P: every
-- redemption mints a NEW session, so a monthly renewal overlaps the existing entitlement instead of extending it.
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
grant execute on function public.redeem_access_code_atomic(text, text, text) to service_role;
