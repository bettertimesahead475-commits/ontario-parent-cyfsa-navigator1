-- GATE C — PENDING APPROVAL: DO NOT EXECUTE against any live Supabase project without explicit approval.
-- Milestone 2 — CAS Accountability, Parent Assistance, Reunification & Agency Compliance Matrix Foundation.
--
-- Extends:
--   - Stage 4: public.navigator_matters, public.navigator_evidence_items
--   - Stage 6 Milestone 1: public.navigator_legal_sources, public.navigator_legal_source_versions,
--     public.navigator_legal_provisions
--
-- Security & Tenant Isolation Model:
--   - Row Level Security (RLS) enabled on all new tables.
--   - Zero public/anon/authenticated direct table grants; only `service_role` has least-privilege grants.
--   - Composite foreign keys enforce strict cross-matter and cross-source boundary integrity.
--   - Provenance immutability triggers prevent tampering with historical evidence/authority coordinates.

begin;

-- 1. Extend navigator_legal_sources source_type check to support verified operational & oversight categories
--    (CAS_STANDARD, PROFESSIONAL_STANDARD, OVERSIGHT_PATHWAY, BILL_C92) if not already expanded by stage9a.
alter table public.navigator_legal_sources
  drop constraint if exists navigator_legal_sources_source_type_check;

alter table public.navigator_legal_sources
  add constraint navigator_legal_sources_source_type_check
  check (source_type in (
    'STATUTE',
    'REGULATION',
    'COURT_RULE',
    'CASE_LAW',
    'CHARTER',
    'CAS_STANDARD',
    'PROFESSIONAL_STANDARD',
    'OVERSIGHT_PATHWAY',
    'BILL_C92'
  ));

-- 2. Curated Registry of CAS Accountability & Parent Assistance Obligations (Libraries A & B)
create table public.navigator_compliance_obligations (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null unique check (char_length(rule_code) between 3 and 120),
  library_section text not null check (library_section in (
    'A1_STATUTORY_CAS_DUTIES',
    'A2_OCPS_2016_STANDARDS',
    'A3_SUPERVISORY_ACCOUNTABILITY',
    'A4_CASE_NOTES_AND_RECORDKEEPING',
    'A5_PROFESSIONAL_ETHICS_AND_REGISTRATION',
    'A6_OATHS_AND_SWORN_EVIDENCE',
    'A7_ACCOUNTABILITY_AND_COMPLAINT_PATHWAYS',
    'B1_FAMILY_PRESERVATION',
    'B2_PARENTING_SUPPORT',
    'B3_MENTAL_HEALTH_AND_ADDICTIONS',
    'B4_HOUSING_AND_BASIC_NECESSITIES',
    'B5_KINSHIP_AND_FAMILY_NETWORKS',
    'B6_PARENT_CHILD_CONTACT',
    'B7_REUNIFICATION_AND_PERMANENCY'
  )),
  matrix_category text not null check (matrix_category in (
    'LAW_AND_PROCEDURE',
    'CAS_ACCOUNTABILITY',
    'PARENT_ASSISTANCE',
    'REUNIFICATION',
    'EVIDENCE_AND_CONTRADICTIONS'
  )),
  legal_source_id uuid not null references public.navigator_legal_sources(id),
  provision_id uuid not null references public.navigator_legal_provisions(id),
  source_label text not null check (source_label in ('STATUTE', 'REGULATION', 'STANDARD', 'PRACTICE_NOTE', 'PROFESSIONAL_STANDARD', 'COURT_RULE')),
  legal_force text not null check (legal_force in (
    'MANDATORY_STATUTORY',
    'MANDATORY_REGULATORY',
    'MANDATORY_STANDARD',
    'PRACTICE_GUIDANCE',
    'PROFESSIONAL_ETHICAL_STANDARD',
    'DISCRETIONARY',
    'LEGALLY_REQUIRED',
    'STANDARDS_BASED',
    'RECOMMENDED',
    'UNAVAILABLE_FOR_DETERMINATION'
  )),
  responsible_party text not null check (char_length(responsible_party) between 2 and 120),
  required_action text not null check (char_length(required_action) between 10 and 4000),
  triggering_event text not null check (char_length(triggering_event) between 5 and 2000),
  deadline_specification text not null check (char_length(deadline_specification) between 2 and 1000),
  applicability_conditions text not null check (char_length(applicability_conditions) between 5 and 2000),
  exceptions_and_limits text not null check (char_length(exceptions_and_limits) between 2 and 2000),
  required_documentation text not null check (char_length(required_documentation) between 2 and 2000),
  created_at timestamptz not null default now(),
  constraint navigator_obligation_provision_source_scope
    foreign key (provision_id, legal_source_id)
    references public.navigator_legal_provisions(id, legal_source_id)
);

