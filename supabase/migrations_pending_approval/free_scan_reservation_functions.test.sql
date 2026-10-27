-- Verification for free_scan_reservation_functions.sql. Run against STAGING or a local database that has a copy of
-- public.free_usage (uid primary key, email, analyses_used, first_analysis_at, last_analysis_at) and the migration applied.
-- Every check raises an exception on failure, so a clean run ends with "ALL FREE SCAN RESERVATION CHECKS PASSED".
-- The script writes only to the test account 'test-free-scan-account' and deletes its rows at the end.

\set ON_ERROR_STOP on

begin;

delete from public.free_usage where uid like 'test-free-scan-account%' or uid like 'free_res_test-free-scan-account%';

-- 1. The first scan is reserved; a second request is refused once the allowance (1) is used.
do $$
declare r jsonb; now_ts timestamptz := now();
begin
  r := public.free_reserve_scan('test-free-scan-account', 'req_a', 1, now_ts, interval '15 minutes');
  if r->>'status' <> 'reserved' then raise exception 'check 1a: expected reserved, got %', r; end if;
  r := public.free_reserve_scan('test-free-scan-account', 'req_b', 1, now_ts, interval '15 minutes');
  if r->>'status' <> 'limit' then raise exception 'check 1b: expected limit, got %', r; end if;
  if (select analyses_used from public.free_usage where uid = 'test-free-scan-account') <> 1 then
    raise exception 'check 1c: counter must stay at 1';
  end if;
end $$;

-- 2. A repeat of a live reservation is joined: no second unit.
do $$
declare r jsonb; now_ts timestamptz := now();
begin
  r := public.free_reserve_scan('test-free-scan-account', 'req_a', 1, now_ts, interval '15 minutes');
  if r->>'status' <> 'joined' then raise exception 'check 2: expected joined, got %', r; end if;
  if (select analyses_used from public.free_usage where uid = 'test-free-scan-account') <> 1 then
    raise exception 'check 2: counter changed on a joined attempt';
  end if;
end $$;

-- 3. A delivered scan is consumed; a repeat of it is consumed, not charged again.
do $$
declare r jsonb; now_ts timestamptz := now();
begin
  r := public.free_finalize_scan('test-free-scan-account', 'req_a', now_ts);
  if r->>'status' <> 'consumed' then raise exception 'check 3a: expected consumed, got %', r; end if;
  r := public.free_reserve_scan('test-free-scan-account', 'req_a', 1, now_ts, interval '15 minutes');
  if r->>'status' <> 'consumed' then raise exception 'check 3b: expected consumed on repeat, got %', r; end if;
  if (select analyses_used from public.free_usage where uid = 'test-free-scan-account') <> 1 then
    raise exception 'check 3c: counter changed on a consumed repeat';
  end if;
end $$;

-- 4. A failed scan releases its unit, which the next request can use.
do $$
declare r jsonb; now_ts timestamptz := now();
begin
  r := public.free_reserve_scan('test-free-scan-account', 'req_c', 2, now_ts, interval '15 minutes');
  if r->>'status' <> 'reserved' then raise exception 'check 4a: expected reserved, got %', r; end if;
  r := public.free_release_scan('test-free-scan-account', 'req_c', r->>'reservation_id', now_ts);
  if r->>'status' <> 'released' then raise exception 'check 4b: expected released, got %', r; end if;
  if (select analyses_used from public.free_usage where uid = 'test-free-scan-account') <> 1 then
    raise exception 'check 4c: release did not return the unit';
  end if;
  -- A release by a caller that does not own the reservation changes nothing.
  r := public.free_release_scan('test-free-scan-account', 'req_a', 'not-the-owner', now_ts);
  if r->>'status' <> 'noop' then raise exception 'check 4d: expected noop, got %', r; end if;
end $$;

-- 5. A reservation whose request ran out of time is released, and the same request is taken again with one unit.
do $$
declare r jsonb; old_ts timestamptz := now() - interval '16 minutes'; now_ts timestamptz := now();
begin
  r := public.free_reserve_scan('test-free-scan-account', 'req_d', 3, old_ts, interval '15 minutes');
  if r->>'status' <> 'reserved' then raise exception 'check 5a: expected reserved, got %', r; end if;
  r := public.free_reserve_scan('test-free-scan-account', 'req_d', 3, now_ts, interval '15 minutes');
  if r->>'status' <> 'reserved' then raise exception 'check 5b: expected reserved after expiry, got %', r; end if;
  -- Net effect of the expiry and the retake is one unit for req_d, and req_a's consumed unit is still counted.
  if (select analyses_used from public.free_usage where uid = 'test-free-scan-account') <> 2 then
    raise exception 'check 5c: expected 2 units (req_a consumed, req_d reserved)';
  end if;
end $$;

-- 6. Another request's expired reservation is released by reconcile, returning its unit to the account.
do $$
declare r jsonb; old_ts timestamptz := now() - interval '20 minutes'; now_ts timestamptz := now();
begin
  r := public.free_reserve_scan('test-free-scan-account', 'req_e', 3, old_ts, interval '15 minutes');
  if r->>'status' <> 'reserved' then raise exception 'check 6a: expected reserved, got %', r; end if;
  if (select analyses_used from public.free_usage where uid = 'test-free-scan-account') <> 3 then
    raise exception 'check 6b: expected 3 units before reconcile';
  end if;
  r := public.free_reserve_scan('test-free-scan-account', 'req_f', 3, now_ts, interval '15 minutes');
  if r->>'status' <> 'reserved' then raise exception 'check 6c: expected reserved, got %', r; end if;
  if (select email from public.free_usage where uid = public.free_marker_uid('test-free-scan-account', 'req_e')) <> 'reservation:released' then
    raise exception 'check 6d: expired reservation req_e was not released';
  end if;
  -- req_d (reserved), req_a (consumed) and req_f (reserved) hold units; req_e's unit was returned.
  if (select analyses_used from public.free_usage where uid = 'test-free-scan-account') <> 3 then
    raise exception 'check 6e: expected 3 units after reconcile and req_f';
  end if;
end $$;

-- 7. Other accounts are never affected by a reservation.
do $$
declare r jsonb; now_ts timestamptz := now();
begin
  r := public.free_reserve_scan('test-free-scan-other', 'req_x', 1, now_ts, interval '15 minutes');
  if r->>'status' <> 'reserved' then raise exception 'check 7: expected reserved for another account, got %', r; end if;
end $$;

delete from public.free_usage where uid like 'test-free-scan-account%' or uid like 'free_res_test-free-scan-account%'
  or uid like 'test-free-scan-other%' or uid like 'free_res_test-free-scan-other%';

select 'ALL FREE SCAN RESERVATION CHECKS PASSED' as result;

rollback;
