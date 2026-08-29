# ParentShield (ontario-parent-cyfsa-navigator1) — Audit Handoff

Repo: bettertimesahead475-commits/ontario-parent-cyfsa-navigator1
Live: ontario-parent-cyfsa-navigator1-ror.vercel.app (Vercel, team ontarioparentassist-7616s-projects)

## What just happened
Three full audit rounds were completed today (2026-08-28) via chat, covering every file in the
repo at least once, most twice. All fixes below are already committed to `main` and confirmed
live (Vercel deployment READY, `tsc --noEmit` clean, `vite build` clean). This document exists so
a fresh Claude Code session doesn't have to rediscover any of it.

## Architecture essentials (read this before touching anything)
- **Two files are both named "server":** `/server.ts` (repo root, ~11 lines, dev-only stub that
  imports the real app) and `/api/_server.ts` (~1,250 lines, the ENTIRE actual Express backend —
  every endpoint, every AI prompt). Vercel only deploys files inside `/api/`, so the root
  `server.ts` is irrelevant to production. **These two got confused via GitHub's web upload UI
  today and it broke production once** — always confirm which one you're editing.
- `/api/services/access.ts` — the real e-transfer payment/access-code flow (Supabase-backed).
- AI calls go through `generateContentWithFallback()` in `_server.ts` — always pass explicit
  `max_tokens` for anything with a large output schema. The shared default is 8000; `/api/analyze`
  and `/api/case-timeline` explicitly override to 16000 because they were truncating at 8000.
- Valid Claude model strings the backend actually accepts: `claude-sonnet-5`,
  `claude-haiku-4-5-20251001` (see `CLAUDE_MODELS` in `_server.ts`). Anything else silently falls
  back to `claude-sonnet-5`.
- Chat endpoints (`/api/rag-query`) now expect a `history` array in the request body — both
  frontend chat UIs (`DocumentAnalyzerTab.tsx`'s case chat, `ParentChatBot.tsx`'s "OPA Coach")
  send it. If a new chat UI gets built, it needs to send `history` too or it'll have no memory.

## A pattern worth knowing about
At least twice today, a bug that had already been fixed in a past session reappeared later
(a Netlify `_redirects` file, a `wrangler`-based deploy script, a `chrome-extension://` crash
guard in the service worker). The working theory: manual GitHub web-uploads and/or an automated
Vercel coding agent have occasionally reintroduced older file versions. Worth being alert to
regressions of things that look "already fixed" in this changelog.

## Round 1 — backend correctness (commit ea42d2e)
- Fixed the TS2769 type error that had been in every build log (role-type ternary widening to
  `string` instead of `"user"|"assistant"`).
- `/api/case-timeline` had no explicit `max_tokens` (same truncation risk as analyze) — raised.
- Removed dead `deploy:pages` script (called `wrangler`, not installed) + duplicate `vite` dep.
- `.env.example` was missing ~half the real env vars (`ADMIN_SECRET`, `SESSION_SECRET`, all SMTP
  vars, `SUPABASE_SERVICE_ROLE_KEY`, `LAWYER_INTAKE_TO`) — documented.

## Round 2 — the other chat, token expiry, misc (commit b235174)
- `ParentChatBot.tsx` had the same "no conversation memory" bug as the main case chat — fixed.
- `TemplatesTab.tsx` voice-evidence extractor had a hardcoded fallback date (`"2026-06-06"`).
- `SignUpTab.tsx` audio upload: async work inside `reader.onloadend` wasn't actually covered by
  the surrounding try/catch — a network failure there left `isTranscribing` stuck `true` forever.
- `utils/workspace.ts`: `fetchRecentEmails` fetched messages sequentially instead of in parallel.
- Google OAuth token never expires/refreshes; normalized 401 handling so an expired token at
  least triggers the existing "reconnect" prompt instead of a confusing raw error. **Real token
  refresh is NOT implemented — this is still a gap**, just no longer a silent-confusing one.
