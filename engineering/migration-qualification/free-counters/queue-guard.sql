BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  ts timestamptz := now();
  ttl interval := interval '15 min';
  marker text;
  result text;
BEGIN
  ASSERT public.free_reserve_scan('ff:queued', 'queued-doc', 1, ts - interval '30 min',
                                  ttl)->>'status' = 'reserved';
  marker := public.free_marker_uid('ff:queued', 'queued-doc');
  INSERT INTO public.analyzer_jobs (job_id, owner_uid, mode, input_key, reservation_id)
  VALUES ('queued-doc', 'synthetic-uid', 'full', 'synthetic-input', marker);
  result := public.free_reserve_scan('ff:queued', 'other-doc', 1, ts, ttl)->>'status';
  ASSERT result = 'limit', 'another request reclaimed a queued job entitlement: ' || result;
  UPDATE public.analyzer_jobs SET status = 'failed' WHERE job_id = 'queued-doc';
  result := public.free_reserve_scan('ff:queued', 'other-doc', 1, ts, ttl)->>'status';
  ASSERT result = 'reserved', 'failed stale job entitlement stayed stranded: ' || result;
  ASSERT (SELECT email = 'reservation:released' FROM public.free_usage WHERE uid = marker);
  RAISE NOTICE 'PASS: B protects an expired queued marker but reclaims it after job failure';
END $$;
ROLLBACK;
