# Stage 10 completion decisions (authoritative contract)

- **Date:** 2026-09-24.
- **Base:** `audit/stage-10-slice-6-lifecycle-http-adapter-frozen`, which is `bd1226cdbb82f5151aa55772ff0c3fa381a5e8dc`.
- **Status:** decisions recorded by the project owner; this document itself is a draft awaiting independent audit.
- **What this document fixes:** the scope, decisions and remaining work that close Stage 10. It must not be edited to add
  scope. A further Stage 10 slice may be added **only** to remediate an independently verified blocking defect.

> The four decisions below are the project owner's product and security choices, recorded so implementation has a
> fixed target. They are **not legal conclusions.** Recipient email processing (Decision 1), disclosure of the
> professional's identity to the parent (Decision 3) and retention (Decision 4) involve personal information in a
> child-protection context. Legal/privacy review is recommended before production activation (§12).

---

## 1. Authoritative Stage 10 scope

`HANDOFF.md` §9 names Stage 10 "Firm Collaboration / Permissions / Audit". No milestone contract existed
(`STAGE_9_ROADMAP_DECISION.md`). This document supplies it:

**Stage 10 delivers matter-level professional permissions and audit.**

**A parent (matter OWNER) can:**
- invite a specific professional to one matter
- see each invitation's and access grant's state
- identify the intended professional and the professional who accepted
- revoke pending or active access
- inspect the matter's access history

**The intended professional can:**
- authenticate
- accept their recipient-bound invitation
- gain REVIEWER access to that matter
- work in it through the existing Professional Workspace (Stage 7C)

**Every lifecycle transition** remains auditable (append-only event log) and transactionally safe: an audit write
happens in the same transaction as the change it records, or the change does not happen.

**Stage 10 does not implement a firm, team, organization or tenant model.** True firm/team tenancy is moved to a future
roadmap stage by this amendment.

## 2. Corrections to the completion-planning audit

| # | Correction |
|---|---|
| C1 | **Slice 7 is not isolated from mounted behavior.** The lifecycle mutation routes stay unmounted, but Slice 7 changes the owner's current-state report, and `GET /api/matters/:matterId/access-audit` has been **mounted since Slice 5**. Any professional identity added to that report is a change to a **live read surface**. Decision 3's privacy requirements are therefore part of the Slice 7 contract, and Slice 7 testing and audit must cover the mounted report route. |
| C2 | **Rate limiting.** A per-account write limiter is required before the lifecycle routes are mounted (Slice 8). An instance-local implementation is acceptable for Stage 10 if: (a) its limitation is documented; (b) it is never described as a globally enforced or distributed limit; (c) the existing `/api` IP limiter stays in place; (d) tests verify the intended local, per-account behavior. A distributed/shared rate-limit store is **not** required for Stage 10 and is recorded as post-Stage-10 hardening (§11). |
| C3 | **Precise wording.** "No application code path found during the Stage 10 completion audit automatically provisions a lawyer-role account." This does not claim that no lawyer account can exist: administrative or database-level role assignment may exist outside normal provisioning. Also: "Audit events are structurally capable of outliving their associated matter if a matter is deleted, because the event table does not use a cascading foreign-key relationship." This does not claim that matter deletion currently happens; no application deletion path has been established. |
| C4 | **The invitation URL is environment-relative.** The owner's browser builds the link from its own current application origin: `<current origin>/accept-invitation#t=<token>`. No Preview or Production domain is hard-coded, and no server environment variable is needed for link construction. Preview therefore produces Preview links and Production produces Production links. The raw token lives only in the URL fragment (§7). |

## 3. Decision 1: recipient binding (LOCKED)

**Invitations are bound to the intended recipient by verified email.**

- **Creation:** the owner supplies the intended professional's email when creating an invitation.
- **Acceptance:** requires that the authenticated caller's **trusted Firebase ID-token claims** carry an `email` whose
  normalized form equals the invitation's recipient, **and** `email_verified === true`.
  - An email in the acceptance request body is never trusted. The accept body stays `{ token }` only.
