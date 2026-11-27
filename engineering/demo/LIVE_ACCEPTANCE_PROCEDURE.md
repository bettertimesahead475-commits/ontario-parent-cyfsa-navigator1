# Live acceptance procedure: three analyzers, synthetic documents only

Purpose: confirm end-to-end behaviour before the Business Centre appointment. Each step names the expected evidence.
Uses paid inference, so **do not start any step below until the owner approves the spend** (see the funding table).

## Preconditions (read-only, no spend)

1. Production deployment is the one recorded in the release checklist; rollback point `d5f2a3c9` is still listed.
2. `GET /api/status` returns 200 with `analyzerReady: true` and `forensicQueueReady: true`.
3. Confirm the Supabase project the analyzer writes to (see `engineering/incidents/2026-11-26-forensic-deep-scan.md`,
   "Staging-named path"). Record the answer in the test log before running anything.
4. Use only the files in `engineering/demo/synthetic-case/`. Do not upload any real client document.

## Steps (each produces a row in the test log)

| # | Action | Expected evidence | Stop if |
|---|---|---|---|
| 1 | Sign in with the owner account (Google sign-in popup opens) | Signed in; header shows the account | Popup blocked, or session not persisted after refresh |
| 2 | Upload `01-investigation-summary.txt` | Upload completes; file listed | Upload error or missing file in list |
| 3 | **Quick Document Review** on file 01 | Summary, chronology, findings; progress bar advances; result saved | No result within 2 minutes |
| 4 | Reload the page during step 3 | Progress resumes, or the saved report appears | Blank screen, or "missing" for a running job |
| 5 | **Forensic Deep Scan** on files 01–04 | Red flags with verbatim quotes; progress through sections; completes | Browser stops and job is not completed server-side |
| 6 | Re-open the saved Forensic report | Same report, no recomputation | Report missing or changed |
| 7 | **Final Case Assessment** on the same set | Case-level synthesis; each finding shows verified or unverified status | Findings without a verification status |
| 8 | Export the Quick and Forensic reports to PDF | Each PDF opens; text is present; citations and verification statuses appear | Blank PDF, or statuses missing |
| 9 | Check credit balance before and after steps 3, 5, 7 | Balance decreases only for completed, billable runs; failed runs released | Charge on a failed run |
| 10 | Sign out and sign in again; open the saved reports | Reports still listed | Reports belong to another account |

## What to check in the output (not a guarantee of the model's wording)

- File 03 contains a misstatement of section 1(2). The report must flag it as unverified or inapplicable. It must not
  accept it as support.
- File 02 contains a deadline sentence that the check should flag. It must not be presented as correct.
- File 04 contradicts file 01 on food availability. The report should note the conflict, not choose a side silently.
- Any citation the registry cannot confirm must be labelled unverified.

## Funding and cost (estimates from `engineering/PERFORMANCE_BASELINE.md`; owner approval required)

| Step set | Estimated cost | Note |
|---|---|---|
| Quick (step 3) | $0.05–0.10 | |
| Forensic (step 5) | $0.25–0.45 | Largest; repeat only if step 5 fails |
| Final Case Assessment (step 7) | not measured | Requires a separate estimate before approval |
| **Minimum to run steps 3, 5 and 7 once** | **about $0.30–0.55 before Final Case Assessment cost; a top-up is needed because the remaining budget is about $0.40** | Owner to set the amount |

## Log template

Record for each step: date and time (UTC), deployment id, analysis id, the step's pass or fail, and the screenshot or
file name. Do not record document text or any customer data in the log.
