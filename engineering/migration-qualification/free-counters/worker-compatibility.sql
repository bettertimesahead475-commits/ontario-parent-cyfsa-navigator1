DO $$
DECLARE
  caller text;
  routine record;
BEGIN
  FOR routine IN SELECT oid, prosecdef FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('free_queue_settlement_key', 'free_finalize_scan', 'free_release_scan')
  LOOP
    ASSERT NOT routine.prosecdef;
    ASSERT has_function_privilege('service_role', routine.oid, 'EXECUTE');
    FOREACH caller IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      ASSERT NOT has_function_privilege(caller, routine.oid, 'EXECUTE');
    END LOOP;
  END LOOP;
  ASSERT to_regprocedure('public.free_queue_settlement_key(text,text)') IS NOT NULL;
END $$;

SET ROLE service_role;
DO $$
DECLARE
  ts timestamptz := now();
  ttl interval := interval '15 min';
  key text;
  phase record;
  marker text;
BEGIN
  FOR phase IN SELECT * FROM (VALUES ('forensic-release', 'full', 'ff:' || repeat('b', 40)),
                                      ('quick-release', 'fast', 'fq:' || repeat('b', 40)))
    AS p(job_id, mode, counter_key)
  LOOP
    key := phase.counter_key;
    ASSERT public.free_reserve_scan(key, phase.job_id, 1, ts, ttl)->>'status' = 'reserved';
    marker := public.free_marker_uid(key, phase.job_id);
    PERFORM public.analyzer_create_job(phase.job_id, 'worker-owner', phase.mode, 'input', NULL, marker, false);
    ASSERT public.free_finalize_scan('different-owner', phase.job_id, ts)->>'status' = 'missing';
    ASSERT public.free_release_scan('different-owner', phase.job_id, marker, ts)->>'status' = 'noop';
    ASSERT public.free_release_scan('worker-owner', phase.job_id, 'wrong-marker', ts)->>'status' = 'noop';
    ASSERT public.free_release_scan('worker-owner', phase.job_id, marker, ts)->>'status' = 'released';
    ASSERT public.free_release_scan(key, phase.job_id, marker, ts)->>'status' = 'noop';
    ASSERT public.free_finalize_scan('worker-owner', phase.job_id, ts)->>'status' = 'released';
    ASSERT (SELECT analyses_used = 0 FROM public.free_usage WHERE uid = key);
    ASSERT public.free_reserve_scan(key, phase.job_id || '-retry', 1, ts, ttl)->>'status' = 'reserved';
  END LOOP;

  key := 'ff:' || repeat('c', 40);
  ASSERT public.free_reserve_scan(key, 'paid-job', 1, ts, ttl)->>'status' = 'reserved';
  marker := public.free_marker_uid(key, 'paid-job');
  PERFORM public.analyzer_create_job('paid-job', 'worker-owner', 'full', 'input',
    '11111111-1111-4111-8111-111111111111', marker, false);
  ASSERT public.free_finalize_scan('worker-owner', 'paid-job', ts)->>'status' = 'missing';
  ASSERT public.free_release_scan('worker-owner', 'paid-job', marker, ts)->>'status' = 'noop';
  PERFORM public.analyzer_create_job('bypass-job', 'worker-owner', 'full', 'input', NULL,
    public.free_marker_uid(key, 'bypass-job'), true);
  PERFORM public.analyzer_create_job('bad-mode-job', 'worker-owner', 'fast', 'input', NULL,
    public.free_marker_uid(key, 'bad-mode-job'), false);
  PERFORM public.analyzer_create_job('bad-hash-job', 'worker-owner', 'full', 'input', NULL, marker, false);
  ASSERT public.free_queue_settlement_key('worker-owner', 'bypass-job') = 'worker-owner';
  ASSERT public.free_queue_settlement_key('worker-owner', 'bad-mode-job') = 'worker-owner';
  ASSERT public.free_queue_settlement_key('worker-owner', 'bad-hash-job') = 'worker-owner';
  ASSERT (SELECT email = 'reservation:reserved' FROM public.free_usage WHERE uid = marker);

  ASSERT public.free_reserve_scan('legacy-worker-owner', 'legacy-job', 3, ts, ttl)->>'status' = 'reserved';
  ASSERT public.free_finalize_scan('legacy-worker-owner', 'legacy-job', ts)->>'status' = 'consumed';
  RAISE NOTICE 'PASS: old worker releases both split lanes; malformed, paid, bypass and wrong-owner jobs do not reroute';

  key := 'fq:' || repeat('d', 40);
  ASSERT public.free_reserve_scan(key, 'direct-new-quick', 1, ts, ttl)->>'status' = 'reserved';
  ASSERT public.free_finalize_scan(key, 'direct-new-quick', ts)->>'status' = 'consumed';
  ASSERT (SELECT email IS NULL FROM public.free_usage WHERE uid = key);
  ASSERT NOT EXISTS (SELECT FROM public.analyzer_jobs WHERE job_id = 'direct-new-quick');
  ASSERT public.free_reserve_scan('same-account-uid', 'direct-old-quick', 3, ts, ttl)->>'status' = 'reserved';
  ASSERT public.free_reserve_scan('different-account-uid', 'other-old-quick', 3, ts, ttl)->>'status' = 'reserved';
  RAISE NOTICE 'BLOCKED: old Quick RPC cannot distinguish a spent split account from an unrelated UID';
END $$;
RESET ROLE;
