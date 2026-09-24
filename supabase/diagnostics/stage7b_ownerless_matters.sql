-- ============================================================================
-- READ-ONLY DIAGNOSTIC -- Stage 7B access-lifecycle remediation (pre-deployment)
-- ============================================================================
-- Lists every matter that has NO OWNER membership. Before the remediation, the
-- original accept_matter_grant could overwrite a matter owner's membership with
-- REVIEWER when the owner accepted an invitation to their own matter, leaving the
-- matter owner-less. No application path can repair such a matter (revocation
-- requires an OWNER), so run this BEFORE applying
-- remediate_navigator_matter_access_grants_lifecycle.sql and review every row.
--
-- This file only reads. It is safe to run inside `begin transaction read only;`.
-- It does NOT repair anything. Any repair or backfill needs separate, explicit
-- approval.
--
-- Columns: the matter, the account that created it (navigator_matters.account_id),
-- that account's current membership role on the matter (NULL if none), and any
-- grant that account itself accepted on the matter (the Bug 2 signature).
-- ============================================================================
select
  m.id                           as matter_id,
  m.account_id                   as creator_account_id,
  m.created_at                   as matter_created_at,
  mm.role                        as creator_current_role,
  (
    select array_agg(g.id order by g.accepted_at)
    from public.navigator_matter_access_grants g
    where g.matter_id = m.id
      and g.accepted_by_account_id = m.account_id
  )                              as grants_accepted_by_creator
from public.navigator_matters m
left join public.navigator_matter_members mm
  on mm.matter_id = m.id and mm.account_id = m.account_id
where not exists (
  select 1
  from public.navigator_matter_members o
  where o.matter_id = m.id and o.role = 'OWNER'
)
order by m.created_at, m.id;