create index navigator_compliance_obligations_section_idx
  on public.navigator_compliance_obligations(library_section, matrix_category);

-- 3. Matter-Scoped Agency Compliance & Evidence Matrix Assessments (Library C — C1 & C2)
create table public.navigator_matter_compliance_assessments (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.navigator_matters(id),
  obligation_id uuid not null references public.navigator_compliance_obligations(id),
  evidence_item_id uuid references public.navigator_evidence_items(id),
  legal_source_id uuid not null references public.navigator_legal_sources(id),
  legal_source_version_id uuid references public.navigator_legal_source_versions(id),
  provision_id uuid not null references public.navigator_legal_provisions(id),
  document_page integer check (document_page is null or document_page >= 1),
  paragraph_or_span text check (paragraph_or_span is null or char_length(paragraph_or_span) <= 300),
  event_date date,
  record_date date,
  author_name text check (author_name is null or char_length(author_name) <= 300),
  exact_excerpt text not null check (char_length(exact_excerpt) between 1 and 4000),
  applicability_status text not null check (applicability_status in (
    'APPLIES',
    'CONDITIONALLY_APPLIES',
    'NOT_APPLICABLE',
    'INSUFFICIENT_CONTEXT_TO_DETERMINE'
  )),
  compliance_status text not null check (compliance_status in (
    'COMPLIANT_ON_AVAILABLE_EVIDENCE',
    'POTENTIAL_NONCOMPLIANCE',
    'PARTIAL_COMPLIANCE',
    'NOT_DOCUMENTED_IN_UPLOADED_RECORDS',
    'INSUFFICIENT_EVIDENCE',
    'NOT_APPLICABLE',
    'EXCEPTION_MAY_APPLY',
    'REQUIRES_LEGAL_REVIEW'
  )),
  source_verification_status text not null check (source_verification_status in (
    'VERIFIED',
    'HISTORICAL_VERSION_RISK',
    'UNVERIFIED',
    'IRRELEVANT_OR_UNSUPPORTED'
  )),
  standard7_deadline_status text check (standard7_deadline_status is null or standard7_deadline_status in (
    'DETERMINED_FROM_INVESTIGATION_COMPLETION',
    'DETERMINED_FROM_CASE_TRANSFER',
    'DEADLINE_NOT_DETERMINABLE',
    'INVALID_TRIGGER_REMOVAL_DATE_ONLY'
  )),
  reasoning text not null check (char_length(reasoning) between 10 and 4000),
  missing_information jsonb not null default '[]'::jsonb,
  exceptions_considered jsonb not null default '[]'::jsonb,
  suggested_follow_up_questions jsonb not null default '[]'::jsonb,
  educational_presentation jsonb not null,
  courtroom_presentation jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Guard against inflammatory/accusatory conclusion language at DB layer
  check (reasoning !~* '\yproves? perjury\y|\ycriminal misconduct\y|\yautomatic breach\y|\ydefinitive(ly)? broke the law\y'),
  -- Missing evidence cannot be marked COMPLIANT_ON_AVAILABLE_EVIDENCE or POTENTIAL_NONCOMPLIANCE when evidence_item_id is null
  check (
    evidence_item_id is not null
    or compliance_status in ('NOT_DOCUMENTED_IN_UPLOADED_RECORDS', 'INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE', 'REQUIRES_LEGAL_REVIEW')
  ),
  constraint navigator_compliance_provision_scope
    foreign key (provision_id, legal_source_id)
    references public.navigator_legal_provisions(id, legal_source_id),
  constraint navigator_compliance_version_scope
    foreign key (legal_source_version_id, legal_source_id)
    references public.navigator_legal_source_versions(id, legal_source_id),
  constraint navigator_compliance_evidence_matter_scope
    foreign key (evidence_item_id, matter_id)
    references public.navigator_evidence_items(id, matter_id)
);

