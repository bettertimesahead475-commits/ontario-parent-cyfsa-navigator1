// ---------------------------------------------------------------------------
// routes.ts — the Marketing Agent's Express router, mounted at
// /api/admin/marketing in api/_server.ts.
//
// Auth model (same primitives as the rest of the admin surface):
//   - Every route requires the x-admin-secret header === ADMIN_SECRET.
//   - /run-scheduler ALSO accepts a Vercel Cron call
//     (Authorization: Bearer <CRON_SECRET>), exactly like /api/admin/check-payments.
//
// The approval workflow is enforced through store.ts transitions: a post must
// be approved by a human (approved_by set) before it can be scheduled or
// published. Routes never fabricate a result — a publish that can't happen
// because an integration isn't ready comes back as 'waiting', not success.
// ---------------------------------------------------------------------------

import express, { type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { isPlatform, PLATFORMS, type Platform } from "./types.js";
import { generateMarketingPosts } from "./ai.js";
import { buildUtmUrl, slugifyCampaign } from "./utm.js";
import { getAllAdapters } from "./adapters/registry.js";
import { runScheduler, refreshAllChannelStates } from "./scheduler.js";
import { publishPost } from "./publisher.js";
import {
  canTransition,
  countPostsByStatus,
  createCampaign,
  createPost,
  getAnalyticsSummary,
  getPost,
  listAgentLog,
  listCampaigns,
  listPosts,
  logAgentAction,
  transitionPost,
  updateCampaign,
  updatePost,
  upsertChannelState,
  type MarketingPost,
  type PostStatus,
} from "./store.js";

export const marketingRouter = express.Router();

// --- Auth -------------------------------------------------------------------

// Constant-time comparison so the secret cannot be guessed byte-by-byte by timing.
export function secretMatches(provided: unknown, expected: string | undefined): boolean {
  if (typeof provided !== "string" || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function adminOk(req: Request): boolean {
  return secretMatches(req.headers["x-admin-secret"], process.env.ADMIN_SECRET);
}
function cronOk(req: Request): boolean {
  return secretMatches(req.headers["authorization"], process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : undefined);
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!adminOk(req)) return res.status(401).json({ error: "Unauthorized." });
  next();
}

// Identify who performed an action, for the audit trail. There's no per-admin
// identity in this app, so default to "admin" but allow an explicit actor label.
function actor(req: Request): string {
  const a = req.body?.actor;
  return typeof a === "string" && a.trim() ? a.trim().slice(0, 120) : "admin";
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function handleError(err: any, res: Response, context: string) {
  console.error(`[marketing] ${context}`, err);
  res.status(err?.statusCode || 500).json({ error: err?.message || `Failed: ${context}` });
}

// --- Channels ---------------------------------------------------------------

marketingRouter.get("/channels", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const adapters = getAllAdapters();
    const states = await Promise.all(adapters.map((a) => a.getStatus()));
    // Persist what we observed so the DB mirrors reality (best-effort).
    await Promise.all(
      states.map((s) =>
        upsertChannelState({
          platform: s.platform,
          status: s.status,
          accountName: s.accountName,
          accountId: s.accountId,
          scopes: s.scopes,
          credentialsPresent: s.credentialsPresent,
          detail: s.detail,
          missingEnv: s.missingEnv,
          lastError: s.lastError ?? null,
        }).catch((e) => console.error("[marketing] channel persist failed", e))
      )
    );
    res.json({ channels: states });
  } catch (err) {
    handleError(err, res, "load channels");
  }
});

marketingRouter.post("/channels/refresh", requireAdmin, async (_req: Request, res: Response) => {
  try {
    await refreshAllChannelStates();
    const states = await Promise.all(getAllAdapters().map((a) => a.getStatus()));
    res.json({ channels: states });
  } catch (err) {
    handleError(err, res, "refresh channels");
  }
});

// --- Content generation (AI drafts) -----------------------------------------

marketingRouter.post("/generate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { platforms, topic, objective, callToAction, linkUrl, variantsPerPlatform, campaignId, model } = req.body || {};
    const requested: Platform[] = Array.isArray(platforms) ? platforms.filter(isPlatform) : [];
    if (!requested.length) return res.status(400).json({ error: `platforms must include at least one of: ${PLATFORMS.join(", ")}.` });
    if (!topic || typeof topic !== "string") return res.status(400).json({ error: "topic is required." });
    if (topic.length > 2000) return res.status(400).json({ error: "topic must be 2000 characters or fewer." });
    if (linkUrl !== undefined && linkUrl !== null && linkUrl !== "" && !isHttpUrl(linkUrl)) {
      return res.status(400).json({ error: "linkUrl must be an http(s) URL." });
    }

    const { drafts, model: usedModel } = await generateMarketingPosts({
      platforms: requested,
      topic,
      objective,
      callToAction,
      linkUrl,
      variantsPerPlatform,
      model,
    });

    // UTM campaign slug is shared across this batch; utm_source is per-platform
    // so each platform's traffic is attributed separately in web analytics.
    const campaignSlug = slugifyCampaign(objective || topic);
    const created: MarketingPost[] = [];
    for (const d of drafts) {
      const taggedLink = linkUrl
        ? buildUtmUrl(linkUrl, { source: d.platform, medium: "social", campaign: campaignSlug })
        : null;
      const post = await createPost({
        platform: d.platform,
        content: d.content,
        hashtags: d.hashtags,
        link_url: taggedLink,
        campaign_id: campaignId || null,
        ai_generated: true,
        ai_model: usedModel,
        title: d.title,
        intended_audience: d.intendedAudience,
        objective: objective || null,
        call_to_action: callToAction || null,
        content_category: d.category,
        verification_notes: d.verificationNotes,
        generation_context: { topic, objective, callToAction, campaignSlug },
        created_by: actor(req),
        status: "draft",
      });
      created.push(post);
    }
    // Drafts carry a verification checklist: the model's claims are never treated as verified.

    await logAgentAction({
      action: "generate",
      status: "success",
      detail: `Generated ${created.length} draft(s) across ${requested.length} platform(s).`,
      metadata: { topic, platforms: requested, model: usedModel },
    });

    res.json({ created, model: usedModel });
  } catch (err) {
    handleError(err, res, "generate content");
  }
});

