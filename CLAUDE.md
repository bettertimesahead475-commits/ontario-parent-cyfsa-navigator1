# CYFSA Navigator — agent instructions

- Engineering control documents live in `engineering/`. After any restart, read `engineering/SESSION_HANDOFF.md` first.
- Ownership: `engineering/FILE_OWNERSHIP.md`. API contracts: `engineering/API_CONTRACTS.md`.
- Environment (all agents and CI): Node 22 (`.nvmrc`; `engines.node >=22`), install with `npm ci --ignore-scripts`
  (lockfile-exact, no lifecycle scripts). Tests: `npx vitest run`; on Node 25+ add
  `NODE_OPTIONS=--no-experimental-webstorage` (Node's built-in localStorage breaks jsdom). Types: `npx tsc --noEmit -p .`.
  Vitest includes `api/**`, `src/**` (`.test.ts`/`.test.tsx`), `eval/**`, `tests/devin/**`, `tests/cloudflare-pages-api.test.ts`.
- Production (cyfsanavigator.com) is promoted manually from `engineering/integration` only; see `engineering/RELEASE_CHECKLIST.md`.
- Never expose credentials or customer data; synthetic documents only; no paid resources or inference beyond the
  budget in `engineering/TEST_REGISTER.md`; never modify real customer balances; preserve the site's visual design.

## Permanent infrastructure directive (2026-11-26)

- Cloudflare is the designated production and staging infrastructure. Production domain: https://cyfsanavigator.com.
  Cloudflare Pages project: `cyfsa-navigator-git-staging`.
- Vercel is obsolete and is NOT an authorized deployment platform. Do not repair, reactivate, fund, configure or deploy
  anything through Vercel. Do not use the Vercel MCP tools to change anything.
- Legacy Vercel integrations (`vercel.json` crons, Vercel environment references, `api/index.ts`) may be disconnected
  only after verifying that nothing depends on them. Verification must show each job has a Cloudflare replacement.
- Preserve all Cloudflare Pages, Workers, Queues, environment bindings, secrets, domains and legitimate CI protections.
- Preserve the Supabase and Firebase integrations.
- Do not change production hosting or deploy unapproved application changes. Continue authorized work only within the
  Cloudflare architecture.
