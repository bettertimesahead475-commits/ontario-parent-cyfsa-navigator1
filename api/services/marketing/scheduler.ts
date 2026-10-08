// ---------------------------------------------------------------------------
// scheduler.ts — the agent's periodic run, invoked by a Vercel Cron (and
// runnable on demand by an admin). It does two jobs, both honest and idempotent:
//
//   1. Publish due posts: every post with status='scheduled' and scheduled_for
//      in the past is pushed through publishPost(). A post whose platform isn't
//      connected yet is left alone and logged as 'waiting' (not failed, not
//      faked) — so the moment credentials land, the next run publishes it.
//   2. Refresh metrics: for recently published posts, pull fresh engagement
//      numbers. Only real numbers from the platform are stored.
//
// Mirrors the gmailAgent.scanForPayments() shape: returns a structured result
// the caller (cron/admin route) can inspect, and never throws for an individual
// post's failure — it records it and moves on.
// ---------------------------------------------------------------------------

import { publishPost, refreshMetricsFor } from "./publisher.js";
import { getAllAdapters } from "./adapters/registry.js";
import {
  listDuePosts,
  listPublishedPosts,
  logAgentAction,
  upsertChannelState,
} from "./store.js";

export interface SchedulerResult {
  ranAt: string;
  due: number;
  published: { postId: string; platform: string; externalUrl?: string | null }[];
  waiting: { postId: string; platform: string; detail: string }[];
  failed: { postId: string; platform: string; detail: string }[];
  skipped: { postId: string; platform: string; detail: string }[];
  metricsRefreshed: number;
}

export async function runScheduler(opts: { refreshMetrics?: boolean } = {}): Promise<SchedulerResult> {
  const result: SchedulerResult = {
    ranAt: new Date().toISOString(),
    due: 0,
    published: [],
    waiting: [],
    failed: [],
    skipped: [],
    metricsRefreshed: 0,
  };

  // --- 1. Publish due posts ---
  const due = await listDuePosts(new Date());
  result.due = due.length;

  for (const post of due) {
    try {
      const outcome = await publishPost(post);
      switch (outcome.result) {
        case "published":
          result.published.push({ postId: post.id, platform: post.platform, externalUrl: outcome.externalUrl });
          break;
        case "waiting":
          result.waiting.push({ postId: post.id, platform: post.platform, detail: outcome.detail });
          break;
        case "failed":
          result.failed.push({ postId: post.id, platform: post.platform, detail: outcome.detail });
          break;
        default:
          result.skipped.push({ postId: post.id, platform: post.platform, detail: outcome.detail });
      }
    } catch (e: any) {
      const detail = e?.message || String(e);
      result.failed.push({ postId: post.id, platform: post.platform, detail });
      await logAgentAction({ action: "scheduler.publish", status: "error", postId: post.id, platform: post.platform, detail });
    }
  }

  // --- 2. Refresh metrics for published posts (opt-in; default on) ---
  if (opts.refreshMetrics !== false) {
    const published = await listPublishedPosts(50);
    for (const post of published) {
      try {
        const ok = await refreshMetricsFor(post);
        if (ok) result.metricsRefreshed++;
      } catch (e) {
        console.error("[marketing scheduler] metrics refresh failed for", post.id, e);
      }
    }
  }

  await logAgentAction({
    action: "scheduler.run",
    status: result.failed.length ? "error" : result.waiting.length ? "waiting" : "success",
    detail: `Due ${result.due}, published ${result.published.length}, waiting ${result.waiting.length}, failed ${result.failed.length}, metrics ${result.metricsRefreshed}.`,
    metadata: { ...result },
  });

  return result;
}

/**
 * Re-checks every platform's live connection status and persists it to
 * marketing_channels. Called by the channels route and (lightly) by the
 * scheduler so the admin UI's status reflects reality.
 */
export async function refreshAllChannelStates(): Promise<void> {
  const adapters = getAllAdapters();
  await Promise.all(
    adapters.map(async (adapter) => {
      try {
        const state = await adapter.getStatus();
        await upsertChannelState({
          platform: state.platform,
          status: state.status,
          accountName: state.accountName,
          accountId: state.accountId,
          scopes: state.scopes,
          credentialsPresent: state.credentialsPresent,
          detail: state.detail,
          missingEnv: state.missingEnv,
          lastError: state.lastError ?? null,
        });
      } catch (e: any) {
        // A status check should never throw up the stack; record an error state.
        await upsertChannelState({
          platform: adapter.platform,
          status: "error",
          credentialsPresent: false,
          detail: "Status check threw unexpectedly.",
          lastError: e?.message || String(e),
        });
      }
    })
  );
}
