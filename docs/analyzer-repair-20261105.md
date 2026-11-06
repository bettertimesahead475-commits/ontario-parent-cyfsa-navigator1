# Analyzer repair, 5 November 2026

> Deployment instructions below are superseded by [staging credential reuse](staging-credential-reuse-20261106.md). The queue relay reuses the existing credential-holding Worker; no replacement Anthropic key is required. Use scripts/Deploy-AnalyzerStaging.ps1 for Pages because Wrangler 4.158 rejects custom Pages --config paths.

Repairs: PDF OCR pages use ordinary PDF objects; provider request rejection no longer falsely declares a file damaged; safe provider diagnostic categories distinguish model/key/format/no-pages/encryption failures; Gemini thought text is excluded; OCR retains the documented PDF-capable default (`gemini-3.6-flash`, not yet verified with the deployed key). Text-layer pages remain local and retain page references. Extraction reserves no credits.

Quick Review uses configured Sonnet; Deep Scan primary sections and verification use configured Opus, ignoring the legacy Sonnet primary override. JSON jobs now have the overall deadline already used by SSE. Browser requests and polling are bounded. Unextracted PDF counts show Pending extraction. Completed reports are still persisted before credit finalization.

Queue failures now retry unconfirmed credit releases even when the ledger is already failed. The isolated staging producer and consumer use `cyfsa-staging-analyzer-jobs` and `cyfsa-staging-analyzer-dead-letter`. The Pages producer configuration is now isolated for the next deployment. Both queues were created in account 6dea4d69ac820b3b1736b302971190df. No consumer was attached to the shared queues. Existing worker targets staging database nxfhvebzzobegubefcda but has no active consumer; its short 15s/60s budgets are insufficient headroom for many reports.

## Validation and release
Use Node 24 (locked unpdf requires it). CI runs TypeScript, the full suite including disposable PostgreSQL integration tests, and the production build. Mocked Gemini and Claude cases are not live E2E evidence. The exact affidavit rejection, deployed model availability, authenticated live report/credit recovery, and consumer integration remain unverified until staging is exercised.

PowerShell, from a clean checkout of the repair branch:

```powershell
npm ci
npm run lint
npm test
npm run build
# Worker execution uses the existing secret-bearing host, then the secret-free relay:
npx --yes wrangler@4 deploy --config wrangler.staging-job-service.jsonc
npx --yes wrangler@4 deploy --config wrangler.analyzer-queue-staging.jsonc
# Deploy the tested CI artifact using a canonical wrangler.jsonc:
.\\scripts\\Deploy-AnalyzerStaging.ps1 -ReleaseDirectory '.\\dist-release-ci'
# Set FIREBASE_ID_TOKEN locally, then run real searchable/scanned PDFs and both modes:
.\scripts\Test-AnalyzerStaging.ps1
# Optionally use the affected affidavit:
.\scripts\Test-AnalyzerStaging.ps1 -PdfPath 'C:\path\affidavit.pdf'
```

The staging relay uses ANALYZER_EXECUTOR to invoke the existing secret-bearing execution Worker; Pages secrets are not inherited or copied. No production database migration or public-site deployment is authorized by these commands. Fresh frontend builds must use the existing staging VITE_FIREBASE_* settings. Use `wrangler tail --config wrangler.analyzer-queue-staging.jsonc` for worker failures and `wrangler pages deployment tail --project-name=cyfsa-navigator-staging` for extraction diagnostics. Never log uploaded documents or credentials.

The initial CI run passed TypeScript and 4,399 tests but found three failing assertions: two stale owner-email fixtures and a polling assertion that needed to account for its new AbortSignal. Those fixtures were corrected; authentication policy was not broadened. The staging Pages project's producer configuration was switched to the isolated queue for the next deployment; the currently deployed revision has not been replaced.

Model verification: Google's official [Gemini 3.6 Flash model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash?hl=en) lists this stable ID and PDF input support. The temporary default downgrade in the first repair commit was removed after checking that specific page; no alternate model is silently substituted.
