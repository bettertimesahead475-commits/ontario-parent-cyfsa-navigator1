# Database migration release register (A–G, P) — authoritative

This is the one register for A–G and P. Edited only by the register session (Devin Boards "Consolidate migration register");
other sessions (A/B incident, backup/restore, payments G/P/D, E, free counters, F, C, lead engineer T-05) send their results to it.
Last verified: 2026-11-27 ~21:00 UTC. Repo state verified: `release/rc-20261127` `dd02ef3` + #187 (`516b6aa` local merge).
**This is the single authoritative register.** [#187](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/187) no longer edits it (reverted at `063d30b` after the Chief of Staff confirmed #195 at `d322c68` carries all of #187's register content). The P package files it cites (`preserve_monthly_renewal_P.*`, `migration-p-preserve-monthly-renewal.pg.test.ts`) land with #187, and the #198/#199/#200/#202/#211 artifacts with those PRs; this register adds no SQL.

**Rules:** nothing is applied without the owner's written approval and Claude's qualification of that entry. Take a backup first
(Free plan: no PITR; none was taken for A/B). Every SQL file runs first on disposable PostgreSQL only. Never weaken grants or RLS.

## Status key

- **PASS**: the evidence named in the row exists and was reproduced; this is not an approval to apply.
- **FAIL**: a test or check fails today.
- **BLOCKED**: cannot proceed until the named prerequisite or owner decision.
- **PENDING**: evidence or decision still to come; nothing known to be wrong.

## Authoritative status (2026-11-27)

| ID | Live on `nxfhvebzzobegubefcda` | Disposable PG (this register, `516b6aa`) | Claude qualification | Owner approval | Overall | Next action / owner |
|---|---|---|---|---|---|---|
| A | Applied `20261127163256` without snapshot; per #164 evidence from audited SQL `0888970` (`left(uid, length(lo)) = lo`) | Audited `0888970`: **PASS** own `.test.sql` + re-apply on `en_US.utf8` and `C`. Release-branch file (`dd02ef3`): **FAIL** on `en_US.utf8` (range matcher). [#199](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/199) restores the audited matcher: 22/22 under `C` and `en_US.utf8` on PG 16 and 17 (originals 18/22 under `en_US.utf8`) | PENDING | **BLOCKED** (ratify, incident) | **BLOCKED** on owner ratification | Owner Supabase sign-in: confirm live SQL and collation, capture replaced definitions and grants (#199); merge #199 before any re-apply |
| B | Applied `20261127163309` without snapshot | [#199](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/199): audited matcher restored in B and its rollback; 22/22 under `C` and `en_US.utf8` on PG 16 and 17 (A+B suite) | PENDING | **BLOCKED** (ratify, incident) | **BLOCKED** on owner ratification | Same live check as A; snapshot incident stays open |
| P | Not applied (drift: in `supabase/migrations/`, absent from live history) | **PASS** 7/7 here; harness 27/27; [#200](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/200): G+P+D 81 tests PASS on disposable PG with real PostgREST, approve-vs-refund race fixed, P rollback and preflight added | PENDING | PENDING | **PENDING** | Merge #200; apply in the same window as G (step 2), after backup |
| G | Not applied; live `service_role` has no `UPDATE` on `payments` | **PASS** harness 27/27, 14/14 e-Transfer recovery; [#200](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/200) (81 tests) | PENDING | PENDING | **PENDING**; never alone | Ship with P: on today's pre-P schema, production app `82dfe65` refunding an activated order records the refund, fails 501 and the customer keeps access (#200) |
| D | Not applied; live preflight fails 2 blocking checks (needs P) | **PASS** 11/11 here; [#200](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/200) (81 tests) | PENDING | PENDING | **BLOCKED** on P | Apply only after P postcheck `ok` |
| C | Not applied (table/function absent) | **PASS** 7/7 here (`rate-limit-migration.pg.test.ts`); **PASS** 32/32 in [#198](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/198) (head `85ee557`, PG 16 + PostgREST 12.2.3): concurrency over 40 connections, concurrent pruning with 0 deadlocks, interrupted transactions, re-apply, RLS/grants (`service_role` execute-only), constraints, customer-table preservation, old/new app before/after apply and after rollback. Read-only preflight/post-apply SQL added in #198 | PENDING | PENDING | **PENDING** | Merge #198; apply with `PERSISTENT_RATE_LIMITS` unset; preflight checksum per #198 |
| F | Not applied | **PASS** `create_transactional_email_outbox.test.sh` (preflight, migrate, re-run, rollback, re-apply); #193: 8/8 `transactional-email-outbox.pg.test.ts` on PG 17 + PostgREST incl. old build `82dfe65` | PENDING | PENDING | **BLOCKED** for live email. Both #193 blockers fixed in [#211](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/211) (head `ece34cf`, stacked on #193): checkout retry or the admin email drain now queues any missing payment, approval or refund email; `.down.sql` refuses while the outbox has rows. 119 outbox + 250 security tests PASS on disposable PG; old build compatible. Limit: an access-code email never queued can't be rebuilt from its hash (operator uses manual reissue) | Backend review of #211, live F preflight, written owner authorization; schema-only apply with no sends stays PENDING |
| Free Quick/Forensic counters (uses A/B; no new migration) | A/B live | **PASS** ledger on PG 14 ([#192](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/192)): preservation, concurrency, restoration, interruption, RLS, A→B re-apply, backup/restore | PENDING | PENDING | **BLOCKED**: 3 reproduced failures: A re-applied alone drops B's guard; old Pages build over-grants free Quick; old worker cannot settle new Forensic markers | Worker-first cutover gate in #192; owner authorization |
| E | Not applied | Release-branch SQL: **FAIL** ([#197](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/197)). Combined [#200](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/200) + [#202](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/202) (#202 head `8034750`: duplicate-restore 409 plus an old-app guard on stacked entitlements): **PASS** 432/432 on disposable PG + PostgREST (was 430/431 at `caa2368`), `tsc` 0, backup and forward-repair rehearsal PASS. Approval/refund after G/P/D/E (12 simultaneous pairs), restore lock contention, stacked renewal/refund accounting, interruption, entitlements, RLS, re-apply, rollback refusal all PASS. Mixed-version: **PASS (rejection only)** at `8034750`: `82dfe65` on the E schema now gets HTTP 502 `ADMIN_STORE_REJECTED` on a stacked refund (no receipt, keeps 10 credits and 60 days; retry sends the shortening to manual review) instead of the silent partial refund seen at `caa2368` (60→30 days, 10 credits kept). This is not mixed-version refund support | PENDING | PENDING | **BLOCKED**: deferred from production; not in this release (no additional features) | When scheduled: pause top-up, refund and manual-restore writes until the combined app serves all traffic (gate not rehearsed on Cloudflare); never roll back to `82dfe65` after top-ups exist |
| Spending-reservation / refund ledger | No currency spend reservations exist: analysis units go through `free_usage`, inference cost is telemetry only. Gap: refund and settlement history is written to Storage non-atomically (read, then append) | — | — | — | **BLOCKED** pending the Postgres refund/settlement ledger package (with a write-pause cutover), being drafted by the E session | E session: deliver the package for qualification |

**Release as a whole: BLOCKED** on owner decisions: (1) ratify A/B or recover their prior definitions, (2) A re-apply safety and the free-counter worker-first cutover (#192),
(3) a verified backup (step 1; procedure PASS in #196, owner to confirm Supabase PITR/backups), (4) written approval of steps 2–6, (5) before any live email: backend review and merge of F's fix (#211, on #193), a live F preflight and owner authorization. Claude qualification: **requested 2026-11-27** (owner handed Claude `engineering/handoffs/devin-migration-register-qualification-request-2026-11-27.md`), **verdict PENDING** for every entry.

Disposable run: `npx vitest run tests/devin/*.pg.test.ts api/services/*free*` on PostgreSQL 16 (`en_US.utf8`) + PostgREST 12.2.3
(CI-pinned checksum): 8 files, 100/100 passed. A's and F's SQL scripts were run with `psql` on the same server. Live state above comes from
the lead engineer's read-only check (2026-11-27 18:40 UTC); this session had no Supabase access and changed nothing.

## Deployment bindings (verified in Cloudflare, read-only, 2026-11-27)

Project names are misleading: everything live uses the Supabase project **named** `cyfsa-navigator-staging`.

| Cloudflare resource | Role | Supabase project it uses |
|---|---|---|
| Pages `cyfsa-navigator-git-staging`, production branch `migration/cloudflare-staging-20261029`, deployment `0cc59589-2be1-43d9-b41f-ff0c0c048792` (commit `82dfe65`) | Serves `cyfsanavigator.com`, `www.cyfsanavigator.com`, `cyfsa-navigator-git-staging.pages.dev` | `nxfhvebzzobegubefcda` (production and preview `STAGING_SUPABASE_URL`) |
| Pages `cyfsa-navigator-git-staging`, preview deployments | Every branch preview | `nxfhvebzzobegubefcda`: previews share the live ledger |
| Worker `cyfsa-analyzer-queue-consumer` (queue `cyfsa-staging-analyzer-jobs`) | Analyzer jobs | `nxfhvebzzobegubefcda` |
| Worker `cyfsa-production-analyzer-queue-consumer` | Analyzer flag off | `nxfhvebzzobegubefcda` |
| Pages `cyfsa-navigator-staging` | Unused | none (`https://unconfigured.invalid`) |

No Cloudflare resource binds to `qboidsfpjuxeqtfotryj`. Nothing in this register goes there until the owner resolves which project is production.

## Exact artifacts (SHA-256 of the file at `516b6aa`)

Live history versions are apply times, not filenames. Apply through Supabase `apply_migration` and record the new version here.

| ID | Forward file (`supabase/…`) | Version | SHA-256 (repo file) | Companion files (SHA-256) |
|---|---|---|---|---|
| A | `migrations_pending_approval/free_scan_reservation_functions.sql` | live `20261127163256` (from `0888970`, sha256 `89d5e381e00800e1b654130ec32a55b22de1df691f8c40b0d9fd955e619f6e9b`) | `95cdcb773313036b7aad972dc321480b2234c934bd507566d2739894f9d43b2c` | `free_scan_reservation_functions.test.sql` `d4f66dbf058dd00263ac40cc1889afde2bd7b9585769378a50f0ba194286faae`<br>`free_scan_reservation_functions.down.sql` `e01d92f439bd824d8d47a2e2ef313d0484827ffe8706c6fff77f94783a7e1d34` |
| B | `migrations_pending_approval/reconcile_skip_live_analyzer_jobs.sql` | live `20261127163309` | `6a97b17a03fa56f09c79a897383fcbfbf9f0cfcfaa4d6cd7cd57468e34dca3d5` | `reconcile_skip_live_analyzer_jobs.down.sql` `0dd1c212172bc09f0ae59e274d71f222b677714d71fe70052251059c62d71527` |
| P | `migrations/20261110004740_preserve_monthly_renewal.sql` | repo `20261110004740`; not in live history | `6916521f08840cad96ee69632c3b01b16728ae669b7d0e05cb001f17f375f1f9` | `preserve_monthly_renewal_P.preflight.sql` `227cdf76efb3b04c072f0f1483ac844cc8022348e269e3081913594a115031ce`<br>`preserve_monthly_renewal_P.postcheck.sql` `96545c506abce8efe490656b84ef123e6aebb2ed030ab129db3efda4c3c22e36`<br>`preserve_monthly_renewal_P.rollback.sql` `4de1a8a9036662fd86db60079648a64bd288f36ecca25cbd63822eaa61555e13`<br>`preserve_monthly_renewal_P.reapply_backfill.sql` `c0c4bc16eee85c5c77a008c4a0b8cb7b775dda0615088a08b13a464f55e1cfb1`<br>**#200 supersedes:** preflight `4392226b55d4fad621abe78451ca095ced48a241930cebd053865567e23759ae`, rollback `86e537154c859b1142e980598471d23c2e3723240e7ca914c9e9a3289024daf8`; use these once #200 merges |
| G | `migrations_pending_approval/payments_service_role_review_update.sql` | not applied | `6dd5117a4972ca63fe7feca0008ec2791a1dd09b9618e4f5d2fd430c88b684ce` | `payments_service_role_review_update.preflight.sql` `8d065f0cec27dfa2b16093c34ac07add3af58faa53704e81140fdd170a01ab59`<br>`payments_service_role_review_update.rollback.sql` `b3250e83c40d96b56b2477b0c37345c2bf045ea12038c81c27d35bbc1e9f2d0a` |
| D | `migrations_pending_approval/access_codes_one_redemption_per_reference.sql` | not applied | `f7087176c3f6cfba9343bd02019500e8825befffd1d2992b670b423507b680ae` | `access_codes_one_redemption_per_reference.preflight.sql` `12dcb26dfb9458bc146cfb86c74f22666e39ae046106966c14a9fe6871e1c06f`<br>`access_codes_one_redemption_per_reference.rollback.sql` `c7931ede4860bede7e60c742e845f03b94185a8ad7bcf4420713601d2c88b90d` |
| C | `migrations_pending_approval/create_navigator_rate_limit_hits.sql` | not applied | `3396742b16942a1a22ae0b8e35d28c9bdc7d9afe344fa5d17984c654048e29b2` | `rollback_navigator_rate_limit_hits.sql` `b9641e6d4ccd0894e96639774041905069209ace3568e1a9876b2a183564a43e` |
| F | `migrations_pending_approval/create_transactional_email_outbox.sql` | not applied | `8dda8b08d429741fd2f94bf9b3a330ace009fad346fcafc8d5e08c9fa91e3d8c` | `create_transactional_email_outbox.preflight.sql` `ff78d5317256ce0bca5255b3d150b27acc0dd6cb25feae976c317e0ae00fb340`<br>`create_transactional_email_outbox.down.sql` `56c1ec2034b8129ac4c49117542653cc21f2df9c79e66cad388888ea25b6e9f9` (#211 `ece34cf`: `fe4ceae6aaf4dcd47b2d1c292e00f5bc3f57f603677714932c63d481ad3100e4`)<br>`create_transactional_email_outbox.test.sh` (#211 `ece34cf`) `6a2dec25ed1d0e70768b02d8421d63470fd1975952300a159aa1d039b9f84a5b`<br>`create_transactional_email_outbox.test.sql` `86fa79d230e7525a3d6a6f3b39149ab203b5c15a9b7120bb30e227f21f872ea9` |
| E | `migrations_pending_approval/paid_sessions_early_renewal_keeps_credits.sql` | not applied (deferred) | Release branch `81d972ccf7347a9f48af17f2a434b622fb159c82603621321df725b6f516fe12` (FAIL, do not apply). #202 `8034750` (432/432, with old-app guard): `57f6fea9c42ddaa5677c7315e9deea8b210779cf93a25c3e95ec9b82b7319f73`; superseded `caa2368`: `80c7484bf4efa43a953a9c0c5ba472c26d05124f878e67f24fc26995ab3bbeef` | `paid_sessions_early_renewal_keeps_credits.preflight.sql` `a6e7a78af6d8d1c06d9a7407d4b9633df041a79ae1f2f076fac624e7cfaf90ac`<br>`paid_sessions_early_renewal_keeps_credits.rollback.sql` release branch `a676a05ef986edb6a349434f38a74e267ad0f6c30748d400eeb6e2f5930b0433`; #202 `8034750` `74aa1be7562f44d3ac7cc89d25b4acc7004ac55832ee0ce4916bf8d7d4732908` (refuses when refund receipts exist; superseded `caa2368` `6e02bb1b13fb742276de50b5bf5485f3d3b60fffa0e56a1d95ba043fbcc565c3`) |

Recompute before applying: `sha256sum <file>` must equal the forward value above, or this register is updated first.
**A:** the RC file differs from the audited SQL applied live (`0888970`). Never re-apply the `dd02ef3` file; re-apply only the audited matcher (`0888970`, or #199 once merged), and always A then B (#192: A alone drops B's live-job guard). `.down.sql` files of A, B and F must never run on live.

## Intended revisions vs #187's register

This register replaces #187's copy; these differences are deliberate, from later evidence:
- **G and P in one window** (step 2), both preflights first, G revoked directly if P does not commit: #200 showed `82dfe65` on G without P records an activated-order refund, returns 501 and leaves access. #187 had G and P as separate steps.
- **F is forward-repair only** (step 5): its `.down.sql` deletes delivery history and dedupe state (#193). #187 listed `.down.sql` as F's rollback.
- **Backup** (step 1): Supabase-managed PITR/backups on `nxfhvebzzobegubefcda` are **PENDING owner confirmation**; the register still assumes Free plan (none). #187 stated Free plan as fact.
- **E order**: writes-paused E, then the combined app (E row of the sequence), replacing #187's "deploy #181's handler first"; #187's #181 qualification gate is kept.
- Steps renumbered (G+P merged), so #187's step 7 is step 6 here.

## Dependencies (verified from the SQL)

- **D needs P**: D's preflight requires `access_codes.redeemed_session_id` and P's RPC (`md5(prosrc)` `b835b252…`).
- **P's rollback refuses while D's index exists**, so D is rolled back before P.
- **E needs D** and the combined #200+#202 app, which carries #181's handler (#202 is stacked on #181). That handler calls `paid_refund_one_off_pack` only once `granted_credits` exists; Claude must qualify #181 at `d51dea0` or later. Deferred; order is the E row of the execution sequence.
- **G, C, F** are independent of each other and of P/D; G must precede any live e-Transfer approval.
- **A, B** are live; production code calls A's functions, so they are kept, not rolled back.

## A/B: missing pre-migration snapshot

See `engineering/incidents/2026-11-27-migrations-a-b-applied-without-snapshot.md`. A and B were applied to `nxfhvebzzobegubefcda`
at 16:32:56 and 16:33:09 UTC with no snapshot and no capture of the prior function bodies. Consequences for this register:
- No restore point exists before A/B; the earliest backup will be the one taken in step 1.
- A's and B's `.down.sql` drop objects that production code (`82dfe65`) calls, and cannot restore unknown prior definitions: never run them on live.
- Forward repair is the only recovery path for A/B. The RC copy of A must be corrected to the audited predicate before it is ever re-applied.

## Qualification: real PostgreSQL + PostgREST harness ([#188](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/188))

Real handlers through the real PostgREST 12.2.3 binary on disposable PostgreSQL 16, with a live-schema baseline (`md5(prosrc) = ca9f13a8…`).
Only Firebase verification is stubbed. 27/27 pass locally; detail in `engineering/reviews/payment-schema-qualification-20261127.md`.
Claude has not yet re-qualified.

| Entry | Result |
|---|---|
| Baseline (today, before P) | Claim 503 `ACTIVATION_UNAVAILABLE`, nothing written. My Orders 503 and refund of an activated order 501 on #171 head `1773183`; #188 fixes both (orders listed without `accessActive`; refund revokes). Monthly renewal makes 2 overlapping entitlements |
| G | Without G: approve 502, nothing issued. With G: approve, reissue and refund work before P |
| P | 1 activation from 5 concurrent claims; approve versus claim, approve then claim, 3 interruption points (after code insert, after RPC, before refund history) all end with 1 entitlement; monthly renewal extends one entitlement by 30 days. Two live codes of one payment still both activate (S-34) |
| P + D | Same as P, and D refuses the second code (`ORDER_ALREADY_ACTIVATED`): 1 entitlement |
| Refund versus reissue (P and P + D) | On #171 head the reissued code activated a refunded order; #188 cancels it (409 `PAYMENT_REFUNDED`) |
| E | Disposable PG with P + D + E (`tests/devin/early-renewal-credits-migration.pg.test.ts`, 22/22 at `a7584d2`; 24/24 re-run at `516b6aa`): refund with analyses used, reserved, retried, concurrent (separate connections), successive refunds of both packs (access ends, overage counted once) and with other entitlements; a reservation racing a refund waits and gets `limit` (it got `reserved` before the wrapper fix). Not yet qualified by Claude |

## P: repo/live drift (new launch blocker for payments)

- **Code already expecting P:**
  - `functions/api/admin/[[path]].ts` (on `engineering/integration` and in production `82dfe65`) queries
    `access_codes?select=id&redeemed_session_id=eq.…`. On live, PostgREST rejects an unknown column with HTTP 400.
  - PR #171 also selects `redeemed_session_id` in `_customer-payments.ts`, which `claim-purchase.ts` and `my-payments.ts` use.
  - Those payment paths fail on live until P is applied.
- **Customer data today:** `access_codes` has 0 rows and `navigator_paid_sessions` has 5. Applying P adds a nullable column and
  replaces the RPC; no row changes.
- **What P does:** `add column if not exists redeemed_session_id uuid references navigator_paid_sessions(id)` and
  `create or replace redeem_access_code_atomic(text,text,text)`, which adds 30 days on a monthly renewal instead of replacing the entitlement.
- **Rollback readiness (done 2026-11-27, read-only capture):**
  - The live RPC is the comment-stripped `20261030182320` version (`md5(prosrc)` = `ca9f13a8…`). The repo file of that name has md5 `da9c7103…` because it keeps its comments, so it is **not** a valid rollback source.
  - `preserve_monthly_renewal_P.rollback.sql` embeds the exact `pg_get_functiondef` taken from live. The disposable test applies P and then this rollback, and gets `ca9f13a8…` back.
  - Dependants of `access_codes`: one view (`navigator_payment_summary`), which does not use the new column; no triggers; RLS on; table grants to `service_role` only.
  - The rollback refuses if D's index exists, if the RPC is not P's version, or if dropping the column would lose renewal links. A session setting is needed to accept that loss deliberately.
  - Tests: 7/7 on disposable PostgreSQL. Each of the three guards fails at least one test when removed.

## Execution sequence and owner approval checklist

Single owner approval covers the whole sequence; each step still stops on a failed check. Target: `nxfhvebzzobegubefcda` only.

| Step | Action | Gate (must be true to continue) | Rollback |
|---|---|---|---|
| 0 | Owner ratifies A/B as applied (owner 14:26: preserve; no rollback) | Claude's A/B integrity and authorization note; re-apply only `0888970` A, then B (#192) | forward repair only |
| 1 | Logical backup per `engineering/runbooks/` ([#196](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/196)): `supabase db dump` (schema, then `--data-only`) stored off-site. Procedure **PASS** on a disposable PostgreSQL 17 drill (`engineering/runbooks/DATABASE_BACKUP_RESTORE_EVIDENCE.md`). Supabase-managed PITR/backups on `nxfhvebzzobegubefcda`: **PENDING** owner confirmation (register assumes Free plan, none) | Dump files exist, are non-empty and were taken after the last write | Last resort only: restore from the dump, then reconcile rows written after it **by stable key, not by timestamp** (the drill showed a late-committing payment is missed by timestamp), with downtime while restoring |
| 2 | One window, no gap: run G and P preflights (both read-only) first; only if both are `ok`, apply G (`payments_service_role_review_update.sql`), then P (`supabase/migrations/20261110004740_preserve_monthly_renewal.sql`), per [#200](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/200). G must not be live without P (or the release-branch app): app `82dfe65` on a pre-P schema refunds activated orders with a 501 and leaves access | G preflight `ok`; `has_column_privilege('service_role','public.payments','status','UPDATE')` true; P preflight blocking rows `ok`; `preserve_monthly_renewal_P.postcheck.sql` all `ok` | If P fails or does not commit after G: G `.rollback.sql` straight away (P's rollback refuses when P never applied). After P committed: P rollback (#200), then G `.rollback.sql`; forward repair once customers have new P transactions. If P is re-applied, run `preserve_monthly_renewal_P.reapply_backfill.sql` straight after it |
| 3 | D preflight, then apply D | D preflight blocking rows `ok`; D brief postchecks | D `.rollback.sql`, then P's if needed |
| 4 | Apply C, with `PERSISTENT_RATE_LIMITS` unset | #174 brief checks | `rollback_navigator_rate_limit_hits.sql` |
| 5 | Apply F | F preflight `ok`; no sends (owner 14:26) | Forward-only repair per #193 runbook; `.down.sql` deletes pending rows and dedupe history, never on live (#211's `.down.sql` refuses while the outbox has rows) |
| 6 | Deploy the frozen RC commit to Cloudflare production | RELEASE_CHECKLIST smoke tests | Cloudflare rollback to the deployment that was live before step 6 (today `0cc59589`) |
| — | E is **not in this release** (it is a feature; owner 15:01: no additional features). When scheduled, after steps 2–3: pause top-up redemption, refund and manual-restore writes; take a verified recovery point; E preflight, apply E (`57f6fea9…`, #202 `8034750`); deploy the combined #200+#202 app; confirm all affected traffic is on it; then re-enable writes. This cutover is not rehearsed on Cloudflare. Supersedes #187's "deploy #181's handler first, then apply E": #181's handler ships inside the combined app, and the combined app on a pre-E schema is not qualified (only its restore failing closed is), while writes-paused E-then-app is | E preflight `ok`; Claude qualification of #181's handler at `d51dea0` or later (it calls `paid_refund_one_off_pack` only once `granted_credits` exists); no request served by `82dfe65` while writes are open; Claude qualification; owner approval | Forward repair only (#202 rollback refuses once refund receipts exist); never roll the app back to `82dfe65` after top-ups exist |

Steps 2–6 are compatible with the code live today (`82dfe65`):
- P keeps the RPC's signature and its `activated`/`reused` statuses.
- D's new `ORDER_ALREADY_ACTIVATED` can only occur for a second code of one payment. Live has 0 access codes.
- G only adds a column grant.
- C and F only add objects.
- Exception: E is **not** compatible with `82dfe65`: at #202 `8034750` its stacked refunds fail loudly (502, sent to review) rather than refunding wrongly, but they still fail, so E needs the paused-writes cutover above.

So step 6 can roll back the app alone, without rolling back the database.

**Rollback order:** reverse order only: the Cloudflare deployment, then C, D, P, G; F is repaired forward, not dropped. Never run `free_scan_reservation_functions.down.sql` on this database.

Every step needs Claude's qualification of that entry. Before each step, record `select max(version) from supabase_migrations.schema_migrations`.
Apply through Supabase `apply_migration` so a history row is written. The recorded version will be the apply time, not the
repo filename, so note both in this register.

## Out of scope for this release

The other files in `supabase/migrations_pending_approval/` (matters, legal corpus, professional profiles, staged foundations, etc.)
belong to unreleased features and are not part of this register.
