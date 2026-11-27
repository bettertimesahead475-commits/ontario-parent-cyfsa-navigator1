-- Run against a disposable database (see create_transactional_email_outbox.test.sh). Each block raises on failure.
\set ON_ERROR_STOP on

INSERT INTO transactional_email_outbox (kind, dedupe_key, payment_reference, recipient_email, template_data)
  VALUES ('payment_instructions', 'PS-AAAA1111', 'PS-AAAA1111', 'parent@example.test', '{"plan":"Basic","amount":19.99}');

-- The same email for the same order is ignored on retry (the app uses ON CONFLICT DO NOTHING via PostgREST).
INSERT INTO transactional_email_outbox (kind, dedupe_key, payment_reference, recipient_email)
  VALUES ('payment_instructions', 'PS-AAAA1111', 'PS-AAAA1111', 'parent@example.test') ON CONFLICT (kind, dedupe_key) DO NOTHING;
DO $$ BEGIN
  IF (SELECT count(*) FROM transactional_email_outbox WHERE dedupe_key = 'PS-AAAA1111') <> 1 THEN RAISE EXCEPTION 'duplicate queued'; END IF;
END $$;

-- A different kind for the same order is its own email.
INSERT INTO transactional_email_outbox (kind, dedupe_key, payment_reference, recipient_email)
  VALUES ('purchase_receipt', 'PS-AAAA1111', 'PS-AAAA1111', 'parent@example.test');

-- Without ON CONFLICT a duplicate is a unique violation.
DO $$ BEGIN
  BEGIN
    INSERT INTO transactional_email_outbox (kind, dedupe_key, recipient_email) VALUES ('purchase_receipt', 'PS-AAAA1111', 'parent@example.test');
    RAISE EXCEPTION 'duplicate accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- Marketing or unknown kinds are rejected.
DO $$ BEGIN
  BEGIN
    INSERT INTO transactional_email_outbox (kind, dedupe_key, recipient_email) VALUES ('newsletter', 'x', 'parent@example.test');
    RAISE EXCEPTION 'marketing kind accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- A sealed code cannot remain on a finished row.
INSERT INTO transactional_email_outbox (kind, dedupe_key, recipient_email, secret_payload)
  VALUES ('access_code', 'PS-BBBB2222', 'parent@example.test', 'iv.sealed');
DO $$ BEGIN
  BEGIN
    UPDATE transactional_email_outbox SET status = 'sent' WHERE dedupe_key = 'PS-BBBB2222';
    RAISE EXCEPTION 'secret kept after send';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
UPDATE transactional_email_outbox SET status = 'sent', secret_payload = NULL, sent_at = now() WHERE dedupe_key = 'PS-BBBB2222';

-- Unknown statuses are rejected.
DO $$ BEGIN
  BEGIN
    UPDATE transactional_email_outbox SET status = 'bounced' WHERE dedupe_key = 'PS-BBBB2222';
    RAISE EXCEPTION 'unknown status accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Browser roles have no access.
DO $$ BEGIN
  IF has_table_privilege('anon', 'transactional_email_outbox', 'SELECT') OR has_table_privilege('authenticated', 'transactional_email_outbox', 'INSERT') THEN
    RAISE EXCEPTION 'browser role can access the outbox';
  END IF;
  IF NOT has_table_privilege('service_role', 'transactional_email_outbox', 'UPDATE') THEN RAISE EXCEPTION 'service_role cannot update'; END IF;
END $$;
