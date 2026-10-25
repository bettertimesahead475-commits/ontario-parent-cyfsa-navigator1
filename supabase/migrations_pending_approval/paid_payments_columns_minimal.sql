-- ============================================================================
-- Migration: paid_payments_columns_minimal.sql
-- Status: PENDING OWNER APPROVAL (DO NOT APPLY). Not executed by any tooling.
-- Target: Supabase production only after review (qboidsfpjuxeqtfotryj). Staging first.
--
-- Supersedes, for credit accounting, create_paid_access_credit_ledger_and_enforcement.sql.
-- Scope: the four payments columns that are absent in production. Nothing else.
--
-- Removed from the original file, with the reason:
--   - analysis_credit_reservations table: credit reservations live in free_usage (see CREDIT_ATOMIC_CLAIM.md).
--   - credit_audit_ledger table: nothing writes to it; the code does not read it.
--   - navigator_paid_sessions credits_* and suspension columns: unused. Credit state is in free_usage;
--     suspension is read from the suspended_<id> row.
--   - tier check constraints: already applied to production (verified read-only).
--   - payments.firebase_uid: already present in production.
--
-- Risk: adding a CHECK with a NOT NULL default validates every existing payments row under lock. Check the
-- payments row count first; run in a quiet period if large.
-- Rollback: drop the four columns (no data depends on them yet).
-- ============================================================================

begin;

alter table public.payments
  add column if not exists bank_settlement_status text not null default 'pending_settlement'
    check (bank_settlement_status in ('pending_settlement', 'bank_confirmed', 'missing_or_disputed')),
  add column if not exists notification_accepted_at timestamptz,
  add column if not exists client_ip text,
  add column if not exists user_agent text;

commit;
