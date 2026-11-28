-- PENDING OWNER APPROVAL. Not applied anywhere. Target: the Supabase project the Cloudflare Pages app actually uses
-- (STAGING_SUPABASE_URL, which has served production; confirm with the read-only preflight before applying).
--
-- Outbox for transactional (payment and access) email only. Promotional email is a separate system
-- (supabase/migrations/20261005_marketing_agent.sql) and must never write here.
-- Minimal personal data: the recipient address and the payment reference. No document content, no names.
-- secret_payload holds an AES-GCM-sealed access code only until it is sent or fails (see CHECK below).
-- Retention: delete rows 180 days after created_at (sent/failed/skipped/unknown); a scheduled cleanup is not part
-- of this migration.
BEGIN;

CREATE TABLE IF NOT EXISTS public.transactional_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('payment_instructions', 'payment_confirmation', 'purchase_receipt', 'access_code', 'renewal_reminder', 'refund_confirmation')),
  dedupe_key text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 120),
  payment_reference text CHECK (payment_reference IS NULL OR length(payment_reference) <= 32),
  recipient_email text NOT NULL CHECK (length(recipient_email) BETWEEN 3 AND 254),
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_payload text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped', 'unknown')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 200),
  sent_at timestamptz,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactional_email_outbox_kind_dedupe_key UNIQUE (kind, dedupe_key),
  CONSTRAINT transactional_email_outbox_secret_only_while_open CHECK (secret_payload IS NULL OR status IN ('pending', 'sending'))
);

CREATE INDEX IF NOT EXISTS transactional_email_outbox_due ON public.transactional_email_outbox (next_attempt_at) WHERE status = 'pending';

-- Service role only (Pages Functions). Browsers never read or write this table.
ALTER TABLE public.transactional_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transactional_email_outbox FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.transactional_email_outbox FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.transactional_email_outbox FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT SELECT, INSERT, UPDATE ON public.transactional_email_outbox TO service_role; END IF;
END $$;

COMMENT ON TABLE public.transactional_email_outbox IS 'Transactional payment/access email outbox. Not for marketing. Delete rows 180 days after created_at.';

COMMIT;
