alter table public.payments
  add column if not exists client_ip text,
  add column if not exists user_agent text;

grant select, insert on table public.payments to service_role;
