-- ============================================================================
-- BLOCKED - PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- Stage 10 slice 7: recipient-bound access lifecycle, contract v4.
-- Authority: STAGE_10_COMPLETION_DECISIONS.md (frozen at audit/stage-10-completion-decisions-frozen),
-- Decisions 1-3.
--
-- ADDITIVE. No historical migration is edited. Requires, in order: the Stage 7B remediation (v2),
-- the slice 2 event log, and the slice 4 audited lifecycle (v3). Aborts with PREREQUISITE_MISSING
-- otherwise and leaves nothing behind.
--
-- What changes:
--   1. navigator_matter_access_grants.recipient_email (nullable; one canonical value per grant).
--      The recipient email is NEVER written to navigator_matter_access_events.
--   2. navigator_canonical_recipient_email(text): the ONE canonical rule (decision record section 3),
--      used by BOTH creation and acceptance, so the two can never disagree:
--        a. trim surrounding ASCII whitespace (space and codes 9-13: \t \n \v \f \r);
--        b. reject any character outside printable ASCII (codes 32-126), checked per code point;
--        c. require 3-254 characters, exactly one '@', a non-empty local part and domain;
--        d. lower-case ASCII A-Z only (translate(), so no locale or collation can change it).
--      Validation order is a -> length -> b -> '@' -> d; JavaScript mirrors it exactly
--      (api/services/recipientEmail.ts) and a real-PostgreSQL parity test compares the two.
--      Nothing else: no dot or plus-tag removal, no domain rewriting, no alias guessing.
--      Returns NULL for anything that is not a valid canonical address.
--   3. create_recipient_bound_matter_grant(...): v3 create_matter_grant plus a required recipient.
--   4. accept_recipient_bound_matter_grant(...): the v3 acceptance with the RECIPIENT CHECK FIRST.
--      The caller's trusted, verified Firebase email is compared with the grant's recipient
--      BEFORE ANY WRITE. A caller who is not the verified recipient gets the same INVALID_TOKEN
--      as an unknown token and causes no state change and no event, even on an expired grant.
--   5. The v3 entry points create_matter_grant(4 args) and accept_matter_grant(2 args) are replaced
--      by versions that refuse (CONTRACT_SUPERSEDED) and write nothing. Otherwise an older
--      application build could create an unbound grant or accept a bound grant without the
--      recipient check. revoke_matter_grant is unchanged (it does not involve the recipient).
--   6. navigator_matter_access_lifecycle_contract_v4() = 'navigator_matter_access_lifecycle_v4'.
--      The v2 and v3 contract functions are left in place, unchanged.
--
-- Rollback boundary: the application must be on v4 code before or together with this migration's
-- use. An older (v3) application build against this database fails closed on create and accept
-- (CONTRACT_SUPERSEDED) and still revokes correctly. There is no down-migration.
-- ============================================================================

begin;

do $$
declare
  v_contract text;
begin
  if to_regprocedure('public.navigator_matter_access_lifecycle_contract()') is null then
    raise exception 'PREREQUISITE_MISSING: apply remediate_navigator_matter_access_grants_lifecycle.sql (contract v2) first.';
  end if;
  if to_regprocedure('public.record_matter_access_event(text, uuid, text, text, uuid, uuid, text, text)') is null then
    raise exception 'PREREQUISITE_MISSING: apply create_navigator_matter_access_event_log.sql first.';
  end if;
  if to_regprocedure('public.navigator_matter_access_lifecycle_contract_v3()') is null then
    raise exception 'PREREQUISITE_MISSING: apply create_navigator_matter_access_lifecycle_audit_v3.sql (contract v3) first.';
  end if;
  execute 'select public.navigator_matter_access_lifecycle_contract_v3()' into v_contract;
  if v_contract is distinct from 'navigator_matter_access_lifecycle_v3' then
    raise exception 'PREREQUISITE_MISSING: expected lifecycle contract v3, found %.', coalesce(v_contract, '<null>');
  end if;
end $$;

