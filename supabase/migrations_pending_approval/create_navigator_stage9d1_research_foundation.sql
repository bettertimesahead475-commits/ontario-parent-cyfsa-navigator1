-- PENDING APPROVAL: do not execute automatically.
-- Stage 9D-1 — Case-wide legal discovery: data model & persistence foundation.
--
-- SCOPE: schema only. No discovery algorithm, ranking algorithm, research API/route,
-- or UI is implemented by this migration or by any code in this commit. This file adds
-- ONLY the persistence structures a later 9D-2/3/4 discovery/ranking/API implementation
-- needs to write into. It deliberately reuses, rather than duplicates, existing Stage 9A/9B
-- authority identity, Stage 7C professional review, and Stage 8 work-product structures.
--
-- Requires (all already applied/pending in this repository):
--   navigator_matters                              (matters foundation)
--   navigator_legal_sources / _versions / navigator_legal_provisions (Stage 6/9A authority identity)
--   navigator_matter_legal_research_candidates      (Stage 9B matter-to-law research candidates)
--   professional_reviews                            (Stage 7C professional review state)
--   professional_work_product_versions              (Stage 8 litigation work product)
--
-- TRUST MODEL enforced structurally in this file:
--   - Authority identity is never re-stored here. Every discovery result points at a Stage 9B
--     candidate row (which itself points at Stage 9A source/version/provision rows) by foreign
--     key; there is no free-form/duplicated citation, verification_state or trust column here.
--   - Ranking/relevance metadata (ranking_method, ranking_score, ranking_factors) is explainability
--     data about *why a candidate surfaced*; it never substitutes for, overrides, or is read as
--     authority verification, evidence classification or professional review state.
--   - Machine discovery state (discovery_status on the results table) is a structurally separate
--     column/table from professional review state (professional_reviews.review_state). A row here
--     reaching RANKED never implies CONFIRMED_RELEVANT; the two are only ever joined by finding_id.
--   - Version/staleness fields (staleness_checked_at) are a timestamp only, never a cached copy of
--     verification_state -- current trust is always re-read from navigator_legal_sources et al.
--
-- MATTER ISOLATION: every new table carries its own matter_id FK to navigator_matters, plus a
-- unique(id, matter_id) identity so downstream tables can require same-matter composite FKs
-- (the same pattern already used by navigator_legal_source_versions, navigator_legal_provisions
-- and navigator_evidence_items in the Stage 6/9A migration). No new table lets a row reference a
-- research run, candidate or work-product version belonging to a different matter.

begin;

-- ============================================================================
-- 0. Composite matter-identity constraints on existing tables, needed so the
--    new composite FKs below can require same-matter references. Purely additive;
--    does not alter any existing column, check, trigger or grant.
-- ============================================================================

alter table public.navigator_matter_legal_research_candidates
  add constraint navigator_research_candidate_matter_identity unique (id, matter_id);

alter table public.professional_work_product_versions
  add constraint professional_work_product_versions_matter_identity unique (id, matter_id);

-- Reuse Stage 7C's generic finding_type/finding_id professional-review model for
-- machine-discovered research results, instead of building a second review framework.
alter table public.professional_reviews
  drop constraint professional_reviews_finding_type_check;
alter table public.professional_reviews
  add constraint professional_reviews_finding_type_check
  check (finding_type in ('EVIDENCE', 'CHRONOLOGY', 'CLAIM', 'CONTRADICTION', 'CORROBORATION', 'EVIDENCE_GAP', 'LEGAL_INTELLIGENCE', 'LEGAL_RESEARCH_RESULT'));

-- ============================================================================
-- 1. A matter-bound discovery/research run.
-- ============================================================================
create table public.navigator_matter_research_runs (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.navigator_matters(id) on delete cascade,
  -- Who/what triggered it: an authenticated account for a manually-triggered run, or null for
  -- a future system/scheduled trigger. Never a caller-asserted identity string.
  triggered_by_account_id uuid references public.accounts(id) on delete set null,
  trigger_type text not null check (trigger_type in ('MANUAL', 'SCHEDULED', 'SYSTEM')),
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (trigger_type = 'MANUAL' or triggered_by_account_id is null),
  check (status not in ('COMPLETED', 'FAILED') or completed_at is not null),
  unique (id, matter_id)
);