// --- Posts: list / create / read / edit -------------------------------------

marketingRouter.get("/posts", requireAdmin, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as PostStatus | undefined;
    const platform = req.query.platform as Platform | undefined;
    const campaignId = req.query.campaignId as string | undefined;
    const posts = await listPosts({
      status: status || undefined,
      platform: platform && isPlatform(platform) ? platform : undefined,
      campaignId: campaignId || undefined,
    });
    res.json({ posts });
  } catch (err) {
    handleError(err, res, "list posts");
  }
});

marketingRouter.post("/posts", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { platform, content, hashtags, mediaUrl, linkUrl, campaignId } = req.body || {};
    if (!isPlatform(platform)) return res.status(400).json({ error: `platform must be one of: ${PLATFORMS.join(", ")}.` });
    if (!content || typeof content !== "string") return res.status(400).json({ error: "content is required." });
    const post = await createPost({
      platform,
      content,
      hashtags: Array.isArray(hashtags) ? hashtags : null,
      media_url: mediaUrl || null,
      link_url: linkUrl || null,
      campaign_id: campaignId || null,
      created_by: actor(req),
      status: "draft",
    });
    res.json({ post });
  } catch (err) {
    handleError(err, res, "create post");
  }
});

marketingRouter.get("/posts/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const post = await getPost(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found." });
    res.json({ post });
  } catch (err) {
    handleError(err, res, "get post");
  }
});

marketingRouter.patch("/posts/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const post = await getPost(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found." });
    if (post.status === "published" || post.status === "publishing") {
      return res.status(409).json({ error: `A ${post.status} post cannot be edited.` });
    }
    if (post.status === "canceled") return res.status(409).json({ error: "A canceled post cannot be edited." });
    const { content, hashtags, mediaUrl, linkUrl, campaignId, scheduledFor, title, intendedAudience, verificationNotes } = req.body || {};
    if (typeof content === "string" && content.length > 10000) return res.status(400).json({ error: "content must be 10000 characters or fewer." });
    if (linkUrl && !isHttpUrl(linkUrl)) return res.status(400).json({ error: "linkUrl must be an http(s) URL." });
    if (scheduledFor && isNaN(new Date(scheduledFor).getTime())) return res.status(400).json({ error: "scheduledFor is not a valid timestamp." });

    const patch: Partial<MarketingPost> = {};
    if (typeof content === "string") patch.content = content;
    if (Array.isArray(hashtags)) patch.hashtags = hashtags.map(String).slice(0, 10);
    if (mediaUrl !== undefined) patch.media_url = mediaUrl || null;
    if (linkUrl !== undefined) patch.link_url = linkUrl || null;
    if (campaignId !== undefined) patch.campaign_id = campaignId || null;
    if (scheduledFor !== undefined) patch.scheduled_for = scheduledFor || null;
    if (typeof title === "string") patch.title = title.slice(0, 200);
    if (typeof intendedAudience === "string") patch.intended_audience = intendedAudience.slice(0, 300);
    if (typeof verificationNotes === "string") patch.verification_notes = verificationNotes.slice(0, 2000);

    const contentChanged = ["content", "hashtags", "media_url", "link_url"].some((k) => k in patch);
    if (contentChanged && post.status !== "draft") {
      // Approval covered the previous text. Revert to draft and clear approval/schedule.
      if (!canTransition(post.status, "draft")) {
        return res.status(409).json({ error: `Cannot edit a '${post.status}' post.` });
      }
      const reverted = await transitionPost(post.id, post.status, "draft", {
        ...patch,
        approved_by: null,
        approved_at: null,
        scheduled_for: null,
        rejection_reason: null,
      });
      if (!reverted) return res.status(409).json({ error: "Post changed status concurrently; try again." });
      await logAgentAction({ action: "edit", status: "info", postId: post.id, platform: post.platform, detail: `Content changed; approval reset (was '${post.status}').` });
      return res.json({ post: reverted, approvalReset: true });
    }

    const updated = await updatePost(req.params.id, patch);
    res.json({ post: updated, approvalReset: false });
  } catch (err) {
    handleError(err, res, "edit post");
  }
});

