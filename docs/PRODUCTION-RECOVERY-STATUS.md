# Deep Scan recovery — November 13, 2026

- Release branch integration/navigator-release-20261108 advanced from c6ed2c0127071ccf3699ef30f72f802bbc161568 to 3d5c52aa884442a231baffc6b8fa3bc062db4113.
- Previous immutable Preview 05b69f33-a3e0-4ef8-afd5-8813b2052d86 has no configured Queue producer. The configured Supabase project nxfhvebzzobegubefcda had no durable job rows when checked. The original signed-in request and provider logs remain unobserved.
- Fix 9bba38e2a2510354ed63b98007d2d918ff491543 removes browser read backpressure from analysis, persistence and settlement in the shared SSE handler. The initial awaited TransformStream write previously preceded the analysis deadline. Heartbeats are skipped while unread events are buffered. Regression 3d5c52aa884442a231baffc6b8fa3bc062db4113 keeps the SSE body unread until the mocked stalled provider times out and the background job settles.
- Exact repaired Preview https://0a37030e.cyfsa-navigator-git-staging.pages.dev, deployment 0a37030e-c99e-493d-825c-bdd226e2316a. Verify its build and exact-commit Actions results before testing.
- Production Pages remained at commit 36c1313a7e18a96fc8ff3cab0afbacdcd604536c. Current canonical deployment 695691bd-52c0-4919-ae03-ffe179116675. Earlier rollback deployment a4513a30-0382-4a39-a6e4-9f74deb9ad93 was recorded in the prior checkpoint.
- Dedicated Worker deployment 9f6bf2ad-b0a1-4743-a092-bf68f74e00da added its requeue producer. Worker still disabled. Primary queue one producer and zero consumers, dead-letter zero producers and zero consumers.

## Resume

Use an authorized synthetic Firebase session on the immutable repaired Preview. Capture sanitized network status and request ID for Deep Scan, correlate stage and provider timing, verify Quick Review and OCR, reopen the persisted Deep Scan, and verify credit settlement. Separately test durable execution with isolated queues and verify frontend refresh and duplicate-click recovery. Production promotion and Queue activation require completed acceptance and explicit approval.
