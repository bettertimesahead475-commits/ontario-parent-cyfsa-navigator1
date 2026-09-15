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
    object_id uuid not null,
    object_type text not null check(object_type in ('ENTITY','MENTION','RESOLUTION','EVENT','PARTICIPANT')),
    provenance_type text not null check(provenance_type in ('ASSERTS','SUPPORTS','DISPUTES','MENTIONS','DATES','IDENTIFIES','ATTRIBUTES','DERIVED_FROM')),
    created_at timestamptz not null default clock_timestamp()
);
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

-- ==========================================
-- Security & Validation Triggers
-- ==========================================

-- A. Append-only audit history
create function public.navigator_intelligence_review_action_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'Review history is append only'; end $$;

create trigger navigator_intelligence_review_action_immutable before update or delete on public.navigator_intelligence_review_actions
for each row execute function public.navigator_intelligence_review_action_guard();
revoke all on function public.navigator_intelligence_review_action_guard() from public,anon,authenticated,service_role;

-- B. Immutability of provenance
create function public.navigator_provenance_immutable_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'Provenance is immutable'; end $$;

create trigger navigator_provenance_immutable before update on public.navigator_intelligence_provenance
for each row execute function public.navigator_provenance_immutable_guard();
revoke all on function public.navigator_provenance_immutable_guard() from public,anon,authenticated,service_role;

-- C. Polymorphic target validation
create function public.navigator_m2a_polymorphic_target_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare
    target_matter_id uuid;
begin
    -- 1. Validate the polymorphic object reference
    if NEW.object_type = 'ENTITY' then
        select matter_id into target_matter_id from public.navigator_entities where id = NEW.object_id;
    elsif NEW.object_type = 'MENTION' then
        select matter_id into target_matter_id from public.navigator_entity_mentions where id = NEW.object_id;
    elsif NEW.object_type = 'RESOLUTION' then
        select matter_id into target_matter_id from public.navigator_identity_resolutions where id = NEW.object_id;
    elsif NEW.object_type = 'EVENT' then
        select matter_id into target_matter_id from public.navigator_events where id = NEW.object_id;
    elsif NEW.object_type = 'PARTICIPANT' then
        select matter_id into target_matter_id from public.navigator_event_participants where id = NEW.object_id;
    else
        raise exception 'Invalid object_type';
    end if;

    if target_matter_id is null then raise exception 'Target object does not exist'; end if;
    if target_matter_id <> NEW.matter_id then raise exception 'Cross-matter target linkage denied'; end if;

    -- 2. Validate evidence (if it is the provenance table)
    if TG_TABLE_NAME = 'navigator_intelligence_provenance' then
        declare ev_matter_id uuid;
        begin
            select matter_id into ev_matter_id from public.navigator_evidence_items where id = NEW.evidence_id;
            if ev_matter_id is null then raise exception 'Evidence item does not exist'; end if;
            if ev_matter_id <> NEW.matter_id then raise exception 'Cross-matter evidence linkage denied'; end if;
        end;
    end if;

    return NEW;
end $$;

create trigger navigator_provenance_target_boundary before insert on public.navigator_intelligence_provenance
for each row execute function public.navigator_m2a_polymorphic_target_guard();

create trigger navigator_review_actions_target_boundary before insert on public.navigator_intelligence_review_actions
for each row execute function public.navigator_m2a_polymorphic_target_guard();

revoke all on function public.navigator_m2a_polymorphic_target_guard() from public,anon,authenticated,service_role;

-- D. Direct Matter-scoped referential integrity cross-checks (FK logic for non-polymorphic)
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
    end if;
    return NEW;
end $$;

create trigger navigator_mentions_matter_boundary before insert or update on public.navigator_entity_mentions
for each row execute function public.navigator_m2a_matter_boundary_guard();

create trigger navigator_resolutions_matter_boundary before insert or update on public.navigator_identity_resolutions
for each row execute function public.navigator_m2a_matter_boundary_guard();

create trigger navigator_participants_matter_boundary before insert or update on public.navigator_event_participants
for each row execute function public.navigator_m2a_matter_boundary_guard();

revoke all on function public.navigator_m2a_matter_boundary_guard() from public,anon,authenticated,service_role;

-- E. Orphan Semantics (Hard-delete prevention if audit/provenance exists)
create function public.navigator_m2a_orphan_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare
    has_history boolean;
    has_provenance boolean;
begin
    select exists(select 1 from public.navigator_intelligence_review_actions where object_id = OLD.id) into has_history;
    if has_history then raise exception 'Cannot delete intelligence object with review history'; end if;

    select exists(select 1 from public.navigator_intelligence_provenance where object_id = OLD.id) into has_provenance;
    if has_provenance then raise exception 'Cannot delete intelligence object with provenance associations'; end if;

    return OLD;
end $$;

