-- STAGE 5 M2-C CLAIMS, ATTRIBUTION, AND ALLEGATION EVOLUTION FOUNDATION
begin;

-- Extend existing M2-A provenance and review action constraints
alter table public.navigator_intelligence_provenance drop constraint navigator_intelligence_provenance_object_type_check;
alter table public.navigator_intelligence_provenance add constraint navigator_intelligence_provenance_object_type_check check(object_type in ('ENTITY','MENTION','RESOLUTION','EVENT','PARTICIPANT','CLAIM','ATTRIBUTION','EVOLUTION'));

alter table public.navigator_intelligence_review_actions drop constraint navigator_intelligence_review_actions_object_type_check;
alter table public.navigator_intelligence_review_actions add constraint navigator_intelligence_review_actions_object_type_check check(object_type in ('ENTITY','MENTION','RESOLUTION','EVENT','PARTICIPANT','CLAIM','ATTRIBUTION','EVOLUTION'));

-- Update the M2-A polymorphic guard function to understand the new types
create or replace function public.navigator_m2a_polymorphic_target_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare
    target_matter_id uuid;
begin
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
    elsif NEW.object_type = 'CLAIM' then
        select matter_id into target_matter_id from public.navigator_claims where id = NEW.object_id;
    elsif NEW.object_type = 'ATTRIBUTION' then
        select matter_id into target_matter_id from public.navigator_attributions where id = NEW.object_id;
    elsif NEW.object_type = 'EVOLUTION' then
        select matter_id into target_matter_id from public.navigator_claim_evolutions where id = NEW.object_id;
    end if;

    if target_matter_id is null then raise exception 'Target object does not exist'; end if;
    if target_matter_id <> NEW.matter_id then raise exception 'Cross-matter target linkage denied'; end if;

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

