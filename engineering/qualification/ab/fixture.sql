create table public.free_usage (
  uid text primary key,
  email text,
  analyses_used integer not null default 0,
  first_analysis_at timestamptz,
  last_analysis_at timestamptz
);
alter table public.free_usage enable row level security;
revoke all on public.free_usage from public, anon, authenticated;
grant select, insert, update, delete on public.free_usage to service_role;

insert into public.free_usage values
  ('qa-legacy', null, 2, '2026-11-01 00:00Z', '2026-11-01 00:00Z'),
  ('paid_session_10000000-0000-4000-8000-000000000001_total', null, 1, '2026-11-01 00:00Z', '2026-11-01 00:00Z');
insert into public.navigator_paid_sessions (id, firebase_uid, tier, issued_at, expires_at, revoked_at, revocation_reason)
values ('10000000-0000-4000-8000-000000000001', 'qa-legacy', 'Basic', '2026-11-01 00:00Z', '2026-12-01 00:00Z', null, null),
       ('10000000-0000-4000-8000-000000000002', 'qa-revoked', 'Basic', '2026-11-01 00:00Z', '2026-12-01 00:00Z', '2026-11-02 00:00Z', 'synthetic');
