# Stage 10 — parallel-safe slice: owner matter-access audit (service + unmounted route)

Date: 2026-09-24. Branch: `claude/youthful-newton-d1jxff`. Starting SHA: `a134ca54c68c5d5007d33746816ed5d700c38a38`
(Stage 9D-4B-2A-ii-b4B-iii, the last commit before any Form 33B.1 work).

## Roadmap authority

- `HANDOFF.md` §9 Future Roadmap: **Stage 10 — Firm Collaboration / Permissions / Audit**.
- `STAGE_9_ROADMAP_DECISION.md` (E1, capability table, "Why neither a new numbered milestone nor Stage 10 can be
  asserted" item 4): Stage 10 has a documented objective but **no first-milestone contract**; defining its tenant/team
  model would introduce new product decisions. Existing single-matter authorization still applies.

This slice therefore adopts **no** firm/team/tenant model, role, capability, table, column, migration or RLS change.
It is the part of "Permissions / Audit" that can be derived entirely from frozen, already-designed Stage 7B data.

## What was built

| File | Purpose |
|---|---|
| `api/services/matterAccessAudit.ts` | OWNER-only, read-only report for one matter: grant lifecycle events, per-grant recorded vs effective status, current effective access with its basis, integrity findings, explicit limitations. |
| `api/services/matterAccessAudit.test.ts` | Pure-builder behavior + service authorization, isolation, fail-closed and no-write tests. |
| `api/matterAccessAuditRoutes.ts` | `GET /api/matters/:matterId/access-audit`, same auth/error pattern as existing route modules. **Not mounted** (see below). |
| `api/matterAccessAuditRoutes.test.ts` | Route auth, forged identity, owner/reviewer/cross-matter, 400/503, no-write-method tests on an isolated Express app. |

Authorization: `verifyFirebaseToken` → `findAccount` → `navigator_matter_members.role === 'OWNER'` for the exact
matter. REVIEWERs are denied because the report lists other reviewers' account IDs (Stage 7F multi-reviewer isolation).
Non-member and nonexistent-matter callers receive the same 403. Any DB error fails closed; `token_digest` is never
selected. Rows from another matter are discarded before the report is built.

### Integrity findings (signals only; nothing is repaired automatically)

| Code | Severity | Meaning |
|---|---|---|
| `REVOKED_GRANT_MEMBERSHIP_PERSISTS` | CRITICAL | Grant revoked but the account still holds REVIEWER membership — revocation incomplete. |
| `UNBACKED_REVIEWER_MEMBERSHIP` | CRITICAL | REVIEWER membership no accepted grant for this matter explains. |
| `GRANT_ACCEPTED_BY_GRANTOR` | CRITICAL | Grantor accepted own invitation (see defect D2). |
| `UNRECOGNIZED_MEMBER_ROLE` | CRITICAL | Role outside schema; never interpreted as a permission. |
| `ACCEPTED_GRANT_WITHOUT_MEMBERSHIP` | WARNING | Accepted grant, but the account has no reviewer access now. |
| `INCONSISTENT_GRANT_LIFECYCLE` | WARNING | Status and lifecycle columns disagree, or times run backwards. |
| `UNRECOGNIZED_GRANT_STATUS` / `INVALID_TIMESTAMP` | WARNING | Data outside the schema contract; not interpreted. |

### Limitations (returned in every report)

Not an append-only audit log; reviewer reads are not logged anywhere; deleted membership history is unrecoverable;
expiry events are dated by scheduled expiry; findings make no legal determination and change no access.

### Machine / human / legal boundary

This slice contains no AI, extraction, suggestion or legal content. It reports persisted access facts and derived,
explicitly labelled states (`expiryDerived`, `timeBasis: 'EXPIRES_AT'`). It cannot grant, revoke or promote anything.

## Stage 10 dependency map

| Component | Purpose | Class | Stage 9 dependency | Parallel-safe | Rationale |
|---|---|---|---|---|---|
| Owner access-audit service | Permissions/Audit read model over Stage 7B tables | **GREEN — done** | None | YES | New file; frozen schema; reuses existing auth. |
| Access-audit route module | HTTP surface for the service | **GREEN — done (unmounted)** | None | YES | New file; tested on isolated app. |
| Mount route in `api/_server.ts` | Make the route live | YELLOW | Shared-file collision only | NO (now) | `_server.ts` registration block was edited by 9D-4A; Stage 9 form work may edit it again. One line at integration. |
| Owner access-audit UI | Show report to parent | YELLOW | Needs mounted route; `src/App.tsx` shared shell (edited by 9D-3) | NO (now) | Build after mount; UX copy needs owner review. |
| Consolidated permission matrix across all routes | Stage 10 "Permissions" inventory | YELLOW | Stage 9 route/work-product surface not final | NO | Inventory would be stale until Stage 9 freezes. |
| Stage 7B grant-lifecycle remediation (D1–D4) | Fix defects below | GREEN-eligible, **not started** | None | YES | Reopens frozen Stage 7B code and a pending migration; needs explicit authorization. |
| Append-only access/audit event log | True audit trail | RED | Indirect | NO | New table + migration + writes in frozen paths; retention/privacy decisions undocumented. |
| Reviewer data-access (read) logging | Who viewed what | RED | Must cover Stage 9D research and form/work-product routes | NO | Route set not final until Stage 9 freeze; schema needed. |
| Firm/team tenant model and firm-level delegation | "Firm Collaboration" | RED | Owner contract required | NO | Roadmap decision says this introduces product decisions not yet made. |
| Firm-shared permissions on work product / form drafts | Collaboration on drafts | RED | Form 33B.1 draft-review and population engine unfrozen | NO | Directly depends on unfinished Form 33B.1 work. |

## Defects found in frozen Stage 7B code (reported, NOT changed here)

- **D1 — silent revocation failure.** `revokeProfessionalGrant` (`api/services/professionalMatterAccess.ts`) ignores
  the errors from both the grant update and the membership delete and returns `{ success: true }`. A failed delete
  leaves the reviewer with live access while the owner is told it was revoked. The audit flags the result as
  `REVOKED_GRANT_MEMBERSHIP_PERSISTS`.
- **D2 — acceptance can downgrade an OWNER.** `accept_matter_grant` (`create_navigator_matter_access_grants.sql`) upserts
  `on conflict ... do update set role = v_grant.capability` and does not reject the grantor or an existing OWNER. An
  owner who opens their own invitation link becomes REVIEWER. The audit flags `GRANT_ACCEPTED_BY_GRANTOR`.
- **D3 — lazy expiry never persists.** The RPC's `update ... set status = 'EXPIRED'` is followed by `raise exception`,
  which rolls back the update in the same transaction. Lapsed grants stay `PENDING`; the audit derives expiry instead.
- **D4 — revoke can remove a still-backed membership.** Revoking an old accepted grant deletes the REVIEWER row even if a
  newer accepted grant for the same account exists.

These are pending-migration / service defects; no production data was accessed. Fixing them requires an authorized
Stage 7B remediation task and must be validated against live Postgres at the release gate.

## Integration notes

1. After Stage 9 freezes, merge this branch, then add `registerMatterAccessAuditRoutes(app);` to `api/_server.ts`.
2. Add a HANDOFF.md entry at integration time (not edited here, to avoid a collision with the Stage 9 branch).
3. Live Postgres/RLS validation remains a release gate; tests here use mocked Supabase.
