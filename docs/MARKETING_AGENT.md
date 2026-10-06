# Marketing Agent

An admin-only pipeline that uses Claude to **draft** social-media posts for
CYFSA Navigator, routes every draft through **human approval**, **schedules**
approved posts, and **publishes** them to social platforms through a pluggable
adapter layer — then records real engagement **analytics**. It is built to the
same standards as the rest of this backend: self-contained services, admin/cron
auth, and — above all — **honesty**. It never fabricates a connection, a
publication, or a metric.

> Status at time of writing: the full architecture, UI, database model, approval
> workflow, scheduler, analytics structure, and configuration flow are
> implemented and tested. **No social platform is connected yet** — every channel
> reports `WAITING_FOR_CREDENTIALS` until its environment variables are set, and
> (where the platform requires app review) `WAITING_FOR_PLATFORM_APPROVAL` after
> that. These states are shown truthfully in the admin console.

## Where things live

| Piece | Path |
| --- | --- |
| DB schema (migration) | `supabase/migrations/20261005_marketing_agent.sql` |
| Adapter interface & types | `api/services/marketing/types.ts` |
| Base adapter (env/honesty logic) | `api/services/marketing/adapters/base.ts` |
| Platform adapters | `api/services/marketing/adapters/{facebook,instagram,linkedin,x,tiktok}.ts` |
| Adapter registry | `api/services/marketing/adapters/registry.ts` |
| AI content agent (guardrails) | `api/services/marketing/ai.ts` |
| Supabase store + status lifecycle | `api/services/marketing/store.ts` |
| Single-post publisher | `api/services/marketing/publisher.ts` |
| Scheduler (cron run) | `api/services/marketing/scheduler.ts` |
| Admin API routes | `api/services/marketing/routes.ts` (mounted at `/api/admin/marketing`) |
| Admin console UI | `src/components/admin/MarketingAgentTab.tsx` (route `/admin/marketing`) |
| Tests | `api/services/marketing/*.test.ts` |

## The content lifecycle

```
draft ─► pending_approval ─► approved ─► scheduled ─► publishing ─► published
            │                    │                         │
            └─► rejected         └─► (publish now)          └─► failed ─► (retry)
```

Enforced in two places that must agree:
- `marketing_posts.status` has a DB **CHECK** constraint (valid values).
- `store.canTransition()` enforces valid **transitions** (e.g. you can never go
  `draft → published`).

**A human must approve before anything can be scheduled or published.**
`publisher.publishPost()` hard-refuses to publish a post with no `approved_by`,
even via "Publish now".

## Honesty rules (do not weaken these)

1. A post becomes `published` **only** when a platform API returns a real post
   id. There is no code path that marks a post published without one.
2. If a platform isn't connected, a publish attempt returns **`waiting`** — the
   post is left scheduled/approved and the reason is logged. It is **not** marked
   `failed`, and never faked as success.
3. Metrics are only ever the real numbers a platform returns. Missing numbers
   stay missing; nothing is estimated or invented.
4. The AI drafts **educational** copy only: no legal advice, no guarantees, no
   invented testimonials/statistics/case results, no fear-mongering. (See the
   system prompt in `ai.ts`; `ai.test.ts` guards it against regression.)

## Setup

### 1. Database
Apply the migration to Supabase (the project already uses Supabase via the
service-role key). Either run the SQL in
`supabase/migrations/20261005_marketing_agent.sql` in the Supabase SQL editor, or
`supabase db push` if you wire up the Supabase CLI. It creates five tables
(`marketing_channels`, `marketing_campaigns`, `marketing_posts`,
`marketing_analytics`, `marketing_agent_log`), all RLS-enabled with no policies
(service-role-only), and seeds the five channel rows.

### 2. Admin access
The console at `/admin/marketing` is gated by `ADMIN_SECRET` (the same secret
used for payment approvals). The admin enters it once; it's held in the tab's
`sessionStorage` and sent as the `x-admin-secret` header. It is **not** behind
the parent Firebase sign-in.

### 3. AI drafting
Requires `ANTHROPIC_API_KEY` (already used elsewhere in the app). With it set,
the **Generate** tab works immediately — no social credentials needed to draft,
review, and approve content.

### 4. Connecting a platform
Set the relevant environment variables (see `.env.example`) in Vercel and
redeploy. The adapter will validate them on the **Channels** tab:

| Platform | Env vars | Platform gate |
| --- | --- | --- |
| Facebook Page | `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN` | App Review for `pages_manage_posts` |
| Instagram | `INSTAGRAM_ACCOUNT_ID`, `INSTAGRAM_ACCESS_TOKEN` | App Review; media-only |
| LinkedIn | `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_ORG_URN` | Marketing Developer Platform approval |
| X (Twitter) | `X_USER_ACCESS_TOKEN` (OAuth2 user token, `tweet.write`) | May require paid API tier |
| TikTok | `TIKTOK_ACCESS_TOKEN` (`video.publish`) | App audit; video-only |

Until a platform's app is approved, the Channels tab shows
`WAITING_FOR_PLATFORM_APPROVAL` whenever a live call is rejected for
permissions — this is expected and truthful, not a bug.

> **Obtaining these tokens requires actions only the account owner can perform**
> (creating developer apps, granting OAuth consent, submitting for app review).
> Those steps are intentionally **not** automated here.

### 5. Scheduling
A Vercel Cron (in `vercel.json`) calls `/api/admin/marketing/run-scheduler`
every 5 minutes using `Authorization: Bearer <CRON_SECRET>`. It publishes any
`scheduled` post whose time has passed and refreshes metrics for published
posts. You can also run it on demand from the **Scheduled** tab.

## API reference (all under `/api/admin/marketing`, `x-admin-secret` required)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/channels` | Live connection status for all platforms |
| POST | `/channels/refresh` | Re-check + persist channel states |
| POST | `/generate` | AI-draft posts → saved as `draft` |
| GET | `/posts` | List posts (`?status=&platform=&campaignId=`) |
| POST | `/posts` | Create a manual draft |
| GET/PATCH | `/posts/:id` | Read / edit a non-published post |
| POST | `/posts/:id/submit` | `draft → pending_approval` |
| POST | `/posts/:id/approve` | `→ approved` (optional `scheduledFor` → scheduled) |
| POST | `/posts/:id/reject` | `pending_approval → rejected` |
| POST | `/posts/:id/schedule` | `approved → scheduled` |
| POST | `/posts/:id/publish` | Publish now (still requires prior approval) |
| POST | `/posts/:id/cancel` | Cancel a pre-publish post |
| GET | `/campaigns`, POST `/campaigns` | Manage campaigns |
| GET | `/analytics` | Aggregated real metrics |
| GET | `/log` | Agent activity/audit log |
| GET/POST | `/run-scheduler` | Run the scheduler (also accepts `CRON_SECRET` bearer) |

## Adding a new platform
1. Create `adapters/<platform>.ts` extending `BaseAdapter`, implementing
   `getStatus`, `doPublish`, `doFetchMetrics`.
2. Add it to `adapters/registry.ts`.
3. Add its `platform` value to the `Platform` type/`PLATFORMS` array and the two
   DB CHECK constraints.
That's it — routes, scheduler, UI, and analytics all resolve platforms through
the registry.
