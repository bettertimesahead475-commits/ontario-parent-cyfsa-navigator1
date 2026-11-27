# Agent B handoff: transactional email (payments and access)

Owner direction (2026-11-27): automated transactional communications for payment instructions, payment confirmation,
purchase receipts, access-code delivery, expiry/renewal reminders and refund confirmation, using the existing Gmail
infrastructure, with duplicate-send protection, delivery tracking, retries and privacy controls, separate from
marketing. Synthetic recipients only; no real sends until authorized.

**Status: built, off by default, not deployed, migration not applied, nothing sent.**

## Existing Gmail / email infrastructure (investigated, read-only)

| What | Where | Usable on Cloudflare? |
|---|---|---|
| Gmail Interac-notification watcher, `gmail.readonly` OAuth of `donations.ontarioparentassist@gmail.com` | `api/services/gmailAgent.ts` (Express, retired with Vercel) | No: `googleapis` Node client. Scope is read-only, so its grant cannot send. |
| nodemailer SMTP (lawyer intake, admin alerts) | `api/_server.ts`, `gmailAgent.ts` `sendAdminAlert` | No: Workers have no SMTP/TCP for nodemailer. |
| `cyfsanavigator.com` mail | DNS: MX `mx1/mx2.improvmx.com`, SPF `v=spf1 include:spf.improvmx.com ~all`, no Google DKIM | Receive-only forwarding (ImprovMX). The domain is **not** Google Workspace, so Gmail cannot send as `@cyfsanavigator.com` with passing SPF/DKIM. |

No-cost path implemented: **Gmail API `users.messages.send` over `fetch`**, authorised by an OAuth refresh token with
scope `https://www.googleapis.com/auth/gmail.send`, from a Gmail account the owner already has. Mail goes out
`From: CYFSA Navigator <that Gmail address>` (Google signs it, so it is not spoofed), with
`Reply-To` set to the owner's preferred address (for example `chris@cyfsanavigator.com`, which ImprovMX forwards).
Consumer Gmail allows about 500 recipients a day, which is far above current volume.

Not recommended: sending as `@cyfsanavigator.com` through Gmail. It needs a paid SMTP relay (ImprovMX SMTP is a paid
plan) or Google Workspace, and both are new expenditure.

## Design

- `functions/api/_mailer.ts`: `TransactionalMailer` interface and `gmailMailer` (token exchange, RFC 2822 plain text,
  RFC 2047 subject, CR/LF header-injection refusal). `TRANSACTIONAL_EMAIL_ENABLED` must be exactly `"true"`.
  `TRANSACTIONAL_EMAIL_ALLOWLIST` (`a@x.test,@example.test`) limits recipients; rows for anyone else become `skipped`.
- `functions/api/_email-templates.ts`: the six kinds, plain text, real values or "Not recorded", only links to
  `https://cyfsanavigator.com`. No marketing content. Marketing stays in its own tables (`20261005_marketing_agent.sql`)
  and never uses these kinds or this outbox; the table's `kind` CHECK rejects anything else.
- `functions/api/_email-outbox.ts`: enqueue (never throws, 3 s timeout, no-op while disabled), processing, summary.
  - **Duplicate protection:** `UNIQUE (kind, dedupe_key)`; dedupe key is the payment reference (reminders:
    `<entitlement id>:<end date>`). Enqueue is `ON CONFLICT DO NOTHING`, so a retried approval, resumed refund or
    duplicate request cannot queue a second email.
  - **At most once:** each row is claimed by compare-and-set (`status=pending&attempts=n`). A row whose outcome is
    unknown (Gmail did not answer, or a run stopped mid-send for 15 min) becomes `unknown` for an administrator to check
    in the Sent folder; it is never resent automatically.
  - **Retry:** temporary errors (5xx, 429, network before the send) back off 5, 10, 20, 40 min (cap 24 h), at most 5
    attempts, then `failed`. A revoked grant (OAuth 400/401) fails at once.
  - **Tracking:** `status`, `attempts`, `last_error` (error code only, never message text), `sent_at`,
    `provider_message_id` (Gmail id).
  - **Privacy:** the row holds only the recipient address, the payment reference and plan/amount/dates. No names, no
    document content. An access code is stored AES-256-GCM sealed (`TRANSACTIONAL_EMAIL_PAYLOAD_KEY`, bound to the row)
    and deleted when the row finishes (a CHECK enforces it). Without the key the code is not emailed and the admin
    delivers it as today. RLS on, browser roles revoked. Logs carry the kind only. The admin summary masks addresses.
    Retention: delete rows 180 days after creation (manual or a later scheduled job).
