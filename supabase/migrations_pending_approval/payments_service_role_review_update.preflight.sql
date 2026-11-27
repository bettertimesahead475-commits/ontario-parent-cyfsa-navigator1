-- Read-only preflight for Migration G. Expected before G: update_status = false, update_approved_at = false,
-- table_update = false, delete = false. Expected after G: the first two true, the last two still false.
select
  has_column_privilege('service_role', 'public.payments', 'status', 'UPDATE') as update_status,
  has_column_privilege('service_role', 'public.payments', 'approved_at', 'UPDATE') as update_approved_at,
  has_table_privilege('service_role', 'public.payments', 'UPDATE') as table_update,
  has_table_privilege('service_role', 'public.payments', 'DELETE') as "delete",
  (select count(*) from public.payments where status = 'pending') as pending_payments;
