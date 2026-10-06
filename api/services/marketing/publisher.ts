// ---------------------------------------------------------------------------
// publisher.ts — publishes a single post through its platform adapter and
// records the real outcome. This is the ONLY place a post becomes 'published',
// and it only ever does so on a genuine success (a real external post id came
// back from the platform). The honesty rules:
//
//   - adapter waiting_for_credentials / waiting_for_platform_approval  ->  the
//     post is NOT marked failed. It stays scheduled (or returns to its prior
//     status) and the situation is logged as 'waiting'. A missing integration
//     must never look like a failed post or, worse, a fake published one.
//   - adapter error  ->  the post is marked 'failed' with last_error, which a
//     human can retry.
//   - adapter success  ->  'published', with external id/url, and a first
//     metrics snapshot is attempted immediately (best-effort).
//
// Concurrency: the post is claimed with transitionPost(... 'publishing'), which
// only succeeds for one caller, so an admin "publish now" and the cron can't
// double-publish the same post.
// ---------------------------------------------------------------------------

import { getAdapter } from "./adapters/registry.js";
import {
  logAgentAction,
  recordAnalyticsSnapshot,
  transitionPost,
  updatePost,
  type MarketingPost,
  type PostStatus,
} from "./store.js";

export interface PublishOutcome {
  postId: string;
  platform: string;
  result: "published" | "failed" | "waiting" | "skipped";
  detail: string;
  externalUrl?: string | null;
}

export async function publishPost(post: MarketingPost): Promise<PublishOutcome> {
  const platform = post.platform;

  // Only approved/scheduled/failed(retry) posts may be published. A human
  // approval (approved_by) is required — enforced here as a hard gate so even a
  // direct "publish now" can't bypass review.
  const publishable: PostStatus[] = ["approved", "scheduled", "failed"];
  if (!publishable.includes(post.status)) {
    return { postId: post.id, platform, result: "skipped", detail: `Post is '${post.status}', not publishable.` };
  }
  if (!post.approved_by) {
    await logAgentAction({
      action: "publish",
      status: "skipped",
      postId: post.id,
      platform,
      detail: "Refused to publish: post has not been approved by a human.",
    });
    return { postId: post.id, platform, result: "skipped", detail: "Post has not been approved by a human." };
  }

  // Claim it: move to 'publishing' only if it's still in its current status.
  const claimed = await transitionPost(post.id, post.status, "publishing");
  if (!claimed) {
    return { postId: post.id, platform, result: "skipped", detail: "Post was already being published or changed status." };
  }

  const adapter = getAdapter(platform);
  let result;
  try {
    result = await adapter.publish({
      content: post.content,
      mediaUrl: post.media_url,
      linkUrl: post.link_url,
      hashtags: post.hashtags,
    });
  } catch (e: any) {
    const detail = e?.message || String(e);
    await transitionPost(post.id, "publishing", "failed", { last_error: detail });
    await logAgentAction({ action: "publish", status: "error", postId: post.id, platform, detail });
    return { postId: post.id, platform, result: "failed", detail };
  }

  if (result.ok) {
    const published = await transitionPost(post.id, "publishing", "published", {
      external_post_id: result.externalPostId,
      external_url: result.externalUrl ?? null,
      published_at: new Date().toISOString(),
      last_error: null,
    });
    await logAgentAction({
      action: "publish",
      status: "success",
      postId: post.id,
      platform,
      detail: `Published to ${platform}.`,
      metadata: { externalPostId: result.externalPostId, externalUrl: result.externalUrl ?? null },
    });

    // Best-effort immediate first metrics snapshot — never fail the publish over it.
    try {
      if (published) await refreshMetricsFor(published);
    } catch (e) {
      console.error("[marketing] initial metrics fetch failed", e);
    }

    return { postId: post.id, platform, result: "published", detail: `Published to ${platform}.`, externalUrl: result.externalUrl ?? null };
  }

  // Non-success. Distinguish "integration not ready" from a real error.
  if (result.status === "waiting_for_credentials" || result.status === "waiting_for_platform_approval") {
    // Put it back where it was so it isn't lost, and record WHY — honestly.
    const restoreTo: PostStatus = post.status === "failed" ? "approved" : post.status;
    await transitionPost(post.id, "publishing", restoreTo, { last_error: result.error });
    await logAgentAction({
      action: "publish",
      status: "waiting",
      postId: post.id,
      platform,
      detail: result.error,
      metadata: { reason: result.status, missingEnv: (result as any).missingEnv ?? null },
    });
    return { postId: post.id, platform, result: "waiting", detail: result.error };
  }

  // A genuine error — mark failed so a human can retry.
  await transitionPost(post.id, "publishing", "failed", { last_error: result.error });
  await logAgentAction({ action: "publish", status: "error", postId: post.id, platform, detail: result.error });
  return { postId: post.id, platform, result: "failed", detail: result.error };
}

/** Fetches metrics for a published post and records a snapshot + denormalized latest. */
export async function refreshMetricsFor(post: MarketingPost): Promise<boolean> {
  if (!post.external_post_id) return false;
  const adapter = getAdapter(post.platform);
  const res = await adapter.fetchMetrics(post.external_post_id);
  if (res.ok) {
    const metrics = res.metrics || {};
    await recordAnalyticsSnapshot(post.id, post.platform, metrics, res.raw);
    await updatePost(post.id, { metrics, metrics_updated_at: new Date().toISOString() });
    return true;
  }
  await logAgentAction({
    action: "metrics",
    status: res.status === "error" ? "error" : "waiting",
    postId: post.id,
    platform: post.platform,
    detail: res.error,
  });
  return false;
}
