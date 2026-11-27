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

## Worktree and commit rules (added 2026-11-26)

Cause of the bundling in `847c4e0`: the primary checkout (`ontario-parent-cyfsa-navigator1`) is the only checkout of
`engineering/claude-backend`, and several agent sessions wrote into it at once. One session committed files another
session had left uncommitted in the same working tree (`analyzerRetryPolicy.ts`, `legalVerificationPipeline.ts`, an
`AdminConsole.tsx` line). Within the 35 minutes after that commit, the branch gained 8 more commits from concurrent
sessions. Nothing in git prevented it.

1. **One writer per worktree.** Each session edits only in its own worktree on its own branch, never in the primary
   checkout. Create one with `git worktree add -b engineering/<name> <path> <base>`. The primary checkout is read-only
   for agents; it is updated only by merges that a control-document owner records.
2. **Commit only what you wrote.** Stage by explicit path (`git add <file> ...`), never `git add -A`, `git add .` or
   `git commit -a`. Before committing, `git diff --cached --stat` must list only files in your task's ownership.
3. **Check the scope before you commit.** Every commit touching files outside your ownership must name the owner in its
   message and be reviewed by that owner (review worktree branches are reviewed before merge).
4. **Shared control documents** (`engineering/*.md`) are edited on the branch of the session that owns them; other
   agents propose edits through their handoff files.
5. **Before reading a file you intend to change**, run `git status` in your own worktree. If the file changed on disk
   that you did not change, stop and record it in your handoff instead of overwriting or committing it.

## Current worktrees (2026-11-26)

| Worktree | Branch | Owner |
|---|---|---|
| `ontario-parent-cyfsa-navigator1` (primary) | `engineering/claude-backend` | Claude (merge point only) |
| `cyfsa-worktrees/claude-review` | `engineering/claude-review` | Claude (review and fixes for 847c4e0) |
| `cyfsa-worktrees/antigravity-frontend` | `engineering/antigravity-frontend` | Antigravity |
| `cyfsa-worktrees/codex-security` | `engineering/codex-security` | Codex |
| `cyfsa-worktrees/integration` | `engineering/integration` | Merge target for promotions |
