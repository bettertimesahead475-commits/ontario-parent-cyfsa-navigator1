# Hosting cost review and low-cost hosting options (2026-10-29)

Status: **proposal only.** Nothing has been migrated, no DNS was changed, nothing was deployed, and no paid service
was enabled. Release is on HOLD.

## 1. What the bills show (verified, read-only, Vercel billing API)

| UTC day (07:00 start) | Total billed | Build CPU minutes | Pro licence | Functions and CDN |
|---|---|---|---|---|
| Oct 24 | US$15.36 | US$14.67 | US$0.67 | < US$0.02 |
| Oct 25 | US$6.34 | US$5.66 | US$0.67 | < US$0.02 |
| Oct 26 | US$16.78 | US$16.10 | US$0.67 | < US$0.02 |
| Oct 27 | US$22.75 | US$22.06 | US$0.67 | < US$0.02 |
| Oct 28 | US$1.35 | US$0.67 | US$0.67 | < US$0.02 |

**Builds are about 97% of the cost.** Serverless functions, the scheduled jobs and the CDN cost cents per day at
current traffic. The owner reports a US$238 outstanding balance, and hosting is paused. The month-to-date total was
not reconstructed here: the billing API refuses windows larger than one day.

## 2. Why builds cost so much (verified)

1. **Three Vercel projects build the same repository.** `cyfsanavigator` (production), `cyfsa-owner-fix` and
   `ontario-parent-cyfsa-navigator1` each built every push. The per-day deployment counts were identical (36, 9, 20,
   30, 5 on Oct 24-28), so every build ran three times.
2. **Every branch and every commit is built**, including documentation-only commits. Automated agents push many small
   commits.
3. **All CYFSA projects use the "elastic" build machine.** Vercel picks the machine size and bills per CPU-minute. The
   build itself (`vite build` plus one esbuild bundle) is small and does not need a large machine.

### Other cost risks checked in the code

| Item | Finding | Risk |
|---|---|---|
| Crons | check-payments every 2 min (~21,600 runs/month), marketing every 5 min (~8,640), monitoring every 10 min (~4,320); #111 adds hourly purge | Low cost per run, but every run is a cold or warm invocation. check-payments currently gets 401 (no `CRON_SECRET`), so it is pure waste until configured |
| `maxDuration: 300` on the single API function | A hung request can hold provisioned memory for up to 300 s | Medium: bounded, but the Forensic Engine deliberately runs about 265 s per invocation |
| Client polling | Job poll every 3 s for at most 6 min; forensic continuation every 1 s between 202s; network retries capped (10 and 6) | Low: bounded |
| AI retries | Provider calls retry with caps; the benchmark disables SDK retries | AI cost, not hosting cost |
| Background jobs | Marketing scheduler runs every 5 min although its tables do not exist in production | Low, but unnecessary until marketing launches |

## 3. Cost controls that need no migration (recommended first)

Each item is an owner action in the Vercel dashboard, or a reviewed PR. Together they should bring hosting back to
roughly the US$20/month Pro licence plus small usage. That figure is an estimate.

1. Pay the balance. This is what unpauses hosting.
2. Disconnect Git from `cyfsa-owner-fix` and `ontario-parent-cyfsa-navigator1`, or delete them. This removes two
   thirds of all builds.
3. On `cyfsanavigator`, set the Build Machine to **Standard** (Settings → Build and Deployment).
4. Merge PR #112. Its ignored build step skips builds for other projects, unlisted branches and documentation-only
   commits; `main` always builds.
5. Set a Spend Management limit with notifications (Settings → Billing), so overages alert before they pause
   anything.
6. Reduce cron frequency until payments are configured: check-payments every 10-15 min is ample for manual approval,
   and the marketing scheduler can stay off until marketing launches. This needs a `vercel.json` change and a deploy.

Vercel Hobby (free) is not an option. Vercel limits Hobby to personal, non-commercial use, and CYFSA Navigator
charges customers.

## 4. If moving off Vercel later: options that fit the current stack

The API is a standard Express app that already runs as `node dist/server.cjs` on `PORT` (see the `start` script). The
frontend is a static Vite build. Firebase Auth and Supabase are external, so they are unaffected by where the app
runs. Prices below are approximate and from general knowledge; **check current pricing before choosing.**

| Option | Fit | Changes needed | Indicative cost at current traffic |
|---|---|---|---|
| **A. Stay on Vercel Pro with section 3's controls** | Exact; no code change | None beyond #112 and settings | ~US$20/month plus small usage |
| **B. Firebase Hosting (static) + Google Cloud Run (API container)** | Strong. The Firebase project already exists. Cloud Run scales to zero, allows long request timeouts (well over 300 s) and has a monthly free tier | A Dockerfile for `node dist/server.cjs`; Hosting rewrites `/api/**` to Cloud Run; crons via Cloud Scheduler (a few jobs free, then about US$0.10 per job per month); secrets in Secret Manager | Likely low single-digit US$/month |
| C. Static frontend on Cloudflare Pages or Firebase Hosting + API on a small always-on container (Render, Railway, Fly.io) | Good; no cold starts | Dockerfile or start command; an external scheduler for crons | Roughly US$5-10/month per small instance |
| D. Netlify or Cloudflare Workers for the API | Poor. Short synchronous function limits, and Node compatibility gaps (pdfjs, googleapis, nodemailer) would break the analyzer and the long forensic invocations | Significant rework | Not recommended |

**Recommendation.** Do A now: it is the smallest change and works immediately once the balance is paid. Evaluate B
in a staging project before any migration. It keeps Firebase in one place and removes the 300 s ceiling the Forensic
Engine works around.

A migration also needs DNS changes for `cyfsanavigator.com`. Mail runs through ImprovMX MX records, which must be kept
when DNS moves.
