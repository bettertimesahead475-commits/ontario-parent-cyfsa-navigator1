# Devin Audit Register

Scope: independent audit per the CYFSA Navigator principal-engineering directive. Branch `engineering/devin-independent-audit` from `engineering/integration` @ `3ad1c8c` (`main` @ `e2bbc76` is stale; production `be46ad7` is an ancestor of the baseline). Synthetic data and mocked fetch/inference only.

## Measured baseline (Node 22.23.5)
| Check | Result |
|---|---|
| `npx vitest run` | exit 0 (baseline); after fixes: 279 files passed / 13 skipped, 4301 tests passed / 478 skipped |
| `npx tsc --noEmit -p .` | exit 0 (before and after) |
| `npm audit` | 0 vulnerabilities (0 low/moderate/high/critical) |

## Areas reviewed (source read + targeted tests)
| Area | Files | Result |
|---|---|---|
| Firebase auth | `functions/api/_auth-check.ts` | Sound (RS256, aud/iss/exp/iat/auth_time). OBS-02: no JWKS cache |
| Access-code activation | `activate-code.ts`, `redeem_access_code_atomic` SQL | Atomic (`for update`), idempotent `reused`, constant-time ref compare. OBS-01 |
| Paid sessions / credits | `_supabase-paid-session.ts`, `_paid-session-validation.ts`, `_paid-credit-reservation.ts`, `_free-credit-reservation.ts`, `_paid-analysis-transaction.ts` | UID+session bound, reserve → persist → finalize, release on failure. No defect found |
| Analyzer entry | `analyze.ts` | **DEVIN-SEC-01** (fixed) |
| Durable jobs / polling | `_durable-analysis-jobs.ts`, `_analysis-jobs.ts`, `analyze/job/[jobId].ts` | Owner checked before status/report; retry ids owner-scoped |
| Queue consumer | `workers/analyzer-queue-consumer.ts` | Lease + worker token, saved-report recovery before rerun, idempotent finalize, bounded backoff |
| Final Case Assessment | `final-case-assessment.ts` | Pro-only, matter ownership rechecked before consume |
| Payment requests | `request-access.ts` | Idempotent on `(firebase_uid, request_key)` incl. 409 race; depends on pending uniqueness migration (known) |
| Admin console | `admin/[[path]].ts`, `_admin-store.ts` | Approve CAS, restore-credits CAS, refund `acquireOnce`. **DEVIN-FIN-01** (open) |
| Rate limiting | `_rate-limit.ts` | Per-isolate (known S-05) |

## Not covered (needs authorization or environment)
- Live Supabase RLS/RPC verification (no isolated DB; production holds real customers).
- Paid inference / analyzer quality on real models (budget reserved).
- UI-driven multi-tab / network-interruption testing.

## Phase two (analyzer accuracy + test effectiveness)
See `engineering/DEVIN_PHASE2_AUDIT_REGISTER.md` (findings P2-01..04, 19 targeted mutations) and
`engineering/handoffs/devin-phase2-2026-11-25.md`. Measured after phase two: `vitest run` 283 files / 4339 tests passed,
`tsc --noEmit` exit 0.

## Phase three (independent release qualification, 2026-11-26)

Candidate `engineering/integration` @ `eaca5cf`. Full assessment, findings (DEVIN-P3-01, pending-SQL parity F-2),
mutation catalogue P01–P16 and skipped-test classification: `engineering/DEVIN_PHASE3_RELEASE_READINESS.md`.
Reusable promotion gate: `engineering/RELEASE_ACCEPTANCE_FRAMEWORK.md`. Fix for DEVIN-P3-01: PR #139.
