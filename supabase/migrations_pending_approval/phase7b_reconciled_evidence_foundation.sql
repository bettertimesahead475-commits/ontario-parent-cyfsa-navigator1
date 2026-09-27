-- PENDING APPROVAL: Phase 7B Reconciled Evidence Foundation
-- Creates minimum navigator_evidence_items contract required by current runtime and Stage 9B candidates.
-- Hardened with evidence classification CHECK constraint.
-- Omits unused legacy page-evidence extraction tables.

begin;

create table public.navigator_evidence_items (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    classification text not null check (classification in (
        'FACT', 'ALLEGATION', 'OPINION', 'PROFESSIONAL_ASSESSMENT', 'INFERENCE', 'UNVERIFIED_CLAIM', 'UNKNOWN'
    )),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint navigator_evidence_matter_identity unique (id, matter_id)
);

create index navigator_evidence_items_matter_idx on public.navigator_evidence_items(matter_id);

alter table public.navigator_evidence_items enable row level security;
revoke all on public.navigator_evidence_items from public, anon, authenticated;
grant select, insert, update, delete on public.navigator_evidence_items to service_role;

commit;
