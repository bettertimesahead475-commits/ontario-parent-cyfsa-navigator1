# Stage 10 slice 4: atomic access lifecycle + audit events (contract v3)

Date: 2026-09-24. Branch: `claude/stage-10-lifecycle-audit`.

## Integration

- **Starting point:** Stage 10 slice 3 `08d751a` (PR #29 → #28 → #26).
- **Stage 7B:** the frozen PR #27 candidate `a452c6c` is integrated by a **merge commit** (`--no-ff`).
  - Both frozen commits, `5d55c27` and `a452c6c`, keep their identities in history.
  - The merge had no conflicts and edited no file; PR #27's files are byte-identical to `a452c6c`.
- **Freeze precondition:** the independent freeze of `a452c6c` was confirmed by the project owner in this session.
  No freeze review is recorded on PR #27 itself.
- **Stage 9:** not merged. Stage 9 (`e24ce01`) is closed on its own line, and nothing here depends on it.

## Two authorities, not duplicated

| Authority | Owner | Role here |
|---|---|---|
| Access lifecycle | `create_matter_grant` (new), `accept_matter_grant`, `revoke_matter_grant` | Decide whether a change is allowed and perform it. Accept and revoke keep the frozen `a452c6c` logic verbatim: same checks, locks, errors and return shape. |
| Audit events | `record_matter_access_event` (slice 2) | Records what happened. It derives the actor account, the actor's matter role and the timestamp itself. The lifecycle functions pass only the verified uid (or NULL for a system-observed expiry) and identifiers taken from the row they just mutated. |

## Atomicity

- Each lifecycle function is one PostgreSQL statement, and therefore one transaction.
- Events are recorded after the mutation succeeds, inside that same function. Any failure, in the mutation or in any
  event insert, raises and rolls back everything.
- There is **no application-level two-step write.** The service makes one lifecycle RPC per operation, preceded only by
  the read-only contract check.

## Events wired (only types already in the slice 2 vocabulary)

| Transition | Events (exactly) |
|---|---|
| Invitation created (PENDING) | `GRANT_CREATED` |
| PENDING → ACCEPTED, reviewer had no membership | `GRANT_ACCEPTED`, `REVIEWER_ACCESS_ADDED` |
| PENDING → ACCEPTED, reviewer already had access via another grant | `GRANT_ACCEPTED` only |
| PENDING → EXPIRED (persisted on an acceptance attempt after expiry) | `GRANT_EXPIRED` (SYSTEM actor) |
| → REVOKED, and the membership was removed | `GRANT_REVOKED`, `REVIEWER_ACCESS_REMOVED` |
| → REVOKED, another ACCEPTED grant still backs access | `GRANT_REVOKED` only (no false "access removed") |
| PENDING → REVOKED | `GRANT_REVOKED` (no subject) |
| Repeated revoke (no transition) | nothing |
| Repeated revoke that clears a pre-remediation lingering membership | `REVIEWER_ACCESS_REMOVED` only (a real transition) |
| Any refused operation (owner self-accept, non-owner, unknown/malformed input, contract mismatch) | nothing: it raises and rolls back |

**Expiry.** An invitation becomes EXPIRED in the database only when someone tries to accept it after `expires_at`
(Stage 7B behaviour). That persisted transition is recorded. An invitation that lapses and is never used is never
mutated, so **no expiry event is fabricated** for it; a test proves this. The event is recorded as SYSTEM because
expiry is a time-based fact. The acceptance attempt only observed it.

**Refusal logging** (e.g. an owner trying to accept their own invitation) is not wired. A refused lifecycle call raises
and rolls back its transaction, so a refusal record cannot share it. Recording refusals would need an explicit design
decision. The slice 2 recorder already supports bounded refusal events.

## Idempotency and cardinality

- Transitions are guarded by grant status under a row lock. A second accept is refused (`INVALID_STATE`), and a second
  revoke is a successful no-op. **A retry after an ambiguous network failure therefore never creates a duplicate
  event.**
- Every transition has an exact expected event list, asserted in tests. So do the zero-event cases (refusals and
  retries).

## Contract v3 (approved in this session)

- `navigator_matter_access_lifecycle_contract()` is **unchanged** and still returns the frozen
  `navigator_matter_access_lifecycle_v2`.
- New: `navigator_matter_access_lifecycle_contract_v3()` returns `navigator_matter_access_lifecycle_v3`.
  - It exists only when the audited functions are installed, because it is created in the same transaction.
  - It is constant, not `SECURITY DEFINER`, and `service_role`-only.
- Create, accept and revoke all require exactly v3 **before any lifecycle call**. A v2-only database (safe functions but
  no audit wiring) is refused, so new code can never change access without an audit record.

## Deployment order (enforced where possible)

1. `remediate_navigator_matter_access_grants_lifecycle.sql` (Stage 7B, v2)
2. `create_navigator_matter_access_event_log.sql` (slice 2)
3. `create_navigator_matter_access_lifecycle_audit_v3.sql` (this slice)
   - It checks steps 1 and 2 and aborts with `PREREQUISITE_MISSING` if either is absent.
   - The failed install leaves nothing behind; a test proves this.
4. The application code from this branch.

| Database | Code | Behaviour (tested) |
|---|---|---|
| Legacy (pre-7B) | this branch | Refused before any lifecycle call (no v3) |
| v2 only (7B) | this branch | Refused before any lifecycle call, including create |
| v2 + event log (no v3) | this branch | Refused (no v3) |
| v3 | this branch | Correct, fully audited |
| v3 | frozen Stage 7B code (`a452c6c`) | Works. Accept and revoke are audited, because the functions record events. Create uses the old direct insert, so **`GRANT_CREATED` is not recorded**. Access-safe. |

## Rollback boundary

- **Application rollback** from this branch to the frozen Stage 7B code is safe at any time after the v3 migration. The
  only loss is the `GRANT_CREATED` event for invitations created by the old code.
- **Database rollback** of the v3 migration must come **after** the application is rolled back. Otherwise this branch's
  code fails closed and stops offering create/accept/revoke. That is unavailable but never unsafe.
- No down-migration is provided. Reverting would mean restoring the `a452c6c` function bodies and dropping
  `create_matter_grant` and the v3 contract function.

## Compatibility with slices 1–3

- **Slice 3 history** shows the wired events through the unchanged read model and `AccessHistoryPanel`. The summaries
  come from the server, so nothing is reconstructed on the client. A test checks the exact summary sequence for a
  two-grant scenario, including the absence of "Reviewer access removed" while another grant still backs access.
- **Slice 1 current-state report** is still computed only from live grant and membership rows.
  - A test deletes a membership out of band. The report shows the loss and raises `ACCEPTED_GRANT_WITHOUT_MEMBERSHIP`,
    while history still (correctly) shows the earlier `REVIEWER_ACCESS_ADDED`.
  - **History is never used as the authority for current access.**

## Privacy

No event column was added. Events carry identifiers and fixed vocabulary only. Neither the raw token nor its digest ever
appears in the event log; a test asserts this.

## Verification (real PostgreSQL 16, disposable local databases)

- `professionalMatterAccessAudit.pg.test.ts`: 54 tests. It covers:
  - the exact event list for every transition
  - refusals and retries recording nothing
  - failure injection on every event type individually, on the lifecycle mutation, and via a CHECK constraint, each
    proving a full rollback
  - six concurrency scenarios × 15 iterations, with an invariant check and deadlocks asserted to be 0
  - authority (no actor, role or timestamp parameters) and contract/privilege checks
  - migration prerequisites
  - rollback compatibility
  - slice 1 and slice 3 compatibility
  - privacy
- `professionalMatterAccess.pg.test.ts` (PR #27's suite): its 23 SQL tests now run against **both** the frozen v2
  functions and the v3 functions, proving every Stage 7B fix is preserved. It also has 3 new v2-only deployment cases.
- **Mutation testing:** 27 lifecycle/audit mutants are killed. They include removing each audit insert, swallowing each
  event type's failure, duplicate insertion, the wrong actor, subject, matter or grant, a wrong timestamp, a removed
  prerequisite check, a contract reporting v2, bypassing the contract gate, a removed response identity guard, and
  app-level audit writes either after the lifecycle transaction or before it.
- **Not validated:** a hosted Supabase project.

## Dependency map (after slice 4)

| Component | Class |
|---|---|
| Slices 1–4 | GREEN, done |
| Mount the Stage 10 routes / place the panel | YELLOW: `api/_server.ts` and `src/App.tsx` integration decision |
| Refusal-event logging for lifecycle denials | YELLOW: needs a design decision (a refused call rolls back its own transaction) |
| Emit `ACCESS_AUDIT_VIEWED` from the slice 1 report | YELLOW: product decision |
| Retention/erasure policy; admin reader | YELLOW: owner/legal decision |
| Reviewer data-read logging | YELLOW → now unblocked by the Stage 9 closure, but needs a design and an audit of the Stage 9 routes |
| Firm/team tenant model | RED: no roadmap contract |
