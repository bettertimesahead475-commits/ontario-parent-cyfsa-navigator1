-- Reverses paid_credit_reservation_functions.sql. Drops functions only; no table or row is touched.
-- PENDING OWNER APPROVAL. Run only if the functions must be removed.
begin;
drop function if exists public.paid_finalize_credit(text, text, timestamptz);
drop function if exists public.paid_release_credit(text, text, text, timestamptz);
drop function if exists public.paid_reserve_credit(text, text, text, integer, timestamptz, interval, interval);
drop function if exists public.paid_reconcile(text, text, timestamptz, interval);
drop function if exists public.paid_release_marker(text, text, timestamptz);
drop function if exists public.paid_counter_for_state(text, text);
drop function if exists public.paid_state_for_scope(text);
drop function if exists public.paid_marker_uid(text, text);
commit;
