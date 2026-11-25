# CYFSA Navigator — agent instructions

- Engineering control documents live in `engineering/`. After any restart, read `engineering/SESSION_HANDOFF.md` first.
- Ownership: `engineering/FILE_OWNERSHIP.md`. API contracts: `engineering/API_CONTRACTS.md`.
- Tests: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run`; types: `npx tsc --noEmit -p .`.
- Production (cyfsanavigator.com) is promoted manually from `engineering/integration` only; see `engineering/RELEASE_CHECKLIST.md`.
- Never expose credentials or customer data; synthetic documents only; no paid resources or inference beyond the
  budget in `engineering/TEST_REGISTER.md`; never modify real customer balances; preserve the site's visual design.
