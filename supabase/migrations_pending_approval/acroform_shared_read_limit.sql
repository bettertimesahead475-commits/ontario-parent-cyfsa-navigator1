-- PENDING OWNER APPROVAL. NOT APPLIED TO ANY DATABASE.
-- Shared fixed-window read limiter for POST /api/acroform/ingest, so every serverless instance counts the same reads.
-- The route calls this function only when ACROFORM_LIMIT_BACKEND="shared" (api/services/acroFormReadLimiter.ts). The default
-- is the per-process limiter. In "shared" mode a missing or failing function refuses the read (503); it never allows it.

create table if not exists public.acroform_read_limits (
  uid text not null,
  window_start timestamptz not null,
  reads integer not null default 0,
  primary key (uid, window_start)
);

alter table public.acroform_read_limits enable row level security;
revoke all on public.acroform_read_limits from public, anon, authenticated;

create or replace function public.acroform_consume_read(p_uid text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  if p_uid is null or p_uid = '' or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments';
  end if;
  insert into public.acroform_read_limits as l (uid, window_start, reads)
  values (p_uid, v_window, 1)
  on conflict (uid, window_start) do update set reads = l.reads + 1
  returning reads into v_count;
  -- Keep the table small: drop windows that have ended.
  delete from public.acroform_read_limits where window_start < v_window - make_interval(secs => p_window_seconds);
  return v_count <= p_limit;
end;
$$;

revoke all on function public.acroform_consume_read(text, integer, integer) from public, anon, authenticated;
grant execute on function public.acroform_consume_read(text, integer, integer) to service_role;