-- Update the review state update RPC
create or replace function public.navigator_intelligence_review_update(
    p_uid text,
    p_matter_id uuid,
    p_object_type text,
    p_object_id uuid,
    p_state text,
    p_expected_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
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
    
    -- Same target table selection logic as before...
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
    elsif p_object_type = 'CLAIM' then
        declare tgt public.navigator_claims%rowtype; begin
        select * into tgt from public.navigator_claims where id = p_object_id and matter_id = p_matter_id for update;
        if not found then raise exception using errcode='P0002',message='Not found'; end if;
        if tgt.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='Review conflict'; end if;
        if tgt.review_state = p_state then return jsonb_build_object('id',tgt.id,'review_state',tgt.review_state,'updated_at',tgt.updated_at,'changed',false); end if;
        previous_state := tgt.review_state; previous_freshness := tgt.freshness_state;
        update public.navigator_claims set review_state = p_state, updated_at = clock_timestamp() where id = tgt.id returning updated_at into new_updated_at;
        end;
    elsif p_object_type = 'EVOLUTION' then
        declare tgt public.navigator_claim_evolutions%rowtype; begin
        select * into tgt from public.navigator_claim_evolutions where id = p_object_id and matter_id = p_matter_id for update;
        if not found then raise exception using errcode='P0002',message='Not found'; end if;
        if tgt.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='Review conflict'; end if;
        if tgt.review_state = p_state then return jsonb_build_object('id',tgt.id,'review_state',tgt.review_state,'updated_at',tgt.updated_at,'changed',false); end if;
        previous_state := tgt.review_state; previous_freshness := tgt.freshness_state;
        update public.navigator_claim_evolutions set review_state = p_state, updated_at = clock_timestamp() where id = tgt.id returning updated_at into new_updated_at;
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

-- 1. Claims
create table public.navigator_claims (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    proposition text not null,
    classification text not null check(classification in ('FACT','ALLEGATION','OPINION','PROFESSIONAL_ASSESSMENT','INFERENCE','UNVERIFIED_CLAIM','UNKNOWN')),
    date_precision text check (date_precision in ('EXACT_DATETIME','EXACT_DATE','MONTH_ONLY','YEAR_ONLY','APPROXIMATE','DATE_RANGE','BEFORE','AFTER','UNKNOWN')),
    date_lower_bound timestamptz,
    date_upper_bound timestamptz,
    timezone_name text,
    date_original_text text,
    review_state text not null check(review_state in ('PROPOSED','CONFIRMED','REJECTED','DISPUTED')),
    freshness_state text not null check(freshness_state in ('FRESH','STALE')),
    fingerprint text not null,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp()
);

-- 2. Attributions
create table public.navigator_attributions (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    claim_id uuid not null references public.navigator_claims(id) on delete cascade,
    speaker_entity_id uuid references public.navigator_entities(id) on delete set null,
    attribution_type text not null check(attribution_type in ('DIRECT_STATEMENT','DIRECT_OBSERVATION','REPORTED_STATEMENT','DOCUMENT_RECORD','PROFESSIONAL_ASSESSMENT','AUTHOR_INFERENCE','SYSTEM_INFERENCE','UNKNOWN')),
    nested_source_attribution_id uuid references public.navigator_attributions(id) on delete restrict,
    created_at timestamptz not null default clock_timestamp()
    -- attributions do not have separate review state; they are reviewed implicitly with the claim or provenance
);

-- 3. Claim Evolutions (REPEATS, EXPANDS, etc)
create table public.navigator_claim_evolutions (
    id uuid primary key default gen_random_uuid(),
    matter_id uuid not null references public.navigator_matters(id) on delete cascade,
    source_claim_id uuid not null references public.navigator_claims(id) on delete cascade,
    target_claim_id uuid not null references public.navigator_claims(id) on delete cascade,
    evolution_type text not null check(evolution_type in ('REPEATS','EXPANDS','NARROWS','CHANGES_DATE','CHANGES_LOCATION','CHANGES_ACTOR','CHANGES_ACTION','CHANGES_SEVERITY','RETRACTS','DENIES','DISPUTES','CORRECTS','INDETERMINATE')),
    review_state text not null check(review_state in ('PROPOSED','CONFIRMED','REJECTED','DISPUTED')),
    freshness_state text not null check(freshness_state in ('FRESH','STALE')),
    fingerprint text not null,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp()
);

-- Constraints
alter table public.navigator_claims enable row level security;
alter table public.navigator_attributions enable row level security;
alter table public.navigator_claim_evolutions enable row level security;

revoke all on public.navigator_claims from public,anon,authenticated,service_role;
revoke all on public.navigator_attributions from public,anon,authenticated,service_role;
revoke all on public.navigator_claim_evolutions from public,anon,authenticated,service_role;

grant select,insert on public.navigator_claims to service_role;
grant update (id, matter_id, proposition, classification, date_precision, date_lower_bound, date_upper_bound, timezone_name, date_original_text, freshness_state, fingerprint, created_at, updated_at) on public.navigator_claims to service_role;

grant select,insert on public.navigator_attributions to service_role;

grant select,insert on public.navigator_claim_evolutions to service_role;
grant update (id, matter_id, source_claim_id, target_claim_id, evolution_type, freshness_state, fingerprint, created_at, updated_at) on public.navigator_claim_evolutions to service_role;

-- Attach orphan guards
create trigger navigator_claims_orphan_guard before delete on public.navigator_claims for each row execute function public.navigator_m2a_orphan_guard();
create trigger navigator_claim_evolutions_orphan_guard before delete on public.navigator_claim_evolutions for each row execute function public.navigator_m2a_orphan_guard();

-- Attach review state guard
create trigger navigator_claims_review_state_guard before insert or update on public.navigator_claims for each row execute function public.navigator_m2a_review_state_guard();
create trigger navigator_claim_evolutions_review_state_guard before insert or update on public.navigator_claim_evolutions for each row execute function public.navigator_m2a_review_state_guard();

-- Extend matter boundary guard for M2C
create or replace function public.navigator_m2a_matter_boundary_guard() returns trigger
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
    elsif TG_TABLE_NAME = 'navigator_attributions' then
        select matter_id into parent_matter_id from public.navigator_claims where id = NEW.claim_id;
        if parent_matter_id <> NEW.matter_id then raise exception 'Cross-matter claim linkage denied'; end if;
        if NEW.speaker_entity_id is not null then
            select matter_id into parent_matter_id from public.navigator_entities where id = NEW.speaker_entity_id;
            if parent_matter_id <> NEW.matter_id then raise exception 'Cross-matter entity linkage denied'; end if;
        end if;
        if NEW.nested_source_attribution_id is not null then
            select matter_id into parent_matter_id from public.navigator_attributions where id = NEW.nested_source_attribution_id;
            if parent_matter_id <> NEW.matter_id then raise exception 'Cross-matter attribution linkage denied'; end if;
        end if;
    elsif TG_TABLE_NAME = 'navigator_claim_evolutions' then
        select matter_id into parent_matter_id from public.navigator_claims where id = NEW.source_claim_id;
        if parent_matter_id <> NEW.matter_id then raise exception 'Cross-matter source claim linkage denied'; end if;
        select matter_id into parent_matter_id from public.navigator_claims where id = NEW.target_claim_id;
        if parent_matter_id <> NEW.matter_id then raise exception 'Cross-matter target claim linkage denied'; end if;
    end if;
    return NEW;
end $$;

-- Attribution cycle prevention
create or replace function public.navigator_m2c_attribution_cycle_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare
    current_id uuid;
    depth integer := 0;
begin
    if NEW.nested_source_attribution_id is null then
        return NEW;
    end if;

    if NEW.nested_source_attribution_id = NEW.id then
        raise exception 'Attribution self-cycle detected';
    end if;

    current_id := NEW.nested_source_attribution_id;

    while current_id is not null loop
        if depth > 100 then
            raise exception 'Attribution traversal bound exceeded';
        end if;
        if current_id = NEW.id then
            raise exception 'Attribution cycle detected';
        end if;
        
        select nested_source_attribution_id into current_id
        from public.navigator_attributions
        where id = current_id and matter_id = NEW.matter_id;
        
        depth := depth + 1;
    end loop;
    return NEW;
end $$;

-- Triggers for matter boundary guard
create trigger navigator_attributions_matter_boundary before insert or update on public.navigator_attributions
for each row execute function public.navigator_m2a_matter_boundary_guard();

create trigger navigator_claim_evolutions_matter_boundary before insert or update on public.navigator_claim_evolutions
for each row execute function public.navigator_m2a_matter_boundary_guard();

-- Triggers for attribution cycle prevention
create trigger navigator_attributions_cycle_guard before insert or update on public.navigator_attributions
for each row execute function public.navigator_m2c_attribution_cycle_guard();

commit;
