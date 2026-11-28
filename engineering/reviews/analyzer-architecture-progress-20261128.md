# Analyzer architecture: progress report (2026-11-28)

Branch `engineering/perf-recovery-20261128-int`. All evidence is synthetic or mocked. No paid provider calls, no production
deploy, no live migration. Full Vitest: 356 files passed, 5,199 tests passed, 519 skipped. `tsc --noEmit` clean.

## 1. Working experimental analyzer

`ANALYZER_FORENSIC_PIPELINE=consolidated` selects `runConsolidatedForensic` (`api/services/consolidatedForensic.ts`). Unset
or any other value keeps the sectioned pipeline, so production behaviour is unchanged. Basic Review is not touched.

The consolidated pipeline:
1. sends the document once and asks for every remaining Forensic section in one JSON object (2 of the 7 calls);
2. validates each section with the same validators and deterministic guards as before;
3. repairs only sections that fail validation, through the existing per-section path;
4. falls back to the sectioned pipeline if the comprehensive answer is cut off, unparseable, or the provider fails;
5. runs the existing independent verification over red flags and thresholds.

## 2. Measured reductions (mocked provider, 50-page synthetic document, 145,640 characters)

Source: `api/services/consolidatedMeasurement.test.ts` (printed as `[MEASUREMENT]`).

| Arm | Provider calls | Verification calls | Transmitted characters (mock) |
|---|---|---|---|
| Sectioned Forensic (current) | 7 | 1 | 1,093,404 |
| Consolidated Forensic | 2 | 1 | 323,681 |
| Consolidated, four sections reused | 2 | 1 | 315,577 |

Consolidated against sectioned: calls −71%, transmitted characters −70%. Reuse of four sections saves 8,104 characters
(under 1%) and no calls, because the comprehensive call still carries the document for the two remaining sections.

Redundant operations removed on this path: five of the seven sends of the full document (six section calls and one
verification call become one comprehensive call and one verification call).

## 3. Reuse planner wired into the experimental path

- `functions/api/_analysis-reuse.ts`: `planAnalysisReuse` decides which sections can be reused. It requires matching owner,
  document fingerprint, analyzer version, prompt version (which includes the mode), models, legal reference version, and a
  usable cache entry (not expired, deleted or incomplete).
- `functions/api/analyze.ts` `planForensicReuse`: runs only on the consolidated path. It asks an injected `reuseLookup`
  for a prior analysis. Production configures no lookup, so nothing is reused in production yet.
- Tests: `tests/devin/analysis-reuse.test.ts` (9), `tests/devin/forensic-reuse-wiring.test.ts` (5).

**Finding that limits reuse:** Basic and Deep Scan use different limits for the same sections, so the prompt version differs
and Basic findings are refused for a Deep Scan. The planner enforces this correctly. Reusing Basic findings in Deep Scan
would need either a shared section prompt (a quality change to test paid) or a different reuse rule. This is the main
open design question for item 1 and 2.

## 4. Report-cache migration validated on a disposable database

`supabase/migrations_pending_approval/create_navigator_report_cache.sql` and its rollback were applied to an in-memory
PostgreSQL (PGlite), with Supabase roles stubbed. Result: 16 of 16 checks passed. Evidence:
`engineering/reviews/evidence/report-cache-validation-pglite.json`, script in the same folder.

Checked: constraints (key format, job id, 30-day expiry bound, duplicate per owner and key), account isolation (same key,
different owner accepted), row-level security enabled, no privileges for anon or authenticated, owner forget removes only
that owner's rows, purge removes expired rows, rollback drops the table, re-apply succeeds.

Not checked: real Supabase behaviour, the server-side PostgREST layer, and the production database. Limits of this test:
PGlite is PostgreSQL-compatible, not identical, and the roles are stubs. The migration remains in `migrations_pending_approval`
and is not applied anywhere.

## 5. Deterministic M2 modules

- **Integrated:** `shared/chronologyIntelligence.ts` (M2B projection over grounded dates) runs on Forensic reports only.
  No model call. Tests: `tests/devin/chronology-intelligence.test.ts` (5).
- **Corrected:** `shared/m2d-relationships.ts` `evaluateDeterministicRelationship`. The previous version hard-coded the
  words "monday" and "tuesday", replaced "did not occur" by string substitution, and returned UNKNOWN for every claim
  outside the same-event branch. It now detects affirmation against denial on the same event (negation removed and compared),
  and date inconsistency on the same event (calendar day compared). It is still conservative about event identity.
  Tests: the existing 30 M2-D tests still pass, plus `tests/devin/m2d-helper-correction.test.ts` (7).
- **Not integrated:** M2C claims and M2E findings. M2E needs a mapping from report findings to M2C claims that is not written.

## 6. Final Case Assessment consolidation

`shared/assessmentConsolidation.ts` builds the assessment input from verified analyses where they exist and are current,
and from original text where no analysis exists or a finding did not verify or was marked MISQUOTED or UNSUPPORTED.
Over-budget input is refused, not truncated.

Wired behind `FCA_CONSOLIDATED=true` with a `priorAnalyses` dependency. Production configures no lookup, so FCA still
reads raw text. Tests: `tests/devin/assessment-consolidation.test.ts` (7).

## 7. Basic protection

Basic Review's code path (`runSectionedAnalysis` with mode `fast`) is unchanged by this pass. The consolidated pipeline,
reasoning switch, reuse planner and FCA consolidation are all off unless their flags are set, and the planner and FCA
assembler are not connected to any stored data in production.

## 8. Items not done

- **Item 7, prompt caching and targeted retrieval:** not implemented. The adapter sends each prompt as one flattened text
  block, so a cacheable document block would need an adapter change. Feasibility is noted; no measurement is possible without
  a paid run.
- **Single-call Basic (item 9):** not built. Basic protection rule applies.
- **Stored analyses for reuse and FCA:** no store writes completed analyses yet, so both reuse and FCA consolidation have no
  data to act on in production. Writing them needs the migration approved and the owner's retention decision.
- **Owner decisions still open:** entitlement rule for a Deep Scan that generates its Basic foundation; legal reference
  version (the placeholder `unversioned-2026-11-28` and effective date `1970-01-01` must be replaced by real values before any
  cache entry is trusted); whether Basic findings may seed a Deep Scan (needs a prompt decision).

## 9. Risks

- The consolidated call's single output can be up to 40,692 tokens. It may not finish inside the 180-second Forensic budget,
  and a timeout falls back to the slower sectioned path. This is the main design risk and it is measurable only with paid runs.
- Quality is not measured. The reduction in calls is not evidence of equal findings.

## 10. Paid comparison

Prepared in `engineering/reviews/paid-comparison-budget-20261128.md`: existing vs consolidated, two repeats, 36 calls, input
about 1.70 million tokens with margin, output ceiling 357,536 tokens. Hard ceiling USD 35.00 at the highest Opus 5 rate
found (the Opus 5 standard rate could not be confirmed and must be verified). Not authorised.
