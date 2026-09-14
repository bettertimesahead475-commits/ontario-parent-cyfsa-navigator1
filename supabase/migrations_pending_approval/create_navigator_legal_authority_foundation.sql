-- PENDING APPROVAL: do not execute automatically, on any project, including disposable ones.
-- Stage 6 Milestone 1 — CYFSA legal-authority foundation. Independent of Stage 5 tables;
-- the only cross-stage touch is additive: a new FK to Stage 4's navigator_evidence_items,
-- plus one new unique constraint added onto that existing table (see below) to support it.
-- No existing Stage 4 column, check, trigger or grant is altered or removed.
-- Requires: navigator_matters, navigator_evidence_items (Stage 4).
begin;

create table public.navigator_legal_sources (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null check (jurisdiction in ('ON','CA')),
  title text not null check (char_length(title) between 1 and 500),
  source_type text not null check (source_type in ('STATUTE','REGULATION','COURT_RULE','CASE_LAW','CHARTER')),
  citation text not null check (char_length(citation) between 1 and 300),
  official_publisher text not null check (char_length(official_publisher) between 1 and 300),
  source_url text not null check (source_url ~ '^https://'),
  verification_state text not null check (verification_state in ('VERIFIED','UNVERIFIED','SUPERSEDED')),
  retrieved_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (jurisdiction, source_type, citation)
);

