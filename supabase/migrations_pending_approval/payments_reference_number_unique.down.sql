-- Rollback for payments_reference_number_unique.sql. Drops only the index; no data changes.
drop index concurrently if exists public.payments_reference_number_key;
