-- PENDING APPROVAL: Phase 7B Reconciled Stage 9B Candidates
-- Creates navigator_matter_legal_research_candidates preserving all provenance FKs.
-- Hardened with same-matter evidence/event composite FKs and legal source composite FKs.

begin;

create table public.navigator_matter_legal_research_candidates (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    evidence_item_id uuid,
    event_id uuid,
    evidence_classification text,
    legal_source_id uuid not null references public.navigator_legal_sources(id),
    legal_source_version_id uuid,
    provision_id uuid,
    authority_identifier text,
    reason_for_relevance text not null,
    retrieval_basis text not null,
    effective_date_context text,
    source_provenance text,
    confidence numeric,
    content_integrity_status text not null default 'NOT_CHECKED',
    idempotence_key text not null unique,
    created_at timestamptz not null default now(),
    retrieved_at timestamptz not null default now(),
    constraint navigator_research_candidate_matter_identity unique (id, matter_id),
    constraint navigator_research_candidate_evidence_scope foreign key (evidence_item_id, matter_id)
        references public.navigator_evidence_items (id, matter_id) on delete set null (evidence_item_id),
    constraint navigator_research_candidate_event_scope foreign key (event_id, matter_id)
        references public.navigator_events (id, matter_id) on delete set null (event_id),
    constraint navigator_research_candidate_source_version_scope foreign key (legal_source_version_id, legal_source_id)
        references public.navigator_legal_source_versions (id, legal_source_id),
    constraint navigator_research_candidate_provision_scope foreign key (provision_id, legal_source_id)
        references public.navigator_legal_provisions (id, legal_source_id)
);

create index navigator_candidates_matter_idx on public.navigator_matter_legal_research_candidates(matter_id);
create index navigator_candidates_source_idx on public.navigator_matter_legal_research_candidates(legal_source_id);

alter table public.navigator_matter_legal_research_candidates enable row level security;
revoke all on public.navigator_matter_legal_research_candidates from public, anon, authenticated;
grant select, insert, update, delete on public.navigator_matter_legal_research_candidates to service_role;

commit;
