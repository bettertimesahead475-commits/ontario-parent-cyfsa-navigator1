# Analyzer repair, 5 November 2026

Repairs: PDF OCR pages use ordinary PDF objects; provider request rejection no longer falsely declares a file damaged; safe provider diagnostic categories distinguish model/key/format/no-pages/encryption failures; Gemini thought text is excluded; OCR uses a documented PDF-capable baseline (`gemini-2.5-flash`, not yet verified with the deployed key). Text-layer pages remain local and retain page references. Extraction reserves no credits.

Quick Review uses configured Sonnet; Deep Scan primary sections and verification use configured Opus, ignoring the legacy Sonnet primary override. JSON jobs now have the overall deadline already used by SSE. Browser requests and polling are bounded. Unextracted PDF counts show Pending extraction. Completed reports are still persisted before credit finalization.

Queue failures now retry unconfirmed credit releases even when the ledger is already failed. The isolated staging producer and consumer use `cyfsa-staging-analyzer-jobs` and `cyfsa-staging-analyzer-dead-letter`. Both queues were created in account 6dea4d69ac820b3b1736b302971190df. No consumer was attached to the shared queues. Existing worker targets staging database nxfhvebzzobegubefcda but has no active consumer; its short 15s/60s budgets are insufficient headroom for many reports.

## Validation and release
Use Node 24 (locked unpdf requires it). CI runs TypeScript, the full suite including disposable PostgreSQL integration tests, and the production build. Mocked Gemini and Claude cases are not live E2E evidence. The exact affidavit rejection, deployed model availability, authenticated live report/credit recovery, and consumer integration remain unverified until staging is exercised.

PowerShell, from a clean checkout of the repair branch:

```powershell
npm ci
npm run lint
npm test
npm run build
# Supply staging secrets interactively to the NEW isolated worker:
npx --yes wrangler@4 secret put ANTHROPIC_API_KEY --config wrangler.analyzer-queue-staging.jsonc
npx --yes wrangler@4 secret put STAGING_SUPABASE_SERVICE_ROLE_KEY --config wrangler.analyzer-queue-staging.jsonc
npx --yes wrangler@4 deploy --dry-run --config wrangler.analyzer-queue-staging.jsonc
# Ensure staging migration 20261104230000_durable_analyzer_queue.sql is applied and analysis_jobs is PRIVATE first.
npx --yes wrangler@4 deploy --config wrangler.analyzer-queue-staging.jsonc
npx --yes wrangler@4 pages deploy dist --config wrangler.pages-queue-staging.jsonc --project-name=cyfsa-navigator-staging --branch=migration/cloudflare-staging-20261029
# Set FIREBASE_ID_TOKEN locally, then run real searchable/scanned PDFs and both modes:
.\scripts\Test-AnalyzerStaging.ps1
# Optionally use the affected affidavit:
.\scripts\Test-AnalyzerStaging.ps1 -PdfPath 'C:\path\affidavit.pdf'
```

The standalone staging worker requires its own encrypted secrets; Pages secrets are not inherited. No production database migration or public-site deployment is authorized by these commands. Fresh frontend builds must use the existing staging VITE_FIREBASE_* settings. Use `wrangler tail --config wrangler.analyzer-queue-staging.jsonc` for worker failures and `wrangler pages deployment tail --project-name=cyfsa-navigator-staging` for extraction diagnostics. Never log uploaded documents or credentials.

The initial CI run passed TypeScript and 4,399 tests but found three failing assertions: two stale owner-email fixtures and a polling assertion that needed to account for its new AbortSignal. Those fixtures were corrected; authentication policy was not broadened. The staging Pages project's producer configuration was switched to the isolated queue for the next deployment; the currently deployed revision has not been replaced.
