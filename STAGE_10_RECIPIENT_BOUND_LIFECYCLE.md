# Stage 10 slice 7: recipient-bound lifecycle contract (v4)

Date: 2026-09-25. Branch: `claude/stage-10-slice-7-recipient-bound-lifecycle`.

## Base

- **Starts from:** the frozen decision record `783acab` (`audit/stage-10-completion-decisions-frozen`). It is not based
  on `main`.
- **Implements:** Decisions 1–3 and the Slice 7 contract (§3, §4, §5, §8, §9) of `STAGE_10_COMPLETION_DECISIONS.md`,
  which is unchanged.
- **Router:** the lifecycle mutation router is **still unmounted**. `_server.ts` is unchanged, and
  `matterAccessLifecycleRoutes.unmounted.test.ts` is green.
- **Frontend:** none.
- **Live surface changed:** yes, one. The OWNER-only current-state report (`GET /api/matters/:matterId/access-audit`,
  mounted since Slice 5) now shows each grant's recipient email (C1, Decision 3).

## What changed

| Layer | File | Change |
|---|---|---|
| Database | `supabase/migrations_pending_approval/create_navigator_matter_access_lifecycle_recipient_v4.sql` (new, BLOCKED) | Additive v4 contract (below) |
| Canonical rule (JS) | `api/services/recipientEmail.ts` (new) | A mirror of the SQL rule; used only to refuse bad input early |
| Firebase | `api/services/firebaseAdmin.ts` | New `verifyFirebaseIdentity()` → `{ uid, email, emailVerified }`; `verifyFirebaseToken()` delegates to it and keeps its frozen `{ uid, email }` shape |
| Service | `api/services/professionalMatterAccess.ts` | Requires exactly contract v4; create takes `{ recipientEmail, expiresInDays? }`; accept takes the verified claims |
| Report | `api/services/matterAccessAudit.ts` | `GrantAuditSummary.recipientEmail` (OWNER-only report) |
| Adapter (unmounted) | `api/matterAccessLifecycleRoutes.ts` | Create body `{ recipientEmail, expiresInDays? }`; accept body stays `{ token }`; claims come only from the verified token |
| Error mapper | `api/services/matterAccessLifecycleHttpErrors.ts` | Two new service messages mapped: `RECIPIENT_INVALID` (400) and `EMAIL_NOT_VERIFIED` (403). The drift test is green |

Historical migrations v1, v2, v3 and 7B are **not** modified.

## The canonical recipient rule (Decision 1, §3)

The authority is `public.navigator_canonical_recipient_email(text)` (immutable, `search_path pg_catalog`,
service_role only). `recipientEmail.ts` is a line-for-line mirror, and a real-PostgreSQL parity test compares the two
on 24 inputs.

1. **Trim** surrounding ASCII whitespace: space and codes 9–13.
   - Not Unicode spaces: `String.trim()` is deliberately not used, because the database would not strip them. A
     leading NBSP is therefore refused.
2. **Validate:**
   - 3–254 characters
   - every character printable ASCII (codes 32–126)
   - exactly one `@`, neither first nor last
3. **Lower-case** only `A`–`Z`, locale-independently (`translate`, not `lower()`).
   - A Turkish `İ` is refused as non-ASCII, never mapped.
4. **Nothing else:** no dot or plus-tag removal, no domain rewriting, no alias guessing.

