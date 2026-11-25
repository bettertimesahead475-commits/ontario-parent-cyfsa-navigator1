# API Contracts (Cloudflare Pages Functions, same-origin only)

Source of truth is the code under `functions/api/`. Shape changes require an entry here and in `TASK_REGISTER.md`
before implementation. Frontend calls go through `src/utils/api.ts` → `apiFetch()`, which attaches
`Authorization: Bearer <Firebase ID token>` and, when present, `X-PS-Session: <paid session token>`.

## Conventions

- Errors: `{ "error": "<human message>", "code": "<MACHINE_CODE>", "retryable"?: boolean }` with a meaningful
  HTTP status. Clients branch on `code`, never on `error` text.
- `401 AUTH_REQUIRED | SIGN_IN_REQUIRED`: no valid Firebase token. `403`: authenticated but not permitted.
  `405 METHOD_NOT_ALLOWED` (with `Allow`), `404 API_ROUTE_NOT_FOUND`, `429` with `Retry-After` (seconds),
  `503 … retryable:true` for transient dependency failures.
- All responses: `Cache-Control: no-store`. No CORS: the API is same-origin.
- Rate limits (per isolate, see `functions/api/_rate-limit.ts`): extract-text 20/min, transcribe 10/min,
  analyze 8/min, activate-code 6/10 min, request-access 5/10 min, admin writes 30/min.

## Customer endpoints

| Method & path | Auth | Request | Success response |
|---|---|---|---|
| `GET /api/health` | none | — | `{status:"ok", service, platform, timestamp}` |
| `GET /api/status` | none (detail for administrators) | — | `{status, analyzerReady, forensicQueueReady, …}` |
| `GET /api/access-pricing` | none | — | package catalogue and prices (pricing is owner-controlled) |
| `POST /api/extract-text` | Firebase | `{fileData:{base64, mimeType, name}}` ≤ 20 MB; PDF, DOCX, TXT, PNG/JPEG/WebP, HEIC/HEIF | `{text, pages?, method, …}`; errors `FILE_TOO_LARGE`, `INVALID_REQUEST`, extraction codes |
| `POST /api/transcribe`, `/api/transcribe-audio` | Firebase | audio payload | transcript |
| `POST /api/analyze` | Firebase (+ `X-PS-Session` for paid) | `{mode:"fast"|"full", documentText|text|textContent, documentName, analysisId?, sessionId?, stream?}` | Quick: report (or SSE when `stream`); Forensic: `202 {jobId, status:"queued", …}`. `409 ANALYSIS_ID_CONFLICT` if `analysisId` belongs to another user; `ANALYSIS_IN_PROGRESS` with `jobId` for duplicates |
| `GET /api/analyze/job/:jobId` | Firebase (owner only) | — | `{jobId, status:"queued"|"running", currentStage, percent}` → `{status:"completed", percent:100, report}` or `{status:"failed", error:{code,message,retryable}}`. `403` for another user's job |
| `POST /api/deep-scan` | Firebase | `{analysisId}` | Forensic entry point (queue) |
| `GET|POST /api/final-case-assessment` | Firebase | `{matterId, …}` | Final Case Assessment |
| `GET /api/analyzer-usage` | Firebase | — | free/paid usage and remaining credits |
| `POST /api/request-access` | Firebase (verified email) | `{tier, requestKey?}` | `{referenceNumber:"PS-XXXXX", amount, instructions}` (Interac e-Transfer instructions; idempotent per `requestKey`) |
| `POST /api/activate-code` | Firebase | `{code, email, referenceNumber?}` | `{sessionToken, sessionId, tier, expiresAt}`; `403 PURCHASE_REFERENCE_REQUIRED` when the signed-in email differs from the purchase email; `401` for any mismatch (never reveals which part) |
| `POST /api/csp-report` | none | CSP report | `204` |
| `/api/professional-workspace/*` | Firebase | see `functions/api/professional-workspace/[[path]].ts` | |

## Administrator endpoints (`functions/api/admin/[[path]].ts`)

Authorization: Firebase ID token, verified email, email on `ADMIN_EMAILS` (server env, comma separated; default:
site owner), optional `ADMIN_UIDS` pin. No shared secret; `x-admin-secret` is ignored. `401 AUTH_REQUIRED`,
`403 ADMIN_REQUIRED`, `503 AUTH_UNAVAILABLE`. Unknown routes `404` and wrong methods `405` are answered before
authorization and touch nothing. POST bodies must be `application/json` ≤ 4 KB.

| Method & path | Body / query | Response |
|---|---|---|
| `GET session` | — | `{admin:true, email}` |
| `GET payments/overview` | — | `{payments:[{referenceNumber, customerEmail, firebaseUid, package, amount, status, submittedAt, approvedAt, bankSettlementStatus, sessionId, accessStatus, creditsGranted, creditsConsumed, creditsRemaining, lastActivity}], sessions:[…]}` |
| `GET customers?q=` | exact email, Firebase uid, or `PS-` reference | `{identity, payments, sessions, accessCodes, jobs, freeUsage, auditTrail}`; only rows of that exact customer |
| `GET access-codes?state=unused|redeemed|expired` | — | `{accessCodes:[{id, email, tier, referenceNumber, createdAt, usedAt, expiresAt, state}]}` (never hashes) |
| `GET jobs?status=failed|running|queued|completed` | — | `{jobs:[…]}` (`error_message` ≤ 240 chars) |
| `GET usage` | — | 7-day job counts by mode, average durations, failures by code |
| `GET revenue` | — | `{currency:"CAD", totals, byMonth, byPlan, tierSummary}` |
| `GET audit` (alias `payments/audit-history`) | `limit` ≤ 40 | `{total, events:[{at, action, target, admin, reason, details}]}` |
| `GET monitoring/status`, `POST monitoring/run` | — | `{checkedAt, healthy, status, database:{reachable, latencyMs}, stuckJobs, recentFailures}` |
| `POST payments/approve` | `{referenceNumber, amountReceived}` | `{accessCode, expiresAt, customerEmail, tier}`: code shown once, only its SHA-256 stored. `409` if already processed |
| `POST payments/confirm-bank` | `{referenceNumber, reason?}` | `{bankSettlementStatus:"bank_confirmed"}` |
| `POST payments/dispute` | `{referenceNumber, reason}` | `{bankSettlementStatus:"missing_or_disputed"}` |
| `POST payments/reset-settlement` | `{referenceNumber, reason?}` | `{bankSettlementStatus:"pending_settlement"}` |
| `POST payments/refund` | `{referenceNumber, reason, revokeAccess?=true}` | record only (funds returned manually): `{paymentRejected, codesExpired, sessionsRevoked}`; `409 ALREADY_REFUNDED` |
| `POST payments/suspend` | `{sessionId, reason}` | `{status:"suspended"}`; `409` if not active |
| `POST payments/restore` | `{sessionId, reason?}` | `{status:"active"}`; only for entitlements suspended from the console |
| `POST access-codes/revoke` | `{codeId, reason}` | `{state:"expired"}`; `409` if redeemed |
| `POST credits/restore` | `{sessionId, credits:1..25, reason}` | `{creditsRestored, creditsRemaining}`; compare-and-set, `409 CONCURRENT_UPDATE` |

Every state change is a conditional database update (exactly-once under concurrency) and writes an immutable
audit object `analysis_jobs/admin-audit/<timestamp>__<action>__<target>__<nonce>.json`.
