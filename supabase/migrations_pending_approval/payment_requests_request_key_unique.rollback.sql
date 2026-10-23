-- Rollback for payment_requests_request_key_unique.sql.
-- Run only after the application code that writes request_key has been rolled back, or inserts
-- will fail. Removes only request_key and its index. firebase_uid is intentionally left in place:
-- it is shared with create_paid_access_credit_ledger_and_enforcement.sql, which also adds it, and
-- dropping it would delete identity bindings on every payment. Rows, references, status and notes
-- are not modified. Keyed values written before the rollback are lost; the rows remain.
DROP INDEX IF EXISTS public.payments_firebase_uid_request_key_uidx;
ALTER TABLE public.payments DROP COLUMN IF EXISTS request_key;
