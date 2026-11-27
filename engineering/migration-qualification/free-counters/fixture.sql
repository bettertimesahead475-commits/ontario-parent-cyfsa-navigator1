CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

-- Synthetic baseline: only the columns required by the reservation functions.
CREATE TABLE public.free_usage (
  uid text PRIMARY KEY,
  email text,
  analyses_used integer NOT NULL DEFAULT 0,
  first_analysis_at timestamptz,
  last_analysis_at timestamptz
);
ALTER TABLE public.free_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.free_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.free_usage TO service_role;
INSERT INTO public.free_usage (uid, analyses_used) VALUES
  ('legacy-uid', 2), ('legacy-exhausted', 3), ('legacy-zero', 0),
  ('paid_session_11111111-1111-4111-8111-111111111111_total', 2);
