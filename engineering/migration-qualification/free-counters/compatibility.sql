SET ROLE service_role;
DO $$
DECLARE
  ts timestamptz := now();
  ttl interval := interval '15 min';
  marker text;
BEGIN
  ASSERT public.free_reserve_scan('ff:' || repeat('a', 40), 'worker-doc', 1, ts, ttl)->>'status' = 'reserved';
  marker := public.free_marker_uid('ff:' || repeat('a', 40), 'worker-doc');
  PERFORM public.analyzer_create_job('worker-doc', 'mixed-uid', 'full', 'synthetic-input', NULL, marker, false);
  -- Old consumer sends owner_uid rather than the key encoded in the marker id.
  ASSERT public.free_finalize_scan('mixed-uid', 'worker-doc', ts)->>'status' = 'missing';
  ASSERT public.free_release_scan('mixed-uid', 'worker-doc', marker, ts)->>'status' = 'noop';
  ASSERT (SELECT email = 'reservation:reserved' FROM public.free_usage WHERE uid = marker);
  RAISE NOTICE 'UNSAFE (historical control): without the bridge the old worker cannot settle split markers';

  ASSERT public.free_finalize_scan('ff:' || repeat('a', 40), 'worker-doc', ts)->>'status' = 'consumed';
  ASSERT public.free_reserve_scan('other-legacy-uid', 'old-queued-doc', 3, ts, ttl)->>'status' = 'reserved';
  ASSERT public.free_finalize_scan('other-legacy-uid', 'old-queued-doc', ts)->>'status' = 'consumed';
  RAISE NOTICE 'PASS: new consumer key choice supports both marker formats on A+B schema';
END $$;
RESET ROLE;
