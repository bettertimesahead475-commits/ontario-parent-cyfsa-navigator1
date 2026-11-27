DO $$
DECLARE
  caller text;
  routine record;
  privileges text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  privilege text;
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.free_usage'::regclass);
  ASSERT (SELECT count(*) = 6 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('free_marker_uid', 'free_release_marker', 'free_reconcile', 'free_reserve_scan',
                     'free_finalize_scan', 'free_release_scan'));
  FOR routine IN SELECT oid, prosecdef FROM pg_proc WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('free_marker_uid', 'free_release_marker', 'free_reconcile', 'free_reserve_scan',
                     'free_finalize_scan', 'free_release_scan')
  LOOP
    ASSERT NOT routine.prosecdef;
    ASSERT has_function_privilege('service_role', routine.oid, 'EXECUTE');
    ASSERT NOT has_function_privilege('anon', routine.oid, 'EXECUTE');
    ASSERT NOT has_function_privilege('authenticated', routine.oid, 'EXECUTE');
  END LOOP;
  FOREACH caller IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH privilege IN ARRAY privileges LOOP
      ASSERT NOT has_table_privilege(caller, 'public.free_usage', privilege);
    END LOOP;
    EXECUTE format('SET LOCAL ROLE %I', caller);
    BEGIN
      PERFORM public.free_reserve_scan('legacy-uid', 'forbidden', 100, now(), interval '15 min');
      RAISE EXCEPTION 'unexpected execute permission';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      UPDATE public.free_usage SET analyses_used = 0 WHERE uid = 'legacy-uid';
      RAISE EXCEPTION 'unexpected counter write permission';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  ASSERT (SELECT count(*) = 1 FROM pg_index WHERE indrelid = 'public.free_usage'::regclass
    AND indisprimary AND indisunique AND indisvalid AND indnkeyatts = 1
    AND pg_get_indexdef(indexrelid, 1, true) = 'uid');
  ASSERT (SELECT indisvalid AND indisready FROM pg_index
    WHERE indexrelid = 'public.analyzer_jobs_live_reservation_idx'::regclass);
  BEGIN
    INSERT INTO public.free_usage (uid) VALUES ('legacy-uid');
    RAISE EXCEPTION 'duplicate key unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.free_usage (uid, analyses_used) VALUES ('null-count', NULL);
    RAISE EXCEPTION 'null count unexpectedly accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS: role grants, RLS, invoker mode, primary key, NOT NULL and live-job index';
END $$;

SET ROLE service_role;
DO $$
DECLARE
  ts timestamptz := now();
  ttl interval := interval '15 min';
  marker text;
BEGIN
  ASSERT (SELECT analyses_used = 2 FROM public.free_usage WHERE uid = 'legacy-uid');
  ASSERT (SELECT analyses_used = 3 FROM public.free_usage WHERE uid = 'legacy-exhausted');
  ASSERT (SELECT analyses_used = 0 FROM public.free_usage WHERE uid = 'legacy-zero');
  ASSERT public.free_reserve_scan('legacy-uid', 'old-quick', 3, ts, ttl)->>'status' = 'reserved';
  ASSERT public.free_finalize_scan('legacy-uid', 'old-quick', ts)->>'status' = 'consumed';
  ASSERT public.free_reserve_scan('legacy-uid', 'new-quick', 3, ts, ttl)->>'status' = 'limit';
  ASSERT public.free_reserve_scan('legacy-exhausted', 'new-quick', 3, ts, ttl)->>'status' = 'limit';
  ASSERT public.free_reserve_scan('ff:legacy', 'new-forensic', 1, ts, ttl)->>'status' = 'reserved';
  ASSERT (SELECT analyses_used = 2 FROM public.free_usage WHERE uid LIKE 'paid_session_%');
  RAISE NOTICE 'PASS: legacy and paid rows preserved; legacy Quick ceiling and independent Forensic';

  FOREACH marker IN ARRAY ARRAY['fq:failure', 'ff:failure'] LOOP
    ASSERT public.free_reserve_scan(marker, 'failed-doc', 1, ts, ttl)->>'status' = 'reserved';
    ASSERT public.free_reserve_scan(marker, 'failed-doc', 1, ts, ttl)->>'status' = 'joined';
    ASSERT public.free_release_scan(marker, 'failed-doc', 'wrong-marker', ts)->>'status' = 'noop';
    ASSERT public.free_release_scan(marker, 'failed-doc',
           public.free_marker_uid(marker, 'failed-doc'), ts)->>'status' = 'released';
    ASSERT public.free_release_scan(marker, 'failed-doc',
           public.free_marker_uid(marker, 'failed-doc'), ts)->>'status' = 'noop';
    ASSERT (SELECT analyses_used = 0 FROM public.free_usage WHERE uid = marker);
    ASSERT public.free_reserve_scan(marker, 'retry-doc', 1, ts, ttl)->>'status' = 'reserved';
    ASSERT public.free_finalize_scan(marker, 'retry-doc', ts)->>'status' = 'consumed';
    ASSERT public.free_release_scan(marker, 'retry-doc',
           public.free_marker_uid(marker, 'retry-doc'), ts)->>'status' = 'noop';
    ASSERT (SELECT analyses_used = 1 FROM public.free_usage WHERE uid = marker);
  END LOOP;
  RAISE NOTICE 'PASS: both modes join duplicate requests, restore failure exactly once, and keep delivered units';
END $$;
RESET ROLE;
