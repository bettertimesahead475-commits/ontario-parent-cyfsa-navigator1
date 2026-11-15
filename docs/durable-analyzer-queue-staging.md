# Durable analyzer queue: staging setup

This branch adds asynchronous analysis without changing pricing or entitlement rules. The Pages Function authenticates the Firebase user and reserves an existing credit, creates a job row, writes the document into the existing private `analysis_jobs` bucket under `inputs/<jobId>.json`, and publishes exactly `{ "version": 1, "jobId": "..." }`. The separate consumer Worker uses the existing Sonnet Quick Review and Sonnet plus Opus Forensic In-Depth pipelines.

## Bindings and secrets

Configure the Pages project with [wrangler.pages.jsonc](../wrangler.pages.jsonc), or add the same producer binding in the Pages project settings:

| Binding | Type | Resource/value |
| --- | --- | --- |
| `ANALYZER_JOBS_QUEUE` | Queue producer | `cyfsa-analyzer-jobs` |
| `ANALYZER_JOBS_REQUEUE` | Queue producer on the consumer Worker | `cyfsa-analyzer-jobs` |

Create/configure the separate consumer from [wrangler.analyzer-queue-consumer.jsonc](../wrangler.analyzer-queue-consumer.jsonc). It consumes both `cyfsa-analyzer-jobs` and `cyfsa-analyzer-dead-letter`; the primary queue sends messages to the DLQ after five failed deliveries. Consumer concurrency is limited to two, with one message per batch.

Set these as encrypted Worker secrets for **both** the Pages project and consumer Worker:

- `STAGING_SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`

Set `STAGING_SUPABASE_URL`, `FIREBASE_PROJECT_ID`, and `ANALYZER_ENABLED=true` as non-secret Worker variables on both. The existing optional model and budget variables remain available. Do not configure the service-role key in frontend build variables. The consumer does not need a Firebase token: it trusts only the job row loaded through its service-role database binding.

## Required staging steps

1. Apply `supabase/migrations/20261104230000_durable_analyzer_queue.sql` to the staging Supabase project. It creates the RLS-protected `analyzer_jobs` ledger and service-role-only RPCs for creation, atomic claims, updates, retrieval, and DLQ failure/recovery.
2. Confirm the existing `analysis_jobs` Storage bucket is private and that the server-side service-role key can write/read it. Inputs and reports are separate objects; the browser receives neither object path nor storage credentials.
3. Attach the producer binding to the Pages deployment and configure the two queue consumers from the consumer config. The named queues already exist; no queue creation is needed.
4. Add the listed secrets and `ANALYZER_ENABLED=true` to staging only. No production environment values are required by this change.
5. Build and deploy the Pages project and the dedicated consumer only after reviewing this branch. Deployment is intentionally not performed by this change.

## Recovery and billing order

The Postgres `UPDATE ... WHERE status='queued' OR lease expired` claim is the concurrency boundary. A worker saves the report before calling the existing idempotent credit finalizer, then marks the row complete. If it stops after saving the report, its retry reads the report and repeats only the finalizer. Retryable errors return the row to `queued` and use bounded exponential Queue delay. Permanent errors mark the row failed and release its reservation. The DLQ consumer waits for an active lease, requeues abandoned jobs under a durable attempt cap, recovers reports already saved, and marks exhausted jobs failed with reservation release.

Storage object write/read failures are surfaced and retried only when classified transient; no response claims completion if the report could not be recovered. Existing synchronous JSON and SSE remain supported when the Pages queue binding is absent. With the binding configured, requests return 202; the frontend polls the authenticated status endpoint and recovers the same report after refresh.
