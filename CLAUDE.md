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
