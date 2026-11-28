-- Rollback for create_transactional_email_outbox.sql. Drops only the outbox (queued and sent-email records);
-- no payment, access-code or entitlement data is touched.
BEGIN;
DROP TABLE IF EXISTS public.transactional_email_outbox;
COMMIT;
