# Phase 7: Staging Completion Report

Date: 2026-10-30. Branch `migration/cloudflare-staging-20261029`, PR #115 (draft, not merged).
Production was not touched: no change to cyfsanavigator.com, the Vercel project, production Supabase or DNS. Two
read-only schema queries were run against production Supabase: the `payments` columns, constraints and policies.

**Decision: NO-GO** (see section G).

## What this session could and could not reach

| Resource | Access | Effect |
|---|---|---|
| GitHub (repo, PR #115, CI) | Yes | Code, tests and pushes done |
| Cloudflare Pages (`cyfsa-navigator-git-staging`) | **No.** The Cloudflare connector is in "needs reconnect" state and is not enabled; this container has no API token or `wrangler` | Could not read or change bindings, could not set `ANALYZER_ENABLED`, could not configure Preview. Deploys happen through the Git integration on push |
| Supabase staging `nxfhvebzzobegubefcda` | Yes (MCP) | Migration applied and verified |
| Anthropic / Gemini keys | **No.** None in this container; the keys exist only in Cloudflare | No direct provider calls. Live calls through staging need `ANALYZER_ENABLED=true` (Cloudflare access) and a signed-in Firebase user |
| Firebase test account | **No** | No authenticated browser or API journey |

## A. Deployment

- **Commit:** `29e68e4c` (code). The report is committed after it.
- **Cloudflare Pages deployment:** `7c053f99-59f3-4986-893c-5e9e2a064e33`. GitHub check "Cloudflare Pages": success.
- **Live URL:** https://cyfsa-navigator-git-staging.pages.dev
- **The deployed version is the new code** (verified over HTTP after deploy):
  - `GET /api/status` → 200 `{"analyzerReady":false,...}`. This route did not exist before; it was a 503 from the
    catch-all.
  - `POST /api/transcribe-audio` without sign-in → 401 `SIGN_IN_REQUIRED`. Before, it answered 400 to an anonymous
    caller.
  - `POST /api/activate-code`, `/api/extract-text` and `/api/request-access` without sign-in → 401.
  - `POST /api/analyze` → 503 `STAGING_ANALYZER_NOT_READY`, which is fail closed.
  - `GET /api/health` → 200.
- **Which environment serves the hostname.** It is one with bindings, inferred rather than read. The new
  transcription route returns 503 `AUTH_NOT_CONFIGURED` when `FIREBASE_PROJECT_ID` is absent; the live site returns
  401, so `FIREBASE_PROJECT_ID` is bound there. That fits the owner's report that the Production environment holds
  the seven variables and Preview holds none. The binding names were not read from Cloudflare.
- **`ANALYZER_ENABLED`:** not `true` (`analyzerReady:false`), as required until checks pass.

## B. Database (staging only)

**Migration** `20261030_reconcile_access_codes_and_atomic_rpc.sql`: **corrected, then applied to staging.**

- **Staging before the change** (inspected): `access_codes(id, tier, code UNIQUE, created_at)` with 0 rows;
  `navigator_paid_sessions` with `UNIQUE(access_code_id)` and 0 rows. RLS was on for both, with no policies and no
  `anon`/`authenticated` grants. No redemption function was installed.

- **Correction to the stated defect.** In PL/pgSQL, a block with an `EXCEPTION` clause runs as a subtransaction. When
  the handler catches an error, everything the block wrote is undone. Demonstrated on PostgreSQL 16: after a failing
  session insert under the draft handler, the code was still unused and no session existed. So the draft did not
  partially commit. Its real defects were:
  1. Raw `SQLERRM` returned to the API. `activate-code.ts` passed `rpcData.error` to customers.
  2. Failures returned as ordinary results.
  3. A caller-supplied `p_now` that could defeat the expiry check.
  4. Ambiguous matching (`hash OR plaintext ... order by created_at limit 1`).
  5. An `Enterprise` tier that is not an application tier.

- **Changes applied:**
  - `access_codes` gains `used_at`, `expires_at`, `code_hash`, `email`, `reference_number` and `amount`.
  - Plaintext codes are back-filled with `code_hash = sha256(upper(trim(code)))`, the same as `access.ts hashCode()`.
    Verified against Node's `createHash` in tests.
  - The migration aborts if any two codes collide. A partial unique index on `code_hash` is added.
  - Tier checks follow `tierTypes.ts`. Codes keep the legacy `pro_advocate` and `premium_attorney` values. Sessions
    take the 8 application tiers, a superset of the current `Pro` and `Premium`.
  - The draft's 4-argument signature is dropped.
  - `redeem_access_code_atomic(p_firebase_uid, p_code, p_email)`:
    - security definer, `search_path = public, pg_temp`;
    - **no exception handler**;
    - `SELECT ... FOR UPDATE` on the unique hash;
    - an email mismatch gets the same answer as an unknown code;
    - idempotent reuse only for the same account and a live, unrevoked session;
    - expiry is checked against the transaction clock;
    - unredeemable tiers are refused before any write;
    - the claim and the session insert happen in one transaction.
  - The superseded draft `atomic_access_code_redemption_rpc.sql` is removed from the branch.

- **RPC and permissions on staging** (verified): `prosecdef = true`; ACL `postgres=X, service_role=X`; `anon` and
  `authenticated` have no EXECUTE and there is no PUBLIC grant.

- **Controlled staging tests** with synthetic records, which were deleted afterwards (back to 0 codes and 0 sessions):

  | Case | Result |
  |---|---|
  | Valid code | `activated` |
  | Same account again | `reused`, same session id |
  | Other account | `consumed` |
  | Malformed email | `invalid` |
  | Expired | `expired` |
  | Legacy tier | `denied`, `TIER_NOT_REDEEMABLE` |
  | Unknown code | `invalid` |

- **Rollback and concurrency evidence.** `api/services/accessCodeRedemption.pg.test.ts` runs 11 tests on PostgreSQL 16
  against the exact staging table shapes and the migration file unchanged:
  - A failing session insert leaves the code unused and creates no session.
  - 20 simultaneous redemptions produce exactly 1 `activated` and 19 `consumed`, with one session row.
  - Also covered: revoked sessions, wrong email, expiry, legacy hash compatibility, no error text, permission
    denied for `anon`/`authenticated`, and refusal on duplicate codes (the whole migration rolls back).

- **Also on staging:** `public.payments` was missing although `/api/request-access` writes to it. It was created to
  mirror production's columns, status and role checks and the `(firebase_uid, request_key)` idempotency index.
  Differences: no foreign keys to a `users` table staging lacks, no personal default email, RLS on with no policies,
  and no `anon`/`authenticated` grants.

## C. AI

**Not verified live.**
- **Anthropic and Gemini models:** not verified. No keys are reachable from this session, and live calls through
  staging require `ANALYZER_ENABLED=true` (Cloudflare access) plus a signed-in user.
- **Quick Review live result:** not run.
- **Forensic live result:** not run.
- **OCR live result:** not run.
- **Audio live result:** not run.
- **Code fact recorded:** the transcription route hard-codes `gemini-2.0-flash`. Its availability on the configured
  Gemini account is unverified.

## D. Customer workflow

**Not verified in a browser.**
- **Authentication:** every gated route refuses unauthenticated calls on the deployed site (A).
- **Upload, analysis, report retrieval, export:** not run. They need a Firebase test account and the analyzer
  enabled.
- **Credits:** not run. The analyzer-usage endpoint returns the free defaults (3 Quick Reviews, 0 Forensic) to an
  anonymous caller.
- **Paid entitlement:** the redemption path is verified at the database level (B) and at the API boundary by unit
  tests. It was not verified end to end.

## E. Security

**Defects found and corrected in this branch:**

| Severity | Defect | Fix |
|---|---|---|
| High | `/api/transcribe` skipped sign-in when `FIREBASE_PROJECT_ID` was unset, which is the case in a binding-less Preview environment. An anonymous caller could send about 7.5 MB of audio per request on the Gemini key | Fails closed (503); sign-in is checked before the body is read; audio MIME allowlist (415 otherwise) |
| Medium | Gemini error bodies returned to callers (`details: errBody`) | Removed |
| Medium | Database text (`SQLERRM`) could reach customers through `rpcData.error` | Fixed messages per outcome; no RPC text is ever shown |
| Medium | The RPC accepted a caller-supplied clock, and matching was ambiguous | Removed; unique hash match |
| Low | Admin-secret comparison on the status route was not constant-time | Constant-time compare |

**Verified sound:**
- Firebase ID-token verification checks RS256, `aud`, `iss`, `exp` and the JWKS key; the UID sent to the database is
  the token subject. A test proves a body-supplied UID is ignored.
- The service-role key is used only server-side in functions.
- Redemption is RPC-only, with no REST multi-step fallback.
- `/api/analyze` is gated on `ANALYZER_ENABLED`.

**Remaining risks:**
- `request-access.ts` still has a fallback insert that drops `firebase_uid` and `request_key`. It weakens identity
  binding and idempotency on an insert error, though it creates only `pending` rows, which grant nothing. Staging now
  has the full table, so the fallback should be removed in a follow-up.
- No rate limiting on the edge routes.
- Codes issued without an email can be redeemed by any signed-in account holding the code.
- Preview has no bindings. With this fix it fails closed, but Preview is unusable until it is configured.
- **Production note (read-only):** production `payments` grants INSERT to `anon`/`authenticated`. The insert policy
  requires `auth.uid() = user_id`, which is null for public-key callers because the app uses Firebase, so it is not
  writable without a Supabase Auth user.

## F. Engineering

**Files:**
- `supabase/migrations_pending_approval/20261030_reconcile_access_codes_and_atomic_rpc.sql` (rewritten)
- `supabase/migrations_pending_approval/20261030_staging_payments_table.sql` (new)
- `supabase/migrations_pending_approval/atomic_access_code_redemption_rpc.sql` (removed)
- `functions/api/transcribe.ts`, `functions/api/activate-code.ts`, `functions/api/_status.ts`
- `functions/api/status.ts` (new)
- `api/services/accessCodeRedemption.pg.test.ts` (new)
- `api/cloudflare-activate-code-security.test.ts` (new)
- `api/cloudflare-transcribe.test.ts`, `api/cloudflare-status.test.ts`
- `.github/workflows/ci.yml` (PostgreSQL service, as in #114)

**Local results (PostgreSQL 16):**
- `tsc --noEmit`: clean.
- Full Vitest: 4,153 tests, 4,079 passed, **0 failed**, 74 skipped. The skips are 68 official-form artifact tests and
  6 staging tests (see #114).
- `npm run build`: exit 0.
- Every Pages function bundles for the Workers runtime (esbuild, browser/worker conditions) with **no `node:`
  imports**.

**CI on `29e68e4c`:** `test` success, four `verify` jobs success, Cloudflare Pages success.

**Outstanding blockers (owner):**
1. Reconnect the Cloudflare Developer Platform connector in claude.ai, or provide a scoped Pages API token, so
   bindings can be read and set.
2. Set `ANALYZER_ENABLED=true` in the environment that serves staging, once you accept the risks above.
3. Bind the staging-only secrets in Preview, through the Cloudflare dashboard or `wrangler pages secret put`, if
   Preview deployments are to work.
4. Provide a Firebase test account on the staging project, plus approval for the cost of live provider calls, for the
   Quick Review, Forensic, OCR, audio and browser journey checks.

## G. Release decision

**NO-GO.**

Critical live verification is incomplete:
- No real Quick Review or Forensic analysis has run on staging.
- OCR and audio were not exercised against the providers.
- The authenticated browser journey (sign-in, upload, report persistence and retrieval, export, credits,
  redemption) was not run.
- The analyzer is still disabled.

None of these is a code failure. They are blocked on Cloudflare access, provider access through an enabled analyzer,
and a test account.

What is verified:
- Database atomicity and concurrency.
- RPC permissions.
- Fail-closed behaviour of every gated route on the deployed site.
- Edge compatibility.
- CI and a full local suite with 0 failures.
