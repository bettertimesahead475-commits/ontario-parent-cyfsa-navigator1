-- ============================================================================
-- BLOCKED - PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- PURPOSE: Stage 10 (Firm Collaboration / Permissions / Audit) -- append-only
-- matter ACCESS event log foundation. Additive only: one new table, one guard
-- function with two triggers, and two service_role-only RPCs. No existing table,
-- column, constraint, RLS setting, policy or function is changed.
--
-- DEPENDS ON (all pending, schemas frozen):
--   create_accounts_foundation.sql              public.accounts
--   create_navigator_matters_foundation.sql     public.navigator_matters / navigator_matter_members
--   create_navigator_matter_access_grants.sql   public.navigator_matter_access_grants (table only)
-- It does NOT depend on remediate_navigator_matter_access_grants_lifecycle.sql
-- (PR #27): no accept/revoke function is referenced or replaced here.
--
-- WHAT THIS IS / IS NOT
--   * A historical, append-only record of security-relevant ACCESS events.
--   * NOT the Stage 10 current-state access report (api/services/matterAccessAudit.ts),
--     which reconstructs "who can open this matter now" from live grant/membership rows.
--   * NOT wired to any emitter yet. The invitation/accept/revoke paths that would emit
--     GRANT_* / REVIEWER_ACCESS_* events are being rewritten by the Stage 7B remediation
--     (PR #27); emitter integration waits for that freeze (see STAGE_10 doc).
--
-- TRUST BOUNDARY
--   Rows can only be written through record_matter_access_event(), which DERIVES the
--   actor account (from a server-verified Firebase uid), the actor's matter role at the
--   time of the event, and the timestamp. None of those are parameters, so a caller cannot
--   forge them. Matter, subject and grant references are verified to exist, and a grant
--   must belong to the event's matter. No role other than the function owner can INSERT,
--   UPDATE, DELETE or TRUNCATE the table; the append-only trigger also blocks UPDATE,
--   DELETE and TRUNCATE for the owner itself.
--
-- PRIVACY
--   Identifiers and fixed vocabularies only. There is no free-text, JSON or metadata
--   column: no document content, allegation, child record, legal strategy or form answer
--   can be stored. reason_code is constrained to an UPPER_SNAKE token.
--
-- RETENTION
--   No foreign keys to matters/accounts/grants, deliberately: audit history must not block
--   (or be silently cascaded by) any future deletion. Existence is verified at write time.
--   The retention period and any deletion/erasure process are an owner/legal decision that
--   this foundation does not make.
-- ============================================================================

begin;

create table public.navigator_matter_access_events (
  id uuid primary key default gen_random_uuid(),
  -- Total, gap-tolerant order of insertion; the stable ordering and paging key.
  event_sequence bigint generated always as identity unique,
  matter_id uuid not null,
  event_type text not null check (event_type in (
    'GRANT_CREATED',
    'GRANT_ACCEPTED',
    'GRANT_EXPIRED',
    'GRANT_REVOKED',
    'REVIEWER_ACCESS_ADDED',
    'REVIEWER_ACCESS_REMOVED',
    'ACCESS_AUDIT_VIEWED'
  )),
  actor_kind text not null check (actor_kind in ('ACCOUNT', 'SYSTEM')),
  actor_account_id uuid,
  -- The actor's membership role on THIS matter when the event was recorded (derived, never supplied).
  actor_matter_role text not null check (actor_matter_role in ('OWNER', 'REVIEWER', 'NONE', 'SYSTEM')),
  subject_account_id uuid,
  grant_id uuid,
  outcome text not null check (outcome in ('SUCCEEDED', 'REFUSED')),
  reason_code text check (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  idempotency_key text check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  occurred_at timestamptz not null default now(),

  constraint navigator_matter_access_events_actor_shape check (
    (actor_kind = 'ACCOUNT' and actor_account_id is not null and actor_matter_role in ('OWNER', 'REVIEWER', 'NONE'))
    or (actor_kind = 'SYSTEM' and actor_account_id is null and actor_matter_role = 'SYSTEM')
  ),
  -- Only expiry can be observed without an acting account.
  constraint navigator_matter_access_events_system_scope check (actor_kind = 'ACCOUNT' or event_type = 'GRANT_EXPIRED'),
  constraint navigator_matter_access_events_grant_required check (
    event_type not in ('GRANT_CREATED', 'GRANT_ACCEPTED', 'GRANT_EXPIRED', 'GRANT_REVOKED') or grant_id is not null
  ),
  constraint navigator_matter_access_events_subject_required check (
    event_type not in ('GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED', 'REVIEWER_ACCESS_REMOVED') or subject_account_id is not null
  ),
  constraint navigator_matter_access_events_audit_view_shape check (
    event_type <> 'ACCESS_AUDIT_VIEWED' or (grant_id is null and subject_account_id is null)
  ),
  constraint navigator_matter_access_events_refusal_reason check (outcome = 'SUCCEEDED' or reason_code is not null),
  constraint navigator_matter_access_events_idempotency unique (matter_id, idempotency_key)
);

create index navigator_matter_access_events_matter_seq_idx
  on public.navigator_matter_access_events (matter_id, event_sequence);
create index navigator_matter_access_events_refusal_idx
  on public.navigator_matter_access_events (matter_id, actor_account_id, event_type, occurred_at)
  where outcome = 'REFUSED';

comment on table public.navigator_matter_access_events is
  'Stage 10 append-only historical log of security-relevant matter ACCESS events. Written only via record_matter_access_event(); read only via list_matter_access_events(). Identifiers and fixed vocabularies only -- no case content. Distinct from the live access-state report.';

-- ---------------------------------------------------------------------------
-- Append-only guard. Fires for every role, including the table owner.
-- (A superuser can still disable triggers; that is outside the application trust model.)
-- ---------------------------------------------------------------------------
create function public.navigator_matter_access_events_append_only() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'APPEND_ONLY: navigator_matter_access_events rows cannot be updated, deleted or truncated.';
end $$;
revoke all on function public.navigator_matter_access_events_append_only() from public, anon, authenticated, service_role;

create trigger navigator_matter_access_events_no_update_delete
  before update or delete on public.navigator_matter_access_events
  for each row execute function public.navigator_matter_access_events_append_only();
create trigger navigator_matter_access_events_no_truncate
  before truncate on public.navigator_matter_access_events
  for each statement execute function public.navigator_matter_access_events_append_only();

-- Zero policies and no table privileges for any client or server role: every read and
-- write goes through the two SECURITY DEFINER functions below.
alter table public.navigator_matter_access_events enable row level security;
revoke all on public.navigator_matter_access_events from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- WRITE: trusted recorder. Server code passes the uid it obtained from
-- verifyFirebaseToken() (or null for a SYSTEM-observed expiry); everything else that
-- defines authority is derived here.
-- ---------------------------------------------------------------------------
create function public.record_matter_access_event(
  p_actor_firebase_uid text,
  p_matter_id uuid,
  p_event_type text,
  p_outcome text,
  p_subject_account_id uuid default null,
  p_grant_id uuid default null,
  p_reason_code text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_actor_kind text;
  v_role text;
  v_id uuid;
  v_existing public.navigator_matter_access_events;
begin
  if p_event_type is null or p_event_type not in (
    'GRANT_CREATED', 'GRANT_ACCEPTED', 'GRANT_EXPIRED', 'GRANT_REVOKED',
    'REVIEWER_ACCESS_ADDED', 'REVIEWER_ACCESS_REMOVED', 'ACCESS_AUDIT_VIEWED'
  ) then
    raise exception 'INVALID_EVENT_TYPE: %', coalesce(p_event_type, '<null>');
  end if;
  if p_outcome is null or p_outcome not in ('SUCCEEDED', 'REFUSED') then
    raise exception 'INVALID_OUTCOME';
  end if;

  if p_matter_id is null or not exists (select 1 from public.navigator_matters where id = p_matter_id) then
    raise exception 'MATTER_NOT_FOUND';
  end if;

  if p_actor_firebase_uid is null then
    v_actor_kind := 'SYSTEM';
    v_actor_id := null;
    v_role := 'SYSTEM';
  else
    select id into v_actor_id from public.accounts where firebase_uid = p_actor_firebase_uid;
    if v_actor_id is null then
      raise exception 'ACTOR_NOT_FOUND';
    end if;
    v_actor_kind := 'ACCOUNT';
    select role into v_role from public.navigator_matter_members
    where matter_id = p_matter_id and account_id = v_actor_id;
    v_role := coalesce(v_role, 'NONE');
  end if;

  if p_subject_account_id is not null
     and not exists (select 1 from public.accounts where id = p_subject_account_id) then
    raise exception 'SUBJECT_NOT_FOUND';
  end if;
  if p_grant_id is not null and not exists (
    select 1 from public.navigator_matter_access_grants where id = p_grant_id and matter_id = p_matter_id
  ) then
    raise exception 'GRANT_NOT_IN_MATTER';
  end if;

  -- Idempotent retry: the same key on the same matter returns the original event, but only
  -- if every caller-influenced field matches; otherwise the key is being reused for a
  -- different event.
  if p_idempotency_key is not null then
    select * into v_existing from public.navigator_matter_access_events
    where matter_id = p_matter_id and idempotency_key = p_idempotency_key;
    if found then
      if v_existing.event_type = p_event_type
         and v_existing.outcome = p_outcome
         and v_existing.actor_account_id is not distinct from v_actor_id
         and v_existing.subject_account_id is not distinct from p_subject_account_id
         and v_existing.grant_id is not distinct from p_grant_id
         and v_existing.reason_code is not distinct from p_reason_code then
        return v_existing.id;
      end if;
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
  end if;

  -- Bounded refusal logging: at most one REFUSED row per (matter, actor, event type,
  -- reason) per rolling hour. Repeats return the existing event instead of adding rows, so
  -- a caller cannot grow the log without limit by retrying a refused action.
  if p_outcome = 'REFUSED' then
    perform pg_advisory_xact_lock(hashtextextended(
      concat_ws('|', 'navigator_matter_access_refusal', p_matter_id::text,
                coalesce(v_actor_id::text, 'SYSTEM'), p_event_type, coalesce(p_reason_code, '')), 0));
    select id into v_id from public.navigator_matter_access_events
    where matter_id = p_matter_id
      and outcome = 'REFUSED'
      and event_type = p_event_type
      and actor_account_id is not distinct from v_actor_id
      and reason_code is not distinct from p_reason_code
      and occurred_at > now() - interval '1 hour'
    order by event_sequence desc
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.navigator_matter_access_events (
    matter_id, event_type, actor_kind, actor_account_id, actor_matter_role,
    subject_account_id, grant_id, outcome, reason_code, idempotency_key
  ) values (
    p_matter_id, p_event_type, v_actor_kind, v_actor_id, v_role,
    p_subject_account_id, p_grant_id, p_outcome, p_reason_code, p_idempotency_key
  )
  on conflict on constraint navigator_matter_access_events_idempotency do nothing
  returning id into v_id;

  if v_id is null then
    -- A concurrent call inserted the same idempotency key first: apply the same rule.
    select * into v_existing from public.navigator_matter_access_events
    where matter_id = p_matter_id and idempotency_key = p_idempotency_key;
    if v_existing.event_type = p_event_type
       and v_existing.outcome = p_outcome
       and v_existing.actor_account_id is not distinct from v_actor_id
       and v_existing.subject_account_id is not distinct from p_subject_account_id
       and v_existing.grant_id is not distinct from p_grant_id
       and v_existing.reason_code is not distinct from p_reason_code then
      return v_existing.id;
    end if;
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  return v_id;
end;
$$;

comment on function public.record_matter_access_event(text, uuid, text, text, uuid, uuid, text, text) is
  'Stage 10 trusted recorder for navigator_matter_access_events. Derives actor account, actor matter role and timestamp; verifies matter/subject/grant; idempotent by key; bounded REFUSED logging. Raises INVALID_EVENT_TYPE, INVALID_OUTCOME, MATTER_NOT_FOUND, ACTOR_NOT_FOUND, SUBJECT_NOT_FOUND, GRANT_NOT_IN_MATTER, IDEMPOTENCY_CONFLICT, or a check violation for a structurally invalid event.';

revoke all on function public.record_matter_access_event(text, uuid, text, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_matter_access_event(text, uuid, text, text, uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- READ: least privilege.
--   OWNER    -> every event on the matter              (scope 'MATTER')
--   REVIEWER -> only events it performed or that are about it (scope 'SELF')
--   anyone else, including a revoked professional, a suspended account and a caller asking
--   about a matter that does not exist -> the same NOT_AUTHORIZED error.
-- ---------------------------------------------------------------------------
create function public.list_matter_access_events(
  p_firebase_uid text,
  p_matter_id uuid,
  p_after_sequence bigint default 0,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
  v_role text;
  v_events jsonb;
begin
  if p_after_sequence is null or p_after_sequence < 0 or p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'INVALID_REQUEST';
  end if;

  select id into v_account_id from public.accounts
  where firebase_uid = p_firebase_uid and status = 'active';
  if v_account_id is not null then
    select role into v_role from public.navigator_matter_members
    where matter_id = p_matter_id and account_id = v_account_id;
  end if;
  if v_role is null or v_role not in ('OWNER', 'REVIEWER') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'event_sequence', e.event_sequence,
           'event_type', e.event_type,
           'occurred_at', e.occurred_at,
           'actor_kind', e.actor_kind,
           'actor_account_id', e.actor_account_id,
           'actor_matter_role', e.actor_matter_role,
           'subject_account_id', e.subject_account_id,
           'grant_id', e.grant_id,
           'outcome', e.outcome,
           'reason_code', e.reason_code
         ) order by e.event_sequence), '[]'::jsonb)
  into v_events
  from (
    select * from public.navigator_matter_access_events
    where matter_id = p_matter_id
      and event_sequence > p_after_sequence
      and (v_role = 'OWNER'
           or actor_account_id = v_account_id
           or subject_account_id = v_account_id)
    order by event_sequence
    limit p_limit
  ) e;

  return jsonb_build_object(
    'scope', case when v_role = 'OWNER' then 'MATTER' else 'SELF' end,
    'events', v_events
  );
end;
$$;

comment on function public.list_matter_access_events(text, uuid, bigint, integer) is
  'Stage 10 least-privilege reader for navigator_matter_access_events. OWNER: all events of the matter; REVIEWER: only events it performed or that concern it; everyone else: NOT_AUTHORIZED. Pages by event_sequence (limit 1..200).';

revoke all on function public.list_matter_access_events(text, uuid, bigint, integer) from public, anon, authenticated;
grant execute on function public.list_matter_access_events(text, uuid, bigint, integer) to service_role;

commit;
