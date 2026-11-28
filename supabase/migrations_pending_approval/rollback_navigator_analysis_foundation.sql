-- ROLLBACK for create_navigator_analysis_foundation.sql. PENDING APPROVAL: do not execute automatically.
-- Removes the foundation store and its functions. Stored foundations are derived data: dropping them loses no customer
-- report, and the analyzer simply runs without them.
begin;
drop function if exists public.navigator_analysis_foundation_purge_expired();
drop function if exists public.navigator_analysis_foundation_forget(text, text);
drop table if exists public.navigator_analysis_foundation;
commit;
