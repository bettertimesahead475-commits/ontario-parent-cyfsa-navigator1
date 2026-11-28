-- ROLLBACK for create_navigator_analysis_ledger.sql. PENDING APPROVAL: do not execute automatically.
-- Removes the usage ledger. Jobs fall back to the pre-ledger behaviour (no cross-delivery cap) until it is restored.
begin;
drop function if exists public.analyzer_job_ledger_write(text, integer, uuid, jsonb);
drop function if exists public.analyzer_job_ledger_read(text);
drop table if exists public.analyzer_job_ledger;
commit;
