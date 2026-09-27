-- PENDING APPROVAL: Phase 7B Reconciled Legal Corpus Versioning
-- Creates navigator_legal_provision_versions required by matterLegalResearch.ts SHA-256 integrity check.
-- Hardened with UNIQUE(provision_id, legal_source_version_id) for maybeSingle() runtime cardinality.
-- Omits unused legacy snapshots and lineage tables.

begin;

create table public.navigator_legal_provision_versions (
    id uuid primary key default gen_random_uuid(),
    provision_id uuid not null references public.navigator_legal_provisions(id),
    legal_source_id uuid not null references public.navigator_legal_sources(id),
    legal_source_version_id uuid not null references public.navigator_legal_source_versions(id),
    effective_from date not null,
    effective_to date,
    exact_text text not null check (char_length(exact_text) between 1 and 50000),
    normalized_text text not null check (char_length(normalized_text) between 1 and 50000),
    text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
    verification_status text not null default 'UNVERIFIED'
        check (verification_status in ('UNVERIFIED','COMMITTED_INSPECTION','VERIFIED','REJECTED')),
    verified_by uuid references public.accounts(id),
    verified_at timestamptz,
    created_at timestamptz not null default now(),
    unique (provision_id, legal_source_version_id),
    check (effective_to is null or effective_to > effective_from),
    check ((verification_status = 'VERIFIED' and verified_by is not null and verified_at is not null)
        or (verification_status <> 'VERIFIED' and verified_by is null and verified_at is null)),
    constraint navigator_provision_version_provision_scope foreign key (provision_id, legal_source_id)
        references public.navigator_legal_provisions(id, legal_source_id),
    constraint navigator_provision_version_source_version_scope foreign key (legal_source_version_id, legal_source_id)
        references public.navigator_legal_source_versions(id, legal_source_id)
);

create index navigator_provision_versions_provision_idx on public.navigator_legal_provision_versions(provision_id, effective_from);
create index navigator_provision_versions_source_version_idx on public.navigator_legal_provision_versions(legal_source_version_id);

alter table public.navigator_legal_provision_versions enable row level security;
revoke all on public.navigator_legal_provision_versions from public, anon, authenticated;
grant select, insert, update, delete on public.navigator_legal_provision_versions to service_role;

commit;
