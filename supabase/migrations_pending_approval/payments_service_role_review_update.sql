-- PENDING APPROVAL: do not apply to any Supabase project without written owner approval. (Migration G)
-- Found by tests/devin/payment-schema-qualification.pg.test.ts against the live nxfhvebzzobegubefcda grants (read-only
-- check 2026-11-27): service_role has only SELECT and INSERT on public.payments, so every administrator approval
-- (pending -> approved), its rollback (approved -> pending) and the cancellation of an unpaid order (pending -> rejected)
-- is refused by PostgreSQL (42501). Live has never issued an access code (0 access_codes rows), consistent with this.
--
-- Grants UPDATE on exactly the two columns those writes change. No other column, no DELETE, no row is modified,
-- RLS is unchanged (service_role already bypasses it). Independent of P, D and E; re-runnable.
-- Rollback: payments_service_role_review_update.rollback.sql. Preflight: payments_service_role_review_update.preflight.sql.
begin;
grant update (status, approved_at) on table public.payments to service_role;
commit;
