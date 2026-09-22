-- PENDING APPROVAL: do not execute automatically, on any project, including disposable ones.
-- Stage 9D-4A — Official Ontario Court Form Registry + Template/Version Foundation.
--
-- Scope of this task (9D-4A only): identify, version and verify official court-form
-- templates. This migration does NOT implement AI-assisted form completion, template
-- filling, or populated-document generation (9D-4B/9D-4C, both out of scope here) and
-- inserts no rows of real Ontario government form content — see api/services/
-- officialFormFixtures.ts for the CLEARLY LABELED SYNTHETIC test fixtures used to exercise
-- this schema; nothing here asserts any real form number, revision date or hash as fact.
--
-- Mirrors the Stage 9A / Stage 6 M2A "canonical external authority + version + hash +
-- verification state" pattern (navigator_legal_sources / navigator_legal_source_versions /
-- navigator_legal_provision_versions) rather than inventing a new one, and the Stage 8
-- professional_work_product_versions convention for versioned generated artifacts.
begin;

-- ---------------------------------------------------------------------------
-- FORM IDENTITY: stable internal identity for one official court form. Not CYFSA-exclusive
-- — cyfsa_relevant is a tag on top of a general Family Law Rules / Ontario court form
-- registry, never a filter that excludes non-CYFSA forms from existing.
-- ---------------------------------------------------------------------------
create table public.navigator_official_forms (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null default 'ON' check (jurisdiction in ('ON', 'CA')),
  form_number text not null check (char_length(form_number) between 1 and 40),
  official_title text not null check (char_length(official_title) between 1 and 300),
  rule_family text not null check (char_length(rule_family) between 1 and 120),
  category text not null check (char_length(category) between 1 and 120),
  cyfsa_relevant boolean not null default false,
  is_active boolean not null default true,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  unique (jurisdiction, form_number)
);
create index navigator_official_forms_active_idx on public.navigator_official_forms(is_active);
create index navigator_official_forms_cyfsa_idx on public.navigator_official_forms(cyfsa_relevant);

-- ---------------------------------------------------------------------------
-- OFFICIAL SOURCE: canonical external authority this form's identity/versions are
-- verified against. Mirrors navigator_legal_sources' verification_state posture.
-- ---------------------------------------------------------------------------
create table public.navigator_official_form_sources (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.navigator_official_forms(id),
  source_url text not null check (source_url ~ '^https://'),
  source_authority text not null check (char_length(source_authority) between 1 and 200),
  verification_status text not null default 'UNVERIFIED'
    check (verification_status in ('VERIFIED', 'UNVERIFIED', 'SOURCE_UNAVAILABLE')),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  check ((verification_status = 'VERIFIED' and last_verified_at is not null)
    or (verification_status <> 'VERIFIED'))
);
create index navigator_official_form_sources_form_idx on public.navigator_official_form_sources(form_id);

-- ---------------------------------------------------------------------------
-- FORM VERSION: one immutable official revision of a form. Currentness is an explicit,
-- distinct state — "we have it stored" never silently means "still the current official
-- form". supersedes_version_id preserves historical lineage instead of repointing rows.
-- ---------------------------------------------------------------------------
create table public.navigator_official_form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.navigator_official_forms(id),
  version_label text not null check (char_length(version_label) between 1 and 80),
  official_revision_date date,
  effective_from date,
  effective_to date,
  currentness_status text not null default 'UNKNOWN'
    check (currentness_status in ('CURRENT', 'SUPERSEDED', 'UNKNOWN', 'VERIFICATION_OVERDUE', 'SOURCE_UNAVAILABLE')),
  supersedes_version_id uuid references public.navigator_official_form_versions(id),
  first_verified_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (supersedes_version_id is distinct from id),
  check (effective_to is null or effective_from is null or effective_to > effective_from),
  -- CURRENT requires an actual verification timestamp; a locally-stored copy with no
  -- verification event can never resolve to CURRENT.
  check (currentness_status <> 'CURRENT' or last_verified_at is not null)
);
create index navigator_official_form_versions_form_idx on public.navigator_official_form_versions(form_id, currentness_status);
create index navigator_official_form_versions_supersedes_idx on public.navigator_official_form_versions(supersedes_version_id);
-- At most one CURRENT version per form at a time; superseding must flip the old row's status
-- explicitly rather than leaving two rows simultaneously claiming CURRENT.
create unique index navigator_official_form_versions_one_current
  on public.navigator_official_form_versions(form_id) where currentness_status = 'CURRENT';

-- A version's official identity (which form, its label/dates) and its lineage pointer are
-- immutable once created; only currentness/verification fields may ever be updated (e.g. when
-- a newer version supersedes it). This preserves exact historical provenance: existing
-- template artifacts and field maps that reference this version id are never silently
-- repointed at a different official revision.
create function public.navigator_official_form_version_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.form_id is distinct from old.form_id
    or new.version_label is distinct from old.version_label
    or new.official_revision_date is distinct from old.official_revision_date
    or new.effective_from is distinct from old.effective_from
    or new.created_at is distinct from old.created_at then
    raise exception 'Official form version identity is immutable; create a new version instead.';
  end if;
  return new;
end $$;
revoke all on function public.navigator_official_form_version_guard() from public, anon, authenticated, service_role;
create trigger navigator_official_form_version_guard before update on public.navigator_official_form_versions
  for each row execute function public.navigator_official_form_version_guard();

