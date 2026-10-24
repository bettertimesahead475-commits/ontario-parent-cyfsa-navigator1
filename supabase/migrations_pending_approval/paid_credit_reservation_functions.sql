-- ============================================================================
-- Migration: paid_credit_reservation_functions.sql
-- Status: PENDING OWNER APPROVAL. DO NOT APPLY until staging verification passes and production is explicitly approved.
--
-- Adds atomic PostgreSQL functions for paid-analysis credit reservations. Creates NO tables and changes NO rows.
-- Each function runs in one transaction under a per-session advisory lock, so a crash, a lost connection or a
-- concurrent request cannot leave a counter moved without its marker, or the reverse.
--
-- Reversible: paid_credit_reservation_functions.down.sql drops the functions. The application needs them: paid
-- analyses fail closed (503) until they exist, so apply this before the application release that calls them.
--
-- Depends on: public.free_usage (uid primary key, email, analyses_used, first_analysis_at, last_analysis_at).
-- Key formats must match api/services/creditAccounting.ts exactly.
-- ============================================================================

begin;

-- Marker row key: 'paid_res_<session>_<first 32 hex chars of sha256(request id)>'
create or replace function public.paid_marker_uid(p_session text, p_request text)
returns text
language sql
immutable
as $$
  select 'paid_res_' || p_session || '_' || substr(encode(sha256(convert_to(p_request, 'UTF8')), 'hex'), 1, 32)
$$;

-- Marker state for a counter scope: 'total', 'none' (quick reviews on monthly plans), or 'period:<YYYY-MM-DD>'.
create or replace function public.paid_state_for_scope(p_scope text)
returns text
language plpgsql
immutable
as $$
begin
  if p_scope = 'total' then return 'reservation:reserved'; end if;
  if p_scope = 'none' then return 'reservation:reserved:none'; end if;
  if left(p_scope, 7) = 'period:' then return 'reservation:reserved:period:' || substr(p_scope, 8); end if;
  raise exception 'unknown credit scope %', p_scope using errcode = '22023';
end
$$;

-- Counter row for a marker state; null when the unit was not counted (scope 'none').
create or replace function public.paid_counter_for_state(p_session text, p_state text)
returns text
language plpgsql
immutable
as $$
begin
  if p_state = 'reservation:reserved' then return 'paid_session_' || p_session || '_total'; end if;
  if p_state = 'reservation:reserved:none' then return null; end if;
  if left(p_state, 28) = 'reservation:reserved:period:' then
    return 'paid_session_' || p_session || '_period_' || substr(p_state, 29);
  end if;
  return null;
end
$$;

-- Returns one reservation's unit (marker reserved -> released; counter -1 when a unit was recorded).
-- Caller must hold the session advisory lock.
create or replace function public.paid_release_marker(p_session text, p_uid text, p_now timestamptz)
returns boolean
language plpgsql
as $$
declare
  r public.free_usage%rowtype;
  c text;
begin
  select * into r from public.free_usage where uid = p_uid for update;
  if not found or r.email not like 'reservation:reserved%' then
    return false;
  end if;
  update public.free_usage set email = 'reservation:released', last_analysis_at = p_now where uid = p_uid;
  c := public.paid_counter_for_state(p_session, r.email);
  if c is not null and r.analyses_used > 0 then
    update public.free_usage
       set analyses_used = greatest(analyses_used - 1, 0), last_analysis_at = p_now
     where uid = c;
  end if;
  return true;
end
$$;

