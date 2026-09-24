-- ============================================================================
-- BLOCKED - PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- PURPOSE: Stage 10 slice 4 -- wire the append-only access event log into the
-- professional access lifecycle so each access change and its audit event
-- commit (or roll back) in ONE transaction. Contract version v3.
--
-- REQUIRES, IN THIS ORDER (checked below; the migration aborts otherwise):
--   1. remediate_navigator_matter_access_grants_lifecycle.sql   (Stage 7B, contract v2)
--   2. create_navigator_matter_access_event_log.sql             (Stage 10 slice 2)
--
-- TWO AUTHORITIES, NOT DUPLICATED
--   * Lifecycle authority: accept_matter_grant / revoke_matter_grant keep the frozen
--     Stage 7B (a452c6c) logic verbatim -- every check, lock, raise and return shape is
--     unchanged. They alone decide whether a change is allowed.
--   * Audit authority: every event is written through the existing slice 2 recorder,
--     public.record_matter_access_event(), which derives actor account, actor role and
--     timestamp itself. Lifecycle functions pass only the verified uid (or NULL for a
--     system-observed expiry) plus identifiers taken from the row they just mutated.
--
-- ATOMICITY: each function is one statement, hence one transaction. Events are
-- recorded AFTER the mutation succeeds; any failure -- in the mutation or in the event
-- insert -- raises and rolls back both. A committed transition therefore always has
-- its event, and an event never describes a rolled-back transition.
--
-- EVENTS (only types already in the slice 2 vocabulary; one event per real transition):
--   create_matter_grant   PENDING grant created          -> GRANT_CREATED
--   accept_matter_grant   PENDING -> ACCEPTED            -> GRANT_ACCEPTED
--                         membership row newly inserted  -> REVIEWER_ACCESS_ADDED
--                         (not when another accepted grant already gave access)
--                         PENDING -> EXPIRED (persisted) -> GRANT_EXPIRED (SYSTEM actor)
--   revoke_matter_grant   status -> REVOKED              -> GRANT_REVOKED
--                         REVIEWER membership deleted    -> REVIEWER_ACCESS_REMOVED
--                         (not when another ACCEPTED grant still backs access)
--   A repeated revoke is not a transition and records nothing, unless it removes a
--   membership left behind by a pre-remediation partial revocation, which IS a real
--   transition and records REVIEWER_ACCESS_REMOVED.
--   Refused operations raise and roll back; they record nothing (refusal logging stays a
--   separate, bounded, not-yet-wired concern).
--
-- EXPIRY: an invitation becomes EXPIRED in the database only when someone tries to accept
-- it after expires_at (Stage 7B). That persisted transition is recorded. Invitations that
-- lapse unused are never mutated, so no expiry event is fabricated for them.
--
-- CONTRACT: navigator_matter_access_lifecycle_contract() still returns the frozen
-- 'navigator_matter_access_lifecycle_v2' (so the frozen Stage 7B application keeps
-- working after this migration). The new navigator_matter_access_lifecycle_contract_v3()
-- returns 'navigator_matter_access_lifecycle_v3' and exists only when audited lifecycle
-- functions are installed; the Stage 10 application requires it before every operation.
--
-- No table, column, constraint, index, RLS setting or policy changes.
-- ============================================================================

begin;

do $$
declare
  v_contract text;
begin
  if to_regprocedure('public.navigator_matter_access_lifecycle_contract()') is null then
    raise exception 'PREREQUISITE_MISSING: apply remediate_navigator_matter_access_grants_lifecycle.sql (contract v2) first.';
  end if;
  execute 'select public.navigator_matter_access_lifecycle_contract()' into v_contract;
  if v_contract is distinct from 'navigator_matter_access_lifecycle_v2' then
    raise exception 'PREREQUISITE_MISSING: expected lifecycle contract v2, found %.', coalesce(v_contract, '<null>');
  end if;
  if to_regprocedure('public.record_matter_access_event(text, uuid, text, text, uuid, uuid, text, text)') is null then
    raise exception 'PREREQUISITE_MISSING: apply create_navigator_matter_access_event_log.sql first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CREATE: owner-checked invitation creation with its GRANT_CREATED event.
