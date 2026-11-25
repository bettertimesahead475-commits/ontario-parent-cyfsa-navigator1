# File and Component Ownership Register

One owner per path. Only the owner edits a path. Anyone may READ anything. A change another agent needs in a
path it does not own is requested in `TASK_REGISTER.md` (column "Requested by") and made by the owner.
More specific rows win over less specific ones.

| Path / component | Owner | Notes |
|---|---|---|
| `functions/**` (Pages Functions API) | Claude | Includes `/api/admin/*` |
| `workers/**`, `wrangler*.json*`, `wrangler.toml` | Claude | Queue consumer, executor |
| `api/**` (services, legacy Express, backend tests) | Claude | `api/_server.ts` (Express) is legacy and not deployed |
| `shared/**` | Claude | Cross-runtime contracts; Antigravity may request changes |
| `supabase/**` | Claude | Migrations are prepared and tested, never applied without owner approval |
| `public/_headers`, `public/_redirects`, CSP | Claude | Security headers; Antigravity requests changes |
| `vite.config.ts`, `tsconfig*.json`, `vitest.config*`, `package.json`, `package-lock.json` | Claude | Shared build files: request dependency changes |
| `src/utils/api.ts`, `src/utils/firebase.ts` | Claude | API client and auth contract |
| `src/components/admin/**` | Claude | Administrator console (not customer-facing) |
| `src/App.tsx` | Claude (routes) / Antigravity (layout, nav markup) | Coordinate in `TASK_REGISTER.md` before editing |
| `src/**` (all other components, pages, styles, hooks, utils) | Antigravity | Customer-facing UI; visual preservation |
| `src/utils/forensicPdfRenderer.ts`, `src/utils/printExport.ts`, `src/utils/printWindow.ts` | Antigravity | PDF/print exports. Must stay CSP-compatible: no inline scripts or handlers |
| `index.html`, `public/**` (except `_headers`, `_redirects`) | Antigravity | Static assets |
| `e2e/**`, `tests/visual/**`, visual baselines | Antigravity | Browser, accessibility, visual-regression tests |
| `tests/security/**` | Codex | Adversarial and security tests (new directory) |
| `engineering/security/**` | Codex | Security findings; Claude triages into `SECURITY_REGISTER.md` |
| `engineering/handoffs/<agent>-*.md` | Each agent, own files only | Handoff reports |
| `engineering/*.md` (control documents) | Claude | Other agents propose edits in handoffs |
| `CLAUDE.md` | Claude | |
| `tests/setup/**` | Claude | Shared test setup |

## Rules

- Codex does not edit production code. It submits findings and failing tests; Claude (backend) or Antigravity
  (frontend) fixes them.
- Antigravity does not change API request/response shapes. Contract changes go through `API_CONTRACTS.md`.
- Visible changes are limited to defect fixes, accessibility requirements and explicitly authorized features.
