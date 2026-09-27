-- PENDING APPROVAL: Phase 7B Reconciled Event Foundation
-- Creates minimum navigator_events contract required by current runtime and Stage 9B date resolution.
-- Hardened with date upper/lower bound check constraint.
-- Omits unused legacy M2A intelligence tables.

begin;

create table public.navigator_events (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    date_lower_bound timestamptz,
    date_upper_bound timestamptz,
    date_precision text not null default 'UNKNOWN' check (date_precision in (
        'EXACT_DATETIME', 'EXACT_DATE', 'APPROXIMATE', 'MONTH_YEAR', 'YEAR_ONLY', 'UNKNOWN'
    )),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (date_lower_bound is null or date_upper_bound is null or date_upper_bound >= date_lower_bound),
    constraint navigator_events_matter_identity unique (id, matter_id)
);

create index navigator_events_matter_idx on public.navigator_events(matter_id);

alter table public.navigator_events enable row level security;
revoke all on public.navigator_events from public, anon, authenticated;
grant select, insert, update, delete on public.navigator_events to service_role;

commit;
