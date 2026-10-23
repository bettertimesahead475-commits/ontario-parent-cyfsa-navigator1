-- PR #89: database-enforced idempotency for payment requests.
-- Additive only: two nullable columns and one unique index. No existing row is modified, and the
-- index ignores every row without a request_key (all current production rows).
-- Apply BEFORE deploying the application code that writes request_key.
-- firebase_uid is also added by create_paid_access_credit_ledger_and_enforcement.sql with the same
-- definition (text, IF NOT EXISTS), so the two migrations can be applied in either order.

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS firebase_uid text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS request_key text;

-- One checkout attempt = one payment row, in any status. A retry of the attempt is caught by this
-- index; a new purchase uses a new key and is not affected.
CREATE UNIQUE INDEX IF NOT EXISTS payments_firebase_uid_request_key_uidx
  ON public.payments (firebase_uid, request_key)
  WHERE request_key IS NOT NULL;
