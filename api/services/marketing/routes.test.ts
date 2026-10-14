// HTTP-layer end-to-end tests for the Marketing Agent router, run against the
// real Express route handlers with supertest. The Supabase-backed store, the
// Claude content agent, the publisher, and the scheduler are mocked — but
// canTransition() is kept REAL (via importOriginal), so these tests genuinely
// exercise the auth gating, request validation, UTM tagging, and — most
// importantly — the human-approval gate that stops a post being scheduled or
// published before it has been approved.
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";

process.env.ADMIN_SECRET = "test-admin-secret";
process.env.CRON_SECRET = "test-cron-secret";
// Ensure no social creds leak in from the real environment.
for (const k of ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN", "INSTAGRAM_ACCOUNT_ID", "INSTAGRAM_ACCESS_TOKEN", "LINKEDIN_ACCESS_TOKEN", "LINKEDIN_ORG_URN", "X_USER_ACCESS_TOKEN", "TIKTOK_ACCESS_TOKEN"]) {
  delete process.env[k];
}

vi.mock("./ai.js", () => ({ generateMarketingPosts: vi.fn() }));
vi.mock("./scheduler.js", () => ({ runScheduler: vi.fn(), refreshAllChannelStates: vi.fn() }));
vi.mock("./publisher.js", () => ({ publishPost: vi.fn(), refreshMetricsFor: vi.fn() }));

// Keep canTransition REAL; replace only the DB-touching functions.
vi.mock("./store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store.js")>();
  return {
    ...actual,
    getPost: vi.fn(),
    countPostsByStatus: vi.fn(),
    updateCampaign: vi.fn(),
    createPost: vi.fn(),
    listPosts: vi.fn(),
    transitionPost: vi.fn(),
    updatePost: vi.fn(),
    createCampaign: vi.fn(),
    listCampaigns: vi.fn(),
    getAnalyticsSummary: vi.fn(),
    listAgentLog: vi.fn(),
    logAgentAction: vi.fn(),
    upsertChannelState: vi.fn(),
  };
});

const { marketingRouter } = await import("./routes.js");
const store = await import("./store.js");
const ai = await import("./ai.js");
const publisher = await import("./publisher.js");
const scheduler = await import("./scheduler.js");

const SECRET = { "x-admin-secret": "test-admin-secret" };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/marketing", marketingRouter);
  return app;
}
const app = makeApp();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.logAgentAction).mockResolvedValue(undefined);
  vi.mocked(store.upsertChannelState).mockResolvedValue(undefined);
});

describe("auth gating", () => {
  it("rejects requests with no admin secret", async () => {
    const res = await request(app).get("/api/admin/marketing/channels");
    expect(res.status).toBe(401);
  });
  it("rejects a wrong admin secret", async () => {
    const res = await request(app).get("/api/admin/marketing/channels").set("x-admin-secret", "nope");
    expect(res.status).toBe(401);
  });
});

describe("channels — honest status with no credentials", () => {
  it("returns all five platforms as waiting_for_credentials", async () => {
    const res = await request(app).get("/api/admin/marketing/channels").set(SECRET);
    expect(res.status).toBe(200);
    expect(res.body.channels).toHaveLength(5);
    for (const c of res.body.channels) {
      expect(c.status).toBe("waiting_for_credentials");
      expect(c.credentialsPresent).toBe(false);
    }
  });
});

describe("generate — validation + UTM tagging", () => {
  it("400s when no valid platform is given", async () => {
    const res = await request(app).post("/api/admin/marketing/generate").set(SECRET).send({ topic: "x" });
    expect(res.status).toBe(400);
    expect(ai.generateMarketingPosts).not.toHaveBeenCalled();
  });

  it("creates drafts with per-platform UTM-tagged links", async () => {
    vi.mocked(ai.generateMarketingPosts).mockResolvedValue({
      drafts: [{ platform: "facebook", content: "Learn about the free guide", hashtags: ["CYFSA"], title: null, intendedAudience: null, category: null, verificationNotes: "AI-drafted." }],
      model: "claude-sonnet-5",
    });
    vi.mocked(store.createPost).mockImplementation(async (p: any) => ({ id: "p1", ...p }));

    const res = await request(app)
      .post("/api/admin/marketing/generate")
      .set(SECRET)
      .send({ topic: "free guide", objective: "Fall Awareness", platforms: ["facebook"], linkUrl: "https://cyfsanavigator.com/guide" });

    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(1);
    const createArg = vi.mocked(store.createPost).mock.calls[0][0];
    expect(createArg.link_url).toContain("utm_source=facebook");
    expect(createArg.link_url).toContain("utm_medium=social");
    expect(createArg.link_url).toContain("utm_campaign=fall-awareness");
  });
});

describe("manual post creation validation", () => {
  it("400s on an invalid platform", async () => {
    const res = await request(app).post("/api/admin/marketing/posts").set(SECRET).send({ platform: "myspace", content: "hi" });
    expect(res.status).toBe(400);
  });
  it("400s on empty content", async () => {
    const res = await request(app).post("/api/admin/marketing/posts").set(SECRET).send({ platform: "facebook" });
    expect(res.status).toBe(400);
  });
});

