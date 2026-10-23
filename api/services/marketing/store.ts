// ---------------------------------------------------------------------------
// store.ts — all Supabase access for the Marketing Agent, plus the canonical
// post-status lifecycle. Reuses the same service-role client as the rest of the
// backend (services/access.ts's getSupabase()).
//
// The status lifecycle is enforced here, in code, on top of the DB's CHECK
// constraint: the CHECK stops an invalid VALUE from being stored, but only
// canTransition() stops an invalid TRANSITION (e.g. publishing something that
// was never approved). A human approval step (approved_by) is mandatory before
// anything can be scheduled or published — that gate lives in the route layer
// and is backed by these transition rules.
// ---------------------------------------------------------------------------

import { getSupabase } from "../access.js";
import type { Platform, PostMetrics } from "./types.js";

export type PostStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "rejected"
  | "canceled";

// Allowed transitions. Anything not listed is rejected by canTransition().
const STATUS_FLOW: Record<PostStatus, PostStatus[]> = {
  draft: ["pending_approval", "canceled"],
  pending_approval: ["approved", "rejected", "draft", "canceled"],
  approved: ["scheduled", "publishing", "canceled", "draft"],
  // scheduled -> draft and failed -> draft exist so a content edit can revert approval.
  scheduled: ["publishing", "approved", "canceled", "draft"],
  // publishing -> approved is the "credentials missing, put it back" path.
  publishing: ["published", "failed", "scheduled", "approved"],
  published: [],
  // failed -> publishing lets an admin retry a failed post with "Publish now".
  failed: ["scheduled", "approved", "publishing", "canceled", "draft"],
  rejected: ["draft", "canceled"],
  canceled: [],
};

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  if (from === to) return true;
  return (STATUS_FLOW[from] || []).includes(to);
}

export interface MarketingPost {
  id: string;
  campaign_id: string | null;
  platform: Platform;
  status: PostStatus;
  content: string;
  media_url: string | null;
  link_url: string | null;
  hashtags: string[] | null;
  ai_generated: boolean;
  ai_model: string | null;
  title: string | null;
  intended_audience: string | null;
  objective: string | null;
  call_to_action: string | null;
  content_category: string | null;
  verification_notes: string | null;
  generation_context: Record<string, unknown> | null;
  scheduled_for: string | null;
  published_at: string | null;
  external_post_id: string | null;
  external_url: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  last_error: string | null;
  metrics: PostMetrics;
  metrics_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NewPost = Partial<MarketingPost> &
  Pick<MarketingPost, "platform" | "content">;

// --- Posts -----------------------------------------------------------------

export async function createPost(input: NewPost): Promise<MarketingPost> {
  const db = getSupabase();
  const row = {
    platform: input.platform,
    content: input.content,
    status: input.status ?? "draft",
    campaign_id: input.campaign_id ?? null,
    media_url: input.media_url ?? null,
    link_url: input.link_url ?? null,
    hashtags: input.hashtags ?? null,
    ai_generated: input.ai_generated ?? false,
    ai_model: input.ai_model ?? null,
    title: input.title ?? null,
    intended_audience: input.intended_audience ?? null,
    objective: input.objective ?? null,
    call_to_action: input.call_to_action ?? null,
    content_category: input.content_category ?? null,
    verification_notes: input.verification_notes ?? null,
    generation_context: input.generation_context ?? null,
    scheduled_for: input.scheduled_for ?? null,
    created_by: input.created_by ?? null,
  };
  const { data, error } = await db.from("marketing_posts").insert(row).select("*").single();
  if (error) throw Object.assign(new Error(`Failed to create post: ${error.message}`), { statusCode: 500 });
  return data as MarketingPost;
}

export async function getPost(id: string): Promise<MarketingPost | null> {
  const db = getSupabase();
  const { data, error } = await db.from("marketing_posts").select("*").eq("id", id).maybeSingle();
  if (error) throw Object.assign(new Error(`Failed to load post: ${error.message}`), { statusCode: 500 });
  return (data as MarketingPost) ?? null;
}

export interface ListPostsFilter {
  status?: PostStatus;
  platform?: Platform;
  campaignId?: string;
  limit?: number;
}

export async function listPosts(filter: ListPostsFilter = {}): Promise<MarketingPost[]> {
  const db = getSupabase();
  let query = db.from("marketing_posts").select("*").order("created_at", { ascending: false });
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.platform) query = query.eq("platform", filter.platform);
  if (filter.campaignId) query = query.eq("campaign_id", filter.campaignId);
  query = query.limit(filter.limit ?? 200);
  const { data, error } = await query;
  if (error) throw Object.assign(new Error(`Failed to list posts: ${error.message}`), { statusCode: 500 });
  return (data as MarketingPost[]) ?? [];
}

