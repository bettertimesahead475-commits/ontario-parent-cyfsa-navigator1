-- PENDING APPROVAL: do not execute automatically, on any project, including disposable ones.
-- Stage 6 Milestone 2-A — legal corpus schema hardening and snapshot versioning.
-- Extends Stage 6 M1 (create_navigator_legal_authority_foundation.sql). Requires that
-- migration to have run first: navigator_legal_sources, navigator_legal_source_versions,
-- navigator_legal_provisions, navigator_legal_mappings, and btree_gist all already exist.
-- This migration does NOT recreate any M1 table and does NOT add a second legal-mapping table.
-- No statutory corpus is ingested here; no row of real legal text is inserted by this file.
begin;

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Two-level provision model: navigator_legal_provisions (M1, unchanged) remains the stable
-- conceptual/citation identity. This table is the version-specific legal-text layer: the
-- actual wording of one provision as it stood during one legal_source_version's effective
-- period. Multiple rows may exist per provision_id, one per version the text was captured in.
-- ---------------------------------------------------------------------------
create table public.navigator_legal_provision_versions (
  id uuid primary key default gen_random_uuid(),
  provision_id uuid not null references public.navigator_legal_provisions(id),
  -- Redundant identity coordinate (matches the M1 pattern) so the composite FK below can
  -- prove this row's provision and version genuinely share one legal source.
  legal_source_id uuid not null references public.navigator_legal_sources(id),
  legal_source_version_id uuid not null references public.navigator_legal_source_versions(id),
  effective_from date not null,
  effective_to date,
  exact_text text not null check (char_length(exact_text) between 1 and 50000),
  normalized_text text not null check (char_length(normalized_text) between 1 and 50000),
  -- sha256 of the canonical UTF-8 normalized_text bytes; see STAGE_6_M2A doc for the exact rule.
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  verification_status text not null default 'UNVERIFIED'
    check (verification_status in ('UNVERIFIED','COMMITTED_INSPECTION','VERIFIED','REJECTED')),
  verified_by uuid references public.accounts(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  -- VERIFIED requires verification metadata; every other state must carry none. No AI identity
  -- can satisfy this by itself — verified_by is a human accounts(id), and no function in this
  -- migration or in api/services/legalCorpus.ts ever sets verification_status to VERIFIED.
  check ((verification_status = 'VERIFIED' and verified_by is not null and verified_at is not null)
    or (verification_status <> 'VERIFIED' and verified_by is null and verified_at is null))
);
alter table public.navigator_legal_provision_versions
  add constraint navigator_provision_version_provision_scope foreign key (provision_id, legal_source_id)
    references public.navigator_legal_provisions(id, legal_source_id),
  add constraint navigator_provision_version_source_version_scope foreign key (legal_source_version_id, legal_source_id)
    references public.navigator_legal_source_versions(id, legal_source_id);
create index navigator_provision_versions_provision_idx on public.navigator_legal_provision_versions(provision_id, effective_from);
create index navigator_provision_versions_source_version_idx on public.navigator_legal_provision_versions(legal_source_version_id);
create index navigator_provision_versions_verification_idx on public.navigator_legal_provision_versions(verification_status);
-- Overlap prevention within one conceptual provision, mirroring M1's version-overlap guard
-- exactly (half-open [from, to) ranges; null effective_to is unbounded).
alter table public.navigator_legal_provision_versions
  add constraint navigator_provision_version_no_overlap
  exclude using gist (
    provision_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

-- Once VERIFIED, a provision-version's legally material content is fully immutable — every
-- column is frozen, not only the ones a corpus editor might think to protect. A correction
-- requires a new row (a new provision-version, optionally lineage-linked via
-- navigator_legal_provision_lineage below), never an in-place edit of verified text.
create function public.navigator_provision_version_immutable() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  if old.verification_status = 'VERIFIED' then
    raise exception 'Verified provision-version content is immutable; create a new version instead.';
  end if;
  return new;
end $$;
revoke all on function public.navigator_provision_version_immutable() from public, anon, authenticated, service_role;
create trigger navigator_provision_version_immutable before update on public.navigator_legal_provision_versions
  for each row execute function public.navigator_provision_version_immutable();

-- ---------------------------------------------------------------------------
-- Immutable ingestion provenance: the raw retrieved payload a provision-version's text was
-- parsed from. Never an AI-generated summary — this stores what was actually fetched.
-- ---------------------------------------------------------------------------
create table public.navigator_legal_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  legal_source_id uuid not null references public.navigator_legal_sources(id),
  source_url text not null check (source_url ~ '^https://'),
  retrieved_at timestamptz not null,
  raw_content text not null check (char_length(raw_content) between 1 and 5000000),
  -- sha256 of the exact stored raw_content bytes (UTF-8), computed before any parsing/normalization.
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  ingestion_status text not null default 'RETRIEVED'
    check (ingestion_status in ('RETRIEVED','PARSED','VALIDATED','REJECTED')),
  created_at timestamptz not null default now()
);
create index navigator_source_snapshots_source_idx on public.navigator_legal_source_snapshots(legal_source_id, retrieved_at);
create index navigator_source_snapshots_status_idx on public.navigator_legal_source_snapshots(ingestion_status);

-- Only ingestion_status may ever change (as a future pipeline advances RETRIEVED -> PARSED ->
-- VALIDATED/REJECTED); the raw payload, its checksum, its source URL and retrieval time are
-- frozen at insert. This is the provenance record of what was actually fetched, permanently.
create function public.navigator_source_snapshot_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.legal_source_id is distinct from old.legal_source_id
    or new.source_url is distinct from old.source_url
    or new.retrieved_at is distinct from old.retrieved_at
    or new.raw_content is distinct from old.raw_content
    or new.content_sha256 is distinct from old.content_sha256
    or new.created_at is distinct from old.created_at then
    raise exception 'Source snapshot provenance is immutable; only ingestion_status may change.';
  end if;
  return new;
end $$;
revoke all on function public.navigator_source_snapshot_guard() from public, anon, authenticated, service_role;
create trigger navigator_source_snapshot_guard before update on public.navigator_legal_source_snapshots
  for each row execute function public.navigator_source_snapshot_guard();

-- ---------------------------------------------------------------------------
-- Amendment/version lineage: a plain edge table, not a nullable supersedes_id column, so one
-- predecessor can link to many successors (SPLIT) and many predecessors can link to one
-- successor (MERGE) as naturally as a straightforward 1:1 AMENDMENT/RENUMBERING/REPEAL edge.
-- ---------------------------------------------------------------------------
create table public.navigator_legal_provision_lineage (
  id uuid primary key default gen_random_uuid(),
  predecessor_version_id uuid not null references public.navigator_legal_provision_versions(id),
  successor_version_id uuid not null references public.navigator_legal_provision_versions(id),
  lineage_type text not null check (lineage_type in ('AMENDMENT','RENUMBERING','SPLIT','MERGE','REPEAL','REENACTMENT')),
  created_at timestamptz not null default now(),
  check (predecessor_version_id <> successor_version_id),
  unique (predecessor_version_id, successor_version_id, lineage_type)
);
create index navigator_lineage_predecessor_idx on public.navigator_legal_provision_lineage(predecessor_version_id);
create index navigator_lineage_successor_idx on public.navigator_legal_provision_lineage(successor_version_id);

-- ---------------------------------------------------------------------------
-- RLS / ACL — same posture as Stage 6 M1: RLS on, no public policies, service_role only.
-- Lineage edges are a historical record: service_role gets select/insert only (no update/delete
-- grant at all), so once recorded an edge cannot be silently redirected or removed.
-- ---------------------------------------------------------------------------
alter table public.navigator_legal_provision_versions enable row level security;
alter table public.navigator_legal_source_snapshots enable row level security;
alter table public.navigator_legal_provision_lineage enable row level security;
revoke all on public.navigator_legal_provision_versions, public.navigator_legal_source_snapshots,
  public.navigator_legal_provision_lineage from public, anon, authenticated, service_role;
grant select, insert, update on public.navigator_legal_provision_versions to service_role;
grant select, insert, update on public.navigator_legal_source_snapshots to service_role;
grant select, insert on public.navigator_legal_provision_lineage to service_role;

commit;
