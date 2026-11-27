-- GATE C — ROLLBACK SCRIPT (PENDING APPROVAL — DO NOT EXECUTE WITHOUT APPROVAL)
-- Cleanly reverses `milestone2_compliance_matrix_foundation.sql`.

begin;

drop trigger if exists navigator_matter_compliance_touch on public.navigator_matter_compliance_assessments;
drop function if exists public.navigator_matter_compliance_touch();

drop table if exists public.navigator_matter_parent_assistance_records;
drop table if exists public.navigator_matter_compliance_assessments;
drop table if exists public.navigator_compliance_obligations;

alter table public.navigator_legal_sources
  drop constraint if exists navigator_legal_sources_source_type_check;

alter table public.navigator_legal_sources
  add constraint navigator_legal_sources_source_type_check
  check (source_type in ('STATUTE','REGULATION','COURT_RULE','CASE_LAW','CHARTER','OTHER_OFFICIAL_AUTHORITY'));

commit;
