-- Isolated staging only. All fixture writes roll back inside the exception block.
DO $test$
DECLARE
  v_uid text := 'rc_vfy_' || gen_random_uuid()::text;
  sid text := gen_random_uuid()::text;
  jid text := 'rc_job_' || replace(gen_random_uuid()::text, '-', '');
  token uuid := gen_random_uuid();
  r jsonb; second jsonb; n integer;
BEGIN
  BEGIN
    r := public.free_reserve_scan(v_uid, 'fails', 2, now(), interval '10 minutes');
    ASSERT r->>'status' = 'reserved', 'free reserve';
    second := public.free_reserve_scan(v_uid, 'fails', 2, now(), interval '10 minutes');
    ASSERT second->>'status' = 'joined', 'free duplicate';
    ASSERT (select analyses_used from public.free_usage where free_usage.uid = v_uid) = 1, 'free duplicate counter';
    second := public.free_release_scan(v_uid, 'fails', r->>'reservation_id', now());
    ASSERT second->>'status' = 'released', 'free failure release';
    ASSERT (select analyses_used from public.free_usage where free_usage.uid = v_uid) = 0, 'free released counter';
    r := public.free_reserve_scan(v_uid, 'works', 2, now(), interval '10 minutes');
    ASSERT public.free_finalize_scan(v_uid, 'works', now())->>'status' = 'consumed', 'free finalize';
    ASSERT public.free_finalize_scan(v_uid, 'works', now())->>'status' = 'consumed', 'free duplicate finalize';
    perform public.free_release_scan(v_uid, 'works', r->>'reservation_id', now());
    ASSERT (select analyses_used from public.free_usage where free_usage.uid = v_uid) = 1, 'free late release preserves charge';

    r := public.paid_reserve_credit(sid, 'fails', 'total', 2, now(), interval '10 minutes', interval '30 seconds');
    ASSERT r->>'status' = 'reserved', 'paid reserve';
    ASSERT public.paid_reserve_credit(sid, 'fails', 'total', 2, now(), interval '10 minutes', interval '30 seconds')->>'status' = 'joined', 'paid duplicate';
    ASSERT public.paid_release_credit(sid, 'fails', r->>'reservation_id', now())->>'status' = 'released', 'paid failure release';
    ASSERT (select analyses_used from public.free_usage where free_usage.uid = 'paid_session_' || sid || '_total') = 0, 'paid released counter';
    r := public.paid_reserve_credit(sid, 'works', 'total', 2, now(), interval '10 minutes', interval '30 seconds');
    ASSERT public.paid_finalize_credit(sid, 'works', now())->>'status' = 'consumed', 'paid finalize';
    ASSERT public.paid_finalize_credit(sid, 'works', now())->>'status' = 'consumed', 'paid duplicate finalize';
    perform public.paid_release_credit(sid, 'works', r->>'reservation_id', now());
    ASSERT (select analyses_used from public.free_usage where free_usage.uid = 'paid_session_' || sid || '_total') = 1, 'paid late release preserves charge';

    r := public.analyzer_create_job(jid, v_uid, 'fast', 'inputs/' || jid || '.json', null, null, true);
    ASSERT r->>'status' = 'queued', 'job creation';
    ASSERT public.analyzer_claim_job(jid, token, 240)->>'status' = 'running', 'job claim';
    ASSERT public.analyzer_claim_job(jid, gen_random_uuid(), 240) IS NULL, 'duplicate claim excluded';
    ASSERT NOT public.analyzer_requeue_from_dlq(jid), 'active lease protected from DLQ';
    ASSERT public.analyzer_update_job(jid, token, 'queued', 'TEST_RETRY', 'Synthetic retry', true, 10, 'queued'), 'retry state';
    ASSERT public.analyzer_requeue_from_dlq(jid), 'abandoned job DLQ requeue';
    ASSERT public.analyzer_claim_job(jid, token, 240)->>'attempt_count' = '2', 'retry attempt count';
    ASSERT public.analyzer_update_job(jid, token, 'queued', null, null, true, 10, 'queued'), 'return to queue';
    ASSERT public.analyzer_fail_dead_letter(jid, 'TEST_EXHAUSTED', 'Synthetic exhausted job')->>'status' = 'failed', 'DLQ terminal state';
    RAISE EXCEPTION 'rollback synthetic fixtures' USING ERRCODE = 'Z0001';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
  END;
  ASSERT NOT EXISTS (select from public.analyzer_jobs where job_id = jid), 'job fixture rollback';
  ASSERT NOT EXISTS (select from public.free_usage where free_usage.uid = v_uid or free_usage.uid like '%' || sid || '%'), 'credit fixture rollback';
END $test$;
SELECT 'PASS: 26 staging database assertions; synthetic writes rolled back' as result;