export async function updatePost(id: string, patch: Partial<MarketingPost>): Promise<MarketingPost> {
  const db = getSupabase();
  const { data, error } = await db.from("marketing_posts").update(patch).eq("id", id).select("*").single();
  if (error) throw Object.assign(new Error(`Failed to update post: ${error.message}`), { statusCode: 500 });
  return data as MarketingPost;
}

/**
 * Atomically moves a post from `expectedFrom` to `to`, but ONLY if it's still in
 * `expectedFrom`. Scoping the UPDATE to the current status (and checking whether
 * a row actually matched) is what makes concurrent publishes safe — the same
 * pattern access.ts uses to claim a payment. Returns null if the post wasn't in
 * the expected status (already claimed / changed underneath us).
 */
export async function transitionPost(
  id: string,
  expectedFrom: PostStatus,
  to: PostStatus,
  patch: Partial<MarketingPost> = {}
): Promise<MarketingPost | null> {
  if (!canTransition(expectedFrom, to)) {
    throw Object.assign(new Error(`Illegal status transition: ${expectedFrom} -> ${to}.`), { statusCode: 409 });
  }
  const db = getSupabase();
  const { data, error } = await db
    .from("marketing_posts")
    .update({ ...patch, status: to })
    .eq("id", id)
    .eq("status", expectedFrom)
    .select("*");
  if (error) throw Object.assign(new Error(`Failed to transition post: ${error.message}`), { statusCode: 500 });
  if (!data || data.length === 0) return null;
  return data[0] as MarketingPost;
}

/** Scheduled posts whose time has come (status='scheduled' AND scheduled_for <= now). */
export async function listDuePosts(now: Date = new Date(), limit = 25): Promise<MarketingPost[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("marketing_posts")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (error) throw Object.assign(new Error(`Failed to list due posts: ${error.message}`), { statusCode: 500 });
  return (data as MarketingPost[]) ?? [];
}

/** Published posts, for a metrics-refresh sweep. */
export async function listPublishedPosts(limit = 100): Promise<MarketingPost[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("marketing_posts")
    .select("*")
    .eq("status", "published")
    .not("external_post_id", "is", null)
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) throw Object.assign(new Error(`Failed to list published posts: ${error.message}`), { statusCode: 500 });
  return (data as MarketingPost[]) ?? [];
}

// --- Campaigns -------------------------------------------------------------

