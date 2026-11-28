-- READ-ONLY preflight for create_transactional_email_outbox.sql. Run in a read-only transaction; changes nothing.
-- Expected before applying: outbox_exists = false, gen_random_uuid_available = true, the payments and
-- navigator_paid_sessions tables exist (the hooks read them), and navigator_paid_sessions has an email column.
BEGIN READ ONLY;
SELECT
  current_database() AS database,
  to_regclass('public.transactional_email_outbox') IS NOT NULL AS outbox_exists,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gen_random_uuid') AS gen_random_uuid_available,
  to_regclass('public.payments') IS NOT NULL AS payments_exists,
  to_regclass('public.navigator_paid_sessions') IS NOT NULL AS paid_sessions_exists,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'navigator_paid_sessions' AND column_name = 'email') AS paid_sessions_has_email,
  (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) AS supabase_roles_found;
ROLLBACK;
