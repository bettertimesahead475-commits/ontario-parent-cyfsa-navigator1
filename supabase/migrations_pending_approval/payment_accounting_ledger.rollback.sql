begin;

do $$
begin
  if to_regclass('public.payment_accounting_events') is not null then
    lock table public.payment_accounting_events in access exclusive mode;
    if exists (select 1 from public.payment_accounting_events) then
      raise exception 'Payment accounting ledger is not empty; use forward repair';
    end if;
  end if;
end
$$;
drop function if exists public.read_payment_accounting_state(text);
drop view if exists public.payment_accounting_state;
drop function if exists public.append_payment_accounting_event(uuid, text, text, text, text, jsonb);
drop table if exists public.payment_accounting_events;

commit;
