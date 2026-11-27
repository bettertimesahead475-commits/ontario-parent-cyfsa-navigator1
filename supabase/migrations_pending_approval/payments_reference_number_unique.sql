-- ============================================================================
-- Migration: payments_reference_number_unique.sql
-- Status: PENDING OWNER APPROVAL (DO NOT APPLY). Not executed by any tooling.
-- Purpose: payment reference numbers identify a payment to the customer, the bank memo and the administrator
-- console. They were 5 random characters with no uniqueness guarantee (security register S-11); new references
-- are 8 characters. This index makes a duplicate impossible.
--
-- Step 1 (read-only pre-check; must return zero rows before step 2):
--   select reference_number, count(*) from public.payments
--   where reference_number is not null group by reference_number having count(*) > 1;
-- If it returns rows, resolve them first (the admin console refuses to act on a duplicated reference).
--
-- Step 2: CONCURRENTLY builds without blocking inserts. It cannot run inside a transaction block, so run this
-- statement on its own (the Supabase SQL editor runs a single statement without an explicit transaction).
-- Rollback: payments_reference_number_unique.down.sql (drops only this index; no data changes).
-- ============================================================================

create unique index concurrently if not exists payments_reference_number_key
  on public.payments (reference_number)
  where reference_number is not null;
