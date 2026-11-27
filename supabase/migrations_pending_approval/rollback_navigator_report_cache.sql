-- PENDING APPROVAL: rollback for create_navigator_report_cache.sql (DEVIN-PERF-03).
-- Safe at any time: the table is an index only, so dropping it loses no customer report (reports stay in the
-- analysis_jobs storage bucket). Cached lookups simply miss and run a normal, charged analysis afterwards.
begin;
drop function if exists public.navigator_report_cache_purge_expired();
drop function if exists public.navigator_report_cache_forget(text, text);
drop table if exists public.navigator_report_cache;
commit;
