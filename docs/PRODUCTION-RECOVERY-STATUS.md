# Production recovery status — November 13, 2026

## Verified

- The public homepage loaded and the apex redirected to www.cyfsanavigator.com. Cloudflare Pages reports canonical deployment a4513a30-0382-4a39-a6e4-9f74deb9ad93 at 36c1313a7e18a96fc8ff3cab0afbacdcd604536c.
- Preview 11e12fe5-144a-4fe7-b49a-d5b4fdfb86f2 at d2f812e5fa4519b8cea7082c671d3576fbd80514 loaded. GitHub main resolves to e2bbc76fd31694ee0cf30af7f68c1761eb599b69, which has a successful Cloudflare Pages preview check and three successful Vercel statuses. Required GitHub Actions checks remain unverified.
- Preview and the dedicated production consumer list Anthropic, Gemini and Supabase service-role secrets. The Worker reports ANALYZER_ENABLED=false. Both production analyzer queues report zero producers and zero consumers.
- A read-only SELECT 1 succeeded on Supabase staging. The production Supabase SQL connector consistently returned PostgreSQL 28P01 for its postgres role. This establishes a connector authentication failure. Application connectivity remains to be tested separately.
- Local checkout 5838a4f619c372c2aae0893591932fec35fe4f97 could not run the normal Vitest and Vite commands because esbuild could not read a workspace ancestor in the sandbox. These commands did not reach application tests or build verification.

## Next executable action

Use the immutable preview associated with the selected candidate SHA and the existing synthetic staging harness. Verify required Actions results on that exact SHA. Run signed-in Quick Review and Forensic Deep Scan, verify provider connectivity, queue recovery, exact credit accounting, authorization and report reopening. Investigate the production SQL connector independently and verify the deployed runtime's Supabase connection with synthetic input. Record job and report identifiers and repeat the application checks on the verified production release after gated activation.

## Release and rollback

No production rollout or activation performed in this session. The observed Pages deployment ID above is the rollback reference. If a later activation reveals a critical failure, disable analyzer execution, detach the production producer and consumers, and roll back Pages to the recorded known deployment after checking the intended target. No customer data or balances were modified.
