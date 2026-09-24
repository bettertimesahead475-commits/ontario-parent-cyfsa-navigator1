# Stage 10 slice 3: access-history read model and UI foundation

Date: 2026-09-24. Branch: `claude/stage-10-access-history`, stacked on slice 2 (`621f634`, PR #28), which is stacked on
slice 1 (`97ec949`, PR #26). It contains no Stage 7B remediation (PR #27) and no Form 33B.1 or Stage 9 history.

## Why this slice is GREEN (re-verified)

- **No schema change.** Slice 2's `list_matter_access_events` already authorizes each request inside PostgreSQL,
  binds results to one matter, orders by `event_sequence`, and pages by `after_sequence`.
- **No shared-file change.** The frontend pattern (`apiFetch`, jsdom component tests, `role="status"` / `role="alert"`,
  generation-ref stale-response guards from the 9D-3 remediation) lets the panel be built without touching `App.tsx`.
- **No dependency** on PR #27, Stage 9, Form 33B.1 or `api/_server.ts`.

## What was built

| File | Purpose |
|---|---|
| `api/services/matterAccessHistory.ts` | Application-facing read model over `listMatterAccessEvents`: matter-bound opaque cursor, bounded pages, fixed past-tense summaries, "you" labelling, historical-basis notice. |
| `api/matterAccessHistoryRoutes.ts` | `GET /api/matters/:matterId/access-history?cursor=&pageSize=`. Read-only and **not mounted**. |
| `src/components/AccessHistoryPanel.tsx` | Isolated, read-only history panel. **Not mounted** in `App.tsx`. |

Slices 1 and 2 and their files are unchanged.

## Current state vs history

- **Every page** carries `basis: 'HISTORICAL_EVENTS'` and a notice: *"This is a record of past access events. It does
  not show who can open this matter now; the current access report answers that."*
- **Summaries are past-tense descriptions of stored events only**, e.g. "Access invitation accepted". A test rejects any
  summary containing "has", "have", "currently" or "now", and the UI test rejects "has access", "currently" and
  "can open".
- **"Who can open this matter now"** stays the job of slice 1's report (`matterAccessAudit.ts`). The two sources are not
  merged. A future screen may show them side by side, labelled separately.

## Authorization (unchanged from slice 2, enforced before rows leave PostgreSQL)

| Reader | Result |
|---|---|
| OWNER | The matter's full history (scope `MATTER`) |
| REVIEWER | Only events it performed or that concern it (scope `SELF`) |
| Revoked professional, suspended account, unrelated account, other matter's owner, unknown account, unknown matter | 403 `FORBIDDEN`, no entries |

**No client-side security.** The read model and the panel never filter records. The PostgreSQL test calls the database
function directly and shows the reviewer's rows are already restricted at the source.

**Authorization is re-checked on every page.** The cursor holds no role or permission. Tests prove that:
- A professional revoked between pages is refused on the next page.
- A role change between pages takes effect on the next page, in both directions.

## Pagination and ordering

**Cursor.** It is opaque: `h1.` + base64url JSON `{m: matterId, s: lastEventSequence}`.
- It is validated strictly before any database call: prefix, charset, maximum length, exact keys, lowercase canonical
  matter id **equal to the requested matter**, and a positive safe-integer sequence.
- A cursor from matter A used on matter B → 400 `INVALID_CURSOR`, with no database call.
- It is **not signed**, deliberately. It carries no authority: a tampered sequence can only re-slice events the caller is
  already authorized to read, which a test proves for a reviewer.

**Why not offset pagination.** Offsets skip or duplicate rows when events are inserted between requests. A test inserts
an event between pages and proves nothing is duplicated or skipped.

**Page size.** Default 25, range 1–100. The read model requests `pageSize + 1` rows to know whether another page exists,
which stays within slice 2's 200-row bound (asserted at module load).

**Ordering.** Strictly by `event_sequence`, a unique identity column. This makes the order total even when timestamps are
identical. The test fixture writes five events in one transaction, so they share one `now()`. Paging with sizes 1, 2, 3,
4 and 100 returns every event exactly once, in the same order, every time.

## Privacy and minimization

- Entries expose exactly: id, sequence, occurredAt, eventType, outcome, reasonCode, summary, actor {kind, accountId,
  roleAtEvent, isRequester}, subject {accountId, isRequester}, and grantId.
- There is no idempotency key or internal column, and the event schema has no case content to leak.
- The UI shows short account references ("account 1a2b3c4d") and never raw server error text.

## Unknown event types

The server (slice 2) fails closed: an unrecognized event type from the database rejects the whole page, and the panel
shows a generic error. As a second defense, the panel renders any unrecognized type as "Unrecognized access event". Both
the visible text and the accessible name are neutral; the untrusted summary is never shown.

## Accessibility

- **Structure:** a `<section>` labelled by an `<h2>`; an `<ol aria-label="Access history, oldest first">`; each entry is
  an `<article>` with an accessible name.
- **Timestamps:** `<time dateTime>` with an explicit date, 24-hour time and zone name.
- **Outcomes:** written out ("Outcome: refused", "Reason code: …"), never shown by colour alone.
- **Announcements:** loading and empty states use `role="status"`; failures use `role="alert"`.
- **Paging:** "Load more history" is a native `<button>`, so it is keyboard-operable. It is disabled while loading and
  sets `aria-busy`.

## Route and integration points (not done here)

- **API:** add `registerMatterAccessHistoryRoutes(app)` next to the other `register*Routes(app)` calls in `api/_server.ts`
  (with the slice 1 and slice 2 registrations) after Stage 9 lands.
- **UI:** render `<AccessHistoryPanel matterId={…} />` on the matter owner's and reviewer's matter views in `src/App.tsx`
  or the workspace, after the route is mounted.

## Dependency map (recalculated)

| Component | Class | Why |
|---|---|---|
| Slice 1 current-state report | GREEN, done (PR #26) | — |
| Slice 2 append-only event log | GREEN, done (PR #28) | — |
| Slice 3 history read model, route, panel | **GREEN, done (this slice)** | No schema, shared-file or PR #27/Stage 9 dependency |
| Emit `GRANT_*` / `REVIEWER_ACCESS_*` from invite/accept/revoke | YELLOW | PR #27 rewrites those functions; wait for its independent freeze |
| Emit `ACCESS_AUDIT_VIEWED` from the slice 1 report | YELLOW | Needs a product decision: should a failed audit write block the owner's view? |
| Mount the three Stage 10 routes; place the panel in the app | YELLOW | `api/_server.ts` and `src/App.tsx` are shared with Stage 9 |
| Access-denied logging at request gates | YELLOW | Needs rate-limit and retention policy |
| Admin/compliance reader; retention and erasure policy | YELLOW | Owner/legal decision |
| Reviewer data-read logging | RED | Needs Stage 9D research and form/work-product routes to be final |
| Firm/team tenant model and delegation | RED | No roadmap contract |
| Firm-shared permissions on form drafts | RED | Depends on unfinished Form 33B.1 |

## Verification

- Real PostgreSQL 16 (`matterAccessHistory.pg.test.ts`, opt-in, local only, disposable database): 37 tests, stable over
  5 consecutive runs.
- Mocked service, route and component tests: 47.
- Mutation testing: 20 security-relevant mutants are killed across the read model, the slice 2 SQL, and the panel. One
  mutant is behaviourally equivalent: removing the "clear entries on 403" step, because the list only renders in the
  loaded state. That step is kept as a redundant defense.
- Not validated: a hosted Supabase project.
