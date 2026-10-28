-- ============================================================================
-- Migration: free_scan_reservation_functions.sql
-- Status: PENDING OWNER APPROVAL. DO NOT APPLY until staging verification passes and production is explicitly approved.
--
-- Adds atomic PostgreSQL functions that reserve one free scan before its analysis runs. Creates NO tables, changes
-- NO rows, and changes NO existing function, grant, or policy. Each function runs in one transaction under a
-- per-account advisory lock, so a concurrent request on any instance cannot take the last free scan twice.
--
-- The counter is the existing public.free_usage row keyed by the account uid, so getFreeUsage and the paid
-- reservation functions read the same count. Each reservation has a marker row keyed by the account uid and the
-- analysis request id, following the paid reservation markers exactly.
--
-- Reversible: free_scan_reservation_functions.down.sql drops these functions. The application needs them: a free
-- analysis fails closed (503) until they exist, so apply this migration BEFORE the application release that calls
-- them. Verify with supabase/migrations_pending_approval/free_scan_reservation_functions.test.sql on staging first.
--
-- Depends on: public.free_usage (uid primary key, email, analyses_used, first_analysis_at, last_analysis_at).
-- Key formats must match api/services/freeScanReservation.ts exactly.
-- ============================================================================

begin;

-- Marker row key: 'free_res_<uid>_<first 32 hex chars of sha256(request id)>'
create or replace function public.free_marker_uid(p_uid text, p_request text)
returns text
language sql
immutable
as $$
  select 'free_res_' || p_uid || '_' || substr(encode(sha256(convert_to(p_request, 'UTF8')), 'hex'), 1, 32)
$$;

-- Releases one reserved marker and returns its unit to the counter. Only a reserved marker can be released.
create or replace function public.free_release_marker(p_uid text, p_marker text, p_now timestamptz)
returns boolean
language plpgsql
as $$
declare
  r public.free_usage%rowtype;
begin
  select * into r from public.free_usage where uid = p_marker for update;
  if not found or r.email not like 'reservation:reserved%' then
    return false;
  end if;
  update public.free_usage set email = 'reservation:released', last_analysis_at = p_now where uid = p_marker;
  if r.analyses_used > 0 then
    update public.free_usage
       set analyses_used = greatest(analyses_used - 1, 0), last_analysis_at = p_now
     where uid = p_uid;
  end if;
  return true;
end
$$;

-- Releases reservations of THIS account (p_uid) that were not touched within p_ttl.
-- The range predicate uses the uid primary key index (a LIKE or left() predicate would scan the table). The length
-- check makes the match exact: a marker is 'free_res_<uid>_' plus 32 hex characters, so a marker of another account
-- whose uid merely starts with p_uid || '_' can never be released against p_uid's counter.
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

-- Atomic reservation of one free scan. One transaction: reconcile, check the allowance, and write the counter and
-- the marker together. Returns jsonb: status = reserved | joined | consumed | limit.
-- reservation_id is non-null only for the attempt that owns the reservation (the only one allowed to release it).
-- A reservation of this same request older than p_ttl is released first, so a request whose earlier attempt has
-- certainly ended (the function ceiling is far shorter than p_ttl) is not blocked forever.
create or replace function public.free_reserve_scan(
  p_uid text,
  p_request text,
  p_limit integer,
  p_now timestamptz,
  p_ttl interval
)
returns jsonb
language plpgsql
as $$
declare
  v_marker text := public.free_marker_uid(p_uid, p_request);
  v_marker_row public.free_usage%rowtype;
  v_marker_found boolean;
  v_counter public.free_usage%rowtype;
  v_counter_found boolean;
  v_used integer := 0;
  v_slot integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_uid, 0));
  perform public.free_reconcile(p_uid, v_marker, p_now, p_ttl);

  select * into v_marker_row from public.free_usage where uid = v_marker for update;
  v_marker_found := found;

  if v_marker_found then
    if v_marker_row.email = 'reservation:consumed' then
      return jsonb_build_object('status', 'consumed', 'reservation_id', null, 'used', v_marker_row.analyses_used);
    end if;
    if v_marker_row.email like 'reservation:reserved%' then
      if coalesce(v_marker_row.last_analysis_at, v_marker_row.first_analysis_at) > p_now - p_ttl then
        -- Live: the attempt that owns this unit is still within its time limit. Not charged again, not owner.
        return jsonb_build_object('status', 'joined', 'reservation_id', null, 'used', v_marker_row.analyses_used);
      end if;
      -- Expired: release it (returning its unit) and take a new claim below.
      perform public.free_release_marker(p_uid, v_marker, p_now);
    end if;
    -- 'reservation:released' falls through to a new claim.
  end if;

  select * into v_counter from public.free_usage where uid = p_uid for update;
  v_counter_found := found;
  v_used := coalesce(v_counter.analyses_used, 0);
  if v_used >= p_limit then
    return jsonb_build_object('status', 'limit', 'reservation_id', null, 'used', v_used);
  end if;
  v_slot := v_used + 1;

  if v_counter_found then
    update public.free_usage set analyses_used = v_slot, last_analysis_at = p_now where uid = p_uid;
  else
    insert into public.free_usage (uid, email, analyses_used, first_analysis_at, last_analysis_at)
    values (p_uid, null, v_slot, p_now, p_now);
  end if;

  if v_marker_found then
    update public.free_usage
       set email = 'reservation:reserved', analyses_used = v_slot, last_analysis_at = p_now
     where uid = v_marker;
  else
    insert into public.free_usage (uid, email, analyses_used, first_analysis_at, last_analysis_at)
    values (v_marker, 'reservation:reserved', v_slot, p_now, p_now);
  end if;

  return jsonb_build_object('status', 'reserved', 'reservation_id', v_marker, 'slot', v_slot, 'used', v_slot);
