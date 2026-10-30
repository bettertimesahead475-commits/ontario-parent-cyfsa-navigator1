# Cloudflare staging: Supabase entitlement integration contract

Status: **not enabled**. This document records verified schema and required security gates; it does not authorize migration or production changes.

## Verified staging facts (2026-10-29)
- Supabase project: `nxfhvebzzobegubefcda`; production project: `qboidsfpjuxeqtfotryj`. Do not cross-connect them.
- `navigator_paid_sessions` columns include `id`, `firebase_uid`, `tier`, `issued_at`, `expires_at`, `revoked_at`. There is **no** `remaining_credits` column.
- `free_usage` stores counters, reservation markers, and suspension markers.
- Existing `free_reserve_scan`, `free_finalize_scan`, `free_release_scan`, `paid_reserve_credit`, `paid_finalize_credit`, `paid_release_credit` are atomic PostgreSQL functions.
- The six functions are SECURITY INVOKER; execution is not granted to `anon` or `authenticated`, but is granted to `service_role`.
- Sensitive tables checked have RLS enabled, with no public policies and no `anon`/`authenticated` table privileges found.
- Current Cloudflare `_entitlement-readiness` deliberately responds 503. **Do not enable the analyzer yet.**

## Implementation requirements
1. Verify Firebase ID token cryptographically on each privileged request. Never accept Firebase UID from JSON/body/query as identity.
2. Read the paid session using a server-only Supabase credential and verify `firebase_uid === verifiedToken.sub`; check session ID, revocation, expiration, and suspension marker. Treat missing/invalid rows and failed reads as denied, not active.
3. Obtain `tier` exclusively from the verified database row. Reject unknown tiers. Do not accept client-provided plan, limit, session owner, or `verifiedFromDatabase` as authorization evidence.
4. Derive allowance and counter scope from the existing `api/services/creditAccounting.ts` rules, including monthly billing anchors, rather than from a nonexistent credit-balance column. Pro/Community quick reviews are not constrained by the monthly forensic counter; do not accidentally deny them because that counter is exhausted.
5. For free scans, derive usage from `free_usage` using the verified Firebase UID; reserve with `free_reserve_scan`. Paid scans must reserve with `paid_reserve_credit`. The preview policy alone must never consume or grant credits.
6. Reserve before model work, finalize only on successful billable delivery, release on failed processing, and enforce idempotency and request ownership. An ambiguous database write must fail closed.
7. Never expose Supabase `service_role` credentials in Vite/browser bundles, response bodies, logs, or public Pages environment variables. Use staging-specific secrets.
8. Validate full and quick tiers independently, including forged session IDs, expired/revoked sessions, exhausted credits, concurrent reservations, timeouts, duplicate requests, and failed database access.
9. Keep staging analyzer disabled until CI, authenticated end-to-end tests, and security checks pass. Do not merge to `main` or change `cyfsanavigator.com` DNS.

## Integration caution
The pure `_entitlement-policy.ts` model currently uses a `verifiedFromDatabase` boolean as a **test-only evidence field**. A caller setting this boolean does not prove anything. The future trusted adapter must construct evidence itself after actual database reads, and the final authorization path must be coupled to the atomic reservation result.

## Existing code references
- `api/services/creditAccounting.ts` — current production credit scope, tier allowances and reservation lifecycle.
- `functions/api/_auth-check.ts` — staging Firebase signature verification prototype.
- `functions/api/_entitlement-policy.ts` — pure policy, not wired to the database.
- `functions/api/_entitlement-readiness.ts` — fail-closed readiness endpoint.
