-- ============================================================================
-- BLOCKED - PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- PURPOSE: Stage 7B access-lifecycle security remediation. Corrective, applies
-- AFTER create_navigator_matter_access_grants.sql. That historical file is not
-- modified. No table, column, constraint, index, RLS setting or policy changes.
--
-- Fixes, each reproduced against the original SQL on PostgreSQL 16 before this
-- file was written (see STAGE_7B_ACCESS_LIFECYCLE_REMEDIATION.md):
--
-- BUG 2 (owner downgrade): the original accept_matter_grant upserted
--   `on conflict (matter_id, account_id) do update set role = 'REVIEWER'`, so a
--   matter OWNER opening an invitation to their own matter was silently turned
--   into a REVIEWER, leaving the matter with no OWNER. Acceptance now refuses the
--   grantor and any account that already holds a non-REVIEWER membership, and
--   never updates an existing membership role.
--
-- BUG 3 (expiry never persisted): the original function updated the grant to
--   EXPIRED and then RAISEd, which rolled the update back; lapsed invitations
--   stayed PENDING forever. The function now persists EXPIRED and RETURNS an
--   EXPIRED outcome instead of raising. Expired invitations remain unusable.
--
-- BUGS 1 & 4 (revocation): revocation was two unchecked writes in the service
--   layer (errors ignored, success always reported) and deleted the REVIEWER
--   membership even when another ACCEPTED grant still authorized it. It is now a
--   single atomic, owner-checked RPC, revoke_matter_grant, which is idempotent,
--   removes a membership only when no other ACCEPTED grant for the same account
--   and matter remains, never touches an OWNER row, and reports what it did.
--
-- accept_matter_grant's return type changes (navigator_matter_members -> jsonb),
-- which PostgreSQL cannot do with CREATE OR REPLACE; the function is dropped and
-- recreated inside this transaction with identical name, arguments and privileges.
--
-- DEPLOY ORDER: apply this migration before deploying the matching
-- api/services/professionalMatterAccess.ts. If the order is accidentally reversed, the code
-- still fails closed: it checks navigator_matter_access_lifecycle_contract() (defined at the end
-- of this file) and refuses acceptance/revocation BEFORE calling any legacy function.
-- ============================================================================

begin;

drop function if exists public.accept_matter_grant(text, text);

create function public.accept_matter_grant(
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
begin
  select * into v_account from public.accounts where firebase_uid = p_firebase_uid;
  if not found or v_account.status <> 'active' then
    raise exception 'ACCOUNT_UNAVAILABLE: Account not found or inactive.';
  end if;

  -- Serializes concurrent accept/revoke of the same grant.
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
    -- Persist and return (not raise) so the EXPIRED state survives.
    update public.navigator_matter_access_grants
    set status = 'EXPIRED', updated_at = now()
    where id = v_grant.id;
    return jsonb_build_object('outcome', 'EXPIRED', 'grant_id', v_grant.id);
  end if;

  if v_grant.capability <> 'REVIEWER' then
    raise exception 'INVALID_STATE: Unsupported capability %.', v_grant.capability;
  end if;

  if v_account.id = v_grant.grantor_account_id then
    raise exception 'OWNER_CANNOT_ACCEPT: The grantor cannot accept their own invitation.';
  end if;

  -- Lock any existing membership so a concurrent revoke of another grant for this
  -- account serializes with this acceptance.
  select role into v_role from public.navigator_matter_members
  where matter_id = v_grant.matter_id and account_id = v_account.id
  for update;
  if v_role is not null and v_role <> 'REVIEWER' then
    raise exception 'OWNER_CANNOT_ACCEPT: An OWNER of this matter cannot accept a professional invitation to it.';
  end if;

  insert into public.navigator_matter_members (matter_id, account_id, role)
  values (v_grant.matter_id, v_account.id, 'REVIEWER')
  on conflict on constraint navigator_matter_members_matter_account_key do nothing;

  -- Re-check after the insert: a concurrently inserted non-REVIEWER row must never
  -- be overwritten, and in that case nothing is accepted (the raise rolls back).
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

  return jsonb_build_object(
    'outcome', 'ACCEPTED',
    'grant_id', v_grant.id,
    'matter_id', v_grant.matter_id,
    'role', 'REVIEWER'
  );
end;
$$;

comment on function public.accept_matter_grant(text, text) is
  'Stage 7B acceptance (remediated). Returns {outcome: ACCEPTED, grant_id, matter_id, role} or {outcome: EXPIRED, grant_id} (EXPIRED is persisted). Raises ACCOUNT_UNAVAILABLE, INVALID_TOKEN, INVALID_STATE or OWNER_CANNOT_ACCEPT. Never changes an existing membership role.';

revoke all on function public.accept_matter_grant(text, text) from public, anon, authenticated;
grant execute on function public.accept_matter_grant(text, text) to service_role;

create function public.revoke_matter_grant(
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

  -- Idempotent: the first revocation's time and actor are kept.
  if v_grant.status <> 'REVOKED' then
    update public.navigator_matter_access_grants
    set status = 'REVOKED',
        revoked_at = now(),
        revoked_by_account_id = v_account.id,
        updated_at = now()
    where id = v_grant.id;
  end if;

  v_member_account := v_grant.accepted_by_account_id;
  if v_member_account is not null then
    -- Lock the membership first so a concurrent acceptance of another grant for
    -- this account is serialized with the "still backed?" check below.
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
      -- REVIEWER only: an OWNER row is never removed by revocation.
      delete from public.navigator_matter_members
      where matter_id = v_grant.matter_id
        and account_id = v_member_account
        and role = 'REVIEWER';
      get diagnostics v_count = row_count;
      v_removed := v_count > 0;
    end if;
  end if;

  return jsonb_build_object(
    'grant_id', v_grant.id,
    'matter_id', v_grant.matter_id,
    'status', 'REVOKED',
    'membership_removed', v_removed
  );
end;
$$;

comment on function public.revoke_matter_grant(text, uuid) is
  'Stage 7B atomic revocation. Caller must be an active OWNER of the grant''s matter. Marks the grant REVOKED (idempotently) and removes the accepting account''s REVIEWER membership only when no other ACCEPTED grant for that account and matter remains. Returns {grant_id, matter_id, status, membership_removed}. Raises ACCOUNT_UNAVAILABLE, GRANT_NOT_FOUND or NOT_OWNER.';

revoke all on function public.revoke_matter_grant(text, uuid) from public, anon, authenticated;
grant execute on function public.revoke_matter_grant(text, uuid) to service_role;

-- Contract capability (audit finding B-1). Created in the same transaction as the two
-- functions above, so it exists if and only if the remediated semantics are installed. The
-- application calls it before every acceptance/revocation and refuses the operation unless it
-- returns exactly 'navigator_matter_access_lifecycle_v2'. That keeps new code from ever invoking
-- the legacy accept_matter_grant, which could commit an OWNER downgrade before its return value
-- could be inspected. It takes no arguments, reads no table and returns a constant.
create function public.navigator_matter_access_lifecycle_contract()
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select 'navigator_matter_access_lifecycle_v2'::text $$;

comment on function public.navigator_matter_access_lifecycle_contract() is
  'Stage 7B access-lifecycle contract version. Returns the constant navigator_matter_access_lifecycle_v2 when the remediated accept_matter_grant / revoke_matter_grant are installed. Reads no data.';

revoke all on function public.navigator_matter_access_lifecycle_contract() from public, anon, authenticated;
grant execute on function public.navigator_matter_access_lifecycle_contract() to service_role;

commit;
