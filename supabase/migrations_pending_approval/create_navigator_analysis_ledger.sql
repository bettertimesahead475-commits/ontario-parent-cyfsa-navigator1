-- PENDING APPROVAL: do not execute automatically, including on the disposable DB. (DEVIN-PERF-05)
-- Per-job usage ledger: cumulative provider reservations, settlements and stage checkpoints across every delivery of a job.
-- Writes are compare-and-swap on `version`, and only the worker holding a live job lease may write (analyzer_jobs.worker_token
-- with lease_expires_at in the future). Contains usage numbers and stage digests only; no document text.
-- Rollback: supabase/migrations_pending_approval/rollback_navigator_analysis_ledger.sql.
begin;
create table public.analyzer_job_ledger (
  job_id text primary key references public.analyzer_jobs (job_id) on delete cascade,
  version integer not null default 0 check (version >= 0),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and length(state::text) <= 262144),
  updated_at timestamptz not null default now()
);
alter table public.analyzer_job_ledger enable row level security;
revoke all on public.analyzer_job_ledger from public, anon, authenticated;
grant select, insert, update, delete on public.analyzer_job_ledger to service_role;

create or replace function public.analyzer_job_ledger_read(p_job_id text)
returns jsonb language sql security definer set search_path = '' as $$
  select l.state || jsonb_build_object('version', l.version, 'jobId', l.job_id)
    from public.analyzer_job_ledger as l where l.job_id = p_job_id;
$$;

-- Compare-and-swap write. Returns 'not_owner' unless p_worker_token holds a live lease on the job,
-- 'conflict' when the stored version is not p_expected_version, otherwise 'written'.
create or replace function public.analyzer_job_ledger_write(
  p_job_id text,
  p_expected_version integer,
  p_worker_token uuid,
  p_state jsonb
) returns text language plpgsql security definer set search_path = '' as $$
declare v_stored integer;
begin
  if p_worker_token is null then return 'not_owner'; end if;
  perform 1 from public.analyzer_jobs as j
   where j.job_id = p_job_id and j.status = 'running' and j.worker_token = p_worker_token and j.lease_expires_at > now();
  if not found then return 'not_owner'; end if;
  insert into public.analyzer_job_ledger (job_id, version, state) values (p_job_id, 0, '{}'::jsonb)
    on conflict (job_id) do nothing;
  select l.version into v_stored from public.analyzer_job_ledger as l where l.job_id = p_job_id for update;
  if v_stored is distinct from p_expected_version then return 'conflict'; end if;
  update public.analyzer_job_ledger
     set version = v_stored + 1, state = p_state - 'version' - 'jobId', updated_at = now()
   where job_id = p_job_id;
  return 'written';
end;
$$;

revoke all on function public.analyzer_job_ledger_read(text) from public, anon, authenticated;
revoke all on function public.analyzer_job_ledger_write(text, integer, uuid, jsonb) from public, anon, authenticated;
commit;
