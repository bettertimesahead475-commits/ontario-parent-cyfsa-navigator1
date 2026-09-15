-- STAGE 5 M2-A PENDING APPROVAL. DO NOT EXECUTE against any project in this task.
-- Requires Stage 3 locked matter reads and Stage 4 page-evidence foundation.
begin;

-- ENUM equivalent CHECKS will be used for state and types for extensibility

-- 1. Entities
create table public.navigator_entities (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    entity_type text not null check(entity_type in ('PERSON', 'ORGANIZATION')),
    display_name text not null,
    review_state text not null check(review_state in ('PROPOSED','CONFIRMED','REJECTED','DISPUTED')),
    freshness_state text not null check(freshness_state in ('FRESH','STALE')),
    fingerprint text not null,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp()
);

-- 2. Entity Mentions (anchored to evidence)
create table public.navigator_entity_mentions (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    evidence_id uuid not null references public.navigator_evidence_items(id) on delete cascade,
    mention_text text not null,
    review_state text not null check(review_state in ('PROPOSED','CONFIRMED','REJECTED','DISPUTED')),
    freshness_state text not null check(freshness_state in ('FRESH','STALE')),
    fingerprint text not null,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp()
);

-- 3. Identity Resolutions (candidate/confirmed)
create table public.navigator_identity_resolutions (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    mention_id uuid not null references public.navigator_entity_mentions(id) on delete cascade,
    entity_id uuid not null references public.navigator_entities(id) on delete cascade,
    review_state text not null check(review_state in ('PROPOSED','CONFIRMED','REJECTED','DISPUTED')),
    freshness_state text not null check(freshness_state in ('FRESH','STALE')),
    fingerprint text not null,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp()
);

-- 4. Events
create table public.navigator_events (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    description text not null,
    date_precision text not null check(date_precision in ('EXACT_DATETIME', 'EXACT_DATE', 'MONTH_ONLY', 'YEAR_ONLY', 'APPROXIMATE', 'DATE_RANGE', 'BEFORE', 'AFTER', 'UNKNOWN')),
    date_lower_bound timestamptz,
    date_upper_bound timestamptz,
    timezone_name text,
    date_original_text text,
    review_state text not null check(review_state in ('PROPOSED','CONFIRMED','REJECTED','DISPUTED')),
    freshness_state text not null check(freshness_state in ('FRESH','STALE')),
    fingerprint text not null,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    check (
        (date_precision = 'UNKNOWN' and date_lower_bound is null and date_upper_bound is null) or
        (date_precision = 'BEFORE' and date_lower_bound is null and date_upper_bound is not null) or
        (date_precision = 'AFTER' and date_lower_bound is not null and date_upper_bound is null) or
        (date_precision in ('EXACT_DATETIME', 'EXACT_DATE', 'MONTH_ONLY', 'YEAR_ONLY', 'APPROXIMATE', 'DATE_RANGE') and date_lower_bound is not null and date_upper_bound is not null and date_lower_bound <= date_upper_bound)
    ),
    check (
        (date_precision = 'EXACT_DATETIME' and timezone_name is not null) or (date_precision <> 'EXACT_DATETIME')
    )
);

-- 5. Event Participants
create table public.navigator_event_participants (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    event_id uuid not null references public.navigator_events(id) on delete cascade,
    entity_id uuid not null references public.navigator_entities(id) on delete cascade,
    role text not null check(role in ('ACTOR','SUBJECT','REPORTER','WITNESS','PROFESSIONAL','OTHER')),
    review_state text not null check(review_state in ('PROPOSED','CONFIRMED','REJECTED','DISPUTED')),
    freshness_state text not null check(freshness_state in ('FRESH','STALE')),
    fingerprint text not null,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp()
);

-- 6. Provenance (Many-to-Many Evidence to Intelligence Object)
create table public.navigator_intelligence_provenance (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    evidence_id uuid not null references public.navigator_evidence_items(id) on delete cascade,
    -- Polymorphic reference to object, enforcing referential integrity with constraints/triggers
    object_id uuid not null,
    object_type text not null check(object_type in ('ENTITY','MENTION','RESOLUTION','EVENT','PARTICIPANT')),
    provenance_type text not null check(provenance_type in ('ASSERTS','SUPPORTS','DISPUTES','MENTIONS','DATES','IDENTIFIES','ATTRIBUTES','DERIVED_FROM')),
    created_at timestamptz not null default clock_timestamp()
);
-- Enforce single matter boundary for provenance
create unique index navigator_intelligence_provenance_matter_idx on public.navigator_intelligence_provenance(id, matter_id);

-- 7. Audit History
create table public.navigator_intelligence_review_actions (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    object_id uuid not null,
    object_type text not null check(object_type in ('ENTITY','MENTION','RESOLUTION','EVENT','PARTICIPANT')),
    actor_account_id uuid not null references public.accounts(id),
    from_state text not null check(from_state in ('PROPOSED','CONFIRMED','REJECTED','DISPUTED')),
    to_state text not null check(to_state in ('PROPOSED','CONFIRMED','REJECTED','DISPUTED')),
    from_freshness text not null check(from_freshness in ('FRESH','STALE')),
    to_freshness text not null check(to_freshness in ('FRESH','STALE')),
    created_at timestamptz not null default clock_timestamp(),
    object_updated_at timestamptz not null,
    check(from_state <> to_state or from_freshness <> to_freshness)
);