-- ---------------------------------------------------------------------------- canonical rule
create function public.navigator_canonical_recipient_email(p_email text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v text;
  c integer;
  n integer;
begin
  if p_email is null then
    return null;
  end if;
  -- a. trim surrounding ASCII whitespace: space, \t, \n, \v, \f, \r (codes 32, 9-13)
  v := btrim(p_email, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13));
  n := char_length(v);
  -- c. length (in characters; all characters are single-byte ASCII once b. passes)
  if n < 3 or n > 254 then
    return null;
  end if;
  -- b. printable ASCII only (codes 32-126), checked by code point: no locale, collation or regex range
  for i in 1..n loop
    c := ascii(substr(v, i, 1));
    if c < 32 or c > 126 then
      return null;
    end if;
  end loop;
  -- c. exactly one '@' with a non-empty local part and domain
  if n - char_length(replace(v, '@', '')) <> 1 or left(v, 1) = '@' or right(v, 1) = '@' then
    return null;
  end if;
  -- d. lower-case ASCII A-Z only
  return translate(v, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
end;
$$;

comment on function public.navigator_canonical_recipient_email(text) is
  'Stage 10 v4: the single canonical recipient-email rule (trim ASCII whitespace; printable ASCII only; 3-254 chars; exactly one @ with non-empty sides; ASCII lower-case). Returns NULL when invalid. No provider-specific rewriting.';

revoke all on function public.navigator_canonical_recipient_email(text) from public, anon, authenticated;
grant execute on function public.navigator_canonical_recipient_email(text) to service_role;

-- ---------------------------------------------------------------------------- recipient column
alter table public.navigator_matter_access_grants add column recipient_email text;

alter table public.navigator_matter_access_grants
  add constraint navigator_matter_access_grants_recipient_email_canonical
  -- NULL-safe on purpose: a CHECK whose expression is NULL passes, so a plain "=" would admit a value that
  -- has no canonical form (canonical() returns NULL). "is not distinct from" makes that case false.
  check (recipient_email is null or recipient_email is not distinct from public.navigator_canonical_recipient_email(recipient_email));

comment on column public.navigator_matter_access_grants.recipient_email is
  'Stage 10 v4: the invited professional''s email, canonical (navigator_canonical_recipient_email). Only this verified recipient can accept. NULL only on grants created before v4, which v4 acceptance can never accept. Never copied into the event log.';

-- ---------------------------------------------------------------------------- create (v4)
create function public.create_recipient_bound_matter_grant(
  p_firebase_uid text,
  p_matter_id uuid,
  p_token_digest text,
  p_expires_in_days integer,
  p_recipient_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.accounts;
  v_grant public.navigator_matter_access_grants;
  v_recipient text;
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

  v_recipient := public.navigator_canonical_recipient_email(p_recipient_email);
  if v_recipient is null then
    raise exception 'INVALID_RECIPIENT: recipient email is not a valid address.';
  end if;

  insert into public.navigator_matter_access_grants (
    matter_id, grantor_account_id, token_digest, capability, status, expires_at, recipient_email
  ) values (
    p_matter_id, v_account.id, p_token_digest, 'REVIEWER', 'PENDING',
    now() + make_interval(days => p_expires_in_days), v_recipient
  )
  returning * into v_grant;

  -- Same event as v3: identifiers only. The recipient email is not an event field.
  perform public.record_matter_access_event(
    p_firebase_uid, v_grant.matter_id, 'GRANT_CREATED', 'SUCCEEDED', null, v_grant.id, null, null);

  return jsonb_build_object(
    'id', v_grant.id,
    'matter_id', v_grant.matter_id,
    'grantor_account_id', v_grant.grantor_account_id,
    'capability', v_grant.capability,
    'status', v_grant.status,
    'expires_at', v_grant.expires_at,
    'created_at', v_grant.created_at,
    'recipient_email', v_grant.recipient_email
  );
end;
$$;

comment on function public.create_recipient_bound_matter_grant(text, uuid, text, integer, text) is
  'Stage 10 v4: owner-checked creation of a PENDING REVIEWER invitation bound to one canonical recipient email, recording GRANT_CREATED in the same transaction. Raises ACCOUNT_UNAVAILABLE, NOT_OWNER, INVALID_REQUEST or INVALID_RECIPIENT.';

revoke all on function public.create_recipient_bound_matter_grant(text, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.create_recipient_bound_matter_grant(text, uuid, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------- accept (v4)
create function public.accept_recipient_bound_matter_grant(
  p_firebase_uid text,
  p_token_digest text,
  p_verified_email text,
  p_email_verified boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.accounts;
  v_grant public.navigator_matter_access_grants;
  v_caller_email text;
  v_role text;
  v_inserted integer;
begin
  select * into v_account from public.accounts where firebase_uid = p_firebase_uid;
  if not found or v_account.status <> 'active' then
    raise exception 'ACCOUNT_UNAVAILABLE: Account not found or inactive.';
  end if;

  -- The caller's identity claim is checked before the token is even looked up.
  v_caller_email := public.navigator_canonical_recipient_email(p_verified_email);
  if p_email_verified is distinct from true or v_caller_email is null then
    raise exception 'EMAIL_NOT_VERIFIED: A verified email is required to accept an invitation.';
  end if;

  select * into v_grant from public.navigator_matter_access_grants
  where token_digest = p_token_digest
  for update;

  -- RECIPIENT FIRST. A caller who is not the grant's verified recipient is told exactly what an
  -- unknown token is told, and nothing below (no expiry transition, no event, no membership
  -- change) runs for them. A pre-v4 grant (recipient_email NULL) matches no one.
  if not found or v_grant.recipient_email is null or v_grant.recipient_email <> v_caller_email then
    raise exception 'INVALID_TOKEN: Grant not found.';
  end if;

  -- From here on this is the frozen v3 acceptance, unchanged, for the verified recipient only.
  if v_grant.status <> 'PENDING' then
    raise exception 'INVALID_STATE: Grant is %.', v_grant.status;
  end if;

  if now() > v_grant.expires_at then
    update public.navigator_matter_access_grants
    set status = 'EXPIRED', updated_at = now()
    where id = v_grant.id;
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

comment on function public.accept_recipient_bound_matter_grant(text, text, text, boolean) is
  'Stage 10 v4: acceptance by the verified recipient only. The caller''s server-verified Firebase email (and email_verified) is compared with the grant''s canonical recipient BEFORE any write; a non-recipient gets INVALID_TOKEN, exactly as for an unknown token, and changes nothing. Otherwise identical to v3 (expiry persistence, owner preservation, same-transaction events).';

revoke all on function public.accept_recipient_bound_matter_grant(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.accept_recipient_bound_matter_grant(text, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------- v3 entry points refuse
create or replace function public.create_matter_grant(
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
begin
  raise exception 'CONTRACT_SUPERSEDED: invitations must be created with a recipient (contract v4).';
end;
$$;

create or replace function public.accept_matter_grant(
  p_firebase_uid text,
  p_token_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'CONTRACT_SUPERSEDED: invitations must be accepted by their verified recipient (contract v4).';
end;
$$;

revoke all on function public.create_matter_grant(text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.create_matter_grant(text, uuid, text, integer) to service_role;
revoke all on function public.accept_matter_grant(text, text) from public, anon, authenticated;
grant execute on function public.accept_matter_grant(text, text) to service_role;

-- ---------------------------------------------------------------------------- contract v4
create function public.navigator_matter_access_lifecycle_contract_v4()
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select 'navigator_matter_access_lifecycle_v4'::text $$;

comment on function public.navigator_matter_access_lifecycle_contract_v4() is
  'Stage 10 access-lifecycle contract v4: recipient-bound create/accept (verified email checked before any write), audited in the same transaction. Returns the constant navigator_matter_access_lifecycle_v4. Reads no data.';

revoke all on function public.navigator_matter_access_lifecycle_contract_v4() from public, anon, authenticated;
grant execute on function public.navigator_matter_access_lifecycle_contract_v4() to service_role;

commit;
