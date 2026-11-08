-- Durable Cloudflare Queue job ledger. Document contents and reports remain in the
-- private analysis_jobs Storage bucket; this table stores only ownership, state,
-- storage key, and credit reservation references.
create table if not exists public.analyzer_jobs (
  job_id text primary key check (job_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  owner_uid text not null,
  mode text not null check (mode in ('fast', 'full')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  input_key text not null,
  session_id uuid,
  reservation_id text,
  owner_bypass boolean not null default false,
  worker_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  progress integer not null default 0 check (progress between 0 and 100),
  stage text,
  error_code text,
  error_message text,
  retryable boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists analyzer_jobs_owner_created_idx
  on public.analyzer_jobs (owner_uid, created_at desc);

alter table public.analyzer_jobs enable row level security;
revoke all on public.analyzer_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.analyzer_jobs to service_role;

create or replace function public.analyzer_create_job(
  p_job_id text,
  p_owner_uid text,
  p_mode text,
  p_input_key text,
  p_session_id uuid,
  p_reservation_id text,
  p_owner_bypass boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_job public.analyzer_jobs;
begin
  insert into public.analyzer_jobs(job_id, owner_uid, mode, input_key, session_id, reservation_id, owner_bypass)
  values (p_job_id, p_owner_uid, p_mode, p_input_key, p_session_id, p_reservation_id, coalesce(p_owner_bypass, false))
  returning * into v_job;
  return to_jsonb(v_job);
end;
$$;

create or replace function public.analyzer_get_job(p_job_id text)
returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(j) from public.analyzer_jobs as j where j.job_id = p_job_id;
$$;

-- The conditional UPDATE is the claim lock: concurrent consumers can update at
-- most one queued row, and a running row can only be reclaimed after lease expiry.
create or replace function public.analyzer_claim_job(p_job_id text, p_worker_token uuid, p_lease_seconds integer default 240)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.analyzer_jobs;
begin
  update public.analyzer_jobs as j
     set status = 'running', worker_token = p_worker_token,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
         attempt_count = j.attempt_count + 1, updated_at = now(), error_code = null, error_message = null, retryable = null
   where j.job_id = p_job_id
     and (j.status = 'queued' or (j.status = 'running' and j.lease_expires_at < now()))
  returning * into v_job;
  if not found then return null; end if;
  return to_jsonb(v_job);
end;
$$;

create or replace function public.analyzer_update_job(
  p_job_id text,
  p_worker_token uuid,
  p_status text,
  p_error_code text default null,
  p_error_message text default null,
  p_retryable boolean default null,
  p_progress integer default null,
  p_stage text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_status not in ('queued', 'running', 'completed', 'failed') then return false; end if;
  update public.analyzer_jobs as j
     set status = p_status,
         error_code = p_error_code,
         error_message = p_error_message,
         retryable = p_retryable,
         progress = coalesce(p_progress, j.progress),
         stage = coalesce(p_stage, j.stage),
         updated_at = now(),
         lease_expires_at = case when p_status = 'running' then now() + interval '4 minutes' else null end,
         worker_token = case when p_status = 'running' then j.worker_token else null end,
         completed_at = case when p_status = 'completed' then now() else j.completed_at end
   where j.job_id = p_job_id
     and ((p_worker_token is not null and j.status = 'running' and j.worker_token = p_worker_token)
       or (p_worker_token is null and j.status = 'queued' and p_status = 'failed'));
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- Called only by the separately bound DLQ consumer after Cloudflare exhausts retries.
create or replace function public.analyzer_fail_dead_letter(p_job_id text, p_error_code text, p_error_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.analyzer_jobs;
begin
  update public.analyzer_jobs as j
     set status = 'failed', error_code = p_error_code, error_message = p_error_message,
         retryable = false, updated_at = now(), lease_expires_at = null, worker_token = null
   where j.job_id = p_job_id
     and (j.status = 'queued' or (j.status = 'running' and j.lease_expires_at < now()))
  returning * into v_job;
  if not found then select * into v_job from public.analyzer_jobs where job_id = p_job_id; end if;
  if not found then return null; end if;
  return to_jsonb(v_job);
end;
$$;

-- A crash can exhaust normal Queue delivery before the DB lease expires. The DLQ
-- consumer requeues only an abandoned/queued job, with a durable claim-count cap.
create or replace function public.analyzer_requeue_from_dlq(p_job_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.analyzer_jobs
     set status = 'queued', worker_token = null, lease_expires_at = null,
         stage = 'queued', updated_at = now()
   where job_id = p_job_id and attempt_count < 6
     and (status = 'queued' or (status = 'running' and lease_expires_at < now()));
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- DLQ recovery may complete a job only after its report is found in private Storage
-- and the existing idempotent credit finalizer confirms consumption.
create or replace function public.analyzer_complete_recovered_job(p_job_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.analyzer_jobs
     set status = 'completed', progress = 100, stage = 'complete', error_code = null,
         error_message = null, retryable = null, updated_at = now(), completed_at = now(),
         lease_expires_at = null, worker_token = null
   where job_id = p_job_id and status in ('queued', 'running');
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.analyzer_create_job(text,text,text,text,uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.analyzer_get_job(text) from public, anon, authenticated;
revoke all on function public.analyzer_claim_job(text,uuid,integer) from public, anon, authenticated;
revoke all on function public.analyzer_update_job(text,uuid,text,text,text,boolean,integer,text) from public, anon, authenticated;
revoke all on function public.analyzer_fail_dead_letter(text,text,text) from public, anon, authenticated;
revoke all on function public.analyzer_requeue_from_dlq(text) from public, anon, authenticated;
revoke all on function public.analyzer_complete_recovered_job(text) from public, anon, authenticated;
grant execute on function public.analyzer_create_job(text,text,text,text,uuid,text,boolean) to service_role;
grant execute on function public.analyzer_get_job(text) to service_role;
grant execute on function public.analyzer_claim_job(text,uuid,integer) to service_role;
grant execute on function public.analyzer_update_job(text,uuid,text,text,text,boolean,integer,text) to service_role;
grant execute on function public.analyzer_fail_dead_letter(text,text,text) to service_role;
grant execute on function public.analyzer_requeue_from_dlq(text) to service_role;
grant execute on function public.analyzer_complete_recovered_job(text) to service_role;