-- ---------------------------------------------------------------------------
-- TEMPLATE ARTIFACT: the exact stored file (PDF/DOCX) for one form version. The hash is
-- computed server-side from actual bytes during trusted ingestion only (see
-- api/services/officialFormRegistry.ts) — no caller-supplied hash column exists here, and
-- the storage reference is an opaque bucket+path pointer, never a caller-selected filesystem
-- path. A template row is permanently bound to exactly one form_version_id.
-- ---------------------------------------------------------------------------
create table public.navigator_official_form_templates (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references public.navigator_official_form_versions(id),
  file_format text not null check (file_format in ('PDF', 'DOCX')),
  mime_type text not null check (char_length(mime_type) between 1 and 120),
  storage_bucket text not null check (char_length(storage_bucket) between 1 and 80),
  storage_path text not null check (char_length(storage_path) between 1 and 400 and storage_path !~ '\.\.' and storage_path !~ '^/'),
  byte_size bigint not null check (byte_size > 0),
  sha256_hex text not null check (sha256_hex ~ '^[0-9a-f]{64}$'),
  is_synthetic boolean not null default false,
  trust_status text not null default 'UNTRUSTED' check (trust_status in ('UNTRUSTED', 'HASH_VERIFIED')),
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);
create index navigator_official_form_templates_version_idx on public.navigator_official_form_templates(form_version_id);

-- A template artifact's bytes, hash, storage location and version binding are immutable
-- forever; only trust_status may transition (e.g. once server-side hash verification runs).
create function public.navigator_official_form_template_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.form_version_id is distinct from old.form_version_id
    or new.file_format is distinct from old.file_format
    or new.storage_bucket is distinct from old.storage_bucket
    or new.storage_path is distinct from old.storage_path
    or new.byte_size is distinct from old.byte_size
    or new.sha256_hex is distinct from old.sha256_hex
    or new.created_at is distinct from old.created_at then
    raise exception 'Official form template artifact is immutable; ingest a new template row instead.';
  end if;
  return new;
end $$;
revoke all on function public.navigator_official_form_template_guard() from public, anon, authenticated, service_role;
create trigger navigator_official_form_template_guard before update on public.navigator_official_form_templates
  for each row execute function public.navigator_official_form_template_guard();

-- ---------------------------------------------------------------------------
-- FIELD MAP VERSION: a mapping bound to the EXACT template artifact (and therefore the
-- exact form version/hash) it was built for. Because template_id references one immutable
-- navigator_official_form_templates row, a field map can never silently apply to a
-- different template version — the binding is structural, not just service-layer checked.
-- ---------------------------------------------------------------------------
create table public.navigator_official_form_field_maps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.navigator_official_form_templates(id),
  mapping_version_label text not null check (char_length(mapping_version_label) between 1 and 80),
  field_count integer not null check (field_count >= 0),
  mapping_status text not null default 'DRAFT' check (mapping_status in ('DRAFT', 'VALIDATED', 'DEPRECATED')),
  created_at timestamptz not null default now(),
  unique (template_id, mapping_version_label)
);
create index navigator_official_form_field_maps_template_idx on public.navigator_official_form_field_maps(template_id);

-- A field map's binding to its exact template artifact, its version label and its creation
-- timestamp are immutable forever; only mapping_status and field_count may ever be updated
-- (mapping_status transitions DRAFT -> VALIDATED -> DEPRECATED as review progresses, and
-- field_count may be recalculated against the same immutable template). This makes the
-- "structural, not just service-layer checked" binding claim above actually true at the DB
-- level: an existing field map row can never be repointed at a different template.
create function public.navigator_official_form_field_map_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.template_id is distinct from old.template_id
    or new.mapping_version_label is distinct from old.mapping_version_label
    or new.created_at is distinct from old.created_at then
    raise exception 'Official form field map binding is immutable; create a new field map row instead.';
  end if;
  return new;
end $$;
revoke all on function public.navigator_official_form_field_map_guard() from public, anon, authenticated, service_role;
create trigger navigator_official_form_field_map_guard before update on public.navigator_official_form_field_maps
  for each row execute function public.navigator_official_form_field_map_guard();

-- ---------------------------------------------------------------------------
-- RLS / ACL — same posture as Stage 6 M2A / Stage 9A: RLS on, no anon/authenticated
-- policies. All access goes through the service-role-backed API layer (see
-- api/officialFormRoutes.ts), which exposes blank-form metadata publicly at the HTTP route
-- level without requiring matter access or paid-analyzer/AI usage, but the database grant
-- itself stays service_role-only, matching every other Stage 9 table in this repository.
-- ---------------------------------------------------------------------------
alter table public.navigator_official_forms enable row level security;
alter table public.navigator_official_form_sources enable row level security;
alter table public.navigator_official_form_versions enable row level security;
alter table public.navigator_official_form_templates enable row level security;
alter table public.navigator_official_form_field_maps enable row level security;
revoke all on public.navigator_official_forms, public.navigator_official_form_sources,
  public.navigator_official_form_versions, public.navigator_official_form_templates,
  public.navigator_official_form_field_maps from public, anon, authenticated, service_role;
grant select, insert, update on public.navigator_official_forms to service_role;
grant select, insert, update on public.navigator_official_form_sources to service_role;
grant select, insert, update on public.navigator_official_form_versions to service_role;
grant select, insert, update on public.navigator_official_form_templates to service_role;
grant select, insert, update on public.navigator_official_form_field_maps to service_role;

commit;
