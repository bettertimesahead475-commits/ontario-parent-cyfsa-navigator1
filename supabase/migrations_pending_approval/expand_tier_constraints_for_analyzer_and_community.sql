-- ============================================================================
-- Migration: expand_tier_constraints_for_analyzer_and_community.sql
-- Status: PENDING OWNER APPROVAL
-- Purpose: Expand the tier CHECK constraints on public.access_codes and
--          public.navigator_paid_sessions to support the full authoritative
--          product hierarchy:
--          1. Document Analyzer Basic ($19.99 CAD) -> 'Basic' / 'AnalyzerBasic'
--          2. Document Analyzer Premium ($49.99 CAD) -> 'Premium' / 'AnalyzerPremium'
--          3. Individual / Family CYFSA Case Access ($149 CAD/mo) -> 'Pro'
--          4. Community Sponsorship Plans -> 'Community5', 'Community10', 'Community25'
-- ============================================================================

-- Expand access_codes tier constraint
alter table public.access_codes drop constraint if exists access_codes_tier_check;
alter table public.access_codes add constraint access_codes_tier_check
  check (tier in (
    'Basic',
    'Premium',
    'Pro',
    'AnalyzerBasic',
    'AnalyzerPremium',
    'Community5',
    'Community10',
    'Community25',
    'pro_advocate',
    'premium_attorney'
  ));

-- Expand navigator_paid_sessions tier constraint
alter table public.navigator_paid_sessions drop constraint if exists navigator_paid_sessions_tier_check;
alter table public.navigator_paid_sessions add constraint navigator_paid_sessions_tier_check
  check (tier in (
    'Basic',
    'Premium',
    'Pro',
    'AnalyzerBasic',
    'AnalyzerPremium',
    'Community5',
    'Community10',
    'Community25'
  ));
