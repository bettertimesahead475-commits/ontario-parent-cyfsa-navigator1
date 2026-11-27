begin;

create table if not exists public.payment_accounting_events (
  id bigint generated always as identity primary key,
  payment_id uuid not null references public.payments(id),
  event text not null check (event in ('refund', 'refund-applied', 'confirm-bank', 'dispute', 'reset-settlement')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 255),
  occurred_at timestamptz not null,
  actor text not null,
  reason text,
  details jsonb not null check (jsonb_typeof(details) = 'object'),
  unique (payment_id, event, idempotency_key)
);
create unique index if not exists payment_accounting_once_per_refund_event
  on public.payment_accounting_events (payment_id, event) where event in ('refund', 'refund-applied');
create index if not exists payment_accounting_recent
  on public.payment_accounting_events (payment_id, occurred_at desc, id desc);

alter table public.payment_accounting_events enable row level security;
revoke all on public.payment_accounting_events from public, anon, authenticated, service_role;
grant select on public.payment_accounting_events to service_role;
drop policy if exists payment_accounting_service_read on public.payment_accounting_events;
create policy payment_accounting_service_read on public.payment_accounting_events for select to service_role using (true);
revoke all on sequence public.payment_accounting_events_id_seq from public, anon, authenticated, service_role;

create or replace view public.payment_accounting_state with (security_invoker = true) as
select distinct on (e.payment_id) e.payment_id, p.reference_number,
  case e.event when 'refund' then 'refunded' when 'confirm-bank' then 'bank_confirmed'
    when 'dispute' then 'missing_or_disputed' else 'pending_settlement' end as status,
  e.occurred_at as at,
  e.event = 'refund' and not exists (
    select 1 from public.payment_accounting_events a where a.payment_id = e.payment_id and a.event = 'refund-applied'
  ) as refund_incomplete
from public.payment_accounting_events e join public.payments p on p.id = e.payment_id
where e.event <> 'refund-applied'
order by e.payment_id, (e.event = 'refund') desc, e.occurred_at desc, e.id desc;
revoke all on public.payment_accounting_state from public, anon, authenticated, service_role;
grant select on public.payment_accounting_state to service_role;

create or replace function public.read_payment_accounting_state(p_reference text default null)
returns jsonb
language sql stable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('reference_number', reference_number, 'status', status, 'at', at)), '[]'::jsonb)
    from public.payment_accounting_state
    where p_reference is null or reference_number = p_reference
$$;
revoke all on function public.read_payment_accounting_state(text) from public, anon, authenticated, service_role;
grant execute on function public.read_payment_accounting_state(text) to service_role;

create or replace function public.append_payment_accounting_event(
  p_payment uuid, p_event text, p_key text, p_actor text, p_reason text, p_details jsonb
) returns text
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_refund boolean;
  v_applied boolean;
  v_last_at timestamptz;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Payment accounting append requires READ COMMITTED' using errcode = '25000';
  end if;
  if p_payment is null or p_event is null
     or p_event not in ('refund', 'refund-applied', 'confirm-bank', 'dispute', 'reset-settlement')
     or p_key is null or length(p_key) not between 1 and 255 or p_actor is null
     or jsonb_typeof(p_details) is distinct from 'object' then
    raise exception 'Invalid payment accounting event' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payment-accounting:' || p_payment::text, 0));
  if not exists (select 1 from public.payments where id = p_payment) then
    return 'not_found';
  end if;
  select exists (select 1 from public.payment_accounting_events where payment_id = p_payment and event = 'refund'),
         exists (select 1 from public.payment_accounting_events where payment_id = p_payment and event = 'refund-applied')
    into v_refund, v_applied;
  if p_event = 'refund' and v_refund then
    return case when v_applied then 'already_applied' else 'already_recorded' end;
  elsif p_event = 'refund-applied' then
    if v_applied then return 'unchanged'; end if;
    if not v_refund then return 'missing_refund'; end if;
  elsif v_refund then
    return 'refunded';
  end if;
  select occurred_at into v_last_at from public.payment_accounting_events
    where payment_id = p_payment order by occurred_at desc, id desc limit 1;
  if exists (
    select 1 from public.payment_accounting_events where payment_id = p_payment and event = p_event and idempotency_key = p_key
  ) then
    return 'unchanged';
  end if;
  insert into public.payment_accounting_events (payment_id, event, idempotency_key, occurred_at, actor, reason, details)
  values (p_payment, p_event, p_key, greatest(clock_timestamp(), v_last_at), p_actor, p_reason, p_details);
  return 'appended';
end
$$;
revoke all on function public.append_payment_accounting_event(uuid, text, text, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.append_payment_accounting_event(uuid, text, text, text, text, jsonb) to service_role;

commit;
