-- Run immediately after re-applying Migration P following preserve_monthly_renewal_P.rollback.sql.
-- The rollback drops redeemed_session_id; a first redemption's link is still recorded in
-- navigator_paid_sessions.access_code_id, so restore it (purchase recovery in claim-purchase reads this link).
-- Renewal-only links accepted as lost at rollback cannot be rebuilt and stay null.
begin;

update public.access_codes c
set redeemed_session_id = s.id
from (
  select distinct on (access_code_id) access_code_id, id
  from public.navigator_paid_sessions
  where access_code_id is not null
  order by access_code_id, issued_at, id
) s
where s.access_code_id = c.id
  and c.redeemed_session_id is null
  and c.used_at is not null;

commit;
