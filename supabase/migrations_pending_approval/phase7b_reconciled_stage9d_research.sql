-- PENDING APPROVAL: Phase 7B Reconciled Stage 9D Research
-- Creates navigator_matter_research_runs and navigator_matter_research_run_results required by runtime.
-- Updates professional_reviews.finding_type check constraint to include 'LEGAL_RESEARCH_RESULT'.
-- Omits unused navigator_matter_research_work_product_links table.

begin;

alter table public.professional_reviews
  drop constraint if exists professional_reviews_finding_type_check;

alter table public.professional_reviews
  add constraint professional_reviews_finding_type_check
  check (finding_type in ('EVIDENCE', 'CHRONOLOGY', 'CLAIM', 'CONTRADICTION', 'CORROBORATION', 'EVIDENCE_GAP', 'LEGAL_INTELLIGENCE', 'LEGAL_RESEARCH_RESULT'));

create table public.navigator_matter_research_runs (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    triggered_by_account_id uuid references public.accounts(id) on delete set null,
    trigger_type text not null check (trigger_type in ('MANUAL', 'SCHEDULED', 'SYSTEM')),
    status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    check (trigger_type = 'MANUAL' or triggered_by_account_id is null),
    check (status not in ('COMPLETED', 'FAILED') or completed_at is not null),
    unique (id, matter_id)
);

create index navigator_research_runs_matter_idx on public.navigator_matter_research_runs(matter_id);
create index navigator_research_runs_triggered_by_idx on public.navigator_matter_research_runs(triggered_by_account_id);

create table public.navigator_matter_research_run_results (
    id uuid primary key default gen_random_uuid(),
    research_run_id uuid not null,
    matter_id uuid not null,
    candidate_id uuid not null,
    discovery_status text not null default 'CANDIDATE_DISCOVERED' check (discovery_status in ('CANDIDATE_DISCOVERED', 'RANKED', 'SUPERSEDED')),
    ranking_method text check (ranking_method is null or char_length(ranking_method) between 1 and 200),
    ranking_score numeric check (ranking_score is null or ranking_score between 0 and 1),
    ranking_factors jsonb,
    check ((ranking_method is null and ranking_score is null and ranking_factors is null) or ranking_method is not null),
    staleness_checked_at timestamptz,
    discovered_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint navigator_research_result_run_scope foreign key (research_run_id, matter_id)
        references public.navigator_matter_research_runs (id, matter_id) on delete cascade,
    constraint navigator_research_result_candidate_scope foreign key (candidate_id, matter_id)
        references public.navigator_matter_legal_research_candidates (id, matter_id) on delete cascade,
    unique (id, matter_id),
    unique (research_run_id, candidate_id)
);

create index navigator_research_results_run_idx on public.navigator_matter_research_run_results(research_run_id);
create index navigator_research_results_matter_idx on public.navigator_matter_research_run_results(matter_id);
create index navigator_research_results_candidate_idx on public.navigator_matter_research_run_results(candidate_id);

alter table public.navigator_matter_research_runs enable row level security;
alter table public.navigator_matter_research_run_results enable row level security;

revoke all on public.navigator_matter_research_runs, public.navigator_matter_research_run_results from public, anon, authenticated;
grant select, insert, update, delete on public.navigator_matter_research_runs, public.navigator_matter_research_run_results to service_role;

commit;