- **A forwarded token alone grants nothing** to any other authenticated user. That includes a user whose email matches
  but is unverified, and a user with no email claim.

**Normalization rule (the one canonical rule; applied identically at creation and acceptance):**
1. Trim surrounding whitespace.
2. Lower-case the whole address, locale-independently.
3. Validate: 3–254 characters, exactly one `@`, a non-empty local part and domain, and printable ASCII only.
   Anything else is refused at creation, and never matches at acceptance.
   - Non-ASCII addresses are refused rather than Unicode-normalized, to avoid ambiguous comparisons.
   - This restriction may only be relaxed by amending this contract.
4. **Nothing else.** No removal of dots or plus-tags, no domain rewriting, no alias guessing, no provider-specific
   rules.

The rule must be implemented once, shared by creation and acceptance, and unit-tested with at least: surrounding
whitespace, mixed case, dots, plus-tags, non-ASCII, multiple `@`, and over-length input.

**Representation (recorded recommendation; confirmed in the Slice 7 implementation):**
- Store the normalized recipient email **once**, on the grant row, in a new column added by an additive migration.
- A digest-only representation cannot meet Decision 3, which requires showing the intended recipient of a
  *pending* invitation. Storing a digest alongside a display copy would keep the same personal information twice.
- The recipient email is **not** written to the append-only event log. Events keep identifiers only, as in Slice 2.
  This keeps the PII in one row that the owner can see and that a future retention policy can act on.

**Firebase contract:**
- `verifyFirebaseToken` currently returns `{ uid, email }` and **not** `email_verified`.
- Slice 7 extends it to also return `emailVerified` from the verified token.
- `checkRevoked: true` stays unchanged.

**Database contract:**
- Historical v1, v2 and v3 migrations are **not** rewritten.
- An additive **v4** lifecycle contract is expected: new migration, new `navigator_matter_access_lifecycle_contract_v4()`,
  and the service requires exactly v4.
- The accept function takes the trusted verified email as an argument from the server-side service, never from the
  client.

**Ordering requirement:**
- The frozen v3 `accept_matter_grant` saves EXPIRED (and records `GRANT_EXPIRED`) *before* its remaining checks.
- In v4, the recipient/verification check must happen **before any state change**. A caller who is not the verified
  recipient must cause no write at all: no expiry transition, no event.
