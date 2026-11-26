# Skipped test files (register)

Last reviewed: 2026-11-26, by Claude (backend), on `engineering/claude-review`.
Method: `npx vitest run --reporter=json` on Node 26 locally, with `NODE_OPTIONS=--no-experimental-webstorage`.
Result: 291 files passed, 13 files fully skipped, 478 tests skipped. No test was deleted or converted to a no-op.

Skips are not failures, but a skipped file is not evidence that the behaviour is covered locally. Each entry below
records where the test does run, and what would be needed to run it here.

## A. PostgreSQL-gated suites (11 files, 0 run locally, RUN IN CI)

Correction (2026-11-26, reconciliation): the earlier count of 10 was wrong. The table below lists 11 `.pg.test.ts`
files. Together with B and C that accounts for all 13 fully skipped files. The 13-file total is from a JSON run;
the per-file list was re-derived from that run, not assumed. After commit 5940df4 the total is 14: the new
`api/services/navigatorQuoteHits.pg.test.ts` is also PostgreSQL-gated (CI runs it with `CREDIT_PG_URL`).

Gate: `describe.skipIf(!process.env.CREDIT_PG_URL)` (or the admin URL variant). `.github/workflows/ci.yml` starts a
`postgres:16` service container and sets `NAVIGATOR_PG_TEST_ADMIN_URL` and `CREDIT_PG_URL`, so these run on every CI
push. Local machines have no PostgreSQL, so they skip.

| File | Tests | Why it matters |
|---|---|---|
| api/matterAccessActivation.pg.test.ts | 25 | Matter access activation rules on a real schema |
| api/matterAccessLifecycleRoutes.pg.test.ts | 25 | Lifecycle route guarantees |
| api/matterAccessRoutes.pg.test.ts | 24 | Matter access route guarantees |
| api/services/accessCodeRedemption.pg.test.ts | 11 | Access-code redemption (DEVIN-OBS-01 ownership) |
| api/services/freeUsageStore.pg.test.ts | 4 | free_usage row guarantees |
| api/services/matterAccessEvents.pg.test.ts | 45 | Matter access event log |
| api/services/matterAccessHistory.pg.test.ts | 37 | Matter access history |
| api/services/paidCreditFunctions.pg.test.ts | 13 | Paid credit SQL functions (financial integrity) |
| api/services/professionalMatterAccess.pg.test.ts | 60 | Professional matter access |
| api/services/professionalMatterAccessAudit.pg.test.ts | 55 | Professional access audit trail |
| api/services/professionalMatterAccessRecipient.pg.test.ts | 71 | Recipient rules |

Decision: keep as is. They are necessary. Local restoration would need a PostgreSQL instance (none is installed here,
and Docker is unavailable). CI is the verification path. **Unverified this session:** the CI run result for the
current commits could not be read (the `gh` CLI is not installed in this environment).

## B. Staging-only suite (1 file, 6 tests)

- api/services/creditStaging.test.ts: `describe.skipIf(!enabled)`, "credit reservation against a real Supabase project
  (staging only)". It needs staging Supabase credentials. Those must never be placed in the repo or in agent sessions.
  Decision: keep skipped. It runs only in the staging workflow that holds the secret. No change.

## C. Real-artifact suite (1 file, 21 tests)

- api/services/docxFieldInventoryRealArtifacts.test.ts: `describe.skip` when the real court-form DOCX files are absent.
  Those files come from the real upload path and are not committed to the repo (the rules require synthetic documents
  only, and no customer documents in the repository). Decision: keep skipped locally. The synthetic-fixture equivalents run unconditionally.
  If a fixture directory is supplied by CI, the suite runs there.

## Action items

- No change needed to make local `npx vitest run` deterministic: skips are gated by environment, not by `.only`.
- A future CI job should publish the skipped-count per file, so a new silent skip is visible.
