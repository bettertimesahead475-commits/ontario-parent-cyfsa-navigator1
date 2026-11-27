# Consolidated release approval checklist (RC 2026-11-27)

Prepared read-only on 2026-11-27. **Not ready to request execution approval**: items 1 and 5 are open.
Nothing has been migrated, deployed, sent or spent. Live checks were aggregate-only.

## 1. Exact release commit: NOT FROZEN

- `release/rc-20261127` head is `4c73750`. CI passed except the obsolete Vercel checks.
- These must be merged into the RC (or explicitly excluded), then the head frozen and re-tested:

| PR | Content | Needed because |
|---|---|---|
| [#187](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/187) | P package, execution sequence, Sonar rollback exclusion | P rollback/postcheck |
| [#189](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/189) | Register entry G and harness results | Register (merged into #187 already) |
| [#188](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/188) (via #171) | Pre-P fail-closed My Orders/refund; reissue-vs-refund race; G files | Payment integrity |
| [#185](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/185) (via #171) | e-Transfer checkout shows server `payTo` | Payment copy |
| [#174](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/174) | 429 vs 503 rate-limit responses, C files | Migration C |

- Out of this release: #181 / Migration E (feature).
- The production rollback target is `0cc59589` (`82dfe65`), the deployment live today. The RC doc's `4c902955` is the deployment before that.

## 2. Migration dependencies and compatibility

The sequence and gates are in `MIGRATION_RELEASE_REGISTER.md` (execution sequence): A/B ratify → backup → G → P → D → C (flag off) → F → deploy.

Live state (read-only, 2026-11-27):

| Check | Value |
|---|---|
| Latest migration | `20261127163309` (B) |
| P column `redeemed_session_id` | absent; live RPC `md5(prosrc)` = `ca9f13a8…` |
| D index, C table and function, F outbox | absent |
| `service_role` `UPDATE` on `payments` | **false**, so admin approve gets 502 today (G fixes it) |
| `payments` | 2 rows, both pending; 0 approved |
| `access_codes` | 0 rows |
| Active paid sessions | 0 |

- Steps G–F are compatible with the code live today (`82dfe65`), so the app can be rolled back without rolling back the database.
- The RC payment routes need P: before P, claim returns 503 and writes nothing (#188 harness).

## 3. Backup and recovery procedure: NOT VERIFIED

- Supabase org `CYFSA PARENTS PLATFORM` is on the **Free plan**, which has no scheduled backups and no PITR (Supabase docs, "Database Backups").
- Zero-cost procedure: immediately before step 2, run `supabase db dump --db-url <connection string> -f schema.sql`. Then run it again with `--data-only -f data.sql`. Store both off-site.
  - The connection string includes the database password, which engineering does not hold.
  - The owner runs the dump, or provides the string for that session only.
- Restore test: load both files into a disposable PostgreSQL and compare table counts. Customer rows never leave the owner's storage.
- Paid alternative: Pro plan ($25/month) gives daily backups, and PITR is an extra add-on. This is spending and needs owner approval.
- Each migration also has a tested rollback script (register).

## 4. Payment activation and refund integrity

#188 harness: the real handlers run through the real PostgREST against disposable PostgreSQL with the live schema. 27/27 pass. Claude has not yet re-qualified.

| Scenario | Result |
|---|---|
| Before P | Claim 503, nothing written. #188 fixes My Orders listing and refund of an activated order |
| P | 1 activation from 5 concurrent claims. Approve-versus-claim and 3 interruption points each end with 1 entitlement. A monthly renewal extends one entitlement by 30 days |
| P + D | A second code of one payment is refused (`ORDER_ALREADY_ACTIVATED`) |
| Refund versus reissue | A reissued code on a refunded order is cancelled (409 `PAYMENT_REFUNDED`) |
| G | Without G, approve gets 502 and issues nothing. With G, approve, reissue and refund work |
| Not covered | Approve versus refund of the same pending order |

- The top-up `granted_credits` refund only matters with E, which is out of this release.
- All 8 package prices match across the server, pricing page, e-Transfer instructions and claim amounts (#179).

## 5. Independent qualification results: OPEN

| Item | Claude result |
|---|---|
| #171 payments | At `282789b`: blockers D-1..D-4. #188 answers them; re-qualification pending |
| P / execution sequence (#187), register (#180, #189) | pending |
| D (#175), F (#182), G (#188), C and T-05 (#168 `5f57810`, #174) | pending |
| A/B authorization and integrity | pending |
| #164 audit remediation, #176, #178 | pending |

Devin-side evidence: disposable-PG suites for P (7/7), D, E, F and the harness (27/27), plus full Vitest on this branch (`23217bd` + register merge): 5,318 passed, 0 failed, 461 skipped. It must be re-run on the frozen head.

## 6. Production rollback procedure

Rollback compatibility at every intermediate state, after customer transactions: `engineering/reviews/rollback-compatibility-matrix-20261127.md`. Roll back the app first. G, C and D are reversible. P is reversible only with no renewal links. F needs unsent rows exported first. E is forward-fix only.

1. App: `POST /accounts/6dea4d69…/pages/projects/cyfsa-navigator-git-staging/deployments/0cc59589-2be1-43d9-b41f-ff0c0c048792/rollback`. Takes effect in seconds; no DB change needed (item 2).
2. Database, only if a migration itself is faulty: run the rollbacks in reverse order, F, C, D, P, G, each with its own script and guards. Never run `free_scan_reservation_functions.down.sql`.
3. Data loss, last resort: the site keeps taking orders, sign-ups and analyses after the dump, so a full restore would discard them.
   - Prefer the per-migration rollback, or a targeted repair of the damaged table from the dump.
   - If a full restore is unavoidable:
     1. Roll back the app to `0cc59589` and record the time.
     2. Export every row with a created/updated time after the dump's start from `payments`, `access_codes`, `navigator_paid_sessions`, the credit ledger and analyzer job tables (to owner storage).
     3. Restore, then re-insert those rows. A later write wins over the dump.
     4. Check `payments` and active-session counts against the export.
4. Record the rollback in `SESSION_HANDOFF.md`.

## 7. Expected downtime

None expected.

- Each migration runs in one short transaction on tiny tables (0 access codes, 2 payments).
- P and P's rollback briefly lock `access_codes` (`ACCESS EXCLUSIVE`). For well under a second, code activation waits instead of failing.
- The Cloudflare deployment switches atomically.
- The only path with downtime is a restore from the dump.

## 8. Final acceptance-testing costs

| Part | Cost |
|---|---|
| Migrations, deployment, smoke checks (`RELEASE_CHECKLIST` step 9: health, status, CSP, sign-in, synthetic extraction, admin 401) | **$0** |
| Minimum paid acceptance on production (test account, synthetic documents): 1 Quick, 1 Forensic (3 pages), 1 Final Case Assessment | **≈ $0.95** estimate ($0.10 + $0.45 + $0.40, `live-acceptance-plan-5usd.md`) |
| Full plan (7 runs + 1 contingency) | **≤ $4.10** cap; stop at $4.00 |

- Exact cost is only known after the runs: provider tokens vary with output.
- The control is a hard cap. Every run's tokens and cost go in `TEST_REGISTER.md`.
- The performance study's estimates are higher (Quick ≈ $0.22, Forensic ≈ $1.25 per 10k tokens), so the cap, not the estimate, is binding.
- Authorized budget remaining is about $0.40. Any paid acceptance needs a new owner amount.
- The plan's Preview step no longer applies: Preview stays not-ready.

## Owner approvals (one sign-off once items 1 and 5 close)

- [ ] Ratify A/B.
- [ ] Provide or run the database dump (item 3).
- [ ] Execute steps 2–6 (G, P, D, C flag off, F).
- [ ] Deploy the frozen commit (step 7).
- [ ] Paid acceptance amount: $0, $0.95 or up to $4.10.
