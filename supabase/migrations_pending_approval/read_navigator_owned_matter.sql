-- PENDING APPROVAL ONLY. Never executed as part of lifecycle hardening.
-- Depends on the reviewed accounts and navigator matters foundation artifacts.
-- Atomic authorization AND matter read, not a reusable authorization token.
-- Lock order: account -> matter -> client -> membership. FOR SHARE blocks even
-- non-key UPDATEs (status/role/ownership) and DELETEs until transaction end.
-- At READ COMMITTED, a concurrent writer that wins first is waited for and its
-- updated row is checked. A writer that loses waits until this read completes.
-- At stronger isolation, serialization errors must fail closed at the API.
-- Future document reads must occur inside this same transaction/function scope;
-- a subsequent REST request would not inherit these locks. Administrative
-- multi-row writers should use this lock order; deadlocks/timeouts fail closed.
begin;

create function public.read_navigator_owned_matter(p_firebase_uid text, p_matter_id uuid)
returns setof public.navigator_matters
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $$
declare
  owner_account public.accounts%rowtype;
  owned_matter public.navigator_matters%rowtype;
  owned_client public.clients%rowtype;
  owner_member public.navigator_matter_members%rowtype;
begin
  select a.* into owner_account from public.accounts a
    where a.firebase_uid = p_firebase_uid for share;
  if not found or owner_account.status <> 'active' then return; end if;

  select m.* into owned_matter from public.navigator_matters m
    where m.id = p_matter_id for share;
  if not found or owned_matter.account_id <> owner_account.id then return; end if;

  select c.* into owned_client from public.clients c
    where c.id = owned_matter.client_id for share;
  if not found or owned_client.account_id <> owner_account.id then return; end if;

  select mm.* into owner_member from public.navigator_matter_members mm
    where mm.matter_id = owned_matter.id and mm.account_id = owner_account.id for share;
  if not found or owner_member.role <> 'OWNER' then return; end if;

  return next owned_matter;
end;
$$;

revoke all on function public.read_navigator_owned_matter(text, uuid) from public, anon, authenticated;
grant execute on function public.read_navigator_owned_matter(text, uuid) to service_role;
commit;
