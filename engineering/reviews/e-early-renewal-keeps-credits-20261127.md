# Migration E: an early one-off re-purchase keeps unused analyses (2026-11-27, Agent A)

Assigned by the #171 owner (b3e6cd58). Owner directive: "Support legitimate early renewals without forfeiting existing
unused entitlements." **Not applied anywhere** except the disposable PostgreSQL in the test.

## Defect today (P + D)
A customer with an active Premium (5) or Basic (3) pack who pays again receives a second session. Analyses are counted
per session (`paid_session_<id>_total`), so the first pack's unused analyses are stranded on a session the customer
no longer uses. The UI blocks an early Premium re-purchase for this reason; it must keep blocking it until E is applied.

## What E changes
- `navigator_paid_sessions.granted_credits integer` (nullable, `> 0`; null = tier default). Existing rows stay null.
- `redeem_access_code_atomic` = D's version plus one block. When a one-off pack (`Basic`, `AnalyzerBasic`,
  `Premium`, `AnalyzerPremium`) is redeemed while the same account has an active session of that exact tier, the
  session gets `granted_credits = coalesce(granted_credits, pack) + pack` and 30 more days. The RPC returns that
  existing session id. It uses the same renewal lock and row choice as the monthly path. D's per-reference guard runs
  first, so a second code of the same payment adds nothing.
- `paid_reserve_credit` keeps its signature. The original body is renamed to `paid_reserve_credit_tier_default`, and
  a thin wrapper passes `greatest(p_granted, granted_credits)` for the `total` scope. It never lowers an allowance.
  **No application change is needed for enforcement, before or after E.**
- Tier aliases are distinct: an `AnalyzerPremium` code while a `Premium` session is active still mints a new session.

## Tests (`tests/devin/early-renewal-credits-migration.pg.test.ts`, disposable PG 16): 12 passed
Covered: the baseline defect, a read-only preflight, refusal without D, a clean and re-runnable apply, and grants
(service_role only). Premium with 2 used then re-purchased leaves 8 left. Basic gives 3 + 3. Two payments redeemed
concurrently give 15 analyses and +60 days in one session. D still holds. An expired or revoked pack, or a different
tier, gets a new session. Monthly tiers are unchanged. The wrapper never lowers an allowance. The rollback guard and
the exact rollback are tested.
Mutations each make tests fail: wrapper without `granted_credits` (2 fail), no one-off block (5 fail), rollback without
its guard (1 fails).

## Migration plan entry: E, `paid_sessions_early_renewal_keeps_credits.sql`

| Item | Detail |
|---|---|
| Files | `supabase/migrations_pending_approval/paid_sessions_early_renewal_keeps_credits.sql`, `.rollback.sql`, `.preflight.sql` |
| Depends on | **P** → **D** → `paid_credit_reservation_functions.sql` (not listed in the register yet; confirm whether it is live) |
| Prerequisites | 1. Owner written approval. 2. Claude qualification. 3. Backup or PITR confirmed. 4. **Read-only preflight**: every blocking row `ok = true`. The live `redeem_access_code_atomic` must equal D (`76dd0fe56ba742c3f50fbfef7dcfa536`) and the live `paid_reserve_credit` must equal `paid_credit_reservation_functions.sql` (`b79c9a9d06a0375c8ab0036711e17c50`); otherwise stop and re-baseline. 5. Apply on a preview or disposable DB first |
| Apply order | After D, in one transaction (the file has `begin`/`commit`). It raises and changes nothing if D or `paid_reserve_credit` is missing |
| Rollback order | Before D's rollback. It refuses while any active session has `granted_credits`, because those customers would silently drop to the tier default. The owner can accept that knowingly with `set navigator.allow_credit_reduction = 'on'`. It restores D's RPC and the original `paid_reserve_credit` exactly, and drops the column |
| Customer impact | No existing row changes. After E, an early re-purchase of the same one-off pack keeps the unused analyses and extends access by 30 days. Monthly tiers and codes without a reference are unchanged |

## Application follow-ups that must ship with or after E (not in this PR)
- Usage display: `functions/api/analyzer-usage.ts:84` and `functions/api/admin/[[path]].ts:128` show `LIMITS[tier]`.
  After E they should show `granted_credits ?? LIMITS[tier]`. Their selects can only add `granted_credits` once E is
  live (PostgREST rejects unknown columns).
- Pricing UI: allow an early re-purchase of the same one-off pack only after E is applied.

## Claude handoff: please qualify independently
1. Lock order: code row → reference lock (D) → renewal lock → session row; the reserve wrapper reads the session
   outside the per-session lock (a concurrent top-up can only cause a transient `limit`, never an extra analysis).
2. The wrapper (`language sql`, security invoker) and the rename keep grants: service_role only.
3. Rollback equality with D and with `paid_credit_reservation_functions.sql` (fingerprints above).
4. Whether +30 days from the current expiry is the intended one-off extension, and exact-tier matching for aliases.