create index navigator_matter_compliance_matter_idx
  on public.navigator_matter_compliance_assessments(matter_id, compliance_status);
create index navigator_matter_compliance_obligation_idx
  on public.navigator_matter_compliance_assessments(obligation_id);

-- 4. Matter-Scoped Parent Assistance 15-Question Records (Library C — C3 & C4)
create table public.navigator_matter_parent_assistance_records (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.navigator_matters(id),
  evidence_item_id uuid references public.navigator_evidence_items(id),
  need_domain text not null check (need_domain in (
    'B1_FAMILY_PRESERVATION',
    'B2_PARENTING_SUPPORT',
    'B3_MENTAL_HEALTH_AND_ADDICTIONS',
    'B4_HOUSING_AND_BASIC_NECESSITIES',
    'B5_KINSHIP_AND_FAMILY_NETWORKS',
    'B6_PARENT_CHILD_CONTACT',
    'B7_REUNIFICATION_AND_PERMANENCY'
  )),
  identified_need_title text not null check (char_length(identified_need_title) between 3 and 500),
  legal_force_classification text not null check (legal_force_classification in (
    'LEGALLY_REQUIRED',
    'STANDARDS_BASED',
    'DISCRETIONARY',
    'RECOMMENDED',
    'UNAVAILABLE_FOR_DETERMINATION'
  )),
  coexisting_statuses text[] not null check (
    array_length(coexisting_statuses, 1) >= 1 and
    coexisting_statuses <@ array[
      'NEED_IDENTIFIED',
      'SERVICE_CONSIDERED',
      'SERVICE_OFFERED',
      'REFERRAL_MADE',
      'SERVICE_ACCESSIBLE',
      'SERVICE_INACCESSIBLE',
      'SERVICE_ACCEPTED',
      'SERVICE_DECLINED',
      'SERVICE_COMPLETED',
      'FOLLOW_UP_DOCUMENTED',
      'NO_OFFER_DOCUMENTED',
      'UNKNOWN'
    ]::text[]
  ),
  statutory_non_funding_rule_triggered boolean not null default false,
  fifteen_question_payload jsonb not null,
  page_and_paragraph_attribution text not null check (char_length(page_and_paragraph_attribution) between 1 and 300),
  exact_excerpt text not null check (char_length(exact_excerpt) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint navigator_parent_assistance_evidence_matter_scope
    foreign key (evidence_item_id, matter_id)
    references public.navigator_evidence_items(id, matter_id)
);

create index navigator_parent_assistance_matter_idx
  on public.navigator_matter_parent_assistance_records(matter_id, need_domain);

-- 5. Enable Row Level Security (RLS) and Enforce Least-Privilege Service-Role Grants
alter table public.navigator_compliance_obligations enable row level security;
alter table public.navigator_matter_compliance_assessments enable row level security;
alter table public.navigator_matter_parent_assistance_records enable row level security;

revoke all on
  public.navigator_compliance_obligations,
  public.navigator_matter_compliance_assessments,
  public.navigator_matter_parent_assistance_records
from public, anon, authenticated, service_role;

grant select, insert on public.navigator_compliance_obligations to service_role;
grant select, insert, update on public.navigator_matter_compliance_assessments to service_role;
grant select, insert, update on public.navigator_matter_parent_assistance_records to service_role;

-- 6. Provenance Immutability Trigger for Compliance Assessments
create function public.navigator_matter_compliance_touch() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  new.updated_at := now();
  new.matter_id := old.matter_id;
  new.obligation_id := old.obligation_id;
  new.evidence_item_id := old.evidence_item_id;
  new.legal_source_id := old.legal_source_id;
  new.legal_source_version_id := old.legal_source_version_id;
  new.provision_id := old.provision_id;
  return new;
end $$;

revoke all on function public.navigator_matter_compliance_touch() from public;

create trigger navigator_matter_compliance_touch
  before update on public.navigator_matter_compliance_assessments
  for each row execute function public.navigator_matter_compliance_touch();

commit;
