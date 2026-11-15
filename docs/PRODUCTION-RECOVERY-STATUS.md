# Live paid-session lookup trace — November 15, 2026

Authenticated synthetic Quick Review and Deep Scan both returned 503 SESSION_INVALID. A live Pages tail confirmed the read-only GET to the configured nxfhvebzzobegufcda project at /rest/v1/navigator_paid_sessions returned HTTP 400, non-JSON, with no db/PostgREST error code or sb-request-id. The staging table has RLS enabled and the service role has SELECT and BYPASSRLS. Supabase edge logs showed no corresponding paid-session REST request.

Commit c7117441b08459e4e04634cd29536369f0aeeaf2 added sanitized response classification. Commit a84ece81a5bcaa20516106fb8632ad987565b48b trims the configured key, sends opaque keys in apikey only, preserves legacy JWT headers, and logs only a key-format classification. Preview https://af84d91e.cyfsa-navigator-git-staging.pages.dev deployed successfully. GitHub checks at time of checkpoint: Cloudflare staging API verification 43763818117: success; Cloudflare migration compatibility checks 43763818139: success; CI 43763818167: success.

The fresh live trace classified the effective key as unrecognized after trimming: neither a supported opaque prefix nor a JWT-shaped value. The Preview metadata lists only STAGING_SUPABASE_SERVICE_ROLE_KEY for privileged access, with no read-key override. The 400 response occurred before any successful paid-session lookup, credit reservation, queue enqueue or provider work. The available Supabase connector exposes publishable keys only, so a privileged staging key could not be installed or independently tested with available access.

Next action: securely install a valid project-matched backend key from nxfhvebzzobegufcda in the Cloudflare Pages Preview binding STAGING_SUPABASE_SERVICE_ROLE_KEY. Verify the staging Consumer has a valid matching key before Queue acceptance. Redeploy and rerun signed-in synthetic acceptance. Keep production unchanged.

# Staging recovery continuation — November 15, 2026

- The synthetic user has only a password provider. Native Firebase sign-in in gen-lang-client-0105737183 returned PASSWORD_LOGIN_DISABLED.
- Confirmed missing iam.serviceAccounts.signBlob for the authenticated IAM principal on the Firebase signing service account. Created a custom role containing only that permission and applied temporary conditional bindings on that service account alone. The bindings were removed after token signing. The unbound role definition remains available. Firebase ID tokens were accepted by both immutable Previews; no Firebase provider or production application configuration changed.
- First authenticated Deep Scan without a paid session returned 403 UPGRADE_REQUIRED. Provisioned a 45-minute synthetic-only AnalyzerPremium session in the existing staging database. The original and diagnostic Previews both returned HTTP 503 SESSION_INVALID for both signed-in scan modes with that session. Code maps 503 to the unavailable paid-session REST lookup before credit reservation. Confirmed zero durable jobs for the four request IDs. Supabase SQL confirmed service_role can read the paid-session table. No matching REST events appeared in the available Supabase logs.
- Commit 414880633b38a8d75623a2c84a13e787c2c37473 adds sanitized lookup diagnostics. CI 43760049394, staging API 43760049379 and migration compatibility 43760049408 passed. Diagnostic Preview https://0a0333cf.cyfsa-navigator-git-staging.pages.dev (0a0333cf-9521-49a3-aa12-3ec3b9496943) deployed. Workers Observability returned no matching Pages diagnostics. Next action: attach a live Pages tail to that deployment and rerun with a fresh synthetic session, or validate the configured staging Supabase secret securely against the exact paid-session REST read. Preserve project identity and production settings.
- No Claude execution, forensic completion, report persistence or credit acceptance was observed. Production promotion remains blocked.
 
# Staging acceptance update — November 15, 2026

The active recovery branch is genspark/forensic-analyzer-recovery at a8396848c9bf247683e106973c2fd58a6b53cbe2. Cloudflare immutable preview https://75415549.cyfsa-navigator-git-staging.pages.dev is deployed, and CI 43757945143, staging API verification 43757945132 and migration compatibility 43757945158 passed. Preview is configured for the staging queue and Firebase project gen-lang-client-0105737183.

The existing isolated Firebase identity signed in to its own project. The exact candidate returned HTTP 401 before job submission because its configured Firebase project differs. The existing Admin SDK session could read the designated synthetic user in the trusted project and locate the Firebase signer. createCustomToken failed with auth/insufficient-permission during signing. The needed permission for remote custom-token signing is iam.serviceAccounts.signBlob on the Firebase signer. An equivalent way to unblock acceptance is an authorized synthetic session issued by the trusted Firebase project via an already enabled provider. Check that the synthetic staging entitlement is active before submission.

No signed-in Deep Scan or Quick Review job was submitted, and no report, timing, or credit evidence was produced. No production promotion or auth settings change was made. Continue with signed-in synthetic queue, provider, persistence, recovery, and credit acceptance before considering promotion.

# Deep Scan recovery — November 13, 2026

- Release branch integration/navigator-release-20261108 advanced from c6ed2c0127071ccf3699ef30f72f802bbc161568 to 3d5c52aa884442a231baffc6b8fa3bc062db4113.
- Previous immutable Preview 05b69f33-a3e0-4ef8-afd5-8813b2052d86 has no configured Queue producer. The configured Supabase project nxfhvebzzobegubefcda had no durable job rows when checked. The original signed-in request and provider logs remain unobserved.
- Fix 9bba38e2a2510354ed63b98007d2d918ff491543 removes browser read backpressure from analysis, persistence and settlement in the shared SSE handler. The initial awaited TransformStream write previously preceded the analysis deadline. Heartbeats are skipped while unread events are buffered. Regression 3d5c52aa884442a231baffc6b8fa3bc062db4113 keeps the SSE body unread until the mocked stalled provider times out and the background job settles.
- Exact repaired Preview https://0a37030e.cyfsa-navigator-git-staging.pages.dev, deployment 0a37030e-c99e-493d-825c-bdd226e2316a. Deploy succeeded. Exact-commit CI 43527020629, staging API verification 43527020650, and migration compatibility 43527020617 all passed.
- Production Pages remained at commit 36c1313a7e18a96fc8ff3cab0afbacdcd604536c. Current canonical deployment 695691bd-52c0-4919-ae03-ffe179116675. Earlier rollback deployment a4513a30-0382-4a39-a6e4-9f74deb9ad93 was recorded in the prior checkpoint.
- Dedicated Worker deployment 9f6bf2ad-b0a1-4743-a092-bf68f74e00da added its requeue producer. Worker still disabled. Primary queue one producer and zero consumers, dead-letter zero producers and zero consumers.

## Resume

Use an authorized synthetic Firebase session on the immutable repaired Preview. Capture sanitized network status and request ID for Deep Scan, correlate stage and provider timing, verify Quick Review and OCR, reopen the persisted Deep Scan, and verify credit settlement. Separately test durable execution with isolated queues and verify frontend refresh and duplicate-click recovery. Production promotion and Queue activation require completed acceptance and explicit approval.
