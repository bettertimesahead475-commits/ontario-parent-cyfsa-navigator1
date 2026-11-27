SET ROLE service_role;
DO $$
DECLARE
  ts timestamptz := now();
  ttl interval := interval '15 min';
  marker text;
BEGIN
  -- A prospective new-app reservation using the unchanged RPC signature on the A+B schema.
  ASSERT public.free_reserve_scan('fq:mix', 'new-doc', 1, ts, ttl)->>'status' = 'reserved';
  ASSERT public.free_finalize_scan('fq:mix', 'new-doc', ts)->>'status' = 'consumed';
  -- Old Pages still chooses raw uid, so it does not see the new consumed Quick lane.
  ASSERT public.free_reserve_scan('mixed-uid', 'old-doc', 3, ts, ttl)->>'status' = 'reserved';
  ASSERT (SELECT count(*) = 2 FROM public.free_usage WHERE uid IN ('mixed-uid', 'fq:mix') AND analyses_used = 1);
  RAISE NOTICE 'FAIL: old Pages can grant Quick after the new Quick entitlement is spent (reproduced)';

  ASSERT public.free_reserve_scan('ff:mix', 'worker-doc', 1, ts, ttl)->>'status' = 'reserved';
  marker := public.free_marker_uid('ff:mix', 'worker-doc');
  -- Old consumer sends owner_uid rather than the key encoded in the marker id.
  ASSERT public.free_finalize_scan('mixed-uid', 'worker-doc', ts)->>'status' = 'missing';
  ASSERT public.free_release_scan('mixed-uid', 'worker-doc', marker, ts)->>'status' = 'noop';
  ASSERT (SELECT email = 'reservation:reserved' FROM public.free_usage WHERE uid = marker);
  RAISE NOTICE 'FAIL: old queue consumer cannot finalize or release a new free Forensic marker (reproduced)';

  ASSERT public.free_finalize_scan('ff:mix', 'worker-doc', ts)->>'status' = 'consumed';
  ASSERT public.free_reserve_scan('other-legacy-uid', 'old-queued-doc', 3, ts, ttl)->>'status' = 'reserved';
  ASSERT public.free_finalize_scan('other-legacy-uid', 'old-queued-doc', ts)->>'status' = 'consumed';
  RAISE NOTICE 'PASS: new consumer key choice supports both marker formats on A+B schema';
END $$;
RESET ROLE;
