# Design: preserving a validated report when billing finalization fails permanently

Status: Option A is IMPLEMENTED on PR #106 (no schema change, no migration). A validated report whose billing
finalization fails permanently is held in the job record as `billing_pending`, its reservation is kept, and the
same analysis id recovers it after the credit is confirmed. Covered by `analyzerStreaming.billingHold.test.ts` (storage
and hold semantics) and by the route-level suite "billing_pending recovery through the real routes" in `_server.test.ts`:
successful recovery, held report not exposed through job status, wrong paid session, wrong user, expired reservation,
storage failure at hold, storage failure after confirmation, repeated and concurrent retries. Every route case asserts
that the model is not run again and that the reservation is consumed at most once.
A billing outage (credit RPC failure) is distinct from a final reservation outcome (released or missing): outages are
retried and held, final outcomes are not. A held job's sections are withheld from the public job view.
Option B (ledger table) still needs a separately approved migration and is not implemented.

## The problem

When `/api/analyze` produces a validated report, the server:

1. records paid usage (`recordPaidUse`), then
2. finalizes the reservation (`finalizeAnalysisCreditWithRetry`, which marks `reservation:reserved` as `reservation:consumed`), then
3. persists the report to the job store and responds.

If step 2 fails permanently (all retries exhausted), today's behavior is:

- the catch block calls `releaseAnalysisReservation`, which returns the unit,
- the user receives an error,
- the validated report is discarded, and
- the model cost is spent.

Outcome: the user is not charged and receives nothing. That is safe for credit integrity but wasteful, and the user may retry and pay for a second analysis.

## Constraints

- No double charge. A report is delivered only if its reservation was consumed.
- No credit bypass. A report is never delivered as complete without a consumed reservation.
- No AI re-execution on retry. The model must not run again for the same request.
- Authorization unchanged. Only the owner (same Firebase uid) can retrieve the job.
- No production schema change in phase 1.

## Facts from the code (verified in this branch)

- `paid_finalize_credit` (migration `paid_credit_reservation_functions.sql`) is idempotent. `consumed` returns `consumed`. `missing` and `released` are final and are not retried.
- `paid_release_marker` releases only `reservation:reserved*` markers. A consumed reservation cannot be released.
- The reservation expires through reconciliation after `RESERVATION_TTL` (15 minutes).
- The durable job store is one JSON object per job in a private Supabase Storage bucket (`analyzerStreaming.ts`, `persistJobToStorage`). Upload failures are silently ignored, so a persist failure is not visible today.
- The job store is keyed by the analysis id, and existing job retrieval already checks the owner uid.

## Proposed design (phase 1: no schema change)

### New job state, stored in the existing JSON job object

`billing_pending`: the job holds the validated report and the reservation id, and is not yet complete.

- Written only after validation passes and while the reservation is still `reserved`.
- Never returned by the job-status endpoint as a completed report. The status endpoint reports it as "awaiting billing confirmation".

### Flow

1. Report validated. Persist the job as `billing_pending` with the report.
   - If the persist fails, release the reservation and return an error. No report is delivered without its persisted record.
2. Finalize with retry.
   - Success: mark the job `completed` (persist), respond with the report. Normal path.
   - Permanent failure: do NOT release. Leave the job `billing_pending` and return a retryable response (`BILLING_PENDING`) with the analysis id.
3. Recovery (same idempotency key retried, or the job status endpoint is polled by the owner):
   - Owner check on the job (uid match), as today.
   - If `billing_pending`: call `finalizeAnalysisCreditWithRetry` (idempotent). Success returns the stored report and marks the job `completed`. No model call.
   - If finalize returns `RESERVATION_RELEASED` or `RESERVATION_MISSING` (reconciled after TTL): do not return the report. Respond with a final error that says the reservation expired and a new analysis is needed. The user pays for a new analysis if they choose to run one.

### Invariants

- A report is returned only when the job is `completed`, and `completed` is written only after finalize succeeds.
- AI runs at most once per analysis id.
- The reservation is released only when finalize has not succeeded and the job has no validated report.
- If the reconciliation TTL expires before the user recovers, the report is not delivered. This avoids a free report, and it is the stated trade-off.

## Race conditions

- Two concurrent retries: both call finalize. It is idempotent, so both see `consumed`. Only the stored report is returned, so the model does not run twice.
- Job write races: the job record is last-writer-wins JSON. Use a transition check (`billing_pending` to `completed` only) before writing. Two `completed` writes carry the same report, so the race is benign.

## Storage-failure rule

`persistJobToStorage` ignores upload errors today. Phase 1 must treat a failed `billing_pending` persist as a hard failure (release, no report). A failed `completed` persist after a successful finalize may still deliver the report, because the charge is recorded; the recovery record is lost only if a reload is needed.

## Acceptance tests (to write with the implementation)

1. Finalize transient failure, then success: report delivered, one charge, AI called once.
2. Finalize permanent failure: no release, job `billing_pending`, response is `BILLING_PENDING`, AI called once.
3. Recovery after permanent failure, within TTL: report returned, reservation consumed once, AI not called again.
4. Recovery after TTL (reservation released or missing): report not returned, final error returned.
5. `billing_pending` job retrieved by a different uid: denied.
6. `billing_pending` job retrieved through the status endpoint: not returned as completed.
7. Persist failure on `billing_pending`: reservation released, no report delivered.
8. Concurrent recovery requests: AI called once, one consumed reservation.
9. Regression: a consumed reservation is never released (existing SQL behavior, with a mocked RPC test).

## Options considered

- **Option A (recommended, above):** job-store state only. No schema change, reuses idempotent finalize. Limitation: depends on the storage bucket and on the TTL window.
- **Option B: a ledger table** linking reservation id to report hash, with its own status. Stronger audit trail. Requires a migration, which must be prepared separately and approved. Not proposed for phase 1.
- **Option C: extend the reconciliation TTL for `billing_pending` reservations.** Lengthens the window in which a reservation is held, which affects other users' available units. Not recommended without measurement.

## What this design does not solve

- A permanent database outage across the TTL window still loses the report. The user is not charged and gets no report.
- Storage-bucket outages block phase 1 entirely (fail closed).

## Approval needed

- Approval to implement Option A (no schema change).
- Decision on whether to pursue Option B later (migration approval).
