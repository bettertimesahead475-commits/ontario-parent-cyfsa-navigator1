-- Rollback for create_navigator_rate_limit_hits.sql (T-05). Removes only the rate-limit function and table; the
-- table holds hashed counters, no customer data. Safe to run when the migration was never applied.
begin;
drop function if exists public.navigator_rate_limit_hit(text, integer, integer);
drop table if exists public.navigator_rate_limit_hits;
commit;
