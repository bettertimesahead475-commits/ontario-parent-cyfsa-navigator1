-- PENDING APPROVAL: do not execute automatically, including on the disposable DB. (DEVIN-PERF-03)
-- Account-isolated index of completed reports. Stores no document text and no report content: the report stays in
-- the existing private analysis_jobs storage object; this row only points to it. Keys are HMACs bound to the owner
-- (functions/api/_report-cache.ts), so rows reveal nothing about documents and never match across accounts.
begin;
create table public.navigator_report_cache (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null check (char_length(owner_uid) between 1 and 128),
  cache_key text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  key_version text not null,
  document_fingerprint text not null check (document_fingerprint ~ '^[0-9a-f]{64}$'),
  mode text not null check (mode in ('fast','full','final_case_assessment')),
  analyzer_version text not null, prompt_version text not null,
  primary_model text not null, verification_model text,
  legal_reference_version text not null, legal_effective_date date not null,
  job_id text not null check (job_id ~ '^req_[A-Za-z0-9_-]{1,120}$'),
  status text not null default 'completed' check (status = 'completed'),
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  deleted_at timestamptz,
  check (expires_at > completed_at),
  unique (owner_uid, cache_key)
);
create index navigator_report_cache_expiry_idx on public.navigator_report_cache (expires_at) where deleted_at is null;
create index navigator_report_cache_owner_doc_idx on public.navigator_report_cache (owner_uid, document_fingerprint);
-- Service role only: the Worker reads and writes with the server key after verifying the caller's identity.
alter table public.navigator_report_cache enable row level security;
revoke all on public.navigator_report_cache from anon, authenticated;

-- Owner deletion (account deletion or "forget this document") and retention purge. Returns rows affected.
create or replace function public.navigator_report_cache_forget(p_owner_uid text, p_fingerprint text default null)
returns integer language sql security definer set search_path = public as $$
  with d as (
    delete from public.navigator_report_cache
    where owner_uid = p_owner_uid and (p_fingerprint is null or document_fingerprint = p_fingerprint)
    returning 1)
  select count(*)::integer from d;
$$;
create or replace function public.navigator_report_cache_purge_expired()
returns integer language sql security definer set search_path = public as $$
  with d as (delete from public.navigator_report_cache where expires_at <= now() or deleted_at is not null returning 1)
  select count(*)::integer from d;
$$;
revoke all on function public.navigator_report_cache_forget(text, text) from public, anon, authenticated;
revoke all on function public.navigator_report_cache_purge_expired() from public, anon, authenticated;
commit;
