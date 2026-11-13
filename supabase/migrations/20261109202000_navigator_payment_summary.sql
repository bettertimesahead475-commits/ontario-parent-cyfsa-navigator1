create or replace view public.navigator_payment_summary as
with orders as (
  select plan as tier, count(*) as checkout_requests,
    count(*) filter (where status = 'approved') as approved_payments
  from public.payments group by plan
), codes as (
  select tier, count(*) as codes_issued,
    count(*) filter (where used_at is not null) as codes_redeemed,
    count(*) filter (where used_at is null and expires_at > now()) as codes_unused,
    count(*) filter (where used_at is null and expires_at <= now()) as codes_expired,
    count(*) filter (where used_at is null and expires_at is null) as codes_without_expiry
  from public.access_codes group by tier
), sessions as (
  select tier, count(distinct firebase_uid) as active_accounts
  from public.navigator_paid_sessions
  where revoked_at is null and expires_at > now()
  group by tier
)
select tier, coalesce(checkout_requests, 0) as checkout_requests,
  coalesce(approved_payments, 0) as approved_payments,
  coalesce(codes_issued, 0) as codes_issued,
  coalesce(codes_redeemed, 0) as codes_redeemed,
  coalesce(codes_unused, 0) as codes_unused,
  coalesce(codes_expired, 0) as codes_expired,
  coalesce(codes_without_expiry, 0) as codes_without_expiry,
  coalesce(active_accounts, 0) as active_accounts
from orders full join codes using (tier) full join sessions using (tier);

revoke all on public.navigator_payment_summary from public, anon, authenticated;
grant select on public.navigator_payment_summary to service_role;