- **Hooks (enqueue only, never block or fail the payment action):**
  - `functions/api/request-access.ts`: new order → `payment_instructions` (not for a reused open order).
  - `functions/api/admin/[[path]].ts` approve → `payment_confirmation`, `purchase_receipt`, `access_code`. The
    response gains `emailsQueued`; the admin note says when the code was queued. Mandatory administrator confirmation
    of received funds is unchanged: nothing is emailed before an administrator approves with the amount received.
  - refund → `refund_confirmation`, only for a payment that was approved (money received). Response gains
    `refundEmailQueued`.
  - Not hooked: reissued codes (the admin delivers them; a second `access_code` row for the same reference is deduped).
  - Not edited: `claim-purchase.ts`, `my-payments.ts`, `_customer-payments.ts`, T-05 rate-limit files.
- **Send-time check:** before each send the processor re-reads the current state and skips (`NO_LONGER_APPLICABLE`)
  instructions for an order that is no longer pending, confirmation/receipt for one that is not approved, an access
  code that is no longer the live unused code for the order (hash match, unused, unexpired), and a renewal reminder
  whose entitlement was renewed or revoked. A failed check is retried with the same backoff, never sent blind.
- **Processing trigger:** Pages Functions have no cron, and no existing Worker has a scheduled trigger. Added
  `POST /api/admin/email-outbox/process` (admin only; refuses with `EMAIL_DISABLED` while off): queues renewal
  reminders for entitlements ending within 7 days, then sends up to 10 due rows. `GET /api/admin/email-outbox` shows
  counts and the latest 50 rows (masked). For automatic sending, a free Cloudflare Cron Trigger Worker can call the same
  `processOutbox` every 10 minutes; that is a deployment decision and is not included.

## Migration (pending approval, not applied)

`supabase/migrations_pending_approval/create_transactional_email_outbox{.sql,.down.sql,.preflight.sql,.test.sql,.test.sh}`

- Target: the Supabase project the Cloudflare app actually uses (`STAGING_SUPABASE_URL`, which has served the live
  site). Do not choose by project name; confirm with the preflight.
- Dependencies: none on other pending migrations. Hooks read `payments` and `navigator_paid_sessions` (existing).
- Existing data: new table only; no existing table, row or function is changed.
- Preflight (read-only transaction): outbox absent, `gen_random_uuid` present, `payments` / `navigator_paid_sessions`
  (with `email`) present, Supabase roles present.
- Rollback: `DROP TABLE` of the outbox only (queued/sent records are lost; no payment data touched). Before applying,
  take the normal Supabase backup per `engineering/RELEASE_CHECKLIST.md`.
- Disposable PostgreSQL test (`test.sh`): run here with PostgreSQL 14 (`PGBIN=/usr/lib/postgresql/14/bin`; 16 is not in
  this VM's apt sources), from a copy in `/tmp` because the `postgres` user cannot read the home directory. Result:
  `PASS` preflight before apply, migration + assertions (dedupe, marketing kind rejected, sealed code cannot outlive
  the send, unknown status rejected, browser roles have no access), re-run, rollback drops only the outbox (payments
  row kept), re-apply after rollback.

## What the owner must configure (only when authorizing real sends)

1. In Google Cloud (free): an OAuth client (Web or Desktop) with the Gmail API enabled; consent screen in Testing or
   Production for the sending Gmail account.
2. Grant scope `https://www.googleapis.com/auth/gmail.send` once as the sending account and keep the refresh token.
3. Cloudflare Pages project `cyfsa-navigator-git-staging` (production environment) secrets: `GMAIL_OAUTH_CLIENT_ID`,
   `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN`, `TRANSACTIONAL_EMAIL_PAYLOAD_KEY`
   (`openssl rand -base64 32`). Variables: `GMAIL_SENDER_ADDRESS`, `TRANSACTIONAL_EMAIL_REPLY_TO`.
4. Apply the migration after the preflight.
5. First run with `TRANSACTIONAL_EMAIL_ENABLED=true` and `TRANSACTIONAL_EMAIL_ALLOWLIST=@<synthetic test domain>` (or
   the owner's own address), check the six messages, then remove the allowlist when authorized.

Decision for the owner: which Gmail account sends (the existing `donations.ontarioparentassist@gmail.com` or another
Gmail address the owner controls), and the Reply-To address.

## Pre-existing admin console defect (fixed here, also in production)

`AdminConsole.tsx` `act()` showed the result message and then reloaded the section, and `load()` / `searchCustomer()`
clear the message first. So after "Approve" or "Reissue code" the one-time access code disappeared before the
administrator could read it. Present on `engineering/integration` and production `82dfe65`. Fixed by reloading first,
then showing the message (`src/components/admin/AdminConsole.tsx`, Claude-owned). The approval message now also says
when the code was queued for email, so it is not sent twice.

## Tests

- `api/cloudflare-transactional-email.test.ts` (new): templates, Gmail mailer, allowlist, sealing, enqueue dedupe and
  failure isolation, reminders, processing (send once, backoff, unknown never resent, concurrent claim, allowlist,
  disabled), masked summary, request-access hook.
- `api/cloudflare-admin-api.test.ts` (extended): approve/refund hooks, missing table, disabled, process endpoint.

- Results: `npx tsc --noEmit -p .` clean; full vitest 5178 passed, 519 skipped, 0 failed (345 files passed, 16 skipped).
