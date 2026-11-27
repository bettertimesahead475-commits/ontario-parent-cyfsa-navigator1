# Payment-schema qualification: real PostgreSQL + real PostgREST (Claude D-1 to D-4)

Branch `devin/1795807524-live-schema-harness`, into `devin/1795800106-etransfer-payments` (PR #171, base head `1773183`).
Answers Claude's PR #171 review (comment 7226489336). Disposable PostgreSQL 16 and PostgREST 12.2.3 only. Nothing was
applied to or written on any hosted database; the live facts below come from read-only catalog queries on
`nxfhvebzzobegubefcda` (no customer rows read).

## Harness

- `tests/devin/fixtures/live-nxfh-payment-schema.sql`: the live payment tables (`payments`, `access_codes`,
  `navigator_paid_sessions`) with their live columns, constraints, indexes, RLS (enabled, no policies) and grants, and
  the live `redeem_access_code_atomic` (the test asserts `md5(prosrc) = ca9f13a85933345f0dfede3b1ab2975e`, the live value).
  `access_codes.redeemed_session_id` is absent, as on live.
- `tests/devin/helpers/postgrest-harness.ts`: creates a throwaway database, starts the real PostgREST binary against it
  (JWT role `service_role`), and routes the handlers' `/rest/v1/*` calls to it. `/storage/v1/*` (audit records and
  create-once locks) goes to an in-memory double. Hooks pause or fail a named request to force interleavings.
- `tests/devin/payment-schema-qualification.pg.test.ts`: drives the real `functions/api/claim-purchase.ts`,
  `my-payments.ts`, `activate-code.ts` and admin approve/reissue/refund (`functions/api/admin/[[path]].ts`). Only
  Firebase verification is stubbed. Migrations P, G and D are applied by file from the repo, followed by a PostgREST
  schema reload.
- Skips cleanly unless `CREDIT_PG_URL` is set and a PostgREST binary is found (`POSTGREST_BIN`, `~/tools/postgrest`,
  `/usr/local/bin/postgrest`). CI downloads the pinned, checksummed free binary into the existing `test` job (no new job,
  no paid service).

## New finding G: admin approval and refund of a pending order are refused on live today

Live `service_role` has `SELECT, INSERT` on `public.payments` and no `UPDATE` (table or column; read-only check
2026-11-27). Approval and pending-order refund both `PATCH payments`, so on the live grants the harness gets
**502 `ADMIN_STORE_REJECTED`** and the payment stays `pending` with no code issued. Nothing is granted twice; access is
simply never issued. Pending package (not applied):
`supabase/migrations_pending_approval/payments_service_role_review_update.sql` grants `UPDATE (status, approved_at)`
only, with `.rollback.sql` and a read-only `.preflight.sql`. Independent of P; must precede any live e-Transfer sale.

## Results (32 of 32 pass locally, 2026-11-27)

### Pre-P (live baseline)

