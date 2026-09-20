-- PENDING APPROVAL: do not execute automatically.
-- Stage 9A ?" Legal Source Extensions

begin;

-- 1. Extend the check constraint for source_type to allow OTHER_OFFICIAL_AUTHORITY.
alter table public.navigator_legal_sources drop constraint navigator_legal_sources_source_type_check;
alter table public.navigator_legal_sources add constraint navigator_legal_sources_source_type_check 
  check (source_type in ('STATUTE','REGULATION','COURT_RULE','CASE_LAW','CHARTER','OTHER_OFFICIAL_AUTHORITY'));

-- 2. Add case-specific fields to navigator_legal_sources
alter table public.navigator_legal_sources
  add column court text,
  add column decision_date date,
  add column docket_number text;

commit;