-- Reconciles incomplete reservations of one session: any reservation (other than the caller's) untouched for
-- longer than p_ttl is released. Live reservations are touched by their own requests and are never released here.
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

-- Atomic reservation. One transaction: reconcile, check the allowance, and write the counter and marker together.
-- Returns jsonb: status = reserved | joined | consumed | in_progress | limit.
-- reservation_id is non-null only for the attempt that owns the reservation (the only one allowed to release it).
create or replace function public.paid_reserve_credit(
  p_session text,
  p_request text,
  p_scope text,
  p_granted integer,
  p_now timestamptz,
  p_ttl interval,
  p_claim_window interval
)
returns jsonb
language plpgsql
as $$
declare
  v_uid text := public.paid_marker_uid(p_session, p_request);
  v_state text := public.paid_state_for_scope(p_scope);
  v_counter text := public.paid_counter_for_state(p_session, v_state);
  v_marker public.free_usage%rowtype;
  v_marker_found boolean;
  v_counter_row public.free_usage%rowtype;
  v_counter_found boolean := false;
  v_used integer := 0;
  v_slot integer;
  v_touched timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session, 0));
  perform public.paid_reconcile(p_session, v_uid, p_now, p_ttl);

  select * into v_marker from public.free_usage where uid = v_uid for update;
  v_marker_found := found;

  if v_marker_found then
    v_touched := coalesce(v_marker.last_analysis_at, v_marker.first_analysis_at);
    if v_marker.email = 'reservation:consumed' then
      return jsonb_build_object('status', 'consumed', 'reservation_id', null, 'slot', v_marker.analyses_used);
    end if;
    if v_marker.email like 'reservation:reserved%' then
      if v_marker.analyses_used > 0 then
        -- A live reservation with its unit recorded: a joined attempt, not charged again, not owner.
        return jsonb_build_object('status', 'joined', 'reservation_id', null, 'slot', v_marker.analyses_used);
      end if;
      if p_now - v_touched <= p_claim_window then
        return jsonb_build_object('status', 'in_progress', 'reservation_id', null);
      end if;
      -- An abandoned claim with no unit recorded: nothing to return. Re-take it below.
    end if;
    -- 'reservation:released' and abandoned claims fall through to a new claim.
  end if;

  if v_counter is not null then
    select * into v_counter_row from public.free_usage where uid = v_counter for update;
    v_counter_found := found;
    v_used := coalesce(v_counter_row.analyses_used, 0);
    if v_used >= p_granted then
      return jsonb_build_object('status', 'limit', 'reservation_id', null);
    end if;
    v_slot := v_used + 1;
    if v_counter_found then
      update public.free_usage set analyses_used = v_slot, last_analysis_at = p_now where uid = v_counter;
    else
      insert into public.free_usage (uid, email, analyses_used, first_analysis_at, last_analysis_at)
      values (v_counter, null, v_slot, p_now, p_now);
    end if;
  else
    v_slot := 0;
  end if;

  if v_marker_found then
    update public.free_usage
       set email = v_state, analyses_used = v_slot, last_analysis_at = p_now
     where uid = v_uid;
  else
    insert into public.free_usage (uid, email, analyses_used, first_analysis_at, last_analysis_at)
    values (v_uid, v_state, v_slot, p_now, p_now);
  end if;

  return jsonb_build_object(
    'status', 'reserved',
    'reservation_id', v_uid,
    'slot', v_slot,
    'counter_used', case when v_counter is null then null else v_slot end
  );
end
$$;

-- Releases a reservation, only for the owner: the id must equal the marker's uid.
create or replace function public.paid_release_credit(
  p_session text,
  p_request text,
  p_reservation_id text,
  p_now timestamptz
)
returns jsonb
language plpgsql
as $$
declare
  v_uid text := public.paid_marker_uid(p_session, p_request);
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session, 0));
  if p_reservation_id is null or p_reservation_id <> v_uid then
    return jsonb_build_object('status', 'noop');
  end if;
  if public.paid_release_marker(p_session, v_uid, p_now) then
    return jsonb_build_object('status', 'released');
  end if;
  return jsonb_build_object('status', 'noop');
end
$$;

-- Marks a reservation consumed after the analysis is delivered. Only a reserved marker can be consumed.
create or replace function public.paid_finalize_credit(p_session text, p_request text, p_now timestamptz)
returns jsonb
language plpgsql
as $$
declare
  v_uid text := public.paid_marker_uid(p_session, p_request);
  v_marker public.free_usage%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session, 0));
  select * into v_marker from public.free_usage where uid = v_uid for update;
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;
  if v_marker.email = 'reservation:consumed' then
    return jsonb_build_object('status', 'consumed');
  end if;
  if v_marker.email like 'reservation:reserved%' then
    update public.free_usage set email = 'reservation:consumed', last_analysis_at = p_now where uid = v_uid;
    return jsonb_build_object('status', 'consumed');
  end if;
  return jsonb_build_object('status', 'released');
end
$$;

revoke all on function public.paid_marker_uid(text, text) from public, anon, authenticated;
revoke all on function public.paid_state_for_scope(text) from public, anon, authenticated;
revoke all on function public.paid_counter_for_state(text, text) from public, anon, authenticated;
revoke all on function public.paid_release_marker(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.paid_reconcile(text, text, timestamptz, interval) from public, anon, authenticated;
revoke all on function public.paid_reserve_credit(text, text, text, integer, timestamptz, interval, interval) from public, anon, authenticated;
revoke all on function public.paid_release_credit(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.paid_finalize_credit(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.paid_reserve_credit(text, text, text, integer, timestamptz, interval, interval) to service_role;
grant execute on function public.paid_release_credit(text, text, text, timestamptz) to service_role;
grant execute on function public.paid_finalize_credit(text, text, timestamptz) to service_role;

commit;