describe("the human-approval gate", () => {
  it("refuses to SCHEDULE a draft that was never approved (409)", async () => {
    vi.mocked(store.getPost).mockResolvedValue({ id: "p1", status: "draft", platform: "facebook" } as any);
    const res = await request(app)
      .post("/api/admin/marketing/posts/p1/schedule")
      .set(SECRET)
      .send({ scheduledFor: new Date(Date.now() + 3600_000).toISOString() });
    expect(res.status).toBe(409);
    expect(store.transitionPost).not.toHaveBeenCalled();
  });

  it("allows approving a pending_approval post", async () => {
    vi.mocked(store.getPost).mockResolvedValue({ id: "p1", status: "pending_approval", platform: "facebook" } as any);
    vi.mocked(store.transitionPost).mockResolvedValue({ id: "p1", status: "approved", platform: "facebook", approved_by: "admin" } as any);
    const res = await request(app).post("/api/admin/marketing/posts/p1/approve").set(SECRET).send({});
    expect(res.status).toBe(200);
    expect(res.body.post.status).toBe("approved");
    expect(store.transitionPost).toHaveBeenCalledWith("p1", "pending_approval", "approved", expect.objectContaining({ approved_by: expect.any(String) }));
  });

  it("publish-now delegates to the publisher and reports a waiting outcome honestly", async () => {
    vi.mocked(store.getPost)
      .mockResolvedValueOnce({ id: "p1", status: "approved", platform: "x", approved_by: "admin" } as any)
      .mockResolvedValueOnce({ id: "p1", status: "approved", platform: "x", approved_by: "admin" } as any);
    vi.mocked(publisher.publishPost).mockResolvedValue({ postId: "p1", platform: "x", result: "waiting", detail: "X is not connected." } as any);
    const res = await request(app).post("/api/admin/marketing/posts/p1/publish").set(SECRET).send({});
    expect(res.status).toBe(200);
    expect(res.body.outcome.result).toBe("waiting");
  });
});

describe("run-scheduler auth", () => {
  it("accepts the cron bearer secret", async () => {
    vi.mocked(scheduler.runScheduler).mockResolvedValue({ ranAt: "t", due: 0, published: [], waiting: [], failed: [], skipped: [], metricsRefreshed: 0 } as any);
    const res = await request(app).get("/api/admin/marketing/run-scheduler").set("authorization", "Bearer test-cron-secret");
    expect(res.status).toBe(200);
    expect(scheduler.runScheduler).toHaveBeenCalled();
  });
  it("rejects a bad bearer", async () => {
    const res = await request(app).get("/api/admin/marketing/run-scheduler").set("authorization", "Bearer wrong");
    expect(res.status).toBe(401);
  });
});

// --- Approval-gate regressions, draft review, campaigns, overview ----------

describe("content edits cannot publish unreviewed text", () => {
  it("editing the content of an approved post returns it to draft and clears approval", async () => {
    vi.mocked(store.getPost).mockResolvedValue({ id: "p1", platform: "facebook", status: "approved", approved_by: "admin", content: "old" } as any);
    vi.mocked(store.transitionPost).mockResolvedValue({ id: "p1", status: "draft", content: "new" } as any);
    const res = await request(app).patch("/api/admin/marketing/posts/p1").set(SECRET).send({ content: "new" });
    expect(res.status).toBe(200);
    expect(res.body.approvalReset).toBe(true);
    expect(store.transitionPost).toHaveBeenCalledWith("p1", "approved", "draft", expect.objectContaining({ approved_by: null, approved_at: null, scheduled_for: null, content: "new" }));
    expect(store.updatePost).not.toHaveBeenCalled();
  });

  it("editing a scheduled post's text also reverts it to draft (no schedule survives the edit)", async () => {
    vi.mocked(store.getPost).mockResolvedValue({ id: "p2", platform: "x", status: "scheduled", approved_by: "admin" } as any);
    vi.mocked(store.transitionPost).mockResolvedValue({ id: "p2", status: "draft" } as any);
    const res = await request(app).patch("/api/admin/marketing/posts/p2").set(SECRET).send({ hashtags: ["Changed"] });
    expect(res.status).toBe(200);
    expect(store.transitionPost).toHaveBeenCalledWith("p2", "scheduled", "draft", expect.objectContaining({ approved_by: null }));
  });

  it("a non-content edit (campaign) does not reset approval", async () => {
    vi.mocked(store.getPost).mockResolvedValue({ id: "p3", platform: "facebook", status: "approved", approved_by: "admin" } as any);
    vi.mocked(store.updatePost).mockResolvedValue({ id: "p3", status: "approved" } as any);
    const res = await request(app).patch("/api/admin/marketing/posts/p3").set(SECRET).send({ campaignId: "c1" });
    expect(res.status).toBe(200);
    expect(res.body.approvalReset).toBe(false);
    expect(store.transitionPost).not.toHaveBeenCalled();
  });

  it("refuses to edit a canceled post", async () => {
    vi.mocked(store.getPost).mockResolvedValue({ id: "p4", status: "canceled" } as any);
    const res = await request(app).patch("/api/admin/marketing/posts/p4").set(SECRET).send({ content: "x" });
    expect(res.status).toBe(409);
  });

  it("rejects non-http link URLs such as javascript: URLs", async () => {
    vi.mocked(store.getPost).mockResolvedValue({ id: "p5", status: "draft" } as any);
    const res = await request(app).patch("/api/admin/marketing/posts/p5").set(SECRET).send({ linkUrl: "javascript:alert(1)" });
    expect(res.status).toBe(400);
  });
});

