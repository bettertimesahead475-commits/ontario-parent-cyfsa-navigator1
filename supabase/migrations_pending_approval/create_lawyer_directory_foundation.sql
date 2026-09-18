-- ============================================================================
-- BLOCKED - PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- PURPOSE: Stage 7D Lawyer Directory Data Foundation
-- Creates normalized child tables for office locations, service areas,
-- practice areas, and profile sources, linked to professional_profiles.
-- ============================================================================

begin;

-- 1. Office Locations
create table public.professional_office_locations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.professional_profiles(id) on delete cascade,
  address text,
  locality text,
  province text default 'ON',
  postal_code text,
  country text default 'Canada',
  lat float8,
  lng float8,
  precision_metadata text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index professional_office_locations_profile_idx on public.professional_office_locations(profile_id);
create index professional_office_locations_locality_idx on public.professional_office_locations(locality);

alter table public.professional_office_locations enable row level security;
revoke all on public.professional_office_locations from public, anon, authenticated;
grant select, insert, update, delete on public.professional_office_locations to service_role;

-- 2. Service Areas
create table public.professional_service_areas (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.professional_profiles(id) on delete cascade,
  coverage_type text not null check (coverage_type in ('LOCALITY', 'REGIONAL', 'ONTARIO_WIDE', 'VIRTUAL')),
  locality_name text,
  region_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index professional_service_areas_profile_idx on public.professional_service_areas(profile_id);
create index professional_service_areas_coverage_idx on public.professional_service_areas(coverage_type);
create index professional_service_areas_locality_idx on public.professional_service_areas(locality_name);

alter table public.professional_service_areas enable row level security;
revoke all on public.professional_service_areas from public, anon, authenticated;
grant select, insert, update, delete on public.professional_service_areas to service_role;

-- 3. Practice Areas
create table public.professional_practice_areas (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.professional_profiles(id) on delete cascade,
  practice_area text not null,
  provenance_type text not null check (provenance_type in ('SELF_REPORTED', 'CURATED', 'VERIFIED_EXTERNAL')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, practice_area)
);

create index professional_practice_areas_profile_idx on public.professional_practice_areas(profile_id);
create index professional_practice_areas_area_idx on public.professional_practice_areas(practice_area);

alter table public.professional_practice_areas enable row level security;
revoke all on public.professional_practice_areas from public, anon, authenticated;
grant select, insert, update, delete on public.professional_practice_areas to service_role;

-- 4. Profile Sources / Provenance
create table public.professional_profile_sources (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.professional_profiles(id) on delete cascade,
  source_type text not null,
  source_organization text,
  source_url text,
  observed_at timestamptz not null default now(),
  verified_at timestamptz,
  verification_method text,
  created_at timestamptz not null default now()
);

create index professional_profile_sources_profile_idx on public.professional_profile_sources(profile_id);

alter table public.professional_profile_sources enable row level security;
revoke all on public.professional_profile_sources from public, anon, authenticated;
grant select, insert, update, delete on public.professional_profile_sources to service_role;

commit;
