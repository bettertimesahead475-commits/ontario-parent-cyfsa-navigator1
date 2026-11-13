# Production recovery status — November 13, 2026

- PR #127 and integration/navigator-release-20261108 point to d2f812e5fa4519b8cea7082c671d3576fbd80514. Immutable preview: https://11e12fe5.cyfsa-navigator-git-staging.pages.dev (deployment 11e12fe5-144a-4fe7-b49a-d5b4fdfb86f2).
- CI 43482524806 passed TypeScript, Vitest and build. Staging API verification 43482524421 and migration compatibility 43482524467 passed. Three Vercel statuses failed with an account deployment block. Required-status policy for those contexts remains unverified.
- Applied the existing disabled preflight requeue binding to the deployed Worker without replacing the script. Deployment 9f6bf2ad-b0a1-4743-a092-bf68f74e00da, version ca14b56e-472c-4b89-bbe7-de1633f2ef5e. Verified ANALYZER_ENABLED=false and all three secret names after the patch. Primary queue has one producer, the Worker requeue binding, and zero consumers. DLQ has zero producers and zero consumers. No shortstop-named script appeared in the account inventory.
- Worker is configured for nxfhvebzzobegubefcda. The SQL connector reached that project and found public.analyzer_jobs. The 28P01 error observed for qboidsfpjuxeqtfotryj came from its management SQL connector. Application runtime access and provider calls remain unverified.
- Pages rollout and analyzer activation remain pending. Pages rollback: a4513a30-0382-4a39-a6e4-9f74deb9ad93 at 36c1313a7e18a96fc8ff3cab0afbacdcd604536c. Previous Worker version: 9d2e2dea-b7fa-4681-9a17-5cd6ece6bc0a.

## Next executable action

Obtain a signed-in authorized synthetic Firebase session in the test runner. FIREBASE_ID_TOKEN was absent. The existing staging runner restricts its hostname to cyfsa-navigator-staging.pages.dev, so use the exact immutable candidate origin in a narrowly scoped runner before executing the signed-in acceptance suite. Record both analyses, OCR, persistence and reopening, failure and duplicate handling, authorization, entitlement and credit evidence. Verify required check policy and keep the Worker disabled and consumers detached until the acceptance gates pass.