end
$$;

-- Marks a reservation consumed after the report has been delivered. Only a reserved marker can be consumed.
create or replace function public.free_finalize_scan(p_uid text, p_request text, p_now timestamptz)
returns jsonb
language plpgsql
as $$
declare
  v_marker text := public.free_marker_uid(p_uid, p_request);
  v_row public.free_usage%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_uid, 0));
  select * into v_row from public.free_usage where uid = v_marker for update;
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;
  if v_row.email = 'reservation:consumed' then
    return jsonb_build_object('status', 'consumed');
  end if;
  if v_row.email like 'reservation:reserved%' then
    update public.free_usage set email = 'reservation:consumed', last_analysis_at = p_now where uid = v_marker;
    return jsonb_build_object('status', 'consumed');
  end if;
  return jsonb_build_object('status', 'released');
end
$$;

-- Releases this request's reservation, if the caller owns it. A consumed or missing reservation is not released.
create or replace function public.free_release_scan(
  p_uid text,
  p_request text,
  p_reservation_id text,
  p_now timestamptz
)
returns jsonb
language plpgsql
as $$
declare
  v_marker text := public.free_marker_uid(p_uid, p_request);
begin
  perform pg_advisory_xact_lock(hashtextextended(p_uid, 0));
  if p_reservation_id is null or p_reservation_id <> v_marker then
    return jsonb_build_object('status', 'noop');
  end if;
  if public.free_release_marker(p_uid, v_marker, p_now) then
    return jsonb_build_object('status', 'released');
  end if;
  return jsonb_build_object('status', 'noop');
end
$$;

revoke all on function public.free_reserve_scan(text, text, integer, timestamptz, interval) from public, anon, authenticated;
revoke all on function public.free_finalize_scan(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.free_release_scan(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.free_reserve_scan(text, text, integer, timestamptz, interval) to service_role;
grant execute on function public.free_finalize_scan(text, text, timestamptz) to service_role;
grant execute on function public.free_release_scan(text, text, text, timestamptz) to service_role;

-- The entry points above run as the caller, so service_role also needs the internal helpers they call.
-- The helpers are revoked from PUBLIC, anon and authenticated too: PostgreSQL grants EXECUTE to PUBLIC by default, and the
-- API exposes public functions. Without this, a public-key caller could release another account's reservation directly.
revoke all on function public.free_marker_uid(text, text) from public, anon, authenticated;
revoke all on function public.free_release_marker(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.free_reconcile(text, text, timestamptz, interval) from public, anon, authenticated;
grant execute on function public.free_marker_uid(text, text) to service_role;
grant execute on function public.free_release_marker(text, text, timestamptz) to service_role;
grant execute on function public.free_reconcile(text, text, timestamptz, interval) to service_role;

commit;
