# Cloudflare migration: compatibility gates

This branch is isolated from production. The current application cannot safely be deployed as a fully working Cloudflare Worker by copying Vercel environment variables alone.

## Verified repository constraints
- `api/_server.ts` initializes an Express application and uses Node `fs`/`path`, Node middleware, and an SSE emitter that writes to an Express response.
- `api/services/pdfPolyfill.ts` imports pdfjs-dist and installs Node headless DOM polyfills.
- `api/services/firebaseAdmin.ts` uses the Firebase Admin SDK and a service-account credential.
- The analyzer reserves, finalizes, and releases credits; a partially executed or prematurely terminated request must not double-charge.
- The frontend is built by Vite; `server.ts` is a Node entrypoint, not a Cloudflare Worker handler.
- The existing Vercel environment includes production secrets. Do not copy any value into the repository.

## Required engineering gates
1. Establish a Cloudflare Worker-compatible request adapter and test route parity for the full API.
2. Validate the PDF/DOCX extraction stack and Firebase Admin behavior in the Workers runtime; do not assume `nodejs_compat` is sufficient.
3. Preserve SSE streaming, durable job status, and idempotent credit settlement under disconnects and retries.
4. Verify the production Supabase project reference and database availability before writing or using credentials.
5. Stage with isolated secrets and non-production test data, then run authenticated end-to-end tests.
6. Obtain explicit approval before any paid resource, DNS change, or production cutover.

## Release status
No Cloudflare deployment, secrets transfer, or domain cutover is authorized by this document. Passing a frontend build alone is not evidence that the analyzer works.
