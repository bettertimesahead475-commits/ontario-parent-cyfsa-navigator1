# Live acceptance test: prepared, NOT authorized (v2, 2026-11-27)

**Do not execute** until both gates are recorded in `engineering/TEST_REGISTER.md`:
1. **Owner expenditure approval.** The amount must be at least the $4.10 ceiling below; the hard cap is $5.00.
2. **Claude confirms a safe environment.** That means the target deployment and database are identified, no real customer balance can be touched, and the build qualified at `067446a` (or later) is the one deployed.

Candidate: [PR #164](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/164) at `067446a`. No migration is applied before or during the test (see `pr164-migration-approval-brief.md`; Claude records both as already applied to staging).

## Environment
- Cloudflare Pages **preview** build of the qualified commit, project `cyfsa-navigator-git-staging`. It is not production.
- The analyzer database is whatever the preview is bound to today. If Claude cannot confirm that binding is isolated
  from live customers, **stop**: the test needs a separate test account and its credits must be granted by a logged admin action.
- Only one synthetic test account. Only synthetic documents (`eval/` fixtures and the synthetic affidavit used in the browser tests).
- Queue consumer for staging: confirm it is attached and that its settings match
  `engineering/evidence/cloudflare-queue-config-20261127.json` (read-only Cloudflare API check) before run 1.

## Runs
| # | Run | Purpose | Est. cost |
|---|---|---|---|
| 1 | Quick Document Review, 3-page affidavit | Baseline; one deduction | $0.10 |
| 2 | Forensic Deep Scan, same affidavit | Dual-pass completes; PDF fidelity | $0.45 |
| 3 | Forensic, 25-page case file; refresh mid-run | Queue path, refresh recovery, **NAV-004 timing (C)** | $1.25 |
| 4 | Final Case Assessment over runs 1–3 sources | Separator-aware limit, reused-source upload, PDF | $0.40 |
| 5 | Duplicate submit: double-click plus a second tab on run 1's document | One job, one deduction | $0.10 |
| 6 | Forced failure after reservation | Refund; no stale "running" record | $0.10 |
| 7 | Retry of run 6 | One deduction in total | $0.45 |
| | Contingency (one repeat) | | $1.25 |
| | **Ceiling** | | **$4.10** |

Stop at once if cumulative spend reaches $4.00, or on any credit discrepancy, privacy leak or crash.

## NAV-004 timing (run 3)
Record from Worker logs only (no case text). Pass if:
- every timing below is recorded;
- `submit → claimed` is under 15 minutes;
- `submit → finalized` is under the 15-minute reservation TTL;
- no `[ANALYZER_RESERVATION_PAST_TTL]` warning appears.

| Measure | Source |
|---|---|
| submit → `[ANALYZER_JOB_CLAIMED]` (`queueAgeSeconds`) | queue consumer log |
| claimed → completed | durable job `updated_at` |
| submit → reservation finalized | credit ledger row time |
| delivery attempts | `deliveryAttempt` in the claim log |

## Checks for every run
- **Analyzer:** the job reaches `completed`; no truncation flag; quotations carry page references; no invented metadata or scores.
- **Persistence:** after a reload and after signing out and back in, the report reopens with identical content under the correct case.
- **PDFs:**
  - Lawyer Case Brief (PDF and TXT), Forensic and Quick Review PDFs, Final Case Assessment PDF.
  - The network log shows no analyzer request and no credit use during a download.
  - Source tags resolve to the cited pages.
  - The redacted copy keeps finding count, order and severity, and removes names, dates and free text.
- **Credits:** check the balance before and after each run. Expect exactly one deduction per completed job; a refund on run 6; nothing for duplicates or downloads; ledger rows that match.

## Records
For each run, record job id, model, tokens, cost, balance before and after, and pass or fail in `engineering/TEST_REGISTER.md`.
Production promotion is a separate lead-engineer decision under `engineering/RELEASE_CHECKLIST.md`.