The same function runs at creation (on the owner's input) and at acceptance (on the verified Firebase email).

## Database contract v4

The migration requires v2, the slice 2 recorder and v3; otherwise it raises `PREREQUISITE_MISSING`. It is one
transaction and adds the following.

- **Column `navigator_matter_access_grants.recipient_email text`:**
  - The single stored copy of the recipient.
  - The CHECK `navigator_matter_access_grants_recipient_email_canonical` holds it to NULL or its canonical form.
  - The CHECK is **NULL-safe** (`is not distinct from`). A plain `=` would evaluate to NULL for a value with no
    canonical form, and a CHECK that is NULL passes. A Slice 7 test caught exactly that during development.
- **`create_recipient_bound_matter_grant(uid, matter, digest, days, recipient)`.** Checks run in this order:
  1. active account → `ACCOUNT_UNAVAILABLE`
  2. OWNER of the matter → `NOT_OWNER`
  3. digest shape and 1–365 days → `INVALID_REQUEST`
  4. canonical recipient → `INVALID_RECIPIENT`

  It then inserts the grant with the canonical recipient and records `GRANT_CREATED` in the same transaction. The event
  holds identifiers only, never the email.
- **`accept_recipient_bound_matter_grant(uid, digest, verified_email, email_verified)`:**
  1. Active account, otherwise `ACCOUNT_UNAVAILABLE`.
  2. **Caller claims before the token:** unless `email_verified` is exactly true and the email canonicalizes, it raises
     `EMAIL_NOT_VERIFIED`. This depends only on the caller, so it reveals nothing about any token.
  3. The grant is locked by digest (`for update`).
  4. **Recipient first:** an unknown digest, a grant with no recipient (pre-v4), or a recipient other than the caller's
     all raise `INVALID_TOKEN`, identical to an unknown token.
     - Nothing below runs for a non-recipient: no expiry transition, no `GRANT_EXPIRED`, no membership change, no event.
  5. The frozen v3 acceptance body, verbatim: PENDING check, persisted expiry and `GRANT_EXPIRED`, capability, grantor,
     owner preservation (pre-check and post-check), membership insert, and `GRANT_ACCEPTED` +
     `REVIEWER_ACCESS_ADDED`, all in one transaction.
- **The v3 `create_matter_grant` / `accept_matter_grant` now raise `CONTRACT_SUPERSEDED`** (`create or replace`; the
  historical v3 file is untouched).
  - This closes the one route by which an older build could still create an **unbound** invitation, or accept one
    without the recipient check.
  - `revoke_matter_grant` is unchanged.
- **`navigator_matter_access_lifecycle_contract_v4()`** returns `navigator_matter_access_lifecycle_v4`. The service
  requires exactly this.

## Service and adapter

- **`createProfessionalGrant(uid, matterId, { recipientEmail, expiresInDays? })`:**
  - An invalid recipient throws `Recipient email must be a valid address.` before any database call.
  - The database canonicalizes again.
  - The result must carry the same canonical recipient, or the call fails closed.
- **`acceptProfessionalGrant(uid, rawToken, { email, emailVerified })`:**
  - Unless `emailVerified === true` and the email is canonical-valid, it throws `Verified email required.` before any
    database call.
  - The claims object is built by the adapter **only** from `verifyFirebaseIdentity()`, which reads `email` and
    `email_verified` from a token verified with `checkRevoked: true`. `emailVerified` is true only for the boolean
    `true`.
- **Adapter (still unmounted):**
  - The create body allows `recipientEmail` and `expiresInDays` only.
  - An invalid recipient returns one constant 400 that never echoes the input.
  - The accept body allows `token` only: an `email`, `recipientEmail`, `emailVerified` or `uid` field is refused as an
    extra field, and query strings are refused.
  - The create response returns `recipientEmail` (the canonical form of what the owner typed) to the creating owner
    only.
- **Error mapper additions** (exact-string classification; the drift test is green):

| Operation | Service message | HTTP |
|---|---|---|
| create | `Recipient email must be a valid address.` | 400 `INVALID_REQUEST` `recipientEmail must be a valid email address.` |
| accept | `Verified email required.` | 403 `EMAIL_NOT_VERIFIED` `Sign in with a verified email address to accept this invitation.` |

A non-recipient, an unknown token, a used, revoked or expired invitation, and a pre-v4 invitation all give the same
**410 `INVITATION_UNAVAILABLE`**.

## Live report privacy (Decision 3, C1)

- **Owner only.** `recipientEmail` is added per grant to the report, which remains owner-only
  (`getMatterAccessAudit`, unchanged).
- **Owner:** sees the email on pending, accepted, revoked and expired grants. It is `null` only for a pre-v4 grant.
- **Report shape:** grant keys are exactly the frozen keys plus `recipientEmail`. `currentAccess` and
  `integrityFindings` gain no email.
- **Other callers:** a reviewer, revoked reviewer, stranger or cross-matter owner gets one identical 403 with no
  identity. A suspended caller gets the frozen Slice 5 account refusal (see Notes). Unauthenticated callers get 401.
  - No email appears in any body on any of the three mounted routes.
- **Event and history routes:** carry no email, even to the owner. The event table has no email or recipient column.
- **Error bodies**, including the fail-closed 503, carry no email, digest or raw token.

## Verification

- **New and ported tests:**
  - `professionalMatterAccessRecipient.pg.test.ts` (new, 71, real PostgreSQL) covers the §9 criteria:
    - canonical parity
    - the NULL-safe CHECK
    - creation, including reviewer, stranger and cross-matter refusals
    - digest-only storage and no email in events
    - recipient-only acceptance, and "non-recipient changes nothing / cannot expire"
    - unverified, absent and malformed claims refused before the database, and `EMAIL_NOT_VERIFIED` enforced by the
      database itself
    - grantor refusal, including a grantor who has since left the matter
    - co-owner preservation, inactive recipients, parent-role recipients, pre-v4 grants, single-use tokens
    - identical non-recipient and unknown-token messages
    - revocation BUG 1/4, audit-failure rollback for all four event types
    - four concurrency races on separate connections, the v4 gate, and the prerequisite guard
  - `matterAccessRoutes.pg.test.ts` (+6): live report privacy through the real `_server`.
  - `matterAccessLifecycleRoutes.test.ts` (+21): adapter recipient binding.
  - `recipientEmail.test.ts` (new) and `firebaseAdminIdentity.test.ts` (new).
  - Ported to v4 by addressing each invitation to its intended acceptor:
    - `professionalMatterAccess{,.remediation,.pg}.test.ts`
    - `professionalMatterAccessAudit{,.pg}.test.ts`
    - `matterAccessLifecycleRoutes{,.pg,.unmounted}.test.ts`
  - The frozen v2/v3 SQL variant suites are unchanged.
- **Mutation testing:** 18 mutants (the 17 required, with "accept `email_verified=false`" split into its database and
  service halves); **18 killed**. Every mutated file was restored and verified by SHA-256.
  - M08 ("grantor may accept") first **survived**: the owner check refused a grantor who was still OWNER, which
    shadowed the grantor check. A test for a grantor who has left the matter now kills it.

| # | Mutant | Killed by |
|---|---|---|
| M01 | recipient comparison skipped | recipient PG suite |
| M02 | recipient comparison inverted | recipient PG suite |
| M03a | database accepts `email_verified=false` | recipient PG suite (database-level test) |
| M03b | service accepts `emailVerified=false` | recipient PG suite |
| M04 | accept trusts a body email | adapter unit |
| M05 | expiry persisted before the recipient check | recipient PG suite |
| M06 | audit event recorded for a mismatch | recipient PG suite |
| M07 | inactive account may accept | recipient PG suite |
| M08 | grantor may accept | recipient PG suite (grantor has left the matter) |
| M09 | owner downgraded on accept | recipient PG suite (BUG 2 co-owner) |
| M10 | reviewer may create | recipient PG suite |
| M11 | reviewer may revoke | recipient PG suite (BUG 1) |
| M12 | report with emails exposed to a reviewer | live report PG suite |
| M13 | recipient email echoed in an error | adapter unit |
| M14 | recipient email written to the event log | recipient PG suite |
| M15 | audit failure no longer rolls back acceptance | recipient PG suite |
| M16 | non-recipient distinguishable (enumeration) | recipient PG suite |
| M17 | lifecycle router mounted | unmounted test |

- **Quality gates:** see the PR description for lint, `tsc --noEmit`, build, and the full suite (CI-style and with
  PostgreSQL), compared by test identity against `783acab`.

## Deployment order (still BLOCKED; nothing here is deployed)

1. Apply the v4 migration **before** deploying this code. The mounted report now selects `recipient_email`; on a
   database without v4 it fails closed (fixed 503, no data).
2. The older application build keeps working on a v4 database for everything that is live: the report does not select
   the column, and the history routes are untouched. Its unmounted lifecycle calls get `CONTRACT_SUPERSEDED`.
3. **Rollback:** redeploying the older code is safe. The migration is additive; the column and functions can stay.

## Notes for the independent audit

1. **Firebase contract.** §3 says `verifyFirebaseToken` is "extended" to return `emailVerified`.
   - It is extended by a sibling, `verifyFirebaseIdentity()`, which shares the same verification path.
   - `verifyFirebaseToken()` delegates to it, so there is one verification, with the same header rules and
     `checkRevoked: true`.
   - This keeps `verifyFirebaseToken`'s frozen `{ uid, email }` shape, and its existing tests, for every other caller,
     per "do not broadly refactor authentication".
2. **Printable ASCII is codes 32–126**, taken literally from §3, so an *internal* space is admitted. Firebase would
   never issue such an address as verified, so no acceptance can match it. An owner who types one creates an invitation
   no one can accept.
3. **A suspended caller on the report** receives the frozen Slice 5 `ACCOUNT_UNAVAILABLE` refusal, not the `FORBIDDEN`
   body that the other non-owners share.
   - §5 lists "suspended account" among callers receiving "the same refusal".
   - The account refusal describes only the caller's own account. It is identical for this matter, another owner's
     matter and a matter that does not exist, and it carries no identity (tested).
   - Changing it would alter frozen Slice 5 behavior, which is out of Slice 7 scope.
4. **`EMAIL_NOT_VERIFIED` is a distinct 403**, not the 410. It depends only on the caller's own claims and is raised
   before the token lookup, so it discloses nothing about any invitation (tested with two different tokens).
5. **Pre-v4 pending grants** (`recipient_email` NULL) can never be accepted. The lifecycle has never been mounted, so
   none should exist outside tests. The owner can still revoke them, and they expire.
6. **Retention** (Decision 4): the recipient email is kept on the grant row under the same unset policy. No purge or
   redaction is added.
