-- PENDING APPROVAL: Phase 7B Reconciled Professional Work Product Versions
-- Replaces unhardened create_professional_work_product_versions.sql
-- Adds explicit transaction boundary, RLS, and service_role privilege block.

begin;

create table public.professional_work_product_versions (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    reviewer_account_id uuid not null references public.accounts(id) on delete cascade,
    work_product_type text not null check (work_product_type = 'CASE_BRIEF'),
    version_number integer not null,
    status text not null check (status = 'FINALIZED'),
    snapshot jsonb not null,
    created_at timestamptz not null default now(),
    finalized_at timestamptz not null default now(),
    unique (matter_id, reviewer_account_id, work_product_type, version_number)
);

create index idx_prof_wp_versions_matter_reviewer on public.professional_work_product_versions(matter_id, reviewer_account_id);

alter table public.professional_work_product_versions enable row level security;
revoke all on public.professional_work_product_versions from public, anon, authenticated;
grant select, insert, update, delete on public.professional_work_product_versions to service_role;

commit;
