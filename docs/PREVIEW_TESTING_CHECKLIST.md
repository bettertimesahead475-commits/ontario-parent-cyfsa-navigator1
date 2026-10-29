# Forensic Intelligence Engine: Preview Testing & Deployment Checklist

This document details the step-by-step verification protocol for testing the Forensic Intelligence Engine in a non-production preview environment prior to general release.

---

## 1. Owner Authorization Gates (Strictly Required)

The following actions **MUST NOT** be taken without explicit, written owner authorization:

- [ ] **Resolving Vercel Billing**: Upgrading or updating billing on Vercel project `cyfsanavigator` (`prj_wbNOXbsCWbj7vyu7JjxlXwt4WQpR`) to clear the account-level block.
- [ ] **Enabling Feature Flag**: Setting `FORENSIC_ENGINE_ENABLED=true` in Vercel project settings (preview or production).
- [ ] **Deploying or Merging PRs**: Merging PR #110 (`fix/forensic-accuracy`) or PR #111 (`feat/forensic-engine`), or triggering production deployments.
- [ ] **Database Migrations**: Applying pending Stage 6 corpus migrations (`supabase/migrations_pending_approval`) to the live production database.
- [ ] **Paid Live AI Benchmark Budget**: Incurring paid Anthropic API costs without an explicit monetary spending limit.

---

## 2. Preview Environment Pre-Flight Checklist

Once owner authorization and a preview environment are established:

### A. Environment Configuration
- [ ] Vercel account plan is verified (Pro required for >= 4 cron jobs in `vercel.json`).
- [ ] Set `FORENSIC_ENGINE_ENABLED=true` on **Preview environment only** (leave off in Production).
- [ ] Set non-production `ANTHROPIC_API_KEY` with budget alerts / billing threshold.
- [ ] Confirm `CRON_SECRET` and `ADMIN_SECRET` are set.
- [ ] Verify private Supabase storage bucket `forensic_engine_jobs` is created as `{ public: false }` and inaccessible via public URL.

### B. Functional End-to-End Walkthrough
1. **Document Upload**:
   - [ ] Upload a primary court filing (e.g. 2-page and 9-page PDF).
   - [ ] Confirm the multi-document picker appears in Forensic In-Depth mode when `FORENSIC_ENGINE_ENABLED=true`.
   - [ ] Select up to 2 additional documents from case files whose text has been previously extracted.
2. **Analysis Execution & Progress UI**:
   - [ ] Initiate Forensic In-Depth analysis.
   - [ ] Confirm credit reservation is recorded in `free_usage` / credit table.
   - [ ] Observe stage progress indicator (e.g. "Indexing people, dates...", "Reviewing evidence...").
   - [ ] Verify HTTP 202 `ANALYSIS_CONTINUING` / SSE `continue` event is returned when the invocation approaches the deadline.
3. **Resumption & Crash Recovery**:
   - [ ] Close the browser tab mid-analysis during step 2 or 3.
   - [ ] Reopen the application and navigate to Document Analyzer.
   - [ ] Confirm the job is detected as `resumable` and continues from the latest checkpoint without re-running completed steps.
   - [ ] Confirm no double credit charge occurs upon resumption.
4. **Report Rendering & PDF Export**:
   - [ ] Verify completed report renders both the legacy summary cards and the full Forensic Engine Record.
   - [ ] Confirm the Adversarial Review status badge is displayed.
   - [ ] Trigger PDF export and verify print layout includes evidence classifications and citations without raw tokens or model pricing leaks.
   - [ ] Toggle redaction mode and verify personal identifying details are shielded while retaining status and findings count.
5. **Retention & Purge Route**:
   - [ ] Invoke `GET /api/admin/forensic-engine/purge` with `Authorization: Bearer $CRON_SECRET`.
   - [ ] Verify only jobs older than 24 hours are removed.
   - [ ] Verify active / recent in-flight jobs are preserved.

---

## 3. Deployment Configuration Audit Findings

- **Vercel Rewrites & Routes**: Fully verified. API routes map to `/api/index.ts` with 300s execution budget.
- **Node.js ESM Compatibility**: Bundled cleanly via esbuild for server (`dist/server.cjs`) and Vite for client.
- **Cron Jobs**: 4 scheduled tasks configured in `vercel.json`. Requires Vercel Pro subscription; will fail on Hobby plan.
- **Storage Atomicity**: Supabase Storage upload with `upsert: false` creates objects atomically with HTTP 409 conflict detection.
- **Cross-Account Security**: Jobs strictly bound to Firebase `uid` and verified paid sessions.