create trigger navigator_entities_orphan_guard before delete on public.navigator_entities for each row execute function public.navigator_m2a_orphan_guard();
create trigger navigator_mentions_orphan_guard before delete on public.navigator_entity_mentions for each row execute function public.navigator_m2a_orphan_guard();
create trigger navigator_resolutions_orphan_guard before delete on public.navigator_identity_resolutions for each row execute function public.navigator_m2a_orphan_guard();
create trigger navigator_events_orphan_guard before delete on public.navigator_events for each row execute function public.navigator_m2a_orphan_guard();
create trigger navigator_participants_orphan_guard before delete on public.navigator_event_participants for each row execute function public.navigator_m2a_orphan_guard();
revoke all on function public.navigator_m2a_orphan_guard() from public,anon,authenticated,service_role;

-- F. AI vs Human Confirmation Enforcer
create function public.navigator_m2a_review_state_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin
    if TG_OP = 'INSERT' then
        if NEW.review_state = 'CONFIRMED' then
            raise exception 'New candidates must start as PROPOSED and cannot be CONFIRMED directly';
        end if;
    elsif TG_OP = 'UPDATE' then
        if NEW.review_state <> OLD.review_state then
            if OLD.review_state = 'PROPOSED' then
                if NEW.review_state not in ('CONFIRMED', 'REJECTED', 'DISPUTED') then
                    raise exception 'Invalid transition from PROPOSED to %', NEW.review_state;
                end if;
            elsif OLD.review_state = 'CONFIRMED' then
                if NEW.review_state not in ('DISPUTED', 'REJECTED') then
                    raise exception 'Invalid transition from CONFIRMED to %', NEW.review_state;
                end if;
            elsif OLD.review_state = 'DISPUTED' then
                if NEW.review_state not in ('CONFIRMED', 'REJECTED') then
                    raise exception 'Invalid transition from DISPUTED to %', NEW.review_state;
                end if;
            elsif OLD.review_state = 'REJECTED' then
                if NEW.review_state not in ('CONFIRMED', 'DISPUTED') then
                    raise exception 'Invalid transition from REJECTED to %', NEW.review_state;
                end if;
            else
                raise exception 'Unknown review state: %', OLD.review_state;
            end if;
        end if;
    end if;
    return NEW;
end $$;

create trigger navigator_entities_review_guard before insert or update on public.navigator_entities for each row execute function public.navigator_m2a_review_state_guard();
create trigger navigator_mentions_review_guard before insert or update on public.navigator_entity_mentions for each row execute function public.navigator_m2a_review_state_guard();
create trigger navigator_resolutions_review_guard before insert or update on public.navigator_identity_resolutions for each row execute function public.navigator_m2a_review_state_guard();
create trigger navigator_events_review_guard before insert or update on public.navigator_events for each row execute function public.navigator_m2a_review_state_guard();
create trigger navigator_participants_review_guard before insert or update on public.navigator_event_participants for each row execute function public.navigator_m2a_review_state_guard();
revoke all on function public.navigator_m2a_review_state_guard() from public,anon,authenticated,service_role;

-- G. Controlled Human Review Pathway RPC
create function public.navigator_intelligence_review_update(
    p_uid text,
    p_matter_id uuid,
    p_object_type text,
    p_object_id uuid,
    p_state text,
    p_expected_updated_at timestamptz
) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp set lock_timeout='5s' set timezone='UTC' as $$
declare
    actor uuid;
    previous_state text;
    previous_freshness text;
    new_updated_at timestamptz;
    action public.navigator_intelligence_review_actions%rowtype;
