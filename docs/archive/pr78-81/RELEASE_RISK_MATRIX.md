# Release Risk Matrix

**Verdict:** production remains **NO-GO** for the feature release. The **minimum production security fix** below is separate and needs approval on its own.

**Labels:**

- **CONFIRMED:** verified by a read-only production check, or by a passing test in this repository.
- **UNVERIFIED:** plausible or documented, but not checked in this session.
- **Status:** what has been done, and by whom (agent code, proposal, or owner action).

## A. Minimum production security fix (separate approval)

This is the smallest change that closes the confirmed production vulnerability. It changes grants only. It touches no code, RLS, policy, or data.

| Item | Detail |
|---|---|
| Change | `supabase/proposals/revoke_api_role_grants.sql` |
| Scope | Removes all table privileges from `anon` and `authenticated` on 20 tables. Keeps `anon` SELECT on `document_walkthroughs`. |
| Rollback | `revoke_api_role_grants.rollback.sql` (restores the observed state exactly) |
| Verification | `revoke_api_role_grants.verify.sql` (read-only), `revoke_api_role_grants.test.sh` (passing on a disposable database) |
| Procedure | `PROD_PERMISSION_HARDENING.md` |
| Blocking checks | Owner confirmations in `PROD_PERMISSION_HARDENING.md` section 7 |
| Production status | **Not executed.** Requires explicit owner approval. |

## B. Risk register

| ID | Priority | Risk | Label | Evidence | Affected feature | Status | Remaining dependency | Production impact |
|---|---|---|---|---|---|---|---|---|
| R-01 | **P0** | `anon` and `authenticated` hold all seven privileges on 20 public tables, including TRUNCATE. RLS does not restrict TRUNCATE. | **CONFIRMED** | Read-only grant snapshot (this session) | Entire database | Fix proposed and tested. Not applied. | Owner approval; owner checks in `PROD_PERMISSION_HARDENING.md` section 2 | Anyone holding the anon key can destroy data in 20 tables. No code path uses it. |
| R-02 | **P0** | Whether the anon key has been exposed outside the repository | **UNVERIFIED** | `PHASE_1_FINAL_SECURITY_GATE.md` line 469 lists it as unknown | Entire database | Not checked | Owner review of where the publishable key is stored | If exposed, R-01 is actively exploitable. The fix in section A closes it either way. |
| R-03 | **P0** | Upload path calls `navigator_source_operation`, which is absent from every database except the local scratch one | **CONFIRMED** (absent in production, read-only) | Production table and function check. Route wiring in `documentRoutes.ts`. | Document upload and evidence capture | Ported and tested (v2 proposal, 8 of 8). Not applied anywhere. | Staging branch and owner approval | Upload fails at runtime. Staging blocker. |
| R-04 | **P0** | Evidence schema in the reconciled 7B file lacks columns the runtime reads | **CONFIRMED** (local PostgreSQL 16) | Column comparison and code references | Quotes, page provenance, review | Proposal v1, tested (12 of 12) | Owner approval of the schema | Features fail at runtime if the 7B file alone is applied. Not present in production. |
| R-05 | P1 | Live analyzer output quality, citation accuracy, legal correctness | **UNVERIFIED** | No live run performed | Quick Review, Forensic Deep Scan | Matrix written (`ANALYZER_VALIDATION_MATRIX.md`) | Budget and staging key | Unknown. Do not claim analysis quality. |
| R-06 | P1 | RLS and JWT behaviour under real tokens | **UNVERIFIED** (local PostgreSQL only) | Role semantics tested locally | All database access | Plan written (`STAGING_TEST_PLAN.md`) | Isolated Supabase branch | Unknown beyond the local tests. |
| R-07 | P1 | Authenticated and browser end-to-end flows | **UNVERIFIED** | Not run | Parent and professional flows | Not run | Firebase test accounts; Vercel preview | Unknown. |
| R-08 | P1 | Matter-access remediation not replay-safe | **CONFIRMED** (PostgreSQL 16) | Replay test reproduced `already exists` | Matter-access setup on fresh environments | Patch proposed and tested | Owner approval to patch the frozen file | None in production (functions already final). Staging and fresh environments only. |
| R-09 | P1 | Authorization logic inside every SECURITY DEFINER body | **UNVERIFIED** | `search_path` verified for production functions; bodies not reviewed | Matter access, ownership | Not reviewed | Code review pass | Unknown |
| R-10 | P1 | Official form artifacts missing; 102 tests skipped | **CONFIRMED** (test count) | Test run | Official form generation | Not fixable here | Owner supplies artifacts | Official-form correctness unverified |
| R-11 | P2 | Auth-dependent RLS policies match nothing (Supabase Auth has 0 users) | **CONFIRMED** | Read-only user count and policy text | Access model clarity | Documented | Owner decision: keep or remove | Low today; would activate silently if Supabase Auth were adopted without review |
| R-12 | P2 | `lawyer_profiles` public read policy exposes approved profiles | **CONFIRMED** (policy text); exposure depends on data | Policy text. Zero rows today. | Lawyer directory | Documented | Review fields before first approval | None until a profile is approved |
| R-13 | P2 | `document_walkthroughs` readable by `anon` | **CONFIRMED** (3 rows); content judged non-sensitive | Count-only pattern check; no user column | Reference content | Kept as intended | Owner confirmation | Low |
| R-14 | P2 | Matter-access v3 and v4 not replay-safe | **CONFIRMED** | Replay test | Fresh environments | Documented; they run once | Owner decision | None in production |
| R-15 | P2 | Sequence privileges not checked in production | **UNVERIFIED** | Query failed on a catalog object | Completeness of the grant picture | Open | Re-run read-only check | Unknown; low likelihood |

## C. Resolved in this branch chain

| Item | Resolution | Evidence |
|---|---|---|
| PR #69 not in release chain | Integrated in #78 | Typecheck, tests, build |
| Section 6 status and note disagreed with the analyzer score | Fixed in `217998b` | 41 tests |
| Database suites skipped | Enabled against local PostgreSQL. Skips fell from 444 to 102 (official form artifacts only). | Full test run |
| Public function EXECUTE for API roles | None present (0 of 14) | Read-only check |
| Server uses anon key | No. Only service-role keys are accepted. | `access.ts` key resolution; single `createClient` |

## D. Ordering for the release

1. **Now (production, minimum fix):** approve section A. Verify with `verify.sql` before and after.
2. **Staging (no production data):** approve the isolated branch and run `STAGING_TEST_PLAN.md`, including the evidence pipeline v2 (R-03, R-04).
3. **Analyzer (budgeted):** approve the live run list in `ANALYZER_VALIDATION_MATRIX.md` (R-05).
4. **Feature release (separate):** only after items 2 and 3 pass and the owner approves each feature flag separately. Not part of this security fix.

Production stays NO-GO for the feature release until R-03, R-04, R-05, R-06, and R-07 are resolved.
