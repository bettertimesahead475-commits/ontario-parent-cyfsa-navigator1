-- ============================================================================
-- BLOCKED - PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- PURPOSE: Implement Stage 7B parent-authorized matter access grants.
--
-- Adds the `navigator_matter_access_grants` table to manage the lifecycle of
-- invitations sent by matter owners to professionals.
-- 
-- Also updates `navigator_matter_members` role constraint to allow 'REVIEWER'.
--
-- ATOMIC ACCEPTANCE: The acceptance process validates tokens, expirations,
-- status, and ownership, then creates the 'REVIEWER' membership and updates
-- the grant status to 'ACCEPTED' atomically via the `accept_matter_grant` RPC.
-- ============================================================================

-- 1. Extend the matter member role constraint to include 'REVIEWER'.
alter table public.navigator_matter_members
  drop constraint if exists navigator_matter_members_role_check;

alter table public.navigator_matter_members
  add constraint navigator_matter_members_role_check check (role in ('OWNER', 'REVIEWER'));

comment on column public.navigator_matter_members.role is
  'Role of the account in the matter. OWNER is the parent who created it. REVIEWER is a professional granted access. REVIEWER grants no administrative control.';

-- 2. Create the grants table
create table public.navigator_matter_access_grants (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.navigator_matters(id) on delete cascade,
  grantor_account_id uuid not null references public.accounts(id) on delete restrict,
  
  -- The token is stored as a secure hash, never in plaintext.
  token_digest text not null unique,
  
  capability text not null default 'REVIEWER' check (capability in ('REVIEWER')),
  
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  
  -- Lifecycle timestamps
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_account_id uuid references public.accounts(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by_account_id uuid references public.accounts(id) on delete restrict,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index navigator_matter_access_grants_matter_id_idx on public.navigator_matter_access_grants(matter_id);
create index navigator_matter_access_grants_token_digest_idx on public.navigator_matter_access_grants(token_digest);

comment on table public.navigator_matter_access_grants is
  'Manages the lifecycle of invitations and consent given by a parent (matter OWNER) to a professional. The raw token is generated server-side, given to the user once, and only the hash is persisted in token_digest. Accepted grants atomically create a navigator_matter_members row. Revocation tombstones the member row or deletes it.';

-- RLS: Zero policies. Handled entirely via server-side service architecture.
alter table public.navigator_matter_access_grants enable row level security;
revoke all on public.navigator_matter_access_grants from public, anon, authenticated;
grant select, insert, update, delete on public.navigator_matter_access_grants to service_role;

-- 3. Atomic acceptance RPC function
create or replace function public.accept_matter_grant(
  p_firebase_uid text,
  p_token_digest text
)
returns public.navigator_matter_members
language plpgsql
security definer
as $$
declare
  v_account public.accounts;
  v_grant public.navigator_matter_access_grants;
  v_member public.navigator_matter_members;
begin
  -- Resolve the accepting account
  select * into v_account from public.accounts where firebase_uid = p_firebase_uid;
  if not found or v_account.status != 'active' then
    raise exception 'ACCOUNT_UNAVAILABLE: Account not found or inactive.';
  end if;

  -- Lock the grant row for update
  select * into v_grant from public.navigator_matter_access_grants 
  where token_digest = p_token_digest for update;
  
  if not found then
    raise exception 'INVALID_TOKEN: Grant not found.';
  end if;

  if v_grant.status != 'PENDING' then
    raise exception 'INVALID_STATE: Grant is %.', v_grant.status;
  end if;

  if now() > v_grant.expires_at then
    -- Optimistically expire it if caught here
    update public.navigator_matter_access_grants set status = 'EXPIRED' where id = v_grant.id;
    raise exception 'EXPIRED_TOKEN: Grant has expired.';
  end if;

  -- Grant is valid, update it to ACCEPTED
  update public.navigator_matter_access_grants
  set status = 'ACCEPTED',
      accepted_at = now(),
      accepted_by_account_id = v_account.id,
      updated_at = now()
  where id = v_grant.id;

  -- Insert membership row
  insert into public.navigator_matter_members (matter_id, account_id, role)
  values (v_grant.matter_id, v_account.id, v_grant.capability)
  on conflict on constraint navigator_matter_members_matter_account_key 
  do update set role = v_grant.capability -- upsert in case they somehow existed or were revoked
  returning * into v_member;

  return v_member;
end;
$$;

revoke all on function public.accept_matter_grant(text, text) from public, anon, authenticated;
grant execute on function public.accept_matter_grant(text, text) to service_role;
