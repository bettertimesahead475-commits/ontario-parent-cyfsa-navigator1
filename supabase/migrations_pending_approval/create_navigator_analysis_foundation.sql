-- PENDING APPROVAL: do not execute automatically, including on the disposable DB. (DEVIN-PERF-04)
-- Account-isolated store of the source-grounded analytical foundation of a document: quotations that appear in the
-- document, grounded calendar dates, and party names. Interpretations (explanations, severities, legal conclusions,
-- verification verdicts) are never stored here; the writer (functions/api/_analysis-reuse.ts / shared/analyticalFoundation.ts)
-- excludes them, and the JSON records which fields were left out.
-- Keys are HMACs bound to the owner (functions/api/_report-cache.ts): rows reveal nothing about documents and never
-- match across accounts. Contains document quotations, so it is personal data: privacy and retention review required.
-- Proposed eligibility: 30 days (expires_at = completed_at + 30 days), subject to that review.
-- Rollback: supabase/migrations_pending_approval/rollback_navigator_analysis_foundation.sql.
begin;
create table public.navigator_analysis_foundation (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null check (char_length(owner_uid) between 1 and 128),
  document_fingerprint text not null check (document_fingerprint ~ '^[0-9a-f]{64}$'),
  schema_version integer not null check (schema_version >= 1),
  source_mode text not null check (source_mode in ('fast','full')),
  source_job_id text not null check (source_job_id ~ '^req_[A-Za-z0-9_-]{1,120}$'),
  foundation jsonb not null check (jsonb_typeof(foundation) = 'object' and length(foundation::text) <= 262144),
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  deleted_at timestamptz,
  check (expires_at > completed_at and expires_at <= completed_at + interval '30 days'),
  -- One foundation per account, document and schema version. A later Basic or Forensic run refreshes it by replacement.
  unique (owner_uid, document_fingerprint, schema_version)
);
create index navigator_analysis_foundation_expiry_idx on public.navigator_analysis_foundation (expires_at) where deleted_at is null;

-- Service role only: the Worker reads and writes with the server key after verifying the caller's identity.
alter table public.navigator_analysis_foundation enable row level security;
revoke all on public.navigator_analysis_foundation from anon, authenticated;

-- Owner deletion ("forget this document" or account deletion) and retention purge. Returns rows affected.
create or replace function public.navigator_analysis_foundation_forget(p_owner_uid text, p_fingerprint text default null)
returns integer language sql security definer set search_path = public as $$
  with d as (
    delete from public.navigator_analysis_foundation
    where owner_uid = p_owner_uid and (p_fingerprint is null or document_fingerprint = p_fingerprint)
    returning 1)
  select count(*)::integer from d;
$$;
create or replace function public.navigator_analysis_foundation_purge_expired()
returns integer language sql security definer set search_path = public as $$
  with d as (delete from public.navigator_analysis_foundation where expires_at <= now() or deleted_at is not null returning 1)
  select count(*)::integer from d;
$$;
revoke all on function public.navigator_analysis_foundation_forget(text, text) from public, anon, authenticated;
revoke all on function public.navigator_analysis_foundation_purge_expired() from public, anon, authenticated;
commit;