- Removed an unconditional Firestore read that fired on every page load in production forever.
- Fixed `Apache-2.5` (not a real license) → `Apache-2.0`; fixed a header crash risk
  (`userProfile.fullName.split(...)` with no guard); fixed a hardcoded year in generated IDs.

## Round 3 — complete file-by-file sweep, remaining ~20 files (commit 3a66b71)
- Wired up `eslint.config.js` (was orphaned, never actually run — now has a script + explicit dep).
- Removed `public/_redirects` (Netlify-only, dead under Vercel) and restored a missing
  `chrome-extension://` scheme guard in `public/sw.js` — both regressions of past fixes.
- Fixed `metadata.json` still naming the wrong sibling repo.
- Removed `LegalCaseBrief.tsx`'s dead import (superseded by inline rendering) and deleted
  `LegislativePortalModal.tsx` entirely (never imported anywhere, its body was a literal
  `/* ... rest of the modal content */` placeholder comment).
- **Non-functional model selector** in `DocumentAnalyzerTab.tsx` AND `ParentChatBot.tsx` — both
  dropdowns offered two options, neither valid per `CLAUDE_MODELS`. Fixed both.
- **Dead feature**: `SavedDocumentsTab.tsx`'s "Open Document" for a saved analysis wrote to
  `localStorage["OPA_LOAD_ANALYSIS_REPORT"]` and navigated to the analyzer, but nothing ever read
  that key back. Wired up the receiving side in `DocumentAnalyzerTab.tsx`.
- **Real playback logic bug** in `VoiceAssistantTab.tsx`: `speechSynthesis.cancel()` ran
  unconditionally before checking if this was a resume-from-pause (so resume never worked), AND
  the resume branch set `isPaused` to `true` instead of `false` (so after the first pause it would
  try to "resume" forever, even for newly-selected text). Fixed the ordering, the flag, and added
  the same missing reset to the two places that change narration text mid-pause.
- Fixed 5 instances of unguarded `navigator.clipboard.writeText()` (no `.then()`/`.catch()`) across
  `LegalTerminologyDrawer.tsx`, `VoiceAssistantTab.tsx`, `SignUpTab.tsx`,
  `StatutoryBookmarkSidebar.tsx`, `DocumentAnalyzerTab.tsx` — all showed a false "copied!"
  confirmation on silent clipboard failures.
- `PricingTab.tsx` hardcoded its own copy of `TIER_PRICES`/`PAYMENT_EMAIL` instead of the existing
  (never-called until now) `/api/access-pricing` endpoint — now fetches real values with the
  hardcoded copy only as a fallback.

## Known, not fixed — flagged as bigger than a bug-fix pass
1. **No automated tests exist anywhere in this repo.** `npm run lint` is just `tsc --noEmit`.
2. **Bundle size**: main JS chunk is ~1.9MB (537KB gzipped), plus a 1.35MB `heic2any` chunk. Vite
   warns on every build. Needs real code-splitting (`dynamic import()`, `manualChunks`), not a
   quick fix.
3. **Google OAuth token refresh** is still not implemented (see Round 2) — only the error message
   on expiry was fixed, not the underlying expiry itself.
4. No general ESLint rules for the actual TS/React code — `eslint.config.js` only lints
   `firestore.rules` (that plugin's specific purpose). A real `eslint-plugin-react` /
   `@typescript-eslint` setup doesn't exist.
5. Two parallel, similarly-named Vercel projects exist for this codebase historically
   (`ontario-parent-cyfsa-navigator1` and `remix-ontario-parent-cyfsa-navigator`) — always confirm
   which one is actually live before assuming a fix landed (checked via `vercel.com` project ID
   `prj_wbNOXbsCWbj7vyu7JjxlXwt4WQpR` / team `ontarioparentassist-7616s-projects` today).

## Verification standard used throughout today
Every single fix in this document was verified with `npx tsc --noEmit` (zero errors, project-wide,
as of the last commit) and `npx vite build` (clean) before committing, and every commit was
confirmed to reach Vercel `readyState: "READY"` before moving to the next one.
