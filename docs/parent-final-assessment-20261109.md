# Parent Final Case Assessment

The parent analyzer calls `/api/final-case-assessment` directly on Cloudflare Pages. It does not use professional workspace routes or owner bypass. Every request verifies Firebase identity, an active Pro paid session, an active account, and matter ownership. The existing `read_navigator_owned_matter` RPC also verifies the client and OWNER membership. Completion rechecks ownership and paid access.

GET without a matter lists the caller's matters. GET with `matterId` reopens the latest completed report. POST with `matterId` loads the latest immutable document versions and all their pages from server storage, generates the assessment, validates page references, persists the result, and finalizes its reservation. It rejects incomplete extraction, empty sources, more than 20 documents, and input over 75,000 characters rather than silently dropping evidence.

## Allowance

Final Case Assessment shares the existing Pro forensic allowance: five credits per paid month, anchored by the current credit code. One new source set consumes one credit. Identity, session, matter, page IDs and source contents determine the idempotency key. Reopening does not reserve a credit. Repeated generation of the same source set reuses the saved result. Provider and initial persistence failures release the attempt's reservation. A generated result is persisted before finalization; an ambiguous finalization is recovered using the same result and key, without another provider call. The pricing table remains Planned until signed-in deployment acceptance passes.

## Production consumer preparation

`wrangler.production-analyzer-queue-preflight.jsonc` prepares only the dedicated production Worker, with execution disabled, no public workers.dev route, no producers, and no attached consumers. It does not modify the shared or staging Workers. Configure and verify its own database and provider bindings before enabling execution and deploying the existing production consumer configuration. Do not attach production queues on the strength of binding names or synthetic unit tests.

## Verification boundary

The route regression suite uses fictional source pages and fixture transports. It verifies generation/reopening, identity and ownership denial, expired/revoked sessions, missing sources, provider failure, invalid source references, persistence failure, concurrent duplicates, response-loss recovery, and completion-time expiry. These tests do not establish real provider access, deployed database operations, signed-in acceptance, or production readiness.