// --- Approval workflow ------------------------------------------------------

async function doTransition(
  req: Request,
  res: Response,
  to: PostStatus,
  context: string,
  extraPatch: (post: MarketingPost) => Partial<MarketingPost> = () => ({})
) {
  const post = await getPost(req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found." });
  if (!canTransition(post.status, to)) {
    return res.status(409).json({ error: `Cannot move a '${post.status}' post to '${to}'.` });
  }
  const updated = await transitionPost(post.id, post.status, to, extraPatch(post));
  if (!updated) return res.status(409).json({ error: "Post changed status concurrently; try again." });
  await logAgentAction({ action: context, status: "success", postId: post.id, platform: post.platform, detail: `-> ${to}` });
  res.json({ post: updated });
}

marketingRouter.post("/posts/:id/submit", requireAdmin, async (req, res) => {
  try {
    await doTransition(req, res, "pending_approval", "submit");
  } catch (err) {
    handleError(err, res, "submit post");
  }
});

marketingRouter.post("/posts/:id/approve", requireAdmin, async (req, res) => {
  try {
    const scheduledFor = req.body?.scheduledFor;
    // Approve, and if a schedule time is supplied, go straight to scheduled.
    const post = await getPost(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found." });
    if (!canTransition(post.status, "approved")) {
      return res.status(409).json({ error: `Cannot approve a '${post.status}' post.` });
    }
    const approved = await transitionPost(post.id, post.status, "approved", {
      approved_by: actor(req),
      approved_at: new Date().toISOString(),
      rejection_reason: null,
    });
    if (!approved) return res.status(409).json({ error: "Post changed status concurrently; try again." });
    await logAgentAction({ action: "approve", status: "success", postId: post.id, platform: post.platform, detail: "approved" });

    if (scheduledFor) {
      const scheduled = await transitionPost(approved.id, "approved", "scheduled", { scheduled_for: new Date(scheduledFor).toISOString() });
      if (scheduled) {
        await logAgentAction({ action: "schedule", status: "success", postId: post.id, platform: post.platform, detail: scheduledFor });
        return res.json({ post: scheduled });
      }
    }
    res.json({ post: approved });
  } catch (err) {
    handleError(err, res, "approve post");
  }
});

marketingRouter.post("/posts/:id/reject", requireAdmin, async (req, res) => {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 1000) : "Rejected by admin.";
    await doTransition(req, res, "rejected", "reject", () => ({ rejection_reason: reason }));
  } catch (err) {
    handleError(err, res, "reject post");
  }
});

marketingRouter.post("/posts/:id/schedule", requireAdmin, async (req, res) => {
  try {
    const scheduledFor = req.body?.scheduledFor;
    if (!scheduledFor) return res.status(400).json({ error: "scheduledFor (ISO timestamp) is required." });
    const when = new Date(scheduledFor);
    if (isNaN(when.getTime())) return res.status(400).json({ error: "scheduledFor is not a valid timestamp." });
    await doTransition(req, res, "scheduled", "schedule", () => ({ scheduled_for: when.toISOString() }));
  } catch (err) {
    handleError(err, res, "schedule post");
  }
});

// Rejected posts return to draft so they can be edited and resubmitted.
marketingRouter.post("/posts/:id/draft", requireAdmin, async (req, res) => {
  try {
    await doTransition(req, res, "draft", "return-to-draft", () => ({ rejection_reason: null }));
  } catch (err) {
    handleError(err, res, "return post to draft");
  }
});

// Removes a scheduled post from the queue without discarding its approval.
marketingRouter.post("/posts/:id/unschedule", requireAdmin, async (req, res) => {
  try {
    await doTransition(req, res, "approved", "unschedule", () => ({ scheduled_for: null }));
  } catch (err) {
    handleError(err, res, "unschedule post");
  }
});

marketingRouter.post("/posts/:id/cancel", requireAdmin, async (req, res) => {
  try {
    await doTransition(req, res, "canceled", "cancel");
  } catch (err) {
    handleError(err, res, "cancel post");
  }
});