create index navigator_research_runs_matter_idx on public.navigator_matter_research_runs (matter_id);
create index navigator_research_runs_triggered_by_idx on public.navigator_matter_research_runs (triggered_by_account_id);

comment on table public.navigator_matter_research_runs is
  'Stage 9D-1: a matter-bound discovery/research run. No discovery algorithm is implemented in this stage -- status transitions and result population are for a later 9D-2/3/4 implementation to drive. Every row is matter-scoped by FK.';

-- ============================================================================
-- 2/3/4/6/7. Authorities discovered during a run, referencing canonical Stage 9B
-- candidates (which themselves reference Stage 9A source/version/provision identity
-- and, via the candidate's own evidence_item_id/event_id, the matter-side context that
-- caused them to surface). Explainable ranking metadata and provenance/staleness fields
-- live here, structurally separate from professional review state.
-- ============================================================================
create table public.navigator_matter_research_run_results (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null,
  matter_id uuid not null,
  -- The discovered authority's identity is never re-stored: it is always the referenced
  -- Stage 9B candidate row, which itself resolves to Stage 9A source/version/provision.
  candidate_id uuid not null,
  -- Machine discovery state only. Structurally distinct from professional_reviews.review_state,
  -- which is reached only via a professional_reviews row keyed on
  -- (finding_type='LEGAL_RESEARCH_RESULT', finding_id=this row's id).
  discovery_status text not null default 'CANDIDATE_DISCOVERED' check (discovery_status in ('CANDIDATE_DISCOVERED', 'RANKED', 'SUPERSEDED')),
  -- Explainable relevance metadata: structured factors, not a bare free-form score, so a later
  -- reader can reconstruct *why* this candidate matched -- never itself a legal or authority claim.
  ranking_method text check (ranking_method is null or char_length(ranking_method) between 1 and 200),
  ranking_score numeric check (ranking_score is null or ranking_score between 0 and 1),
  ranking_factors jsonb,
  check ((ranking_method is null and ranking_score is null and ranking_factors is null) or ranking_method is not null),
  -- Version/staleness for later revalidation: the version actually resolved is already captured
  -- on the referenced candidate row (legal_source_version_id); this is only a re-check timestamp,
  -- never a cached copy of verification_state.
  staleness_checked_at timestamptz,
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Same-matter composite FKs: a result can never reference a run or candidate from a different matter.
  constraint navigator_research_result_run_scope foreign key (research_run_id, matter_id)
    references public.navigator_matter_research_runs (id, matter_id) on delete cascade,
  constraint navigator_research_result_candidate_scope foreign key (candidate_id, matter_id)
    references public.navigator_matter_legal_research_candidates (id, matter_id) on delete cascade,
  unique (id, matter_id),
  -- A run cannot discover the same candidate twice.
  unique (research_run_id, candidate_id)
);

create index navigator_research_results_run_idx on public.navigator_matter_research_run_results (research_run_id);
create index navigator_research_results_matter_idx on public.navigator_matter_research_run_results (matter_id);
create index navigator_research_results_candidate_idx on public.navigator_matter_research_run_results (candidate_id);
create index navigator_research_results_status_idx on public.navigator_matter_research_run_results (discovery_status);

comment on table public.navigator_matter_research_run_results is
  'Stage 9D-1: authorities discovered during a research run. Authority identity is always resolved via candidate_id -> navigator_matter_legal_research_candidates -> Stage 9A source/version/provision; no citation/trust field is duplicated here. ranking_* columns are structured explainability metadata only, never an authority or review determination. No ranking algorithm is implemented in this stage.';

comment on column public.navigator_matter_research_run_results.ranking_factors is
  'Structured (jsonb) explainability data describing why this candidate matched -- e.g. matched terms, matched evidence/event references, weighting inputs. Never a substitute for authority verification_state, evidence classification or professional review state, all of which remain re-derived from their own authoritative tables.';

comment on column public.navigator_matter_research_run_results.staleness_checked_at is
  'Last time this result''s underlying authority was re-checked for staleness/supersession. Only a timestamp; current trust is always re-read live from navigator_legal_sources/_versions/navigator_legal_provisions, never cached here.';

-- ============================================================================
-- 8. Nullable linkage preparing for (not implementing) reviewed-research -> work-product
-- consumption. Points at Stage 8's existing professional_work_product_versions rather than
-- duplicating work-product storage. No code in this stage reads or writes this table.
-- ============================================================================
create table public.navigator_matter_research_work_product_links (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.navigator_matters(id) on delete cascade,
  research_run_result_id uuid not null,
  work_product_version_id uuid not null,
  linked_at timestamptz not null default now(),
  constraint navigator_research_link_result_scope foreign key (research_run_result_id, matter_id)
    references public.navigator_matter_research_run_results (id, matter_id) on delete cascade,
  constraint navigator_research_link_work_product_scope foreign key (work_product_version_id, matter_id)
    references public.professional_work_product_versions (id, matter_id) on delete cascade,
  unique (research_run_result_id, work_product_version_id)
);

create index navigator_research_wp_links_matter_idx on public.navigator_matter_research_work_product_links (matter_id);
create index navigator_research_wp_links_result_idx on public.navigator_matter_research_work_product_links (research_run_result_id);
create index navigator_research_wp_links_wp_idx on public.navigator_matter_research_work_product_links (work_product_version_id);

comment on table public.navigator_matter_research_work_product_links is
  'Stage 9D-1: nullable/future join table preparing for reviewed-research -> work-product consumption. Not populated or consumed by any code in this stage; a later 9D increment decides when a research result may be linked into a finalized work-product version.';

-- ============================================================================
-- RLS: same defense-in-depth pattern as every other Stage 6/7/8/9 table --
-- RLS enabled with zero policies, explicit REVOKE from PUBLIC/anon/authenticated,
-- GRANT restricted to service_role only. Authorization (matter access) is enforced
-- exclusively in server-side service code, exactly as navigator_matter_legal_research_candidates.
-- Real RLS policies (row-level matter-membership predicates), if ever added on top of this
-- service_role-only baseline, are explicitly DEFERRED to the release/integration gate --
-- no such policy is invented here.
-- ============================================================================
alter table public.navigator_matter_research_runs enable row level security;
alter table public.navigator_matter_research_run_results enable row level security;
alter table public.navigator_matter_research_work_product_links enable row level security;

revoke all on public.navigator_matter_research_runs,
  public.navigator_matter_research_run_results,
  public.navigator_matter_research_work_product_links
  from public, anon, authenticated;

grant select, insert, update, delete on public.navigator_matter_research_runs to service_role;
grant select, insert, update, delete on public.navigator_matter_research_run_results to service_role;
grant select, insert, update, delete on public.navigator_matter_research_work_product_links to service_role;

commit;

-- ============================================================================
-- POST-APPLY VERIFICATION (run after applying, expect the results shown):
-- ============================================================================
-- select relrowsecurity from pg_class where relname in
--   ('navigator_matter_research_runs','navigator_matter_research_run_results','navigator_matter_research_work_product_links');
--   -- EXPECTED: true for all three rows.
--
-- select count(*) from pg_policies where schemaname = 'public'
--   and tablename in ('navigator_matter_research_runs','navigator_matter_research_run_results','navigator_matter_research_work_product_links');
--   -- EXPECTED: 0.
--
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public'
--   and table_name in ('navigator_matter_research_runs','navigator_matter_research_run_results','navigator_matter_research_work_product_links')
--   and grantee in ('anon','authenticated');
--   -- EXPECTED: zero rows.
--
-- ============================================================================
-- ROLLBACK IF NEEDED (affects ONLY the objects created/altered above):
-- ============================================================================
-- drop table if exists public.navigator_matter_research_work_product_links;
-- drop table if exists public.navigator_matter_research_run_results;
-- drop table if exists public.navigator_matter_research_runs;
-- alter table public.professional_reviews drop constraint professional_reviews_finding_type_check;
-- alter table public.professional_reviews add constraint professional_reviews_finding_type_check
--   check(finding_type in ('EVIDENCE', 'CHRONOLOGY', 'CLAIM', 'CONTRADICTION', 'CORROBORATION', 'EVIDENCE_GAP', 'LEGAL_INTELLIGENCE'));
-- alter table public.professional_work_product_versions drop constraint professional_work_product_versions_matter_identity;
-- alter table public.navigator_matter_legal_research_candidates drop constraint navigator_research_candidate_matter_identity;