begin
    select id into actor from public.accounts where firebase_uid=p_uid for update;
    perform 1 from public.read_navigator_owned_matter(p_uid,p_matter_id);
    if not found then raise exception using errcode='P0002',message='Not found'; end if;
    
    if p_state is null or p_expected_updated_at is null or p_state not in ('PROPOSED','CONFIRMED','REJECTED','DISPUTED') then
        raise exception using errcode='22023',message='Invalid review';
    end if;

    if p_object_type not in ('ENTITY','MENTION','RESOLUTION','EVENT','PARTICIPANT') then
        raise exception using errcode='22023',message='Invalid object_type';
    end if;

    -- Switch based on polymorphic type
    if p_object_type = 'ENTITY' then
        declare tgt public.navigator_entities%rowtype; begin
        select * into tgt from public.navigator_entities where id = p_object_id and matter_id = p_matter_id for update;
        if not found then raise exception using errcode='P0002',message='Not found'; end if;
        if tgt.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='Review conflict'; end if;
        if tgt.review_state = p_state then return jsonb_build_object('id',tgt.id,'review_state',tgt.review_state,'updated_at',tgt.updated_at,'changed',false); end if;
        previous_state := tgt.review_state; previous_freshness := tgt.freshness_state;
        update public.navigator_entities set review_state = p_state, updated_at = clock_timestamp() where id = tgt.id returning updated_at into new_updated_at;
        end;
    elsif p_object_type = 'MENTION' then
        declare tgt public.navigator_entity_mentions%rowtype; begin
        select * into tgt from public.navigator_entity_mentions where id = p_object_id and matter_id = p_matter_id for update;
        if not found then raise exception using errcode='P0002',message='Not found'; end if;
        if tgt.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='Review conflict'; end if;
        if tgt.review_state = p_state then return jsonb_build_object('id',tgt.id,'review_state',tgt.review_state,'updated_at',tgt.updated_at,'changed',false); end if;
        previous_state := tgt.review_state; previous_freshness := tgt.freshness_state;
        update public.navigator_entity_mentions set review_state = p_state, updated_at = clock_timestamp() where id = tgt.id returning updated_at into new_updated_at;
        end;
    elsif p_object_type = 'RESOLUTION' then
        declare tgt public.navigator_identity_resolutions%rowtype; begin
        select * into tgt from public.navigator_identity_resolutions where id = p_object_id and matter_id = p_matter_id for update;
        if not found then raise exception using errcode='P0002',message='Not found'; end if;
        if tgt.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='Review conflict'; end if;
        if tgt.review_state = p_state then return jsonb_build_object('id',tgt.id,'review_state',tgt.review_state,'updated_at',tgt.updated_at,'changed',false); end if;
        previous_state := tgt.review_state; previous_freshness := tgt.freshness_state;
        update public.navigator_identity_resolutions set review_state = p_state, updated_at = clock_timestamp() where id = tgt.id returning updated_at into new_updated_at;
        end;
    elsif p_object_type = 'EVENT' then
        declare tgt public.navigator_events%rowtype; begin
        select * into tgt from public.navigator_events where id = p_object_id and matter_id = p_matter_id for update;
        if not found then raise exception using errcode='P0002',message='Not found'; end if;
        if tgt.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='Review conflict'; end if;
        if tgt.review_state = p_state then return jsonb_build_object('id',tgt.id,'review_state',tgt.review_state,'updated_at',tgt.updated_at,'changed',false); end if;
        previous_state := tgt.review_state; previous_freshness := tgt.freshness_state;
        update public.navigator_events set review_state = p_state, updated_at = clock_timestamp() where id = tgt.id returning updated_at into new_updated_at;
        end;
    elsif p_object_type = 'PARTICIPANT' then
        declare tgt public.navigator_event_participants%rowtype; begin
        select * into tgt from public.navigator_event_participants where id = p_object_id and matter_id = p_matter_id for update;
        if not found then raise exception using errcode='P0002',message='Not found'; end if;
        if tgt.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='Review conflict'; end if;
        if tgt.review_state = p_state then return jsonb_build_object('id',tgt.id,'review_state',tgt.review_state,'updated_at',tgt.updated_at,'changed',false); end if;
        previous_state := tgt.review_state; previous_freshness := tgt.freshness_state;
        update public.navigator_event_participants set review_state = p_state, updated_at = clock_timestamp() where id = tgt.id returning updated_at into new_updated_at;
        end;
    end if;

    -- Create audit record
    insert into public.navigator_intelligence_review_actions(
        matter_id, object_id, object_type, actor_account_id, from_state, to_state, from_freshness, to_freshness, object_updated_at
    ) values (
        p_matter_id, p_object_id, p_object_type, actor, previous_state, p_state, previous_freshness, previous_freshness, new_updated_at
    ) returning * into action;

    return jsonb_build_object('id',p_object_id,'review_state',p_state,'updated_at',new_updated_at,'changed',true,'review_action',to_jsonb(action));
end $$;
revoke all on function public.navigator_intelligence_review_update(text,uuid,text,uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.navigator_intelligence_review_update(text,uuid,text,uuid,text,timestamptz) to service_role;

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

-- Grant only to service_role to prevent direct client modifications and enforce security through RPCs.
-- UPDATE is granted ONLY on non-review_state columns to prevent generic table mutation bypassing the RPC capability boundary.
grant select,insert on public.navigator_entities to service_role;
grant update (id, matter_id, entity_type, display_name, freshness_state, fingerprint, created_at, updated_at) on public.navigator_entities to service_role;

grant select,insert on public.navigator_entity_mentions to service_role;
grant update (id, matter_id, evidence_id, mention_text, freshness_state, fingerprint, created_at, updated_at) on public.navigator_entity_mentions to service_role;

grant select,insert on public.navigator_identity_resolutions to service_role;
grant update (id, matter_id, mention_id, entity_id, freshness_state, fingerprint, created_at, updated_at) on public.navigator_identity_resolutions to service_role;

grant select,insert on public.navigator_events to service_role;
grant update (id, matter_id, description, date_precision, date_lower_bound, date_upper_bound, timezone_name, date_original_text, freshness_state, fingerprint, created_at, updated_at) on public.navigator_events to service_role;

grant select,insert on public.navigator_event_participants to service_role;
grant update (id, matter_id, event_id, entity_id, role, freshness_state, fingerprint, created_at, updated_at) on public.navigator_event_participants to service_role;

grant select,insert on public.navigator_intelligence_provenance to service_role;
grant select,insert on public.navigator_intelligence_review_actions to service_role;

commit;