export interface Campaign {
  id: string;
  name: string;
  objective: string | null;
  theme: string | null;
  status: "active" | "paused" | "archived";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function createCampaign(input: Partial<Campaign> & Pick<Campaign, "name">): Promise<Campaign> {
  const db = getSupabase();
  const { data, error } = await db
    .from("marketing_campaigns")
    .insert({
      name: input.name,
      objective: input.objective ?? null,
      theme: input.theme ?? null,
      status: input.status ?? "active",
      created_by: input.created_by ?? null,
    })
    .select("*")
    .single();
  if (error) throw Object.assign(new Error(`Failed to create campaign: ${error.message}`), { statusCode: 500 });
  return data as Campaign;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const db = getSupabase();
  const { data, error } = await db.from("marketing_campaigns").select("*").order("created_at", { ascending: false });
  if (error) throw Object.assign(new Error(`Failed to list campaigns: ${error.message}`), { statusCode: 500 });
  return (data as Campaign[]) ?? [];
}

export async function updateCampaign(id: string, patch: Partial<Campaign>): Promise<Campaign | null> {
  const db = getSupabase();
  const allowed: Partial<Campaign> = {};
  if (patch.name !== undefined) allowed.name = patch.name;
  if (patch.objective !== undefined) allowed.objective = patch.objective;
  if (patch.theme !== undefined) allowed.theme = patch.theme;
  if (patch.status !== undefined) allowed.status = patch.status;
  const { data, error } = await db.from("marketing_campaigns").update(allowed).eq("id", id).select("*").maybeSingle();
  if (error) throw Object.assign(new Error(`Failed to update campaign: ${error.message}`), { statusCode: 500 });
  return (data as Campaign) ?? null;
}

/**
 * Posts left in 'publishing' longer than `olderThan` — i.e. a worker died mid-publish.
 * The scheduler moves these to 'failed' for a human to verify on the platform
 * before any retry, because the external post may already exist.
 */
export async function listStuckPublishing(olderThan: Date): Promise<MarketingPost[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("marketing_posts")
    .select("*")
    .eq("status", "publishing")
    .lte("updated_at", olderThan.toISOString())
    .limit(50);
  if (error) throw Object.assign(new Error(`Failed to list stuck posts: ${error.message}`), { statusCode: 500 });
  return (data as MarketingPost[]) ?? [];
}

/** Count of posts per status, for the admin overview. Counts only — no content. */
export async function countPostsByStatus(): Promise<Record<PostStatus, number>> {
  const db = getSupabase();
  const { data, error } = await db.from("marketing_posts").select("status").limit(10000);
  if (error) throw Object.assign(new Error(`Failed to count posts: ${error.message}`), { statusCode: 500 });
  const counts = Object.fromEntries((Object.keys(STATUS_FLOW) as PostStatus[]).map((s) => [s, 0])) as Record<PostStatus, number>;
  for (const row of (data as { status: PostStatus }[]) ?? []) {
    if (row.status in counts) counts[row.status] += 1;
  }
  return counts;
}

// --- Channels --------------------------------------------------------------

export async function upsertChannelState(state: {
  platform: Platform;
  status: string;
  accountName?: string | null;
  accountId?: string | null;
  scopes?: string[];
  credentialsPresent: boolean;
  detail?: string;
  missingEnv?: string[];
  lastError?: string | null;
}): Promise<void> {
  const db = getSupabase();
  const { error } = await db.from("marketing_channels").upsert(
    {
      platform: state.platform,
      status: state.status,
      account_name: state.accountName ?? null,
      account_id: state.accountId ?? null,
      scopes: state.scopes ?? null,
      credentials_present: state.credentialsPresent,
      detail: state.detail ?? null,
      missing_env: state.missingEnv ?? null,
      last_error: state.lastError ?? null,
      last_checked_at: new Date().toISOString(),
      connected_at: state.status === "connected" ? new Date().toISOString() : null,
    },
    { onConflict: "platform" }
  );
  if (error) throw Object.assign(new Error(`Failed to save channel state: ${error.message}`), { statusCode: 500 });
}

// --- Analytics -------------------------------------------------------------

export async function recordAnalyticsSnapshot(
  postId: string,
  platform: Platform,
  metrics: PostMetrics,
  raw?: unknown
): Promise<void> {
  const db = getSupabase();
  const { error } = await db.from("marketing_analytics").insert({
    post_id: postId,
    platform,
    impressions: metrics.impressions ?? null,
    reach: metrics.reach ?? null,
    likes: metrics.likes ?? null,
    comments: metrics.comments ?? null,
    shares: metrics.shares ?? null,
    clicks: metrics.clicks ?? null,
    raw: raw ?? null,
  });
  if (error) throw Object.assign(new Error(`Failed to record analytics: ${error.message}`), { statusCode: 500 });
}

export async function getAnalyticsSummary(): Promise<{
  totals: PostMetrics;
  perPlatform: Record<string, PostMetrics>;
  publishedCount: number;
}> {
  const posts = await listPublishedPosts(500);
  const totals: Required<PostMetrics> = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
  const perPlatform: Record<string, PostMetrics> = {};
  for (const p of posts) {
    const m = (p.metrics || {}) as PostMetrics;
    const bucket = (perPlatform[p.platform] ||= { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, clicks: 0 });
    for (const key of Object.keys(totals) as (keyof PostMetrics)[]) {
      const val = m[key];
      if (typeof val === "number") {
        totals[key] += val;
        (bucket[key] as number) = (bucket[key] ?? 0) + val;
      }
    }
  }
  return { totals, perPlatform, publishedCount: posts.length };
}

// --- Audit log -------------------------------------------------------------

export async function logAgentAction(entry: {
  action: string;
  status: "success" | "error" | "skipped" | "waiting" | "info";
  postId?: string | null;
  platform?: string | null;
  detail?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getSupabase();
    await db.from("marketing_agent_log").insert({
      action: entry.action,
      status: entry.status,
      post_id: entry.postId ?? null,
      platform: entry.platform ?? null,
      detail: entry.detail ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch (e) {
    // The audit log is best-effort — never let a logging failure break the
    // actual operation it's recording.
    console.error("[marketing] failed to write agent log", e);
  }
}

export async function listAgentLog(limit = 100): Promise<any[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("marketing_agent_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw Object.assign(new Error(`Failed to list agent log: ${error.message}`), { statusCode: 500 });
  return data ?? [];
}
