-- Rollback for payment_requests_request_key_unique.sql.
-- Run only after the application code that writes request_key has been rolled back, or it will
-- start failing on inserts. Dropping the columns also deletes firebase_uid/request_key values written
-- since the migration; the rows themselves, their references, status and notes are kept.
DROP INDEX IF EXISTS public.payments_firebase_uid_request_key_uidx;
ALTER TABLE public.payments DROP COLUMN IF EXISTS request_key;
ALTER TABLE public.payments DROP COLUMN IF EXISTS firebase_uid;