describe("draft review actions", () => {
  it("returns a rejected post to draft and clears the rejection reason", async () => {
    vi.mocked(store.getPost).mockResolvedValue({ id: "p6", platform: "facebook", status: "rejected" } as any);
    vi.mocked(store.transitionPost).mockResolvedValue({ id: "p6", status: "draft" } as any);
    const res = await request(app).post("/api/admin/marketing/posts/p6/draft").set(SECRET);
    expect(res.status).toBe(200);
    expect(store.transitionPost).toHaveBeenCalledWith("p6", "rejected", "draft", expect.objectContaining({ rejection_reason: null }));
  });

  it("unschedules a scheduled post back to approved (approval kept)", async () => {
    vi.mocked(store.getPost).mockResolvedValue({ id: "p7", platform: "facebook", status: "scheduled", approved_by: "admin" } as any);
    vi.mocked(store.transitionPost).mockResolvedValue({ id: "p7", status: "approved" } as any);
    const res = await request(app).post("/api/admin/marketing/posts/p7/unschedule").set(SECRET);
    expect(res.status).toBe(200);
    expect(store.transitionPost).toHaveBeenCalledWith("p7", "scheduled", "approved", expect.objectContaining({ scheduled_for: null }));
  });

  it("cannot unschedule a published post", async () => {
    vi.mocked(store.getPost).mockResolvedValue({ id: "p8", status: "published" } as any);
    const res = await request(app).post("/api/admin/marketing/posts/p8/unschedule").set(SECRET);
    expect(res.status).toBe(409);
  });
});

describe("campaign management", () => {
  it("rejects an invalid campaign status", async () => {
    const res = await request(app).patch("/api/admin/marketing/campaigns/c1").set(SECRET).send({ status: "deleted" });
    expect(res.status).toBe(400);
    expect(store.updateCampaign).not.toHaveBeenCalled();
  });

  it("pauses a campaign", async () => {
    vi.mocked(store.updateCampaign).mockResolvedValue({ id: "c1", name: "Guide", status: "paused" } as any);
    const res = await request(app).patch("/api/admin/marketing/campaigns/c1").set(SECRET).send({ status: "paused" });
    expect(res.status).toBe(200);
    expect(store.updateCampaign).toHaveBeenCalledWith("c1", expect.objectContaining({ status: "paused" }));
  });

  it("returns 404 for an unknown campaign", async () => {
    vi.mocked(store.updateCampaign).mockResolvedValue(null);
    const res = await request(app).patch("/api/admin/marketing/campaigns/nope").set(SECRET).send({ status: "active" });
    expect(res.status).toBe(404);
  });
});

describe("overview", () => {
  it("reports real counts and lists unmeasured metrics as unavailable instead of zero", async () => {
    vi.mocked(store.countPostsByStatus).mockResolvedValue({ draft: 2, pending_approval: 1, approved: 0, scheduled: 0, publishing: 0, published: 0, failed: 1, rejected: 0, canceled: 0 } as any);
    vi.mocked(store.listPosts).mockResolvedValue([{ id: "f1", platform: "x", last_error: "boom", updated_at: "t" }] as any);
    vi.mocked(store.listCampaigns).mockResolvedValue([{ id: "c1", status: "active" }] as any);
    vi.mocked(store.getAnalyticsSummary).mockResolvedValue({ totals: {}, perPlatform: {}, publishedCount: 0 } as any);
    const res = await request(app).get("/api/admin/marketing/overview").set(SECRET);
    expect(res.status).toBe(200);
    expect(res.body.counts.draft).toBe(2);
    expect(res.body.pendingApproval).toBe(1);
    expect(res.body.failedJobs[0].last_error).toBe("boom");
    expect(res.body.campaigns.active).toBe(1);
    expect(res.body.unavailable.length).toBeGreaterThan(0);
    expect(res.body.counts).not.toHaveProperty("traffic");
  });

  it("requires admin authentication", async () => {
    const res = await request(app).get("/api/admin/marketing/overview");
    expect(res.status).toBe(401);
  });
});

describe("secret comparison", () => {
  it("accepts only an exact match and rejects a missing or prefix secret", async () => {
    const { secretMatches } = await import("./routes.js");
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("ab", "abc")).toBe(false);
    expect(secretMatches("abcd", "abc")).toBe(false);
    expect(secretMatches(undefined, "abc")).toBe(false);
    expect(secretMatches("abc", undefined)).toBe(false);
    expect(secretMatches("", "")).toBe(false);
  });
});
