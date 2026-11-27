-- PENDING APPROVAL: do not execute automatically, including on the disposable DB. (T-05 / SEC-3 / S-05)
-- Cross-isolate rate limiting. One row per hashed subject and fixed window. key_hash is SHA-256 of
-- "bucket:subject" computed in the Pages Function (functions/api/_persistent-rate-limit.ts), so no uid, email or
-- IP address is stored. Only service_role may call the function; the table is closed to anon/authenticated.
-- Fixed windows: a client can send up to 2x the limit across one window boundary, never more.
-- Rows older than one day are deleted, at most 50 per allowed call. No customer data is read or changed.
-- Rollback: supabase/migrations_pending_approval/rollback_navigator_rate_limit_hits.sql.
begin;
create table public.navigator_rate_limit_hits (
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null default 1 check (hits >= 1),
  primary key (key_hash, window_start)
);
create index navigator_rate_limit_hits_window_idx on public.navigator_rate_limit_hits (window_start);
alter table public.navigator_rate_limit_hits enable row level security;
revoke all on table public.navigator_rate_limit_hits from public, anon, authenticated;

-- Atomic: concurrent callers for one key serialise on the primary-key row, so at most p_limit calls per window
-- are allowed across every Cloudflare isolate and location. A refused call does not increment the counter.
create function public.navigator_rate_limit_hit(p_key_hash text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_start timestamptz;
  v_hits integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
     or p_limit is null or p_limit < 1 or p_limit > 10000
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;
  v_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  insert into public.navigator_rate_limit_hits as h (key_hash, window_start, hits)
  values (p_key_hash, v_start, 1)
  on conflict (key_hash, window_start) do update set hits = h.hits + 1 where h.hits < p_limit
  returning h.hits into v_hits;

  if v_hits is null then
    return query select false,
      greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - v_now))))::integer;
    return;
  end if;

  delete from public.navigator_rate_limit_hits
   where ctid in (select ctid from public.navigator_rate_limit_hits
                   where window_start < v_now - interval '1 day' limit 50);
  return query select true, 0;
end
$$;
revoke all on function public.navigator_rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.navigator_rate_limit_hit(text, integer, integer) to service_role;
commit;
