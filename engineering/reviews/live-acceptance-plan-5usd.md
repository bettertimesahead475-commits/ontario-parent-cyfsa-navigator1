# Live acceptance plan — analyzers, persistence, PDF downloads, credits (ceiling $5.00 USD)

Status: **awaiting explicit owner spending authorization.** Nothing in this plan has been run.

## Rules
- Synthetic documents only (`eval/` fixtures and the synthetic affidavit used in browser tests). No customer data.
- One dedicated test account with test credits granted by an admin action that is logged. No real customer balance is touched.
- Run against the Cloudflare Pages **preview** deployment of the candidate branch first, bound to the current
  operational analyzer database (`nxfhvebzzobegubefcda`). No database migration or binding change.
- Stop immediately if cumulative estimated spend reaches $4.00, or on any credit discrepancy, data leak, or crash.
- Record every run (job ID, model, tokens, cost, credit balance before/after) in `engineering/TEST_REGISTER.md`.

## Runs and estimated cost
| # | Run | Fixture | Est. cost |
|---|---|---|---|
| 1 | Quick Document Review | 3-page synthetic affidavit | $0.10 |
| 2 | Forensic Deep Scan | same 3-page affidavit | $0.45 |
| 3 | Forensic Deep Scan | 25-page synthetic case file (queue path, refresh mid-run) | $1.25 |
| 4 | Final Case Assessment | saved reports from runs 1–3 | $0.40 |
| 5 | Duplicate submission | double-click and two tabs on run 1's document | $0.10 (one run expected) |
| 6 | Forced failure + refund | oversize/invalid input that fails after reservation | $0.10 |
| 7 | Retry of one failed/truncated job | from run 6 or a forced truncation | $0.45 |
| | Contingency (one repeat of any failed run) | | $1.25 |
| | **Total ceiling** | | **$4.10 (under $5.00)** |

The 200-page stress test (~$3.00) is excluded; it needs separate authorization.

## Checks per run
- **Analyzer:** job reaches `completed`; no truncation flag; quotations carry page references; no invented metadata or scores.
- **Persistence:** reload the page and sign out/in — the report reopens from Saved Reports with identical content; it is
  listed under the correct case.
- **PDF downloads:** Lawyer Case Brief PDF + TXT, Forensic/Quick PDF, Final Case Assessment PDF. Each download makes
  no analyzer or assessment request (network log) and uses no credit. Content matches the saved report; source tags
  resolve to the cited pages; disclaimer present; redaction mode blocks the brief.
- **Credits:** balance before/after each run; exactly one deduction per completed job; reservation released and refunded
  on failure (run 6); no deduction for duplicates (run 5) or downloads; ledger rows match balance changes.

## Exit criteria
All checks pass, total spend ≤ $5.00, register updated. Then: production promotion per `engineering/RELEASE_CHECKLIST.md`
through Cloudflare only, followed by a smoke check (health, sign-in, one saved report reopen, one PDF download) on
https://cyfsanavigator.com with no paid run unless separately authorized.

## Prerequisites still missing
- Owner spending authorization (amount up to $5.00).
- Cloudflare API token for account `6dea4d69ac820b3b1736b302971190df` (Pages project `cyfsa-navigator-git-staging`).
- GitHub write access to push the candidate branch (preview deployments build from pushed branches).
- A test account and admin-granted test credits (or the owner grants them).
