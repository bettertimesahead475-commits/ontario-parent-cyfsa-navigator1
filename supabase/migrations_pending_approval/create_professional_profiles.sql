-- ============================================================================
-- BLOCKED - PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- This migration is NOT applied. It is a draft artifact only, prepared for
-- review - not yet approved, not yet executed against production.
--
-- PURPOSE: creates the `professional_profiles` table, establishing the
-- foundation for the Stage 7 Lawyer/Professional Directory and workspace.
--
-- SCOPE OF THIS MIGRATION: table-only. It does NOT touch navigator_cases,
-- navigator_matters, accounts, or any existing tables.
--
-- OWNERSHIP MODEL:
--   account_id is nullable to support future unclaimed PUBLIC_LISTING rows.
--   A unique constraint ensures an account can claim at most one profile.
--   Zero-policy RLS restricts all access to service_role, following the
--   established codebase security architecture.
-- ============================================================================

create table public.professional_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete restrict,
  
  -- Public Profile Fields
  display_name text not null,
  professional_type text not null check (professional_type in ('LAWYER', 'PARALEGAL', 'OTHER')),
  public_phone text,
  public_email text,
  office_address text,
  city text,
  region text,
  
  -- Service/Practice Indications
  service_areas text[],
  is_virtual_province_wide boolean not null default false,
  indicates_family_law boolean not null default false,
  indicates_cyfsa boolean not null default false,
  
  -- Lifecycle and Source
  profile_source text not null default 'USER_CREATED',
  lifecycle_state text not null default 'CLAIMED_PROFILE' check (lifecycle_state in (
    'PUBLIC_LISTING', 
    'CLAIMED_PROFILE', 
    'VERIFIED_LAWYER', 
    'PARTICIPATING_PROFESSIONAL'
  )),
  
  -- Distinct Verification States (Do not collapse into one boolean)
  identity_verified boolean not null default false,
  licence_verified boolean not null default false,
  practice_verified boolean not null default false,
  platform_participating boolean not null default false,
  
  -- Internal Metadata
  verification_notes text,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure an account has at most one profile
create unique index professional_profiles_account_id_idx on public.professional_profiles (account_id) where account_id is not null;

comment on table public.professional_profiles is
  'Professional profile information and verification states. Separates directory data from the core account. RLS blocks all client access; accessed strictly via server-side services.';

comment on column public.professional_profiles.account_id is
  'The associated account. Nullable to support unclaimed public directory listings. Checked via UNIQUE index to prevent multiple profiles per account.';

comment on column public.professional_profiles.lifecycle_state is
  'Indicates the high-level state of this profile in the directory system. Strict separation between an unverified public listing and a fully participating platform professional.';

-- ============================================================================
-- Row-Level Security: enabled, zero policies.
-- ============================================================================

alter table public.professional_profiles enable row level security;

revoke all on public.professional_profiles from public, anon, authenticated;
grant select, insert, update, delete on public.professional_profiles to service_role;