// Publish immediately (still requires prior human approval on the post).
marketingRouter.post("/posts/:id/publish", requireAdmin, async (req: Request, res: Response) => {
  try {
    const post = await getPost(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found." });
    const outcome = await publishPost(post);
    const refreshed = await getPost(req.params.id);
    const httpStatus = outcome.result === "failed" ? 502 : 200;
    res.status(httpStatus).json({ outcome, post: refreshed });
  } catch (err) {
    handleError(err, res, "publish post");
  }
});

// --- Campaigns --------------------------------------------------------------

marketingRouter.get("/campaigns", requireAdmin, async (_req, res) => {
  try {
    res.json({ campaigns: await listCampaigns() });
  } catch (err) {
    handleError(err, res, "list campaigns");
  }
});

marketingRouter.post("/campaigns", requireAdmin, async (req, res) => {
  try {
    const { name, objective, theme } = req.body || {};
    if (!name || typeof name !== "string") return res.status(400).json({ error: "name is required." });
    const campaign = await createCampaign({ name, objective, theme, created_by: actor(req) });
    res.json({ campaign });
  } catch (err) {
    handleError(err, res, "create campaign");
  }
});

marketingRouter.patch("/campaigns/:id", requireAdmin, async (req, res) => {
  try {
    const { name, objective, theme, status } = req.body || {};
    if (name !== undefined && (typeof name !== "string" || !name.trim())) return res.status(400).json({ error: "name must be a non-empty string." });
    if (status !== undefined && !["active", "paused", "archived"].includes(status)) {
      return res.status(400).json({ error: "status must be one of: active, paused, archived." });
    }
    const campaign = await updateCampaign(req.params.id, {
      name: typeof name === "string" ? name.trim().slice(0, 200) : undefined,
      objective: typeof objective === "string" ? objective.slice(0, 1000) : undefined,
      theme: typeof theme === "string" ? theme.slice(0, 200) : undefined,
      status,
    });
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    await logAgentAction({ action: "campaign.update", status: "info", detail: `Campaign '${campaign.name}' -> ${campaign.status}.` });
    res.json({ campaign });
  } catch (err) {
    handleError(err, res, "update campaign");
  }
});

// --- Overview ---------------------------------------------------------------
// Real counts only. Anything the agent cannot measure is listed under
// `unavailable` with a reason, never shown as zero.

marketingRouter.get("/overview", requireAdmin, async (_req, res) => {
  try {
    const [counts, failed, campaigns, channels, analytics] = await Promise.all([
      countPostsByStatus(),
      listPosts({ status: "failed", limit: 20 }),
      listCampaigns(),
      Promise.all(getAllAdapters().map((a) => a.getStatus())),
      getAnalyticsSummary(),
    ]);
    res.json({
      counts,
      pendingApproval: counts.pending_approval,
      failedJobs: failed.map((p) => ({ id: p.id, platform: p.platform, last_error: p.last_error, updated_at: p.updated_at })),
      campaigns: {
        active: campaigns.filter((c) => c.status === "active").length,
        paused: campaigns.filter((c) => c.status === "paused").length,
        archived: campaigns.filter((c) => c.status === "archived").length,
      },
      channels: channels.map((c) => ({ platform: c.platform, status: c.status })),
      engagement: analytics,
      unavailable: [
        { metric: "Website traffic, unique visitors, landing-page engagement", reason: "No analytics source is connected to the Marketing Agent yet." },
        { metric: "Signups and analyzer-start conversion", reason: "Not read from the product database by this dashboard yet." },
        { metric: "Referral sources and free-to-paid conversion", reason: "No attribution source is connected yet." },
        { metric: "Email engagement and qualified partnership leads", reason: "Not connected to the Marketing Agent yet." },
      ],
    });
  } catch (err) {
    handleError(err, res, "load overview");
  }
});

// --- Analytics & audit log --------------------------------------------------

marketingRouter.get("/analytics", requireAdmin, async (_req, res) => {
  try {
    res.json(await getAnalyticsSummary());
  } catch (err) {
    handleError(err, res, "load analytics");
  }
});

marketingRouter.get("/log", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json({ log: await listAgentLog(limit) });
  } catch (err) {
    handleError(err, res, "load agent log");
  }
});

// --- Scheduler run (admin OR Vercel Cron) -----------------------------------

async function handleRunScheduler(req: Request, res: Response) {
  if (!adminOk(req) && !cronOk(req)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  try {
    const result = await runScheduler({ refreshMetrics: req.query.metrics !== "false" });
    res.json(result);
  } catch (err) {
    handleError(err, res, "run scheduler");
  }
}

// GET so a Vercel Cron (which issues GET) can trigger it; POST for manual admin use.
marketingRouter.get("/run-scheduler", handleRunScheduler);
marketingRouter.post("/run-scheduler", handleRunScheduler);
