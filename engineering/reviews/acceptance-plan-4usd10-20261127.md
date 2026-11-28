# Final acceptance plan: hard cap $4.10 USD (supersedes the run table in `live-acceptance-plan-5usd.md`)

Status: **not run. Needs the owner's explicit spending authorization for $4.10.** The authorized budget left is about $0.40.

## Where and when
- **Production** `https://cyfsanavigator.com`, after the frozen RC commit is deployed and the $0 smoke checks pass.
  Preview stays not-ready by owner decision, so no Preview step.
- Synthetic documents only (`eval/` fixtures, the synthetic affidavit). Two dedicated test accounts:
  - **T-free:** a new account with a verified email. It uses its own lifetime free Quick and Forensic.
  - **T-paid:** paid entitlement issued by a logged admin action. No real customer balance is touched.
- Stop at $4.00 cumulative (provider dashboards plus the logged token counts), and on any credit discrepancy, leak or crash.
- Record every run in `engineering/TEST_REGISTER.md`: job ID, model, input/output tokens, cost, and balances before and after.

## Paid runs (prices verified 2026-11-27 on the official Anthropic and Google pricing pages)
| # | Account | Run | Provider path | Est. |
|---|---|---|---|---|
| 1 | T-free | Free Quick Document Review, 3-page affidavit | Claude Sonnet 5 | $0.10 |
| 2 | T-free | Free Forensic Deep Scan, same affidavit | Claude Opus 5, dual pass + verification | $0.45 |
| 3 | T-paid | Forensic, 25-page synthetic case file; refresh and navigate away mid-run (queue + polling recovery) | Opus 5 via queue Worker | $1.25 |
| 4 | T-paid | Final Case Assessment from saved runs 1 to 3 | Opus 5 | $0.40 |
| 5 | T-paid | Duplicate submission: double-click plus a second tab on a Quick; exactly one run, one deduction | Sonnet 5 | $0.10 |
| 6 | T-paid | Forced failure after reservation; the credit is released | Sonnet 5 (partial) | $0.10 |
| 7 | T-paid | Retry of run 6 | Sonnet 5 | $0.10 |
| 8 | T-paid | **Production Gemini OCR:** 3-page scanned (image-only) synthetic PDF, then Quick on the extracted text | `gemini-2.5-flash` (Google routes it to 3.5 Flash-Lite rates from 2026-12-01) + Sonnet 5 | $0.11 |
| 9 | T-paid | **Production Gemini transcription:** 30-second synthetic audio clip | `gemini-3.6-flash` | $0.01 |
| | | Contingency: one repeat of run 3 | | $1.25 |
| | | **Total** | | **$3.87, cap $4.10** |

The estimates are not exact costs; the cap is binding. The worst case per run is in
`free-trial-acquisition-cost-20261127.md`, and a single run cannot exceed that worst case.

## $0 checks in the same session (no provider call; each one is confirmed by the network log and unchanged balances)
- T-free: a second Quick and a second Forensic are refused with `FREE_LIMIT_REACHED`. Free audio is refused with
  `PAID_FEATURE_REQUIRED`, and free Final Case Assessment is refused.
- The dashboard shows free Quick 0/1 and Forensic 0/1, separate from paid credits.
- Every saved report reopens after reload and sign-out/sign-in. Lawyer Case Brief PDF/TXT, the Forensic/Quick PDF
  and the FCA PDF download with no analyzer request and no credit used.
- Payments (G applied): admin approves a synthetic pending e-Transfer order (no money moves; the test order is
  created by T-paid), the customer claims it, and an admin refund retires the code and access.
- `/api/health` and `/api/analyzer-status` are ready, and `/api/admin/*` returns 401 without a token.

## Exit
All checks pass, spend ≤ $4.10, and the register is updated. Then send the owner the results and the measured cost.
