-- Forward-only proposal for disposable qualification. Depends on A+B and analyzer_jobs.
BEGIN;

CREATE OR REPLACE FUNCTION public.free_queue_settlement_key(p_uid text, p_request text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
  SELECT coalesce((
    SELECT marker.counter_key
    FROM public.analyzer_jobs AS job
    CROSS JOIN LATERAL (
      SELECT substring(job.reservation_id FROM '^free_res_((?:fq|ff):[0-9a-f]{40})_[0-9a-f]{32}$') AS counter_key
    ) AS marker
    WHERE job.job_id = p_request AND job.owner_uid = p_uid
      AND job.session_id IS NULL AND NOT job.owner_bypass
      AND ((job.mode = 'fast' AND left(marker.counter_key, 3) = 'fq:')
        OR (job.mode = 'full' AND left(marker.counter_key, 3) = 'ff:'))
      AND job.reservation_id = public.free_marker_uid(marker.counter_key, p_request)
  ), p_uid)
$$;

REVOKE ALL ON FUNCTION public.free_queue_settlement_key(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_queue_settlement_key(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.free_finalize_scan(p_uid text, p_request text, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_key text := public.free_queue_settlement_key(p_uid, p_request);
  v_marker text := public.free_marker_uid(v_key, p_request);
  v_row public.free_usage%rowtype;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
  SELECT * INTO v_row FROM public.free_usage WHERE uid = v_marker FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'missing');
  END IF;
  IF v_row.email = 'reservation:consumed' THEN
    RETURN jsonb_build_object('status', 'consumed');
  END IF;
  IF v_row.email LIKE 'reservation:reserved%' THEN
    UPDATE public.free_usage SET email = 'reservation:consumed', last_analysis_at = p_now WHERE uid = v_marker;
    RETURN jsonb_build_object('status', 'consumed');
  END IF;
  RETURN jsonb_build_object('status', 'released');
END
$$;

CREATE OR REPLACE FUNCTION public.free_release_scan(p_uid text, p_request text, p_reservation_id text, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_key text := public.free_queue_settlement_key(p_uid, p_request);
  v_marker text := public.free_marker_uid(v_key, p_request);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
  IF p_reservation_id IS NULL OR p_reservation_id <> v_marker THEN
    RETURN jsonb_build_object('status', 'noop');
  END IF;
  IF public.free_release_marker(v_key, v_marker, p_now) THEN
    RETURN jsonb_build_object('status', 'released');
  END IF;
  RETURN jsonb_build_object('status', 'noop');
END
$$;

REVOKE ALL ON FUNCTION public.free_finalize_scan(text, text, timestamptz),
  public.free_release_scan(text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_finalize_scan(text, text, timestamptz),
  public.free_release_scan(text, text, text, timestamptz) TO service_role;

COMMIT;