create table public.navigator_legal_source_versions (
  id uuid primary key default gen_random_uuid(),
  legal_source_id uuid not null references public.navigator_legal_sources(id) on delete cascade,
  version_label text not null check (char_length(version_label) between 1 and 200),
  effective_from date not null,
  effective_to date,
  status text not null check (status in ('NOT_YET_IN_FORCE','IN_FORCE','REPEALED','SUPERSEDED')),
  verification_state text not null check (verification_state in ('VERIFIED','UNVERIFIED','SUPERSEDED')),
  retrieved_at timestamptz not null,
  supersedes_version_id uuid references public.navigator_legal_source_versions(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  unique (legal_source_id, version_label)
);
create index navigator_legal_versions_source_idx on public.navigator_legal_source_versions(legal_source_id, effective_from);
-- Redundant identity coordinate so a version's source is checkable by composite FK.
alter table public.navigator_legal_source_versions
  add constraint navigator_legal_version_source_identity unique (id, legal_source_id);

create table public.navigator_legal_provisions (
  id uuid primary key default gen_random_uuid(),
  legal_source_id uuid not null references public.navigator_legal_sources(id) on delete cascade,
  citation text not null check (char_length(citation) between 1 and 200),
  label text not null check (char_length(label) between 1 and 300),
  verification_state text not null check (verification_state in ('VERIFIED','UNVERIFIED','SUPERSEDED')),
  created_at timestamptz not null default now(),
  unique (legal_source_id, citation)
);
alter table public.navigator_legal_provisions
  add constraint navigator_legal_provision_source_identity unique (id, legal_source_id);

-- Application-layer enforcement (api/services/legalAuthority.ts resolveApplicableVersion)
-- refuses to resolve when versions of one source overlap. This exclusion constraint makes
-- the same invariant fail closed at the database layer even for direct/manual writes.
-- daterange upper bound is exclusive to match the half-open [from, to) resolver semantics;
-- an open-ended (null) effective_to is represented as an unbounded upper bound.
-- Standard Supabase projects provision an `extensions` schema on `search_path` by default;
-- PRE-FLIGHT CHECK before running this migration on any target project: confirm `extensions`
-- exists and is on the migrating role's search_path (`show search_path;`), otherwise this
-- CREATE EXTENSION / operator-class resolution below will fail and the transaction rolls back
-- cleanly (this whole file is one BEGIN/COMMIT, so a failure here leaves no partial schema).
create extension if not exists btree_gist with schema extensions;
alter table public.navigator_legal_source_versions
  add constraint navigator_legal_version_no_overlap
  exclude using gist (
    legal_source_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

-- Stage 4's navigator_evidence_items has no (id, matter_id) unique constraint — only a plain
-- primary key on id — so the composite cross-matter FK below would fail at creation time
-- without this. Purely additive; does not alter Stage 4 provenance or existing constraints.
alter table public.navigator_evidence_items
  add constraint navigator_evidence_matter_identity unique (id, matter_id);

-- Mapping table: potentially relevant legal authority linked to reviewed Stage 4 evidence.
-- This is authority identification, never a legal conclusion (enforced in application code
-- by assertSafeLegalLanguage before any row reaches this table).
create table public.navigator_legal_mappings (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.navigator_matters(id),
  -- No ON DELETE CASCADE: evidence provenance is audit-sensitive, so a legal mapping must
  -- block (not silently follow) deletion of the evidence it references. Deleting evidence
  -- that has an associated mapping fails closed instead of erasing mapping history.
  evidence_item_id uuid not null references public.navigator_evidence_items(id),
  legal_source_id uuid not null references public.navigator_legal_sources(id),
  legal_source_version_id uuid references public.navigator_legal_source_versions(id),
  provision_id uuid not null references public.navigator_legal_provisions(id),
  potential_issue text not null check (char_length(potential_issue) between 1 and 500),
  reason_for_relevance text not null check (char_length(reason_for_relevance) between 1 and 2000),
  -- Legal-conclusion language is rejected in application code before insert; this check is a
  -- fail-closed backstop, not the primary enforcement (natural-language matching is inherently partial).
  check (reason_for_relevance !~* '\yviolat(ed|es|ion)\y|\ybroke the law\y|\yunlawful(ly)?\y|\yproves? misconduct\y|\yis guilty\y|\ycommitted an? offen[cs]e\y|\ycourt erred\y|\ynegligent(ly)?\y|\yliable\y|\yin breach of\y|\yfailed to comply with\y|\yacted contrary to\y'),
  -- Relevance/match confidence for this authority identification only — never a probability
  -- that a violation occurred, that a party would prevail, or that any legal conclusion holds.
  confidence double precision check (confidence between 0 and 1),
  temporal_resolution_outcome text not null check (temporal_resolution_outcome in (
    'RESOLVED','RESOLVED_OPEN_ENDED','RESOLVED_APPROXIMATE','UNKNOWN_DATE','NO_VERIFIED_VERSION',
    'BEFORE_EARLIEST_VERSION','AFTER_LAST_CLOSED_VERSION','GAP_IN_COVERAGE','OVERLAPPING_VERSIONS',
    'MULTIPLE_APPLICABLE_VERSIONS','INVALID_VERSION_DATA'
  )),
  review_status text not null default 'UNREVIEWED' check (review_status in (
    'UNREVIEWED','CONFIRMED_RELEVANT','POSSIBLY_RELEVANT','NOT_RELEVANT','REQUIRES_RESEARCH','SUPERSEDED'
  )),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((review_status in ('UNREVIEWED','REQUIRES_RESEARCH') and reviewed_by is null and reviewed_at is null)
    or (review_status not in ('UNREVIEWED','REQUIRES_RESEARCH') and reviewed_by is not null and reviewed_at is not null)),
  -- A resolved-outcome mapping must carry the version it resolved to; an ambiguous outcome must not.
  check ((temporal_resolution_outcome in ('RESOLVED','RESOLVED_OPEN_ENDED','RESOLVED_APPROXIMATE') and legal_source_version_id is not null)
    or (temporal_resolution_outcome not in ('RESOLVED','RESOLVED_OPEN_ENDED','RESOLVED_APPROXIMATE') and legal_source_version_id is null))
);
-- Cross-matter boundary: evidence, provision and version must each resolve back to the same
-- legal source / matter this mapping claims, never an independently-typed but mismatched row.
alter table public.navigator_legal_mappings
  add constraint navigator_mapping_provision_scope foreign key (provision_id, legal_source_id)
    references public.navigator_legal_provisions(id, legal_source_id),
  add constraint navigator_mapping_version_scope foreign key (legal_source_version_id, legal_source_id)
    references public.navigator_legal_source_versions(id, legal_source_id);
-- evidence_item_id already scopes to matter_id via navigator_evidence_items; this composite FK
-- additionally requires the evidence row to belong to the same matter this mapping claims.
alter table public.navigator_legal_mappings
  add constraint navigator_mapping_evidence_matter_scope foreign key (evidence_item_id, matter_id)
    references public.navigator_evidence_items(id, matter_id);

create index navigator_mappings_matter_idx on public.navigator_legal_mappings(matter_id);
create index navigator_mappings_evidence_idx on public.navigator_legal_mappings(evidence_item_id);
create index navigator_mappings_source_idx on public.navigator_legal_mappings(legal_source_id);
create index navigator_mappings_provision_idx on public.navigator_legal_mappings(provision_id);
create index navigator_mappings_review_idx on public.navigator_legal_mappings(review_status);

-- RLS on, no public policies; only service_role reaches these tables, matching the Stage 4 model.
alter table public.navigator_legal_sources enable row level security;
alter table public.navigator_legal_source_versions enable row level security;
alter table public.navigator_legal_provisions enable row level security;
alter table public.navigator_legal_mappings enable row level security;
revoke all on public.navigator_legal_sources, public.navigator_legal_source_versions,
  public.navigator_legal_provisions, public.navigator_legal_mappings from public, anon, authenticated, service_role;
-- Source/version/provision rows are curated (not user-writable per matter): service_role may
-- read and insert new verified authority, but never delete or blanket-update citation history.
grant select, insert on public.navigator_legal_sources, public.navigator_legal_source_versions,
  public.navigator_legal_provisions to service_role;
grant select, insert, update on public.navigator_legal_mappings to service_role;

-- updated_at maintenance mirrors the Stage 4 evidence guard pattern: SECURITY INVOKER,
-- pinned search_path, minimal EXECUTE grant.
create function public.navigator_legal_mapping_touch() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  new.updated_at := now();
  new.matter_id := old.matter_id;
  new.evidence_item_id := old.evidence_item_id;
  new.legal_source_id := old.legal_source_id;
  new.legal_source_version_id := old.legal_source_version_id;
  new.provision_id := old.provision_id;
  new.potential_issue := old.potential_issue;
  new.reason_for_relevance := old.reason_for_relevance;
  new.temporal_resolution_outcome := old.temporal_resolution_outcome;
  -- Provenance (matter/evidence/source/version/provision/potential issue/reasoning/temporal
  -- outcome) is immutable after creation; only review_status/reviewed_by/reviewed_at may
  -- change, mirroring the Stage 4 evidence provenance-immutability guard. A reviewer disputing
  -- the framing sets review_status (e.g. NOT_RELEVANT) rather than rewriting what was identified.
  return new;
end $$;
revoke all on function public.navigator_legal_mapping_touch() from public;
create trigger navigator_legal_mapping_touch before update on public.navigator_legal_mappings
  for each row execute function public.navigator_legal_mapping_touch();

commit;
