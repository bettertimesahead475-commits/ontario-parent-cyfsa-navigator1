-- POST-LAUNCH CASE-ACTION WORKSPACE BATCH 1
-- Creates:
--   1. public.navigator_case_requirements
--   2. public.navigator_case_actions
--   3. public.navigator_action_evidence_links

begin;

create table if not exists public.navigator_case_requirements (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.navigator_matters(id) on delete cascade,
  title text not null,
  description text,
  authority_type text not null check (authority_type in (
    'COURT_ORDERED',
    'STATUTORY_REGULATORY',
    'CAS_REQUESTED',
    'SERVICE_PROVIDER_REQUESTED',
    'AGREED_CONSENTED',
    'LAWYER_REQUESTED',
    'NAVIGATOR_SUGGESTED',
    'PARENT_CREATED'
  )),
  review_state text not null default 'CONFIRMED' check (review_state in (
    'PROPOSED',
    'CONFIRMED',
    'REJECTED',
    'ARCHIVED'
  )),
  completion_state text not null default 'NOT_STARTED' check (completion_state in (
    'NOT_STARTED',
    'IN_PROGRESS',
    'COMPLETED',
    'NOT_APPLICABLE',
    'SUPERSEDED'
  )),
  dispute_state text not null default 'NOT_DISPUTED' check (dispute_state in (
    'NOT_DISPUTED',
    'DISPUTED',
    'RESOLVED'
  )),
  dispute_type text check (dispute_type in (
    'NO_LEGAL_AUTHORITY',
    'FACTUALLY_INACCURATE',
    'UNREASONABLE_CONDITION',
    'IMPOSSIBLE_DEADLINE',
    'OTHER'
  )),
  dispute_note text,
  due_at timestamptz,
  completed_at timestamptz,
  provenance_type text check (provenance_type in (
    'DOCUMENT_ANALYZER_EXTRACTED',
    'COURT_ORDER_PARSED',
    'CAS_CORRESPONDENCE',
    'PROFESSIONAL_RECOMMENDED',
    'PARENT_MANUAL_ENTRY'
  )),
  source_document_id uuid references public.navigator_documents(id) on delete set null,
  source_document_version_id uuid references public.navigator_document_versions(id) on delete set null,
  source_page_number integer check (source_page_number is null or source_page_number > 0),
  source_exact_quote text check (source_exact_quote is null or char_length(source_exact_quote) <= 2000),
  source_author_or_speaker text,
  source_event_date date,
  linked_legal_provision_id uuid references public.navigator_legal_provisions(id) on delete set null,
  lawyer_notes text,
  verified_by_lawyer_at timestamptz,
  created_by_account_id uuid references public.accounts(id),
  updated_by_account_id uuid references public.accounts(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.navigator_case_actions (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.navigator_matters(id) on delete cascade,
  requirement_id uuid not null references public.navigator_case_requirements(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'PENDING' check (status in (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED'
  )),
  due_at timestamptz,
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_by_account_id uuid references public.accounts(id),
  updated_by_account_id uuid references public.accounts(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.navigator_action_evidence_links (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.navigator_matters(id) on delete cascade,
  requirement_id uuid not null references public.navigator_case_requirements(id) on delete cascade,
  action_id uuid references public.navigator_case_actions(id) on delete cascade,
  evidence_item_id uuid references public.navigator_evidence_items(id) on delete cascade,
  document_id uuid references public.navigator_documents(id) on delete cascade,
  document_version_id uuid references public.navigator_document_versions(id) on delete cascade,
  evidence_type text not null check (evidence_type in (
    'COMPLETION_CERTIFICATE',
    'ATTENDANCE_RECORD',
    'SCREENING_RESULT',
    'RECEIPT_PROOF',
    'CORRESPONDENCE_EMAIL_TEXT',
    'COURT_FILING_STAMP',
    'PARENT_JOURNAL_LOG',
    'PHOTO_EVIDENCE'
  )),
  title text not null,
  notes text,
  attached_by_account_id uuid references public.accounts(id),
  attached_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_navigator_case_reqs_matter on public.navigator_case_requirements(matter_id, created_at desc);
create index if not exists idx_navigator_case_reqs_states on public.navigator_case_requirements(matter_id, review_state, completion_state, dispute_state);
create index if not exists idx_navigator_case_actions_req on public.navigator_case_actions(requirement_id, sort_order asc);
create index if not exists idx_navigator_case_actions_matter on public.navigator_case_actions(matter_id);
create index if not exists idx_navigator_evidence_links_req on public.navigator_action_evidence_links(requirement_id);
create index if not exists idx_navigator_evidence_links_matter on public.navigator_action_evidence_links(matter_id);

alter table public.navigator_case_requirements enable row level security;
alter table public.navigator_case_actions enable row level security;
alter table public.navigator_action_evidence_links enable row level security;

revoke all on public.navigator_case_requirements from public, anon, authenticated, service_role;
revoke all on public.navigator_case_actions from public, anon, authenticated, service_role;
revoke all on public.navigator_action_evidence_links from public, anon, authenticated, service_role;

grant select, insert, update, delete on public.navigator_case_requirements to service_role;
grant select, insert, update, delete on public.navigator_case_actions to service_role;
grant select, insert, update, delete on public.navigator_action_evidence_links to service_role;

commit;
