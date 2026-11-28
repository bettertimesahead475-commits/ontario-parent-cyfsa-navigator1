# Intelligent analyzer: implementation status (2026-11-28)

Branch `engineering/perf-recovery-20261128-int`. Synthetic and mocked tests only. No paid provider calls, no live
migration, no production deploy. Full Vitest: 351 files passed, 5,172 tests passed, 519 skipped. `tsc --noEmit` clean.

## Implemented and wired into the live path

| Item | What changed | Where | Evidence |
|---|---|---|---|
| 6 (M2 integration, part) | Forensic reports now carry a deterministic chronology projection (M2B), built from the grounded dates. No model call. Invalid or unparseable dates are not ordered and are counted. | `shared/chronologyIntelligence.ts`, `functions/api/analyze.ts` (Forensic branch only) | `tests/devin/chronology-intelligence.test.ts` (5) |
| 11 (reasoning reaches the provider) | Adapter now adds max_tokens headroom when adaptive thinking is requested, because thinking tokens count toward max_tokens. Tests read the request body the adapter sends. | `functions/api/_analyzer-model-adapter.ts` | `api/cloudflare-reasoning-request.test.ts` (8): the sectioned Forensic path sends `thinking: {type: "adaptive"}` when `ANALYZER_FORENSIC_REASONING=adaptive`, and `disabled` otherwise |
| 2 (Deep Scan reuse, decision logic) | Pure planner: reuse a completed analysis's sections only when owner, document, analyzer/prompt/model versions, and legal reference version all match and the cache entry is usable. Reports exactly what runs again. | `functions/api/_analysis-reuse.ts` | `tests/devin/analysis-reuse.test.ts` (9) |

Previously committed in this branch: FCA output-limit refusal, strict court-prep dates, and the experimental reasoning
switch (`61b5a01`).

## Built but NOT wired (so no reduction in provider calls yet)

- **Deep Scan reuse (items 1, 2).** The planner exists, but nothing calls it. Wiring needs (a) the report cache
  migration approved, (b) a stored section list per completed analysis, and (c) the owner's entitlement rule (a Deep
  Scan that builds its Basic foundation must not consume a Basic credit). The redundancy baseline still shows 11 provider
  calls for Deep Scan after Basic, the same as before.
- **Report cache (item 4).** `functions/api/_report-cache.ts` and the migration
  `supabase/migrations_pending_approval/create_navigator_report_cache.sql` already provide account-isolated keys and a
  30-day expiry. Nothing in this pass added a second migration. The migration is not applied anywhere.
- **Migration testing (item 5).** No disposable database was used in this pass. The existing pg test
  (`tests/devin/report-cache-migration.pg.test.ts`) runs only where a database is configured. It was not run here.

## Not implemented in this pass

- **Item 3** (Final Case Assessment consolidating verified document analyses). FCA still reads raw page text.
  Changing its input is an owner decision (what the assessment may rely on).
- **Item 7** (consolidated experimental Forensic pipeline combining deterministic tools with adaptive reasoning). Not built.
- **Item 8** (reduce seven Forensic calls to one or two). Not built. It changes prompts and needs paid comparison to show
  quality is kept.
- **Item 9** (experimental single-call Basic). Not built.
- **Item 10** (provider prompt caching, document indexes, targeted retrieval). Not built.
- **Rest of item 6.** M2C claims, M2D relationships and M2E findings are still not connected to the analyzer. M2D's
  `evaluateDeterministicRelationship` is labelled in its source as a test helper and its rules are not sound enough to
  use in production. Connecting M2E needs a mapping from report findings to M2C claims, which is not written.

## Paid comparisons

See `engineering/reviews/paid-comparison-budget-20261128.md`. Only P1 (Forensic reasoning off vs adaptive, 4 runs,
28 calls, input about 1.04M tokens, output ceiling 616,000 tokens) runs on code in this branch. Dollar figures need the
owner's price sheet.
