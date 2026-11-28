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

## Autonomous engineering loop

- Work from `engineering/TASK_REGISTER.md`: pick the highest-priority `todo` row you own. Record every defect with its
  evidence before changing code.
- Loop: identify defect → establish root cause from evidence → implement → run tests and `tsc` → independent review →
  resolve findings → regression check → commit verified change → next row.
- Completion gate: `.claude/settings.json` runs `scripts/stop-gate.mjs` on Stop. It blocks while a P0 row is open (not
  `done` or `blocked` with evidence) or while tracked production-code files have uncommitted changes. Do not work around it.
- A row blocked by something only the owner or an external system can provide is set to `blocked` with the evidence and the
  exact input needed. Continue other work; do not stop the session for it.
- Never change the register by `git checkout` or stash: edit the row, or ask. Use a branch per recovery track.
- Not authorized without separate owner approval: production deployment, live database migrations, destructive
  operations, paid provider calls, pricing or entitlement changes, and feature expansion.
- Basic Quick Review stays protected: no change to its path, limit or reservation without an explicit task.

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
