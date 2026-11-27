-- Empty-only rollback, before enqueue and drain have been enabled. Preserve delivery history; repair forward after use.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL row_security = off;
DO $$
BEGIN
  IF to_regclass('public.transactional_email_outbox') IS NOT NULL THEN
    LOCK TABLE public.transactional_email_outbox IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM public.transactional_email_outbox) THEN
      RAISE EXCEPTION 'Transactional email outbox is not empty; preserve delivery history and repair forward';
    END IF;
    DROP TABLE public.transactional_email_outbox;
  END IF;
END
$$;
COMMIT;
