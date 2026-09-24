# Stage 7B access-lifecycle security remediation

Date: 2026-09-24. Branch: `claude/stage-7b-access-lifecycle-remediation`.
Base: `a134ca54c68c5d5007d33746816ed5d700c38a38`, the last frozen commit before any Form 33B.1 work. It is the same
base as the Stage 10 PR, but this branch does NOT contain Stage 10 commit `97ec949`.
Stage 7B implementation baseline: `ad89c48` ("Add Stage 7B parent-authorized matter access"). The affected files are
unchanged from that commit up to the base above.

## Scope

This task verifies, and then fixes, the four defects reported in `STAGE_10_PARALLEL_ACCESS_AUDIT.md` (D1–D4). It adds no
new capability.

Affected code:
- `api/services/professionalMatterAccess.ts` (`acceptProfessionalGrant`, `revokeProfessionalGrant`)
- `supabase/migrations_pending_approval/create_navigator_matter_access_grants.sql` (`accept_matter_grant`), left
  unmodified.

**Exposure note.** At the base SHA, no HTTP route calls these service functions; only tests do. The migrations are
pending and have not been applied to production (HANDOFF §5, Stage 7B entry). The defects are therefore latent. They would
have gone live as soon as the migration was approved and the functions were wired to routes.

## Findings

| # | Defect | Verdict | Layer | Proven by (against the unfixed code) |
|---|---|---|---|---|
| 1 | Revocation reports success when persistence fails | **CONFIRMED** | TypeScript service | Mocked DB write failure → `{ success: true }`; the membership stays. A second path: re-revoking an already-REVOKED grant short-circuited to success while a leftover membership stayed. |
| 2 | Owner downgraded by accepting an invitation | **CONFIRMED (severe)** | SQL `accept_matter_grant` | Real PostgreSQL 16: the owner accepted an invitation to their own matter. Role changed `OWNER` → `REVIEWER`, and the matter was left with **0 OWNER rows**. |
| 3 | Expiry update rolled back | **CONFIRMED** | SQL `accept_matter_grant` | Real PostgreSQL 16: after `EXPIRED_TOKEN` was raised, the status was still `PENDING`. The expired grant was still refused on every attempt, so this was a state-accuracy defect, not an access bypass. |
| 4 | Stale-grant revocation removes independently authorized access | **CONFIRMED** | TypeScript service (no DB support) | Mocked: reviewer holds accepted grants A and B; revoking A deleted the membership that B still authorizes. |

Root causes:
1. `revokeProfessionalGrant` ignored the `{ error }` result of both the grant update and the membership delete, and returned
   early on `status === 'REVOKED'` without re-checking membership.
2. The original function upserts `on conflict (matter_id, account_id) do update set role = capability` and never checks
   whether the accepting account is the grantor or an existing OWNER. The table's `unique (matter_id, account_id)`
   constraint means the OWNER row itself gets overwritten.
3. `update ... set status = 'EXPIRED'` was followed by `raise exception` in the same function. The exception aborts the
   statement's transaction, which rolls back the update.
4. The delete was keyed only on `(matter_id, account_id, role = 'REVIEWER')`, with no check for another ACCEPTED grant.

## Fix

- **New additive migration**
  `supabase/migrations_pending_approval/remediate_navigator_matter_access_grants_lifecycle.sql`. It runs in a single
  transaction.
  - `accept_matter_grant` (same name and arguments; return type changes to `jsonb`, so the function is dropped and
    recreated):
    - Refuses the grantor, and any account that already holds a non-REVIEWER membership (`OWNER_CANNOT_ACCEPT`).
    - Uses `on conflict do nothing` and re-checks the membership role after the insert, so an existing role is never
      overwritten.
    - For an expired grant, persists `EXPIRED` and returns `{outcome: 'EXPIRED'}` instead of raising.
    - Adds `set search_path = public, pg_temp`, standard hardening for a `security definer` function.
  - New `revoke_matter_grant(text, uuid)`, one atomic transaction:
    1. Requires an active account holding the OWNER role on the grant's matter.
    2. Locks the grant row.
    3. Marks the grant REVOKED idempotently, keeping the first revocation's time and actor.
    4. Locks the membership row.
    5. Deletes the REVIEWER membership (never an OWNER row) only if no other ACCEPTED grant for that account and matter
       remains.
    6. Returns `{grant_id, matter_id, status, membership_removed}`.
  - Both functions: `revoke all from public, anon, authenticated`; `grant execute to service_role`.
  - Unchanged: tables, columns, constraints, indexes, RLS, policies, and the historical migration files.
- **Service**:
  - Revocation goes through the RPC. It reports success only when the database confirms the requested grant is REVOKED.
    Every other outcome throws "Revocation failed. Access may not have been removed."
  - Acceptance reports success only on a confirmed `ACCEPTED` outcome.
  - Raw database error text is no longer returned to callers. It used to be, through `'Acceptance failed: ' + message`.
  - The return type gains `membershipRemoved`.
- **Deploy order**: apply the migration first. Code deployed without it fails closed, because the RPC is missing or
  returns a shape the service rejects.
- **Not done (by design)**: no backfill of existing lapsed `PENDING` rows. Expiry is enforced on every acceptance attempt,
  and a lapsed invitation is persisted as EXPIRED the first time someone tries to use it. A one-off backfill is optional
  and needs its own approval.

## Concurrency

Both functions lock the grant row first. Accept then locks the membership row; revoke locks the membership row before its
"still backed by another grant?" check. A PostgreSQL test forces the dangerous interleaving (grant B's acceptance
in flight while grant A is revoked). With revoke's membership lock removed, that test fails: B ends up ACCEPTED with no
access. With the lock in place, it passes.

## Verification

- Real PostgreSQL 16.13, on a disposable local cluster. Each run creates and drops its own database, and the harness
  refuses any host other than `127.0.0.1`/`localhost`. It loads the real `create_accounts_foundation.sql`, the
  account/client/matter/member portion of `create_navigator_matters_foundation.sql`, and
  `create_navigator_matter_access_grants.sql`, then this remediation. Result: 21/21 pass, stable over repeated runs.
  - Opt-in: `NAVIGATOR_PG_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:<port>/postgres`. Without that variable the suite
    is skipped, which is what CI does.
- Mutation testing: every service guard and every non-redundant SQL guard, when removed, makes at least one test fail.
  - The three owner guards in acceptance are deliberate defense in depth. Each one is shown to hold on its own when the
    others are removed.
  - `id <> v_grant.id` in the sibling check is logically redundant (the grant is already REVOKED at that point) and is
    kept as defense in depth.
- Not yet validated: a hosted Supabase project (PostgREST RPC invocation, real `service_role` JWT). Local PostgreSQL
  proves the SQL semantics, not the hosted deployment.