-- Security: Append-only audit history
create function public.navigator_intelligence_review_action_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'Review history is append only'; end $$;

create trigger navigator_intelligence_review_action_immutable before update or delete on public.navigator_intelligence_review_actions
for each row execute function public.navigator_intelligence_review_action_guard();
revoke all on function public.navigator_intelligence_review_action_guard() from public,anon,authenticated,service_role;

-- Security: Immutability of provenance
create function public.navigator_provenance_immutable_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'Provenance is immutable'; end $$;

create trigger navigator_provenance_immutable before update on public.navigator_intelligence_provenance
for each row execute function public.navigator_provenance_immutable_guard();
revoke all on function public.navigator_provenance_immutable_guard() from public,anon,authenticated,service_role;

-- Matter-scoped referential integrity cross-checks
create function public.navigator_m2a_matter_boundary_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare
    parent_matter_id uuid;
begin
    if TG_TABLE_NAME = 'navigator_entity_mentions' then
        select matter_id into parent_matter_id from public.navigator_evidence_items where id = NEW.evidence_id;
        if parent_matter_id <> NEW.matter_id then raise exception 'Cross-matter evidence linkage denied'; end if;
    elsif TG_TABLE_NAME = 'navigator_identity_resolutions' then
        select matter_id into parent_matter_id from public.navigator_entity_mentions where id = NEW.mention_id;
        if parent_matter_id <> NEW.matter_id then raise exception 'Cross-matter mention linkage denied'; end if;
        select matter_id into parent_matter_id from public.navigator_entities where id = NEW.entity_id;
        if parent_matter_id <> NEW.matter_id then raise exception 'Cross-matter entity linkage denied'; end if;
    elsif TG_TABLE_NAME = 'navigator_event_participants' then
        select matter_id into parent_matter_id from public.navigator_events where id = NEW.event_id;
        if parent_matter_id <> NEW.matter_id then raise exception 'Cross-matter event linkage denied'; end if;
        select matter_id into parent_matter_id from public.navigator_entities where id = NEW.entity_id;
        if parent_matter_id <> NEW.matter_id then raise exception 'Cross-matter entity linkage denied'; end if;
    elsif TG_TABLE_NAME = 'navigator_intelligence_provenance' then
        select matter_id into parent_matter_id from public.navigator_evidence_items where id = NEW.evidence_id;
        if parent_matter_id <> NEW.matter_id then raise exception 'Cross-matter evidence linkage denied'; end if;
    end if;
    return NEW;
end $$;

create trigger navigator_mentions_matter_boundary before insert or update on public.navigator_entity_mentions
for each row execute function public.navigator_m2a_matter_boundary_guard();

create trigger navigator_resolutions_matter_boundary before insert or update on public.navigator_identity_resolutions
for each row execute function public.navigator_m2a_matter_boundary_guard();

create trigger navigator_participants_matter_boundary before insert or update on public.navigator_event_participants
for each row execute function public.navigator_m2a_matter_boundary_guard();

create trigger navigator_provenance_matter_boundary before insert on public.navigator_intelligence_provenance
for each row execute function public.navigator_m2a_matter_boundary_guard();
revoke all on function public.navigator_m2a_matter_boundary_guard() from public,anon,authenticated,service_role;

-- RLS Enablement
alter table public.navigator_entities enable row level security;
alter table public.navigator_entity_mentions enable row level security;
alter table public.navigator_identity_resolutions enable row level security;
alter table public.navigator_events enable row level security;
alter table public.navigator_event_participants enable row level security;
alter table public.navigator_intelligence_provenance enable row level security;
alter table public.navigator_intelligence_review_actions enable row level security;

-- Revoke everything
revoke all on public.navigator_entities from public,anon,authenticated,service_role;
revoke all on public.navigator_entity_mentions from public,anon,authenticated,service_role;
revoke all on public.navigator_identity_resolutions from public,anon,authenticated,service_role;
revoke all on public.navigator_events from public,anon,authenticated,service_role;
revoke all on public.navigator_event_participants from public,anon,authenticated,service_role;
revoke all on public.navigator_intelligence_provenance from public,anon,authenticated,service_role;
revoke all on public.navigator_intelligence_review_actions from public,anon,authenticated,service_role;

-- Grant only to service_role to prevent direct client modifications and enforce security through RPCs
grant select,insert,update on public.navigator_entities to service_role;
grant select,insert,update on public.navigator_entity_mentions to service_role;
grant select,insert,update on public.navigator_identity_resolutions to service_role;
grant select,insert,update on public.navigator_events to service_role;
grant select,insert,update on public.navigator_event_participants to service_role;
grant select,insert on public.navigator_intelligence_provenance to service_role;
grant select,insert on public.navigator_intelligence_review_actions to service_role;

commit;
