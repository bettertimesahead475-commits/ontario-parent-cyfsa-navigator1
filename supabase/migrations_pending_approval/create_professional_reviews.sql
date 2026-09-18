-- STAGE 7C: PROFESSIONAL REVIEW
-- Allows multiple professionals to independently review the same matter intelligence.

begin;

create table public.professional_reviews (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.navigator_matters(id),
  finding_id uuid not null,
  finding_type text not null check(finding_type in ('EVIDENCE', 'CHRONOLOGY', 'CLAIM', 'CONTRADICTION', 'CORROBORATION', 'EVIDENCE_GAP', 'LEGAL_INTELLIGENCE')),
  reviewer_account_id uuid not null references public.accounts(id),
  review_state text not null,
  review_note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint professional_reviews_unique_finding unique (finding_type, finding_id, reviewer_account_id)
);

create index professional_reviews_matter_id_idx on public.professional_reviews(matter_id);
create index professional_reviews_finding_idx on public.professional_reviews(finding_type, finding_id);
create index professional_reviews_reviewer_idx on public.professional_reviews(reviewer_account_id);

alter table public.professional_reviews enable row level security;
revoke all on public.professional_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.professional_reviews to service_role;

commit;
