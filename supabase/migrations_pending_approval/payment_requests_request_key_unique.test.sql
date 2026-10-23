-- Run against a disposable database that has a minimal public.payments table (see test.sh).
-- Each block raises on failure, so a clean run exits 0.
\set ON_ERROR_STOP on

-- Legacy rows (no key) must not conflict with each other or with keyed rows.
INSERT INTO payments (plan, amount, reference_number, status, notes) VALUES
  ('Pro', 99, 'LEG-1', 'pending', 'email:a@x.ca'),
  ('Pro', 99, 'LEG-2', 'pending', 'email:a@x.ca');

-- A keyed request.
INSERT INTO payments (plan, amount, reference_number, status, firebase_uid, request_key)
  VALUES ('Pro', 99, 'K-1', 'pending', 'uid1', 'attempt-aaaa-1111');

-- Retry of the same attempt is rejected by the index (the app then returns the existing row).
DO $$ BEGIN
  BEGIN
    INSERT INTO payments (plan, amount, reference_number, status, firebase_uid, request_key)
      VALUES ('Pro', 99, 'K-2', 'pending', 'uid1', 'attempt-aaaa-1111');
    RAISE EXCEPTION 'duplicate retry was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- A deliberate repeat purchase (new key, same account, same tier) gets its own row.
INSERT INTO payments (plan, amount, reference_number, status, firebase_uid, request_key)
  VALUES ('Pro', 99, 'K-3', 'pending', 'uid1', 'attempt-bbbb-2222');

-- Same key under a different account is independent.
INSERT INTO payments (plan, amount, reference_number, status, firebase_uid, request_key)
  VALUES ('Pro', 99, 'K-4', 'pending', 'uid2', 'attempt-aaaa-1111');

-- A key stays used after approval: a replay of an approved attempt cannot create a second row.
UPDATE payments SET status = 'approved' WHERE reference_number = 'K-1';
DO $$ BEGIN
  BEGIN
    INSERT INTO payments (plan, amount, reference_number, status, firebase_uid, request_key)
      VALUES ('Pro', 99, 'K-5', 'pending', 'uid1', 'attempt-aaaa-1111');
    RAISE EXCEPTION 'replay after approval was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- Legacy pending rows are untouched by the migration and still pending.
DO $$ BEGIN
  IF (SELECT count(*) FROM payments WHERE reference_number IN ('LEG-1', 'LEG-2')
      AND status = 'pending' AND request_key IS NULL) <> 2 THEN
    RAISE EXCEPTION 'legacy pending rows changed';
  END IF;
END $$;
