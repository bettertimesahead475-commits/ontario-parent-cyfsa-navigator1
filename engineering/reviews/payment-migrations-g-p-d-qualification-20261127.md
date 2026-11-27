# Payment migrations G, P, D: qualification evidence (2026-11-27)

Disposable PostgreSQL 16 + real PostgREST v12.2.3 (sha256 verified), built to the live nxfh payment schema
(`tests/devin/fixtures/live-nxfh-payment-schema.sql`), synthetic records only. No hosted database was read or changed.

## Results: 80/80 across five suites

| Suite | Covers |
|---|---|
| `tests/devin/payment-migrations-g-p-d.pg.test.ts` (8) | G/P/D preflights, reapplication, interrupted application, P under an in-flight redemption (waits; with `lock_timeout` fails cleanly), existing entitlements unchanged, grants/RLS, D refused before P, full rollback D -> P -> G back to the exact live catalog and data, reapply after rollback |
| `tests/devin/payment-schema-qualification.pg.test.ts` (37) | Real handlers pre-P / post-P / post-P+D; now includes 5 approve-versus-refund races per schema |
| `tests/devin/payment-old-app-compat.pg.test.ts` (10) | Production handlers (82dfe65) on live, G, G+P, G+P+D |
| `tests/devin/s34-one-redemption-migration.pg.test.ts`, `etransfer-claim-recovery.pg.test.ts` (25) | D apply/rollback/preflight, concurrent duplicate redemption; activation interruption/recovery |

## Defect found and fixed: approval racing a refund

`approvePayment` never read the refund record. A refund landing while approval was inserting its code (or a refund
recorded and then interrupted before cancelling) left a working code on a refunded order. Now approval refuses a
refunded order before it changes anything, and re-checks after inserting the code (cancelling it; fail-closed when the
history cannot be read), mirroring `reissueCode`. Without the fix 4 of the 5 new race tests fail per schema.

## Production finding (pre-existing, not caused by G/P/D)

The production handler (82dfe65) on the pre-P schema refunds an activated order by reading `redeemed_session_id`:
the refund is recorded, then fails `501 ADMIN_SCHEMA_UNAVAILABLE`, and the customer keeps access. It works once P is
applied, and the release branch handles pre-P. So with the old app, G must not ship without P if refunds of activated
orders are expected.

## Rollback and recovery

- G: `payments_service_role_review_update.rollback.sql`, restores the exact grants; safe any time.
- D: `access_codes_one_redemption_per_reference.rollback.sql`, restores P's function exactly; no data loss.
- P: new `preserve_monthly_renewal_P.rollback.sql` restores the captured live function (self-verifies md5 ca9f13a8)
  and drops the column. It refuses while D is installed or once any renewal links a code (`redeemed_session_id` set):
  after customers renew, use forward repair, never this rollback. New read-only `preserve_monthly_renewal_P.preflight.sql`.
- P takes an ACCESS EXCLUSIVE lock on `access_codes`; run it with `set lock_timeout` and retry, not during traffic peaks.

## Order

G (any time before live e-Transfer approval; with the old app, together with P) -> P -> D. D refuses to run before P.
Live execution still needs written owner approval and a verified backup; not done here.
