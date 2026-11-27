# Agent B: owner findings (guest bookmarks, legacy cutover, FCA size limits)

Branch `devin/1795746871-exports-guest-legacy-fca`, based on `engineering/integration` at `0a7c680`.

| Finding | Commit | In production `b9617a8`? |
|---|---|---|
| 3. FCA size guidance | `5b153e1` | Yes. The client check (`file.size > 150000`, "under 150 KB") comes from `c89abf2`, which is an ancestor of `b9617a8`. |
| 2. Irreversible legacy cutover | `54dffef` | No. Sign-out deletion came in `1a1931d` (PR #153), which is not an ancestor of `b9617a8`. |
| 1. Guest bookmark data loss | `5937934` | No. Memory-only guest state also came in `1a1931d`. |

## 1. Guest bookmarks
- `useAccountStorage` now returns a third value, `GuestEdits` (`isGuest`, `unsaved`, `pending`, `clearPending`). Guest state stays in memory and is never written to localStorage or sessionStorage.
- On sign-in, guest edits become `pending` for that account only; nothing is merged automatically. If that account signs out before choosing, the edits go back to the guest. The next account to sign in is offered them; an account switch with no guest in between drops them.
- Statute Desk:
  - Before anything is entered, a "Not signed in" note says bookmarks and notes last only while the page is open.
  - While signed out, the notes button reads "Keep Notes (this page only)".
  - After sign-in it offers "Move these N bookmarks to your account" or "Discard". `mergeBookmarks` keeps the account's copy and appends different guest notes.
  - A `beforeunload` warning shows while guest work is unsaved or not yet moved.

## 2. Legacy shared chat and bookmarks
- `signOutOfAccount` no longer deletes `OPA_COACH_CHAT_MESSAGES` or `OPA_STATUTE_BOOKMARKS`.
- `src/utils/legacySharedData.ts` handles the migration; `LegacySharedDataPrompt` is mounted in `App.tsx`.
  - The first account signed in while legacy keys exist is recorded in `OPA_LEGACY_SHARED_DATA_CLAIM` as `{uid}`.
  - That account is shown counts only, never contents, with "Import into my account" and "Discard them". No other account is ever offered the data.
  - Its choice is recorded before anything is copied. Every copy into `${key}_${uid}` is merged by id, so a retry never duplicates. The legacy keys and the claim are deleted only after the copies are written.
  - If the import is interrupted (for example, storage full), the recorded choice is finished on the next load, whoever is signed in.
- `useAccountStorage` reloads on `opa-account-storage-changed`, so imported data shows up without a refresh.

## 3. FCA source limits
- `shared/assessmentLimits.ts` holds the server's existing limits. The server now imports them; their values are unchanged.
  - 150,000 UTF-8 bytes per request body.
  - 75,000 characters per document and 75,000 per source set.
  - 20 sources per set; 255-character file names; `.txt` only.
- The client measures the exact body it sends (`sourceRequestBody`) and shows the real limit and the current size.
  - The character limit is checked first. One document's limit (75,000 characters) equals the whole matter's, so splitting cannot help: the message says the matter reads about 75,000 characters in total and suggests removing non-evidence pages or moving them to a separate matter.
  - Splitting is suggested only when the 150,000-byte limit alone is the cause (multi-byte text).
- The client cannot see the saved sources' sizes: the API returns them only inside a completed report, and the API shape must not change. The upload help text now states the matter-wide limit instead (`SOURCE_SET_NOTICE`).
- `INPUT_TOO_LARGE` and `SOURCE_SET_TOO_LARGE` messages now state the real limits.

## Verification
- Regression tests (each fails on the old code, checked by stashing the fix):
  - `src/components/FinalCaseAssessment.limits.test.tsx`: 2 of 8 fail on the old component (quote-heavy file, long file name).
  - `src/utils/firebase.signout.test.ts`: fails on the old `firebase.ts`.
  - `src/components/StatutoryBookmarkSidebar.guest.test.tsx` and `src/hooks/useAccountStorage.test.tsx`: 6 of 13 fail on the old hook and sidebar.
  - `src/utils/legacySharedData.test.ts` is new and covers import, discard, second account and interrupted import.
- Review and lead fixes:
  - `f663001`, `1629e0a`: size guidance.
  - `8a9b5b3`: the legacy import keeps the legacy notes and court date for a bookmark that is in both lists.
  - `55fd723`: other tabs reload on a `storage` event instead of overwriting the import.
  - `bce86cf`: if storage is full, the guest bookmarks stay pending.
  - `ccccb78`: comment typo.
- At `ccccb78`: `npx tsc --noEmit -p .` reports 0 errors. Vitest: 322 files passed, 15 skipped; 4765 tests passed, 512 skipped, 0 failed.
- Browser check (Playwright, mocked Firebase users, mocked `/api`, synthetic legacy data):
  - A was offered "1 coach chat message and 1 statute bookmark", imported them, and the legacy keys were removed. B got no prompt and saw no legacy data.
  - When A signed out without choosing, the legacy keys stayed claimed by A and B got no prompt.
  - Guest mode: the note shows before any input, nothing is written to storage, and a refresh raises the `beforeunload` prompt.
  - The in-page move after a real Google sign-in is covered by the component tests only: a mocked sign-in needs a page reload, which clears guest memory.

PDF polish (emoji headings, chronology labels, end matter) is paused locally on `devin/1795746615-exports-pdf-layout` (unpushed WIP commit).
