# S-34 database-level protection: one redemption per payment reference (Migration D)

Owner (2026-11-27): S-34 is a confirmed commercial release blocker. The application-level repair is on PR #171
(`claim__<ref>` permanent lock, shared reissue lock, post-redeem expiry of other unused codes). This document covers the
permanent database-level protection, prepared as a **pending migration: not applied anywhere except disposable PostgreSQL**.

Files (all under `supabase/migrations_pending_approval/`):
- `access_codes_one_redemption_per_reference.sql`: the migration
- `access_codes_one_redemption_per_reference.rollback.sql`: rollback
- `access_codes_one_redemption_per_reference.preflight.sql`: read-only preflight
- Tests: `tests/devin/s34-one-redemption-migration.pg.test.ts` (disposable PostgreSQL 16, own throwaway database)

## What D changes

1. `redeem_access_code_atomic(text, text, text)`: after the existing row lock, tier and expiry checks, the function takes a
   transaction advisory lock on the code's payment reference (`navigator-reference:<REF>`). If another code with the same
   reference is already redeemed, it retires the presented code (`expires_at = now()`) and:
   - for the **same account** with a live entitlement from that reference, returns `reused` with that session (idempotent: no new access);
   - otherwise returns `consumed` / `ORDER_ALREADY_ACTIVATED`.
   Everything else is byte-identical to the live `20261110004740_preserve_monthly_renewal.sql`, including the renewal path.
   Lock order is always code row, then reference, then renewal (`navigator-renewal:<uid>:<tier>`), so no new deadlock.
2. A partial unique index `access_codes_one_redemption_per_reference` on `upper(btrim(reference_number))` where
   `used_at is not null` and the reference is non-empty. This is the backstop against any other writer.

Codes without a reference (manual or legacy) are unaffected. A monthly renewal is a new payment with a new reference, so it still adds 30 days.

## How each owner requirement is met (all checked in the pg test)

| Requirement | Evidence |
|---|---|
| One verified payment, exactly one activation | Eight codes of one reference redeemed in 8 concurrent transactions give 1 `activated` and 7 `reused` (same session). That leaves 1 session, 1 used code and 0 usable codes. The test checks that 7 transactions really waited on the lock |
| Concurrent claims across minute boundaries | The database check does not depend on time or locks in the app. It is the same test as the row above |
| Customer claim and admin reissue share the protection | Both paths redeem through the same RPC, and the index blocks any direct second `used_at` write |
| Failed or interrupted claims stay recoverable | A redemption rolled back mid-transaction leaves nothing. An expired code is refused, and a reissued code then activates |
| Legitimate monthly renewals | A Pro renewal with a new reference adds 30 days. Two more payments redeemed concurrently add 60 days. Two codes of one payment add 30 days once |
| Duplicates add no access | The same code sent 6 times at once activates once and returns the same session 5 times |
| Existing entitlements not silently reduced | D never updates existing sessions or codes. If any reference already has two used codes, D raises an error and changes nothing; the test checks the function, index and sessions are unchanged |
| Another account cannot use a second code | It gets `consumed` / `ORDER_ALREADY_ACTIVATED` and no session |

Baseline test: before D, two codes of one reference both activate, giving two entitlements. With D's check and index removed, 6 of the 11 tests fail.

## Migration plan entry: D, `access_codes_one_redemption_per_reference.sql`

Placed after A (`free_scan_reservation_functions.sql`, applied), B (`reconcile_skip_live_analyzer_jobs.sql`, applied) and C
(`create_navigator_rate_limit_hits.sql`, pending). It does not depend on C.

| | D: `supabase/migrations_pending_approval/access_codes_one_redemption_per_reference.sql` |
|---|---|
| Target | `nxfhvebzzobegubefcda` (the live Pages ledger). Not `qboidsfpjuxeqtfotryj` |
| Objects | New partial unique index `public.access_codes_one_redemption_per_reference`; replaces `public.redeem_access_code_atomic(text, text, text)` (same signature and grants: `service_role` only) |
| Existing objects touched | `redeem_access_code_atomic` body only. No row is updated or deleted |
| Prerequisites | 1. Owner written approval. 2. Claude qualification (below). 3. Supabase backup or PITR confirmed. 4. **Read-only preflight**: every `blocking` row must be `ok = true`. In particular, the live RPC fingerprint must be `b835b252c9d2b97413e43271c712e5ce` (= `20261110004740`); otherwise the rollback would not restore the live version, so stop and re-baseline. 5. Duplicate references (if any) resolved by the owner, never automatically. 6. Apply on a preview or disposable DB first |
| Read-only preflight | `access_codes_one_redemption_per_reference.preflight.sql` (runs as `begin transaction read only` … `rollback`). It reports required columns, references with more than one used code, the live RPC fingerprint, whether D is already applied, the index size and the number of unused codes of already-activated references (D will refuse those) |
| Apply order | Preflight → D (single transaction; the index build briefly locks `access_codes`, which is small) → re-run preflight (index row now `false` = applied) → smoke test: a synthetic code redeemed twice in preview |
| App compatibility | No app change is required. `claim-purchase` and `activate-code` already treat `reused` as success. A `consumed` from D surfaces as the existing "already used" or "activation failed / contact support" answer. Optional follow-up for the lead: map `ORDER_ALREADY_ACTIVATED` in `claim-purchase` to the existing `restore()` path |
| Customer impact | None for normal purchases and renewals. A customer holding a second code (for example an admin code) for an already-activated order gets their existing entitlement back (same account) or "already used" (other account), instead of a second entitlement |
| Rollback order | `access_codes_one_redemption_per_reference.rollback.sql` (drops the index and restores the exact `20261110004740` RPC; tested, fingerprint checked). No data to restore. The app-level S-34 repair on #171 stays in force |

## Claude handoff: please qualify independently
1. Migration D SQL: the advisory-lock ordering, the `READ COMMITTED` visibility of the `v_other` check after the lock,
   `security definer` + `search_path`, the grants, the partial-index predicate matching the RPC's normalisation, and the
   duplicate guard (raises and changes nothing).
2. Rollback: confirm it equals `supabase/migrations/20261110004740_preserve_monthly_renewal.sql` (function part).
3. Preflight: confirm it is read-only and that its checks are sufficient for the owner's go/no-go.
4. The completed payment implementation on #171 (`functions/api/claim-purchase.ts`, `my-payments.ts`,
   `_customer-payments.ts`, `request-access.ts`, admin approve/reissue/refund in `functions/api/admin/[[path]].ts`), against
   the owner's statement: "Ensure customer-submitted payment references or emails cannot independently trigger
   entitlement activation without verified receipt of funds." Start from `engineering/security/S-34-etransfer-claim-race.md`.
5. Run `CREDIT_PG_URL=… npx vitest run tests/devin/s34-one-redemption-migration.pg.test.ts tests/security`, and say whether
   the tests prove the requirements in the table above or need more cases.
