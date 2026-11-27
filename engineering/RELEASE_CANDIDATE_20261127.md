# Release candidate 2026-11-27 (payments, email, SEO) and owner-approval checklist

Branch `release/rc-20261127`, built on `engineering/integration` (`679b7f6`). Nothing here is deployed, applied or sent.
Production stays `0cc59589` / `82dfe65` (rollback `4c902955` / `b9617a8`) until the owner approves item 9.

**Status: HOLD (2026-11-27).** Claude's independent qualification of #171 (PR #171 comment 7226489336) lists blockers D-1..D-4: the payment
routes depend on `access_codes.redeemed_session_id`, which only migration P adds, and P is missing on the operational `nxfh` ledger. #188 (real PostgreSQL + PostgREST, 27 tests, merged) answers D-1..D-4 and is awaiting Claude's review. The
RC is not releasable until that qualification of P, D and one-activation-per-payment passes (Agent A, in
progress) and the pre-P payment paths fail closed. E additionally needs an atomic top-up refund that accounts for consumed and reserved credits.
A/B were applied without the snapshot their approval required (incident: `engineering/incidents/2026-11-27-migrations-a-b-applied-without-snapshot.md`).
Never run `free_scan_reservation_functions.down.sql` on the operational database; any rollback of A/B needs reviewed saved prior definitions.

## Contents

| PR | What | Qualification so far |
|---|---|---|
| #171 (+ #179, #183) | e-Transfer: advertised price recorded; customer order status; post-approval self-activation; idempotent interrupted-activation recovery (one deterministic code per order); 8-package price check | Devin Review clean after fixes; disposable-PG recovery tests; **Claude: pending** |
| #175 | Migration D files (one redemption per payment reference) — **files only, not applied** | disposable-PG tests; **Claude: pending** |
| #182 | Transactional email (Gmail API, outbox, dedupe, retry, encrypted codes), **off by default**; admin access-code message fix (live bug) | Devin Review clean; outbox migration F tested on disposable PG; **Claude: pending** |
| #178 | Public wording: 3 free Quick Reviews per signed-in account (matches `FREE_SCAN_LIMIT`) | CI green; **Claude: pending** |
| #176 | Pre-rendered public pages, JSON-LD, 1200×630 social image, sitemap `<lastmod>`, HTTP 404 for unknown paths | verified locally with `wrangler pages dev` (below); **Claude: pending** |
| #177 | Search Console steps and five article drafts (drafts are not linked or published) | docs only |
| register | `engineering/MIGRATION_RELEASE_REGISTER.md` (P, A–F) | read-only live checks by the T-05 session |

Not yet included: #181 (Migration E, early pack renewal keeps unused credits) until its refund fix lands.

## Verification on this branch

- `tsc --noEmit` clean. Vitest: 5,203 passed, 544 skipped; 1 failure (`FinalCaseAssessment.failclosed`) under full-suite load.
  Root cause: the tests picked the matter before the matter list loaded. Fixed in tests only (#186, `bdbcc06`); full suite 5,213 passed, 0 failed.
- `npm run build` + `wrangler pages dev dist`: `/`, `/five-day-rule`, `/pricing` → 200 with own title, `index,follow`,
  JSON-LD; `/no-such-page` → **404** noindex; `/admin` → 200 noindex shell; sitemap has 17 URLs with `<lastmod>`;
  `og-image.png` is 1200×630; `/api/access-pricing` reports "3 Free Quick Document Reviews" and Premium "5 analyses included".

## Owner-approval checklist (one decision per line)

Database (target `nxfhvebzzobegubefcda`, the staging-named project that serves production; see the register):
1. [ ] Ratify or roll back migrations A and B, which were applied to live on 2026-11-27 16:32–16:33 UTC without confirmed authorization.
2. [ ] Take a backup / confirm PITR before any further migration.
2a. [ ] Apply **G** (`payments_service_role_review_update.sql`: `grant update (status, approved_at) on payments to service_role`).
       Live `service_role` has no UPDATE on `payments`, so admin approve and cancel of e-Transfer orders fail (502) on production
       `82dfe65` today, and no access code is issued. Found read-only by #188; fixes the live site with no deploy.
3. [ ] Apply **P** (`20261110004740_preserve_monthly_renewal.sql`). Required before deploying this RC, and it also fixes the live
       admin path that queries the missing `access_codes.redeemed_session_id` column.
4. [ ] Apply **D** after P (one redemption per payment reference).
5. [ ] Apply **E** after D (early pack renewal keeps unused credits), once Claude qualifies #181 (`a7584d2`, merged into this RC; atomic refund function).
6. [ ] Apply **C** (persistent rate limits) with its flag off.
7. [ ] Apply **F** (transactional email outbox).

Code and deployment:
8. [ ] Merge this RC into `engineering/integration` after Claude's qualification.
9. [ ] Deploy it to Cloudflare Pages production (after item 3), with the RELEASE_CHECKLIST smoke tests and rollback target `4c902955`.

Customer email (no purchase needed; consumer Gmail sends about 500 recipients a day):
10. [ ] Choose the sending Gmail account and the Reply-To address.
11. [ ] Create a free Google OAuth client with `gmail.send`, and add the Cloudflare secrets listed in `engineering/handoffs/agent-b-transactional-email.md`.
12. [ ] Approve a first send to test addresses only (allowlist), then real customer sends.
13. [ ] Decide on automatic sending (free Cloudflare Cron Worker) or admin-triggered sending.

Other:
14. [ ] SonarCloud duplication on migration/rollback pairs (#175, #181): accept as-is in SonarCloud (each file must contain the full function).
15. [ ] Add `SONAR_TOKEN` and turn off SonarCloud Automatic Analysis, so coverage is imported.
16. [ ] Have an Ontario lawyer review the five article drafts in #177 before publication; approve Search Console submission.

No item requires new spending. Stripe remains a future integration.
