-- Rollback for free_scan_reservation_functions.sql. Drops only the functions that migration creates.
-- Creates and changes no tables or rows. Reservation markers already written to public.free_usage are left in place:
-- they are ordinary rows with the same shape as the paid reservation markers, and are read only by these functions.
-- After rollback the application must not be running the release that calls these functions.

begin;

drop function if exists public.free_release_scan(text, text, text, timestamptz);
drop function if exists public.free_finalize_scan(text, text, timestamptz);
drop function if exists public.free_reserve_scan(text, text, integer, timestamptz, interval);
drop function if exists public.free_reconcile(text, text, timestamptz, interval);
drop function if exists public.free_release_marker(text, text, timestamptz);
drop function if exists public.free_marker_uid(text, text);

commit;
