# Staging credential reuse — 6 November 2026

## Inventory (names only)
- Pages `cyfsa-navigator-staging`: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`.
- Pages `cyfsa-navigator-git-staging`: same names plus `ADMIN_SECRET` and `SESSION_SECRET`. **This project serves cyfsanavigator.com and www.cyfsanavigator.com. Do not deploy this repair to it.**
- Worker `cyfsa-analyzer-queue-consumer`: existing encrypted `ANTHROPIC_API_KEY` and `STAGING_SUPABASE_SERVICE_ROLE_KEY`; database origin verified as nxfhvebzzobegubefcda.supabase.co.
- Worker `cyfsa-staging-analyzer-queue-consumer`: deliberately has no secrets. It has the service binding `ANALYZER_EXECUTOR`.

Cloudflare does not disclose a secret's Anthropic dashboard label. These names establish where credentials exist, not which one was labelled CYFSA Queue Worker.

## Implemented architecture
The registered staging queue consumer is a relay. It invokes named RPC `StagingAnalyzerJobs.processJob` on the existing credential holder using a Cloudflare service binding. Only opaque job id, contract version, attempt number and queue channel cross that boundary. The existing handler reads private input, reserves/recovers the job lease, runs the analyzer, saves the report, and idempotently finalizes/reconciles credit state.

The credential holder rejects any database origin other than the verified staging origin and requires the isolated staging queue names. It exposes no HTTP inference, credential reader or job-creation endpoint. Both Workers' public workers.dev and preview URLs are disabled. Named RPC is authorized by the explicit same-account Cloudflare service binding; browser headers cannot invoke it.

Deployment used the documented Worker upload `keep_bindings: ['secret_text']` facility to retain encrypted bindings on the SAME Worker. No credential was decrypted, retrieved, copied into another Worker, or logged. This is credential reuse through server-side execution, not secret sharing. No new Anthropic key is needed.

## Reproducible deployments
Use `wrangler.staging-job-service.jsonc` for the credential host first, then `wrangler.analyzer-queue-staging.jsonc` for the relay. Standard Wrangler deployments preserve existing secrets. Do not delete or recreate the credential host: its encrypted bindings are the retained credentials.

```powershell
npx --yes wrangler@4 deploy --config wrangler.staging-job-service.jsonc
npx --yes wrangler@4 deploy --config wrangler.analyzer-queue-staging.jsonc
.\scripts\Deploy-AnalyzerStaging.ps1 -ReleaseDirectory '.\dist-release-ci' -CommitHash fcaf6878cc83e8a35151e385f7a6951d15c79349
```

A `secret list` result of [] on the relay is expected. Check its `ANALYZER_EXECUTOR` service binding, not for duplicated keys.

## Validation
Commit ece588d109126bcfea53ba51e2c48bb5ea68fad5 passed TypeScript, 4,413 tests (108 skipped), and the production build. Nine new tests cover staging isolation, forbidden payload fields, private-service acknowledgement/retry semantics, missing-binding failure, and public HTTP rejection. The complete deployed Worker module graph compiled without syntax diagnostics and was accepted by Cloudflare.

Both isolated staging queue consumers remained registered. No consumer was attached to shared production queues. No public website deployment or production database migration was performed.

Encrypted binding presence is not a successful live provider or database test. Authenticated synthetic PDF extraction, Quick Review, Deep Scan, saved-report reopening and credit failure checks still require a signed-in staging session. `scripts/Test-AnalyzerStaging.ps1` performs those real calls using a locally supplied Firebase token, without printing credentials.

Wrangler 4.158 rejects custom Pages config paths. The deployment helper places a canonical wrangler.jsonc in the verified release artifact and runs from that directory; it explicitly limits the account, project and queue to staging. Do not use the older Pages --config command from the initial repair notes.

## Actual deployed state
- Credential host version: 8b5e4412-0d1a-4184-8270-70fb2bcb609d (100%).
- Staging relay version: 592a5772-1c06-4730-9aa9-c34e8eec78b4 (100%).
- Repaired Pages release: https://5a68bc90.cyfsa-navigator-staging.pages.dev (successful deployment, artifact source fcaf6878cc83e8a35151e385f7a6951d15c79349).
- Live unauthenticated checks: homepage 200; extract-text, fast/full analyze and report polling all 401.
- Pages retains ANTHROPIC_API_KEY, GEMINI_API_KEY and STAGING_SUPABASE_SERVICE_ROLE_KEY; relay uses the private service binding instead of duplicating secrets.
- Authenticated OCR, Quick Review, Deep Scan, reopening and failure-credit outcomes have NOT been verified; waiting for a user-controlled signed-in staging session. No production changes were made.
