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
import { isPlatform, PLATFORMS, type Platform } from "./types.js";
import { generateMarketingPosts } from "./ai.js";
import { getAllAdapters } from "./adapters/registry.js";
import { runScheduler, refreshAllChannelStates } from "./scheduler.js";
import { publishPost } from "./publisher.js";
import {
  canTransition,
  createCampaign,
  createPost,
  getAnalyticsSummary,
  getPost,
  listAgentLog,
  listCampaigns,
  listPosts,
  logAgentAction,
  transitionPost,
  updatePost,
  upsertChannelState,
  type MarketingPost,
  type PostStatus,
} from "./store.js";

export const marketingRouter = express.Router();

// --- Auth -------------------------------------------------------------------

function adminOk(req: Request): boolean {
  return Boolean(process.env.ADMIN_SECRET) && req.headers["x-admin-secret"] === process.env.ADMIN_SECRET;
}
function cronOk(req: Request): boolean {
  return Boolean(process.env.CRON_SECRET) && req.headers["authorization"] === `Bearer ${process.env.CRON_SECRET}`;
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

    const { drafts, model: usedModel } = await generateMarketingPosts({
      platforms: requested,
      topic,
      objective,
      callToAction,
      linkUrl,
      variantsPerPlatform,
      model,
    });

    const created: MarketingPost[] = [];
    for (const d of drafts) {
      const post = await createPost({
        platform: d.platform,
        content: d.content,
        hashtags: d.hashtags,
        link_url: linkUrl || null,
        campaign_id: campaignId || null,
        ai_generated: true,
        ai_model: usedModel,
        generation_context: { topic, objective, callToAction },
        created_by: actor(req),
        status: "draft",
      });
      created.push(post);
    }

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
    const { content, hashtags, mediaUrl, linkUrl, campaignId, scheduledFor } = req.body || {};
    const patch: Partial<MarketingPost> = {};
    if (typeof content === "string") patch.content = content;
    if (Array.isArray(hashtags)) patch.hashtags = hashtags;
    if (mediaUrl !== undefined) patch.media_url = mediaUrl || null;
    if (linkUrl !== undefined) patch.link_url = linkUrl || null;
    if (campaignId !== undefined) patch.campaign_id = campaignId || null;
    if (scheduledFor !== undefined) patch.scheduled_for = scheduledFor || null;
    const updated = await updatePost(req.params.id, patch);
    res.json({ post: updated });
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