-- The raw token never reaches the database; the server passes only its SHA-256 digest.
-- ---------------------------------------------------------------------------
create function public.create_matter_grant(
  p_firebase_uid text,
  p_matter_id uuid,
  p_token_digest text,
  p_expires_in_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.accounts;
  v_grant public.navigator_matter_access_grants;
begin
  select * into v_account from public.accounts where firebase_uid = p_firebase_uid;
  if not found or v_account.status <> 'active' then
    raise exception 'ACCOUNT_UNAVAILABLE: Account not found or inactive.';
  end if;

  if not exists (
    select 1 from public.navigator_matter_members
    where matter_id = p_matter_id and account_id = v_account.id and role = 'OWNER'
  ) then
    raise exception 'NOT_OWNER: Only the matter OWNER can grant access.';
  end if;

  if p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST: token digest must be a SHA-256 hex digest.';
  end if;
  if p_expires_in_days is null or p_expires_in_days < 1 or p_expires_in_days > 365 then
    raise exception 'INVALID_REQUEST: expiry must be 1 to 365 days.';
  end if;

  insert into public.navigator_matter_access_grants (
    matter_id, grantor_account_id, token_digest, capability, status, expires_at
  ) values (
    p_matter_id, v_account.id, p_token_digest, 'REVIEWER', 'PENDING', now() + make_interval(days => p_expires_in_days)
  )
  returning * into v_grant;

  perform public.record_matter_access_event(
    p_firebase_uid, v_grant.matter_id, 'GRANT_CREATED', 'SUCCEEDED', null, v_grant.id, null, null);

  return jsonb_build_object(
    'id', v_grant.id,
    'matter_id', v_grant.matter_id,
    'grantor_account_id', v_grant.grantor_account_id,
    'capability', v_grant.capability,
    'status', v_grant.status,
    'expires_at', v_grant.expires_at,
    'created_at', v_grant.created_at
  );
end;
$$;

comment on function public.create_matter_grant(text, uuid, text, integer) is
  'Stage 10 v3: owner-checked creation of a PENDING REVIEWER invitation from a server-supplied SHA-256 token digest, recording GRANT_CREATED in the same transaction. Raises ACCOUNT_UNAVAILABLE, NOT_OWNER or INVALID_REQUEST.';

revoke all on function public.create_matter_grant(text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.create_matter_grant(text, uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- ACCEPT: frozen Stage 7B logic (a452c6c) + events. Same signature, return shape and
-- errors, so CREATE OR REPLACE keeps existing privileges.
-- ---------------------------------------------------------------------------
create or replace function public.accept_matter_grant(
  p_firebase_uid text,
  p_token_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.accounts;
  v_grant public.navigator_matter_access_grants;
  v_role text;
  v_inserted integer;
begin
  select * into v_account from public.accounts where firebase_uid = p_firebase_uid;
  if not found or v_account.status <> 'active' then
    raise exception 'ACCOUNT_UNAVAILABLE: Account not found or inactive.';
  end if;

  select * into v_grant from public.navigator_matter_access_grants
  where token_digest = p_token_digest
  for update;
  if not found then
    raise exception 'INVALID_TOKEN: Grant not found.';
  end if;

  if v_grant.status <> 'PENDING' then
    raise exception 'INVALID_STATE: Grant is %.', v_grant.status;
  end if;

  if now() > v_grant.expires_at then
    update public.navigator_matter_access_grants
    set status = 'EXPIRED', updated_at = now()
    where id = v_grant.id;
    -- The expiry is a time-based fact, observed here; recorded as a SYSTEM event.
    perform public.record_matter_access_event(
      null, v_grant.matter_id, 'GRANT_EXPIRED', 'SUCCEEDED', null, v_grant.id, null, null);
    return jsonb_build_object('outcome', 'EXPIRED', 'grant_id', v_grant.id);
  end if;

  if v_grant.capability <> 'REVIEWER' then
    raise exception 'INVALID_STATE: Unsupported capability %.', v_grant.capability;
  end if;

  if v_account.id = v_grant.grantor_account_id then
    raise exception 'OWNER_CANNOT_ACCEPT: The grantor cannot accept their own invitation.';
  end if;

  select role into v_role from public.navigator_matter_members
  where matter_id = v_grant.matter_id and account_id = v_account.id
  for update;
  if v_role is not null and v_role <> 'REVIEWER' then
    raise exception 'OWNER_CANNOT_ACCEPT: An OWNER of this matter cannot accept a professional invitation to it.';
  end if;

  insert into public.navigator_matter_members (matter_id, account_id, role)
  values (v_grant.matter_id, v_account.id, 'REVIEWER')
  on conflict on constraint navigator_matter_members_matter_account_key do nothing;
  get diagnostics v_inserted = row_count;

  select role into v_role from public.navigator_matter_members
  where matter_id = v_grant.matter_id and account_id = v_account.id;
  if v_role is distinct from 'REVIEWER' then
    raise exception 'OWNER_CANNOT_ACCEPT: An OWNER of this matter cannot accept a professional invitation to it.';
  end if;

  update public.navigator_matter_access_grants
  set status = 'ACCEPTED',
      accepted_at = now(),
      accepted_by_account_id = v_account.id,
      updated_at = now()
  where id = v_grant.id;

  perform public.record_matter_access_event(
    p_firebase_uid, v_grant.matter_id, 'GRANT_ACCEPTED', 'SUCCEEDED', v_account.id, v_grant.id, null, null);
  if v_inserted = 1 then
    perform public.record_matter_access_event(
      p_firebase_uid, v_grant.matter_id, 'REVIEWER_ACCESS_ADDED', 'SUCCEEDED', v_account.id, v_grant.id, null, null);
  end if;

  return jsonb_build_object(
    'outcome', 'ACCEPTED',
    'grant_id', v_grant.id,
    'matter_id', v_grant.matter_id,
    'role', 'REVIEWER'
  );
end;
$$;

revoke all on function public.accept_matter_grant(text, text) from public, anon, authenticated;
grant execute on function public.accept_matter_grant(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- REVOKE: frozen Stage 7B logic (a452c6c) + events. Same signature and return shape.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_matter_grant(
  p_firebase_uid text,
  p_grant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.accounts;
  v_grant public.navigator_matter_access_grants;
  v_member_account uuid;
  v_removed boolean := false;
  v_transitioned boolean := false;
  v_count integer;
begin
  select * into v_account from public.accounts where firebase_uid = p_firebase_uid;
  if not found or v_account.status <> 'active' then
    raise exception 'ACCOUNT_UNAVAILABLE: Account not found or inactive.';
  end if;

  select * into v_grant from public.navigator_matter_access_grants
  where id = p_grant_id
  for update;
  if not found then
    raise exception 'GRANT_NOT_FOUND: Grant not found.';
  end if;

  if not exists (
    select 1 from public.navigator_matter_members
    where matter_id = v_grant.matter_id and account_id = v_account.id and role = 'OWNER'
  ) then
    raise exception 'NOT_OWNER: Only the matter OWNER can revoke access.';
  end if;

  if v_grant.status <> 'REVOKED' then
    update public.navigator_matter_access_grants
    set status = 'REVOKED',
        revoked_at = now(),
        revoked_by_account_id = v_account.id,
        updated_at = now()
    where id = v_grant.id;
    v_transitioned := true;
  end if;

  v_member_account := v_grant.accepted_by_account_id;
  if v_member_account is not null then
    perform 1 from public.navigator_matter_members
    where matter_id = v_grant.matter_id and account_id = v_member_account
    for update;

    if not exists (
      select 1 from public.navigator_matter_access_grants
      where matter_id = v_grant.matter_id
        and accepted_by_account_id = v_member_account
        and status = 'ACCEPTED'
        and id <> v_grant.id
    ) then
      delete from public.navigator_matter_members
      where matter_id = v_grant.matter_id
        and account_id = v_member_account
        and role = 'REVIEWER';
      get diagnostics v_count = row_count;
      v_removed := v_count > 0;
    end if;
  end if;

  if v_transitioned then
    perform public.record_matter_access_event(
      p_firebase_uid, v_grant.matter_id, 'GRANT_REVOKED', 'SUCCEEDED', v_grant.accepted_by_account_id, v_grant.id, null, null);
  end if;
  if v_removed then
    perform public.record_matter_access_event(
      p_firebase_uid, v_grant.matter_id, 'REVIEWER_ACCESS_REMOVED', 'SUCCEEDED', v_member_account, v_grant.id, null, null);
  end if;

  return jsonb_build_object(
    'grant_id', v_grant.id,
    'matter_id', v_grant.matter_id,
    'status', 'REVOKED',
    'membership_removed', v_removed
  );
end;
$$;

revoke all on function public.revoke_matter_grant(text, uuid) from public, anon, authenticated;
grant execute on function public.revoke_matter_grant(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- CONTRACT v3: exists iff the audited lifecycle functions above are installed.
-- ---------------------------------------------------------------------------
create function public.navigator_matter_access_lifecycle_contract_v3()
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select 'navigator_matter_access_lifecycle_v3'::text $$;

comment on function public.navigator_matter_access_lifecycle_contract_v3() is
  'Stage 10 access-lifecycle contract v3: create/accept/revoke record their access events in the same transaction. Returns the constant navigator_matter_access_lifecycle_v3. Reads no data.';

revoke all on function public.navigator_matter_access_lifecycle_contract_v3() from public, anon, authenticated;
grant execute on function public.navigator_matter_access_lifecycle_contract_v3() to service_role;

commit;
