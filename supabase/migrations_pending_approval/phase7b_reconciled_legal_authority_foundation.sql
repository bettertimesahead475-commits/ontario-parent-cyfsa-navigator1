-- PENDING APPROVAL: Phase 7B Reconciled Legal Authority Foundation
-- Creates navigator_legal_sources, navigator_legal_source_versions, navigator_legal_provisions.
-- Preserves composite identity constraints for downstream FK referencing.
-- Omits unused legacy navigator_legal_mappings.

begin;

create table public.navigator_legal_sources (
    id uuid primary key default gen_random_uuid(),
    jurisdiction text not null check (jurisdiction in ('ON','CA')),
    title text not null check (char_length(title) between 1 and 500),
    source_type text not null check (source_type in ('STATUTE','REGULATION','COURT_RULE','CASE_LAW','CHARTER')),
    citation text not null check (char_length(citation) between 1 and 300),
    official_publisher text not null check (char_length(official_publisher) between 1 and 300),
    source_url text not null check (source_url ~ '^https://'),
    verification_state text not null check (verification_state in ('VERIFIED','UNVERIFIED','SUPERSEDED')),
    retrieved_at timestamptz not null,
    created_at timestamptz not null default now(),
    unique (jurisdiction, source_type, citation)
);

create table public.navigator_legal_source_versions (
    id uuid primary key default gen_random_uuid(),
    legal_source_id uuid not null references public.navigator_legal_sources(id) on delete cascade,
    version_label text not null check (char_length(version_label) between 1 and 200),
    effective_from date not null,
    effective_to date,
    status text not null check (status in ('NOT_YET_IN_FORCE','IN_FORCE','REPEALED','SUPERSEDED')),
    verification_state text not null check (verification_state in ('VERIFIED','UNVERIFIED','SUPERSEDED')),
    retrieved_at timestamptz not null,
    supersedes_version_id uuid references public.navigator_legal_source_versions(id),
    created_at timestamptz not null default now(),
    check (effective_to is null or effective_to > effective_from),
    unique (legal_source_id, version_label),
    constraint navigator_legal_version_source_identity unique (id, legal_source_id)
);

create index navigator_legal_versions_source_idx on public.navigator_legal_source_versions(legal_source_id, effective_from);

create table public.navigator_legal_provisions (
    id uuid primary key default gen_random_uuid(),
    legal_source_id uuid not null references public.navigator_legal_sources(id) on delete cascade,
    citation text not null check (char_length(citation) between 1 and 200),
    label text not null check (char_length(label) between 1 and 300),
    verification_state text not null check (verification_state in ('VERIFIED','UNVERIFIED','SUPERSEDED')),
    created_at timestamptz not null default now(),
    unique (legal_source_id, citation),
    constraint navigator_legal_provision_source_identity unique (id, legal_source_id)
);

alter table public.navigator_legal_sources enable row level security;
alter table public.navigator_legal_source_versions enable row level security;
alter table public.navigator_legal_provisions enable row level security;

revoke all on public.navigator_legal_sources, public.navigator_legal_source_versions, public.navigator_legal_provisions from public, anon, authenticated;
grant select, insert, update, delete on public.navigator_legal_sources, public.navigator_legal_source_versions, public.navigator_legal_provisions to service_role;

commit;
