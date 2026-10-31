-- Staging only (nxfhvebzzobegubefcda). Creates public.payments, which /api/request-access writes and which staging
-- lacked. Columns, checks and the idempotency index mirror production (inspected read-only 2026-10-30), except:
--   * no foreign keys to public.users (staging has no users table; the app identifies people by Firebase uid);
--   * no default payment_email (production's default is a personal address; the API always sets it);
--   * RLS on with no policies: only the server's service role reads or writes it.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  plan text not null,
  user_role text check (user_role = any (array['parent', 'lawyer'])),
  amount numeric not null,
  payment_method text default 'interac_etransfer',
  payment_email text,
  reference_number text,
  status text default 'pending' check (status = any (array['pending', 'approved', 'rejected'])),
  notes text,
  submitted_at timestamptz default now(),
  approved_at timestamptz,
  approved_by uuid,
  firebase_uid text,
  request_key text
);
create index if not exists idx_payments_status on public.payments (status);
create unique index if not exists payments_firebase_uid_request_key_uidx on public.payments (firebase_uid, request_key) where request_key is not null;
alter table public.payments enable row level security;
revoke all on table public.payments from anon, authenticated;
