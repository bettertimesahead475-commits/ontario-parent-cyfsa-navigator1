-- Rollback of Migration G (payments_service_role_review_update.sql): service_role goes back to SELECT, INSERT only.
-- Administrator approval stops working again (42501). No row is changed.
begin;
revoke update (status, approved_at) on table public.payments from service_role;
commit;
