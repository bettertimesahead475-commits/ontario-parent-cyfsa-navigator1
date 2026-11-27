-- Rollback for reconcile_skip_live_analyzer_jobs.sql: restores the repository versions of both functions. No data changes.
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
  hi text := 'free_res_' || p_uid || '`';
begin
  for r in
    select uid from public.free_usage
     where uid >= lo and uid < hi
       and length(uid) = length(lo) + 32
       and uid <> p_own_marker
       and email like 'reservation:reserved%'
       and coalesce(last_analysis_at, first_analysis_at) <= p_now - p_ttl
     for update
  loop
    perform public.free_release_marker(p_uid, r.uid, p_now);
  end loop;
end
$$;

commit;
