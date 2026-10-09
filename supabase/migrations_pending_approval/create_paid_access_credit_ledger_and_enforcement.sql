-- ============================================================================
-- Migration: create_paid_access_credit_ledger_and_enforcement.sql
-- Status: PENDING OWNER APPROVAL (DO NOT EXECUTE AUTOMATICALLY)
-- Target Database: Supabase Production (qboidsfpjuxeqtfotryj / cyfsa-parent-platform)
-- Purpose:
--   1. Ensure authoritative tier check constraints support:
--      'Basic', 'AnalyzerBasic', 'Premium', 'AnalyzerPremium', 'Pro',
--      'Community5', 'Community10', 'Community25', 'Enterprise',
--      'pro_advocate', 'premium_attorney'.
--   2. Add credit accounting, suspension and audit fields to
--      public.navigator_paid_sessions and public.payments.
--   3. Create public.analysis_credit_reservations for race-proof atomic
--      slot reservations before AI execution.
--   4. Create public.credit_audit_ledger for immutable traceability of
--      grants, reservations, consumptions, releases, suspensions, and
--      bank confirmations.
-- Transaction Safety: Wrapped in BEGIN / COMMIT. Idempotent DDL.
-- ============================================================================

begin;

-- 1. Expand tier constraints on access_codes and navigator_paid_sessions
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

-- 2. Extend navigator_paid_sessions with credit accounting and suspension fields
alter table public.navigator_paid_sessions
  add column if not exists credits_granted integer not null default 0,
  add column if not exists credits_consumed integer not null default 0,
  add column if not exists is_suspended boolean not null default false,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text;

-- 3. Extend payments with identity binding, settlement tracking, and request signals
alter table public.payments
  add column if not exists firebase_uid text,
  add column if not exists bank_settlement_status text not null default 'pending_settlement'
    check (bank_settlement_status in ('pending_settlement', 'bank_confirmed', 'missing_or_disputed')),
  add column if not exists notification_accepted_at timestamptz,
  add column if not exists client_ip text,
  add column if not exists user_agent text;

-- 4. Create analysis_credit_reservations table
create table if not exists public.analysis_credit_reservations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.navigator_paid_sessions(id) on delete cascade,
  firebase_uid text not null,
  slot_index integer not null,
  request_id text not null,
  analysis_type text not null check (analysis_type in ('quick', 'forensic')),
  status text not null default 'reserved' check (status in ('reserved', 'finalized', 'released')),
  reserved_at timestamptz not null default now(),
  finalized_at timestamptz,
  released_at timestamptz,
  document_name text,
  metadata jsonb default '{}'::jsonb,
  constraint analysis_credit_reservations_session_slot_uniq unique (session_id, slot_index),
  constraint analysis_credit_reservations_request_id_uniq unique (request_id)
);

create index if not exists analysis_credit_reservations_session_idx on public.analysis_credit_reservations (session_id);
create index if not exists analysis_credit_reservations_uid_idx on public.analysis_credit_reservations (firebase_uid);
create index if not exists analysis_credit_reservations_status_idx on public.analysis_credit_reservations (status);

-- 5. Create credit_audit_ledger table
create table if not exists public.credit_audit_ledger (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.navigator_paid_sessions(id) on delete set null,
  firebase_uid text not null,
  event_type text not null check (event_type in (
    'grant',
    'reservation',
    'finalization',
    'release',
    'suspension',
    'restoration',
    'bank_confirmation',
    'dispute'
  )),
  credits_delta integer not null default 0,
  balance_after integer,
  reference_id text,
  operator_role text not null default 'system' check (operator_role in ('system', 'admin', 'user')),
  details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists credit_audit_ledger_session_idx on public.credit_audit_ledger (session_id);
create index if not exists credit_audit_ledger_uid_idx on public.credit_audit_ledger (firebase_uid);
create index if not exists credit_audit_ledger_event_idx on public.credit_audit_ledger (event_type);

-- 6. RLS security enforcement
alter table public.analysis_credit_reservations enable row level security;
alter table public.credit_audit_ledger enable row level security;

revoke all on public.analysis_credit_reservations from public, anon, authenticated;
grant select, insert, update on public.analysis_credit_reservations to service_role;

revoke all on public.credit_audit_ledger from public, anon, authenticated;
grant select, insert, update on public.credit_audit_ledger to service_role;

commit;