| Scenario | Today (base `1773183`) | After this branch |
|---|---|---|
| Admin approve on live grants | 502 `ADMIN_STORE_REJECTED`, nothing issued | same (needs G) ; with G: 200 and one code |
| G least privilege (ported from #190) | n/a | service_role may UPDATE only `status`, `approved_at`; no DELETE; anon/authenticated have no SELECT/INSERT/UPDATE/DELETE; PostgREST refuses PATCH of `amount`/`plan`/`firebase_uid` and anon/authenticated PATCH/DELETE; a customer claim leaves a pending order pending. Fails if G is widened (table-wide, `authenticated`, extra column, DELETE) |
| `claim-purchase` (D-1) | **503 `ACTIVATION_UNAVAILABLE`** "Activation is temporarily unavailable. Please try again." No code, no session | unchanged (already fail-closed, never 500) |
| My Orders (`my-payments`) | **503 `PAYMENT_STATUS_UNAVAILABLE`**: no orders listed | 200, all orders listed, `accessActive` omitted |
| Refund of an activated order | **501 `ADMIN_SCHEMA_UNAVAILABLE`**: entitlement not revoked | 200, one entitlement revoked, later claim 409 |
| Refund of an unpaid order (with G) | 200, cancelled | 200, cancelled |
| Reissue before redemption | 200; old code refused, new activates once | same |
| Approve -> activate-code, repeat, claim, reissue | 1 entitlement; claim 503; reissue `CODE_ALREADY_REDEEMED` | same |
| Monthly renewal (D-2) | two overlapping `Pro` entitlements | same: **P is required** |

### Post-P and post-P+D (each scenario runs on both)

| Scenario | P | P + D |
|---|---|---|
| 5 concurrent claims | 1 activation, the rest 409 `ACTIVATION_IN_PROGRESS` or a restore of the same entitlement | same |
| Two live codes of one payment redeemed in parallel (S-34 at the DB) | **both activate** (2 entitlements) | second refused `ORDER_ALREADY_ACTIVATED`, 1 entitlement |
| Approve versus claim (approval paused mid-issue) | 1 entitlement; the approval code is withheld | same |
| Approve then claim | claim retires the e-mailed code; 1 used code | same |
| Interrupted after the code insert | 503, retry activates once | same |
| Interrupted after the RPC committed (response lost) | 503, retry restores the same entitlement | same |
| Interrupted before the refund-history check | 503 with the code kept, retry activates once | same |
| Refund versus reissue (reissue paused mid-issue) | **base: the reissued code activated a refunded order**; now 409 `PAYMENT_REFUNDED`, code cancelled, 0 entitlements | same |
| Approve versus refund, refund lands while approval issues its code | **base: approval returned a working code for the refunded order**; now 409 `PAYMENT_REFUNDED`, code cancelled, 0 entitlements, claim `ORDER_CLOSED` | same |
| Approve versus refund, approval lands while the refund runs | the refund retires the approval code; 0 entitlements, claim `ORDER_CLOSED` | same |
| Monthly renewal (new verified payment) | one entitlement extended by 30 days; refund takes the 30 days back | same |
| No overlapping entitlements (checked after every test) | holds, except the documented no-D S-34 case | holds |

## Application repairs (3 files)

- `functions/api/_customer-payments.ts`: `codesWithLinks` reads codes without `redeemed_session_id` when PostgREST
  reports the column missing (`42703`) and returns `linked: false`.
- `functions/api/my-payments.ts`: uses it; `accessActive` is omitted when unlinked, never guessed.
- `functions/api/admin/[[path]].ts`: (a) the refund's renewal lookup uses `restOptional` (no renewal links exist
  before P); (b) reissue re-reads the refund history after inserting the code and cancels that code (409
  `PAYMENT_REFUNDED`, or 503 if the history is unreadable). The refund writes its record before retiring codes, so the
  post-insert check closes the race.

With these three changes reverted, exactly 5 tests fail (My Orders x2, refund of an activated order, refund versus
reissue on P and on P+D). Type check clean; `tests/devin/etransfer*`, `api`, `functions`, `src/lib`: 4045 passed,
461 skipped.

## Not covered / open

- Approve versus refund of the same pending order is now covered. Approval gained the same post-insert refund check
  as reissue; with it reverted, the first of the two tests fails on P and on P+D. In the second order the payment
  stays `approved` with the refund recorded; the refund audit record is what closes the order.
- E (early one-off renewal) is outside this harness; its refund accounting is the next task.

## For Claude (independent qualification)

Re-run: `CREDIT_PG_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres POSTGREST_BIN=/path/to/postgrest npx vitest run tests/devin/payment-schema-qualification.pg.test.ts`.
Check: (1) the fixture against the live catalog facts above; (2) that only Firebase is stubbed; (3) each D-1 to D-4
claim against the tables; (4) the reverted-repair run fails as stated; (5) G's grant is the minimum needed.
