# Agent A handoff: T-05 / SEC-3 persistent (cross-isolate) rate limiting

Base: `engineering/integration` at `7a49c00`. Status: recommendation made; code and migration prepared, **not applied
and not wired**. Applying the migration needs written owner approval (CLAUDE.md, B-3, S-05).

## 1. Current limiter (per isolate)

`functions/api/_rate-limit.ts`: an in-memory sliding window (`Map` of timestamps, at most 5,000 keys, LRU eviction).
Each Cloudflare isolate has its own counters, so a client spread over isolates or locations can exceed every limit.
Key: `<bucket>:uid:<Firebase uid>` when verified, otherwise `<bucket>:ip:<cf-connecting-ip>`. Refusal is
`429 RATE_LIMITED` with `Retry-After`, before any credit, database or provider work.

| Bucket | Limit | Route (call site) | Key |
|---|---|---|---|
| `analyze` | 8 / 60 s | `/api/analyze` (`functions/api/analyze.ts:239`; skipped for trusted queue jobs) | uid |
| `extractText` | 20 / 60 s | `/api/extract-text` (`functions/api/extract-text.ts:40`) | uid or IP |
| `transcribe` | 10 / 60 s | `/api/transcribe` (`functions/api/transcribe.ts:49`) | uid |
| `activateCode` | 6 / 10 min | `/api/activate-code` (`functions/api/activate-code.ts:87`) | uid or IP |
| `requestAccess` | 5 / 10 min | `/api/request-access` (`functions/api/request-access.ts:103`) | uid |
| `adminWrite` | 30 / 60 s | admin writes in `functions/api/admin/[[path]].ts:734` | admin uid |

No other limiter exists in `functions/`, `workers/` or `api/`.

## 2. Persistent options

Prices fetched 2026-11-27 from the official pages below. The account already runs Cloudflare Queues for the
Forensic queue, which needs Workers Paid (`engineering/DEVIN_DEMO_READINESS.md`), so Workers Paid included usage is
assumed available. Latency figures are not published by either vendor and are not measured in this repo.

| | A. Supabase table + atomic RPC | B. Durable Object limiter | C. Workers KV counters | D. Workers Rate Limiting binding |
|---|---|---|---|---|
| Cost | $0 extra: "Unlimited API requests" on Free and Pro ([supabase.com/pricing](https://supabase.com/pricing)); rows are tiny and pruned after one day | Paid: 1 M requests/month included, then $0.15/M; SQLite rows written 50 M/month included, then $1.00/M. Free: 100,000 requests/day ([DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)) | Paid: 1 M writes/month included, then $5.00/M; 10 M reads, then $0.50/M. Free: 1,000 writes/day ([KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)) | No price stated on the [binding page](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) or [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/); I could not confirm one |
| Plan | Existing project, any plan | Workers Free (SQLite-backed only) or Paid ($5/month minimum, [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)) | Free or Paid | Workers |
| Accuracy | Exact, global (row lock on the key) | Exact, global ("strict limits" per the binding page) | Eventually consistent; 1 write/second per key ([KV limits](https://developers.cloudflare.com/kv/platform/limits/)), so bursts are under-counted | Approximate and **per Cloudflare location**; periods only 10 s or 60 s, so the 10-minute buckets cannot be expressed |
| Latency | One HTTPS PostgREST call to the Supabase region (same path as the credit RPCs); capped at 1.5 s by the client | One call to the object's location | Read + write per request | Local, lowest |
| New resource | None. Needs one migration | New Worker exporting the class, plus a DO binding the owner adds to the Pages project ([Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/)) | New KV namespace and binding the owner creates | Not listed among [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/); would need a separate Worker behind a service binding |
| Change size | Migration ~60 lines, module ~100 lines, 6 one-line call-site swaps | New Worker + wrangler config + deploy pipeline + module | Module + binding | New Worker + service binding |

Cloudflare WAF rate-limiting rules (zone level, no code) stay a possible IP-only backstop: the Free plan counts by IP
only with a 10 s period ([WAF rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)); Pro is
needed for periods up to 1 minute.

Failure mode per route (applies to A, B and C; the per-isolate limiter always stays in front and is the fallback):

| Bucket | Store unreachable | Why |
|---|---|---|
| `analyze`, `extractText`, `transcribe`, `adminWrite` | Open: per-isolate limit only | Availability; credits stay server-authoritative, so no free work is unlocked |
| `activateCode` | Closed: 429, 30 s | Stops code guessing; the route needs the same database anyway |
| `requestAccess` | Closed: 429, 30 s | Stops spam; the route writes to the same database anyway |

## 3. Recommendation: A, Supabase table + atomic RPC

$0, exact across isolates and locations, no new Cloudflare resource or binding, and it reuses the existing
`STAGING_SUPABASE_URL` / `STAGING_SUPABASE_SERVICE_ROLE_KEY` server path. It needs a migration, so per the task it is
prepared, not applied or wired.

Prepared in this PR:
- `supabase/migrations_pending_approval/create_navigator_rate_limit_hits.sql`: table `navigator_rate_limit_hits`
  (SHA-256 key hash, fixed window, count), RLS on, closed to `anon`/`authenticated`; `security definer` function
  `navigator_rate_limit_hit(key_hash, limit, window_seconds)` executable by `service_role` only. A refused call does
  not increment. Prunes rows older than one day, at most 50 per allowed call.
- `supabase/migrations_pending_approval/rollback_navigator_rate_limit_hits.sql`: drops only those two objects.
- `functions/api/_persistent-rate-limit.ts`: `persistentRateLimitRetryAfter(env, bucket, subject)`, same return
  contract as `rateLimitRetryAfter`. Per-isolate check first, then the RPC only when `PERSISTENT_RATE_LIMITS="true"`.
  Subjects are hashed before leaving the isolate; logs carry only the bucket.

Known limit: fixed windows allow up to 2x a limit across one window boundary.

To enable after owner approval: apply the migration, then at each of the 6 call sites replace
`rateLimitRetryAfter(bucket, subject, RATE_LIMITS.x)` with `await persistentRateLimitRetryAfter(env, bucket, subject)`,
and set `PERSISTENT_RATE_LIMITS=true` in preview first.

## 4. Verification

- `api/cloudflare-persistent-rate-limit.test.ts` (16 tests, mocked RPC): a global limit holds across fresh
  isolates; no database call without the flag; isolate bursts are refused before any call; only the hash is sent;
  8 store-failure cases (network, timeout, 503, missing RPC, malformed, empty, missing key, non-HTTPS) are open or
  closed per bucket, with no subject in logs.
- `tests/devin/rate-limit-migration.pg.test.ts` (7 tests, disposable PostgreSQL 16, gated on `CREDIT_PG_URL` like
  the other `.pg` suites): exact limit; 40 parallel connections with limit 8 allow exactly 8; window rollover; pruning;
  argument validation; `anon`/`authenticated` denied, `service_role` allowed; rollback idempotent.
- Mutation checks: removing the `where h.hits < p_limit` guard fails 2 SQL tests; making `activateCode` fail open
  fails 1 unit test.
