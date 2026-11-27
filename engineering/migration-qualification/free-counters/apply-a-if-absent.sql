-- psql wrapper; a_file must be the checksum-verified archived A, not a branch copy.
\set ON_ERROR_STOP on
SELECT pg_advisory_lock(hashtextextended('navigator:install-free-reservation-a', 0));
SELECT count(oid) = 0 AS a_absent, count(oid) = 6 AS a_present
FROM unnest(ARRAY[
  to_regprocedure('public.free_marker_uid(text,text)'),
  to_regprocedure('public.free_release_marker(text,text,timestamp with time zone)'),
  to_regprocedure('public.free_reconcile(text,text,timestamp with time zone,interval)'),
  to_regprocedure('public.free_reserve_scan(text,text,integer,timestamp with time zone,interval)'),
  to_regprocedure('public.free_finalize_scan(text,text,timestamp with time zone)'),
  to_regprocedure('public.free_release_scan(text,text,text,timestamp with time zone)')
]) AS f(oid)
\gset
\if :a_absent
  \i :a_file
\elif :a_present
  \echo 'SKIP: free reservation functions already exist; verify installed definitions, do not replay A'
\else
  DO $$ BEGIN RAISE EXCEPTION 'Partial free reservation installation; stop and verify definitions'; END $$;
\endif
SELECT pg_advisory_unlock(hashtextextended('navigator:install-free-reservation-a', 0));
