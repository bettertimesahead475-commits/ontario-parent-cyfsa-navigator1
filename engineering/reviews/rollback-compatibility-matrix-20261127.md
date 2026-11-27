# Rollback compatibility at every intermediate state (release sequence of 2026-11-27)

Desk analysis of the migration files and of the app code at production `82dfe65` (Cloudflare deployment `0cc59589`)
and at `release/rc-20261127`. It works out what each rollback does **after customers have transacted** in that
state. Nothing was run against a hosted database.

Sequence: ratify A/B -> backup -> **G -> P -> D -> C (off) -> F -> deploy RC** -> (later) **E**.

## Per state

| State reached | App live | Roll back the newest step after customer transactions | Safe? | Rule |
|---|---|---|---|---|
| S1 `+G` | 82dfe65 | `revoke update (status, approved_at)`. Approved rows and issued codes stay. Later approvals fail with 502 again; no data is lost. | **Yes** | None. |
| S2 `+P` | 82dfe65 | P's rollback restores the captured live RPC and drops `access_codes.redeemed_session_id`. It refuses while D is applied, or while any monthly-renewal code records its entitlement only in that column. | **Only if no renewal was redeemed.** Otherwise forcing it (`navigator.p_rollback_accept_link_loss`) loses which entitlement each renewal extended, and refunding those renewals then cannot find the session. | Prefer a forward fix. If a renewal exists, do not roll P back. |
| S3 `+D` | 82dfe65 | Drop the unique index and restore P's RPC. Existing rows still satisfy the old schema. 82dfe65 treats D's `consumed / ORDER_ALREADY_ACTIVATED` like any refusal. | **Yes**, but it reopens second redemptions per order. | Roll D back only together with a fix. |
| S4 `+C` | 82dfe65 | Drop the table and function. No route calls `navigator_rate_limit_hit` (`_persistent-rate-limit.ts` is not wired). | **Yes** | None. |
| S5 `+F` | 82dfe65 | Drop `transactional_email_outbox`. 82dfe65 does not use it, so nothing is lost before the RC is deployed. | **Yes** before the RC deploy. | See S6 for after. |
| S6 RC deployed | RC | **Roll the app back to `0cc59589`, schema stays.** 82dfe65 runs on G+P+D+C+F: it reads `redeemed_session_id` (present) and ignores C and F. | **Yes, with two consequences:** (1) 82dfe65 keys free scans by Firebase UID with its old 3-Quick limit, so each account that used the new `fq:`/`ff:` entitlements gets up to 3 more free Quick reviews, at most $1.63 each. (2) Emails queued but not sent stay in the outbox and are not sent. | App rollback first, never schema. 82dfe65 has no free-trial platform cap, so accept the bounded cost or fix forward quickly. |
| S6, then roll F back | 82dfe65 | Drops pending and `unknown` outbox rows. | **Data loss** of unsent and unconfirmed customer emails. | First export `status in ('pending','unknown')` rows, or don't roll F back. |
| S6, then roll P back | must be 82dfe65 | The RC's `claim-purchase.ts` calls `codesOf(...redeemed_session_id)` and gets 400 without P. `my-payments.ts` degrades through `codesWithLinks`. | **App must be rolled back first.** Same renewal caveat as S2. | Order: app -> D -> P. |
| S7 `+E` (after RC) | RC | E's rollback restores D's RPC and drops `navigator_paid_sessions.granted_credits`. It refuses while any unexpired session holds early-renewal credits. | **No, once any early renewal exists.** The override (`navigator.allow_credit_reduction`) takes paid analyses away from customers. | Forward fix only, after an owner decision on each case. |

## Rules for the execution checklist

1. **Roll back the app first** (Cloudflare to `0cc59589`, seconds). Every schema state from S1 to S6 runs 82dfe65.
2. **Reverse-order SQL is not automatically safe.** G, C and D are reversible at any time. P is reversible only while no
   renewal links exist. F is reversible only after exporting unsent rows. E is not reversible once used.
3. Before any SQL rollback, run its preflight or refusal checks, and take aggregate counts
   (`access_codes where redeemed_session_id is not null`, outbox rows by status, sessions with `granted_credits`).
4. The free-trial policy (PR #194) adds no schema. It writes only new `free_usage` keys, which an app rollback
   ignores. Only the bounded re-opened legacy allowance in S6 follows from that.
5. Restoring the full dump stays a last resort, and rows written after the dump must be replayed (section 6).