- They get the same non-enumerating refusal as an unknown token (§9, "recipient mismatch does not reveal invitation
  validity").

## 4. Decision 2: acceptor policy (LOCKED)

**Stage 10 does not require a special lawyer-role account.** The acceptor must be:
- authenticated
- active (`accounts.status = 'active'`)
- the recipient identified by Decision 1, with a verified email matching the invitation
- otherwise eligible under the existing rules: not the grantor and not an OWNER of the matter (Stage 7B owner
  preservation)

**Not added in Stage 10:** lawyer-account provisioning, Law Society or other credential verification, firm membership
requirements. These are separate future capabilities.

**Preserved:** a REVIEWER cannot create or revoke access (both remain OWNER-only in the database), and owner/co-owner
protections are unchanged.

## 5. Decision 3: owner identity visibility (LOCKED)

**The owner must be able to identify the professional they invited and the professional who accepted.**

- **Minimum identity shown:** the professional's **email**.
  - Under Decision 1 the accepting identity is bound to the invitation's recipient email.
  - That stored recipient email therefore identifies both the intended and the accepting professional, without
    exposing `accounts.email`, uids or account ids.
- **Not acceptable as the owner's only identifier:** `acceptedByAccountId`, a Firebase uid, or an internal account UUID.
- **Optional, not required:** a professional-profile display name, only if it adds no new Stage 10 dependency.

**Privacy contract (this changes a live, mounted read response; see C1):**
- Professional identity fields are returned **only to OWNER callers**. This is already the report's authorization
  boundary (`getMatterAccessAudit`).
- REVIEWER callers must not gain other professionals' identities through any Stage 10 route. That includes the report
  (which stays owner-only), the event and history routes (whose events carry no email), and the lifecycle responses.
- Unauthorized callers receive **no** identity information, including in error responses.
- No token digest is returned.
- No Firebase uid is returned, and no internal account id beyond what the report already returns under its frozen
  contract.
- **Mounted report route tests:**
  - an owner sees the emails
  - a reviewer, stranger, revoked reviewer, suspended account and cross-matter caller receive the same refusal, with
    no email in the body
  - every error body is free of recipient identity
- **The independent Slice 7 audit** treats this as a privacy-sensitive live-surface change.

## 6. Decision 4: retention (LOCKED)

**No legal retention period is chosen in Stage 10.** Append-only audit behavior is preserved unchanged.

**No purge, redaction or deletion** is implemented in Slice 7 or Slice 8 to complete Stage 10.

**Current technical behavior (documented, not changed):**

| Record | Behavior |
|---|---|
| Invitation / grant rows | Kept. `expires_at` is enforced. An expiry is saved on an acceptance attempt, and otherwise derived by the report. |
| REVIEWER access | No time-based expiry; lasts until revoked |
| Access event log | Append-only: UPDATE, DELETE and TRUNCATE are refused by triggers. No application deletion path exists. |
| Events vs. a deleted matter | Events are structurally capable of outliving their matter if a matter is deleted (no cascading foreign key) (C3) |
| Recipient email (new in Slice 7) | Kept on the grant row, under the same (unset) policy |

- The retention/erasure policy requires separate legal/privacy review.
- Any future purge or redaction needs its own contract and security review, and must not silently weaken the
  append-only protections.
- The deployment checklist must acknowledge this model before activation (§12).

## 7. Invitation link and token contract (implemented in Slice 8)

- **Link:** the owner's browser constructs `<window.location.origin>/accept-invitation#t=<token>`. There is no
  environment-specific base URL setting (C4).
- **The raw token:**
  - is returned only once, in the create response (`Cache-Control: no-store`), and held in memory only for display and
    copying
  - is never stored plaintext in the database; only its SHA-256 digest is stored (frozen)
  - never appears in a URL query or path, so normal navigation never sends it to the server or to its logs
  - is never written to analytics, `localStorage`, `sessionStorage` or audit events
- **Acceptance page:**
  1. Read `t` from the URL fragment.
  2. Hold it in memory.
  3. Immediately clear the fragment from the visible URL and history with `history.replaceState`.
  4. Require authentication (the existing `RequireAuth` renders in place and keeps the page).
  5. Submit the token only in the body of the authenticated `POST /api/access-invitations/accept`.
  6. Never persist the raw token client-side.

## 8. Slice 7: recipient-bound lifecycle contract (LOCKED)

- **Name:** Stage 10 Slice 7: Recipient-bound lifecycle contract.
- **Purpose:** implement Decisions 1–3 with the lifecycle mutation routes still unmounted.
- **Router mounted:** **NO.**
- **Frontend:** **NONE.**
- **Live surface changed:** **YES.** The owner current-state report (C1).

**Expected work:**
- An additive v4 migration:
  - a recipient column on grants
  - recipient-bound `create_matter_grant`
  - verified-email `accept_matter_grant`, with the recipient check before any write
  - a v4 contract function
- The service requires contract v4. Create takes the recipient email; accept passes the trusted verified email from
  the server.
- `verifyFirebaseToken` returns `emailVerified`.
- The owner current-state report (`matterAccessAudit.ts`) adds the recipient email per grant, owner-only.
- The Slice 6 adapter:
  - create body `{ recipientEmail, expiresInDays? }`
  - accept stays `{ token }`
  - identity is taken from the verified token only
- The error mapper changes only where new service messages require it. Its drift test must stay green.
- Tests (§9); real-PostgreSQL suites; mutation testing; full regression of every frozen guarantee.

**Not in Slice 7:** mounting, UI, rate limiting, retention mechanisms, create idempotency, decline, email delivery.

## 9. Slice 7 security acceptance criteria

The Slice 7 implementation must prove, on real PostgreSQL where the behavior lives there:

- **Creation**
  - The owner can create a recipient-bound invitation.
  - A reviewer cannot create one.
- **Acceptance by recipient**
  - The matching verified recipient can accept.
  - A forwarded token used by a different verified email cannot accept.
  - A matching but **unverified** email cannot accept.
  - An **absent** email claim cannot accept.
  - **Recipient mismatch does not reveal invitation validity.** The response is identical to an unknown token, and no
    state or event changes, even for an expired invitation.
- **Eligibility**
  - The grantor cannot improperly accept.
  - An existing owner cannot become a reviewer.
  - An inactive account cannot accept.
- **Lifecycle**
  - Tokens remain single-use, and expiry remains enforced.
  - A pending invitation can be revoked, and accepted access can be revoked.
  - A reviewer cannot revoke.
  - Behavior with multiple grants for one reviewer remains correct.
  - Owner preservation remains correct.
  - Cross-matter attacks fail.
- **Non-enumeration and audit**
  - Non-enumeration remains intact across all refusal classes.
  - Audit writes remain in the same transaction, and an audit failure causes full rollback.
- **Concurrency**
  - Concurrent acceptance remains safe.
  - Accept racing revoke remains safe.
- **Privacy**
  - The raw token is never persisted.
  - The normalization rule is applied identically at creation and acceptance, and is unit-tested (§3).
  - **Mounted report:** professional identity is returned only to authorized owner callers; a reviewer cannot enumerate
    identities through it; an unauthorized caller receives no identity; no error body contains identity.
- **Boundaries**
  - The mounted Slice 5 read routes keep their authorization boundaries.
  - The lifecycle mutation routes remain unreachable (Slice 6 unmounted test stays green).

## 10. Slice 8: activation (FINAL Stage 10 slice)

- **Name:** Stage 10 Slice 8: Activation.
- **Responsibilities:**
  - Mount the independently audited lifecycle adapter. Replace the Slice 6 unmounted test with an exact mounted-surface
    test.
  - Add a per-account write limiter on the lifecycle routes; document it as instance-local if it is; keep the existing
    IP limiter (C2, §11).
  - **Owner "Professional access" UI** on the existing owned-matter screen:
    - create an invitation with the recipient email
    - build the environment-relative fragment link (§7)
    - show pending, active, revoked and expired states as the contract supports, with the professional's email
    - revoke access
  - **`/accept-invitation` page:**
    - consume the fragment token and clear it safely
    - authenticated acceptance
    - hand off to the Professional Workspace
  - End-to-end HTTP and real-PostgreSQL tests, accessibility tests, mutation testing.
  - A deployment prerequisites checklist (§12) and the Stage 10 closeout.
- **Not required:** a shared/distributed rate-limit store; production deployment. Code completion plus independent
  audit closes the stage.

## 11. Rate-limit decision

- **Required before mounting (Slice 8):** a per-account (verified uid) write limiter on the lifecycle routes.
  - It may be **instance-local**. It must then be documented as such and never described as a global or distributed
    limit.
- **Kept:** the existing `/api` IP limiter. Note: its default store is also in memory, per serverless instance.
- **Tests:** verify the per-account behavior within one instance.
- **Post-Stage-10 hardening (out of scope):** distributed/shared rate-limit store infrastructure.

## 12. Deployment prerequisites (before production activation of Slice 8)

1. **Retention acknowledgement (required).** The deployer acknowledges in writing:
   - the current retention model (§6)
   - that the retention/erasure policy is unresolved and awaiting legal/privacy review
   - that activation starts creating append-only access records and grant rows holding recipient emails, which the
     application cannot currently delete
2. Confirm which Supabase project Preview uses and which Production uses. They must be separate for case data.
3. Confirm migration state in the target: grants, 7B remediation (v2), event log, v3, v4, applied in that order. The
   service fails closed without v4.
4. Confirm `ALLOWED_ORIGINS` for each environment, with no wildcard.
5. Confirm the Firebase project and service-account configuration for each environment, and that sign-in providers
   issue `email_verified`.
6. Confirm the service-role key is server-side only.
7. Legal/privacy review of Decisions 1, 3 and 4 is recommended.

## 13. Out of scope for Stage 10

- firm, team or tenant architecture; organization management
- lawyer-role provisioning; Law Society or credential verification
- email delivery; notification infrastructure
- reviewer-side history panel
- invitation decline
- refused-attempt event logging
- create idempotency
- a shared/distributed rate-limit store
- retention purge or redaction implementation
- unrelated Professional Workspace enhancements
- Stage 9; Form 33B.1
- analyzer changes; payment/access-code changes
- unrelated UI redesign; unrelated schema cleanup

## 14. Final Stage 10 slice

| | |
|---|---|
| Expected final Stage 10 slice | **8** |
| Total expected Stage 10 slices | **8** |
| Remaining implementation slices after Slice 6 | **2** (Slice 7, Slice 8) |

No further Stage 10 slice may be added unless an independently verified blocking defect requires remediation.

## 15. Stage 10 Definition of Done

Stage 10 is complete when Slices 7 and 8 are independently audited and frozen, and all of the following hold. Each is
objectively testable.

1. **Database:** contract v4 is installed by an additive migration, with v1–v3 untouched. Real-PostgreSQL tests prove:
   recipient binding; recipient check before any write; audit writes in the same transaction; rollback on audit failure;
   concurrency safety.
2. **Service:** requires exactly v4. Recipient email is normalized by the single rule in §3. Acceptance uses only the
   trusted, verified token email. All frozen Stage 7B protections still pass (BUG 1–4, owner preservation, UUID
   handling).
3. **HTTP:**
   - Exactly the Slice 5 GET routes plus the three lifecycle POST routes are mounted; asserted from the live route table.
   - No method/path collisions; CORS allowlist unchanged.
   - Per-account write limiter present and documented (§11).
   - The token is accepted only from the request body.
4. **Owner workflow (end-to-end, mounted HTTP, real PostgreSQL):**
   - invite by email, see it pending with the email, then revoke it
   - invite, the recipient accepts, the owner sees the accepted professional's email, the owner revokes, and access is
     gone
5. **Reviewer workflow:** open the link, sign in, accept, and the matter appears in the Professional Workspace. The
   fragment is cleared. Replayed, revoked, expired, unknown and wrong-recipient links all show one "unavailable"
   message.
6. **Authentication and authorization:** 401 without a verified token. The database is the only access authority. A
   reviewer cannot create or revoke. Owners are never downgraded.
7. **Non-enumeration:** one response per refusal class per operation, including recipient mismatch; asserted on real
   PostgreSQL.
8. **Auditability:** exact event lists per transition, asserted through HTTP. Reads write nothing. No email appears in
   events.
9. **Revocation:** the three cases (pending; alternate backing grant; final grant) are distinct, idempotent, and safe
   under accept-versus-revoke races.
10. **Privacy:**
    - token contract §7 holds (tested in UI and HTTP)
    - the owner-only identity contract §5 holds on the mounted report
    - no digests or uids appear in responses
11. **Accessibility:** new controls are native, labelled buttons and inputs; status and alert roles; keyboard operable;
    tested.
12. **Quality gates:**
    - lint, typecheck and build pass
    - the full suite shows 0 candidate-only regressions **by test identity** against the frozen predecessor
    - mutation testing on the new security points
    - independent audit and freeze of each slice
13. **Documentation:** this record; Slice 7 and Slice 8 docs; the §12 checklist; the Stage 10 closeout.
14. **Not required:** production deployment, a firm/team model, email delivery, a distributed rate-limit store.
