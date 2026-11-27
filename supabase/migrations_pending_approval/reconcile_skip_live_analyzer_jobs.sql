-- ============================================================================
-- Migration: reconcile_skip_live_analyzer_jobs.sql
-- Status: PENDING OWNER APPROVAL (DO NOT APPLY). Not executed by any tooling.
--
-- Problem (concurrency review 2026-11-25, finding 1): paid_reconcile / free_reconcile release any reservation marker
-- untouched for 15 minutes when the same account reserves again. Nothing refreshes the marker of a QUEUED job, so a
-- Forensic job that waits in the queue (retries, backlog) longer than 15 minutes has its credit returned while it is
-- still going to run. Since the concurrency fixes of 2026-11-25 the worker then delivers the report uncharged instead of retrying forever, but the
-- credit accounting is still wrong. This change makes reconcile skip markers that belong to an analyzer job that is
-- still queued or running (analyzer_jobs.reservation_id is the marker uid).
--
-- Pre-check (read-only): the bodies below are the repository versions
-- (paid_credit_reservation_functions.sql, free_scan_reservation_functions.sql) plus one added condition each.
-- Before applying, confirm production matches the repository:
--   select pg_get_functiondef('public.paid_reconcile(text,text,timestamptz,interval)'::regprocedure);
--   select pg_get_functiondef('public.free_reconcile(text,text,timestamptz,interval)'::regprocedure);
-- If either differs, do not apply; re-derive this file from the production definition.
--
-- Rollback: reconcile_skip_live_analyzer_jobs.down.sql (restores the repository versions). No data changes.
-- Bound: only jobs updated in the last 2 hours keep their credit. A job stuck in queued/running (a Pages request
-- that died between creating the job and queueing it, or exhausted dead-letter retries) is still reconciled.
-- Index: run the CREATE INDEX at the end of this file on its own first (CONCURRENTLY cannot run in a transaction).
-- ============================================================================

begin;

create or replace function public.paid_reconcile(p_session text, p_own_uid text, p_now timestamptz, p_ttl interval)
returns void
language plpgsql
as $$
declare
  r record;
  prefix text := 'paid_res_' || p_session || '_';
begin
  for r in
    select uid from public.free_usage
     where left(uid, length(prefix)) = prefix
       and uid <> p_own_uid
       and email like 'reservation:reserved%'
       and coalesce(last_analysis_at, first_analysis_at) <= p_now - p_ttl
       and not exists (
         select 1 from public.analyzer_jobs j
          where j.reservation_id = free_usage.uid and j.status in ('queued', 'running')
            and j.updated_at > p_now - interval '2 hours'
       )
     for update
  loop
    perform public.paid_release_marker(p_session, r.uid, p_now);
  end loop;
end
$$;

create or replace function public.free_reconcile(p_uid text, p_own_marker text, p_now timestamptz, p_ttl interval)
returns void
language plpgsql
as $$
declare
  r record;
  lo text := 'free_res_' || p_uid || '_';
begin
  for r in
    select uid from public.free_usage
     where left(uid, length(lo)) = lo
       and length(uid) = length(lo) + 32
       and uid <> p_own_marker
       and email like 'reservation:reserved%'
       and coalesce(last_analysis_at, first_analysis_at) <= p_now - p_ttl
       and not exists (
         select 1 from public.analyzer_jobs j
          where j.reservation_id = free_usage.uid and j.status in ('queued', 'running')
            and j.updated_at > p_now - interval '2 hours'
       )
     for update
  loop
    perform public.free_release_marker(p_uid, r.uid, p_now);
  end loop;
end
$$;

revoke all on function public.paid_reconcile(text, text, timestamptz, interval) from public, anon, authenticated;
revoke all on function public.free_reconcile(text, text, timestamptz, interval) from public, anon, authenticated;
grant execute on function public.paid_reconcile(text, text, timestamptz, interval) to service_role;
grant execute on function public.free_reconcile(text, text, timestamptz, interval) to service_role;

commit;

-- Not included (proposals; each needs its own review):
--  * Finding 5: paid_reserve_credit never re-claims the caller's OWN stale marker (free_reserve_scan does, after the TTL).
--  * Finding 6: for scope 'none' (unlimited Quick on monthly plans) a same-id request after the 60 s claim window is
--    re-reserved while the first run may still be going. Treat a live reserved marker as in_progress until the TTL.

-- Run FIRST, on its own (not inside a transaction): supports the NOT EXISTS lookup without a table scan.
-- create index concurrently if not exists analyzer_jobs_live_reservation_idx
--   on public.analyzer_jobs (reservation_id) where status in ('queued', 'running');
-- Rollback: drop index concurrently if exists public.analyzer_jobs_live_reservation_idx;
