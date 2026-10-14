// Publish-path tests with the Supabase store and platform adapters mocked. They
// cover the rules that stop unapproved, duplicate, or silently-failed posts:
// the approval gate, the atomic claim, honest waiting states, and safe retries.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { adapter, store } = vi.hoisted(() => ({
  adapter: { publish: vi.fn(), fetchMetrics: vi.fn() },
  store: {
    transitionPost: vi.fn(),
    updatePost: vi.fn(),
    logAgentAction: vi.fn(),
    recordAnalyticsSnapshot: vi.fn(),
  },
}));

vi.mock("./adapters/registry.js", () => ({ getAdapter: () => adapter }));
vi.mock("./store.js", async (importOriginal) => ({ ...(await importOriginal<any>()), ...store }));

const { publishPost } = await import("./publisher.js");

function approvedPost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    platform: "facebook",
    status: "approved",
    content: "Learn about the free plain-language guide.",
    media_url: null,
    link_url: "https://cyfsanavigator.com",
    hashtags: ["CYFSA"],
    generation_context: { campaignSlug: "guide" },
    approved_by: "admin",
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.logAgentAction.mockResolvedValue(undefined);
  store.recordAnalyticsSnapshot.mockResolvedValue(undefined);
  store.updatePost.mockResolvedValue({});
  adapter.fetchMetrics.mockResolvedValue({ ok: false, status: "error", error: "not needed" });
});

describe("approval gate", () => {
  it("never calls the platform for a post that no human approved", async () => {
    const out = await publishPost(approvedPost({ approved_by: null }));
    expect(out.result).toBe("skipped");
    expect(adapter.publish).not.toHaveBeenCalled();
    expect(store.transitionPost).not.toHaveBeenCalled();
  });

  it.each(["draft", "pending_approval", "rejected", "canceled", "published"])("refuses to publish a '%s' post", async (status) => {
    const out = await publishPost(approvedPost({ status }));
    expect(out.result).toBe("skipped");
    expect(adapter.publish).not.toHaveBeenCalled();
  });
});

describe("duplicate prevention", () => {
  it("does not publish when another worker already claimed the post", async () => {
    store.transitionPost.mockResolvedValueOnce(null); // claim lost the race
    const out = await publishPost(approvedPost({ status: "scheduled" }));
    expect(out.result).toBe("skipped");
    expect(adapter.publish).not.toHaveBeenCalled();
  });

  it("claims the post atomically from its current status before calling the platform", async () => {
    store.transitionPost.mockResolvedValueOnce({ id: "post-1" }).mockResolvedValueOnce({ id: "post-1" });
    adapter.publish.mockResolvedValue({ ok: true, externalPostId: "fb_1", externalUrl: "https://fb/1" });
    await publishPost(approvedPost({ status: "scheduled" }));
    expect(store.transitionPost.mock.calls[0]).toEqual(["post-1", "scheduled", "publishing"]);
  });
});

describe("outcomes are recorded honestly", () => {
  it("marks a post published only when the platform returns an external id", async () => {
    store.transitionPost.mockResolvedValueOnce({ id: "post-1" }).mockResolvedValueOnce({ id: "post-1" });
    adapter.publish.mockResolvedValue({ ok: true, externalPostId: "fb_1", externalUrl: "https://fb/1" });
    const out = await publishPost(approvedPost());
    expect(out.result).toBe("published");
    expect(store.transitionPost).toHaveBeenLastCalledWith("post-1", "publishing", "published", expect.objectContaining({ external_post_id: "fb_1" }));
  });

  it("keeps a post waiting (not failed) when credentials are missing, and restores its previous status", async () => {
    store.transitionPost.mockResolvedValueOnce({ id: "post-1" }).mockResolvedValueOnce({ id: "post-1" });
    adapter.publish.mockResolvedValue({ ok: false, status: "waiting_for_credentials", error: "Facebook Page is not connected." });
    const out = await publishPost(approvedPost({ status: "approved" }));
    expect(out.result).toBe("waiting");
    // publishing -> approved must be a legal transition, so the post is not stranded.
    expect(store.transitionPost).toHaveBeenLastCalledWith("post-1", "publishing", "approved", expect.anything());
    expect(store.transitionPost).not.toHaveBeenLastCalledWith("post-1", "publishing", "failed", expect.anything());
  });

  it("marks a genuine platform error as failed with the reason", async () => {
    store.transitionPost.mockResolvedValueOnce({ id: "post-1" }).mockResolvedValueOnce({ id: "post-1" });
    adapter.publish.mockResolvedValue({ ok: false, status: "error", error: "Content too long (HTTP 400)." });
    const out = await publishPost(approvedPost());
    expect(out.result).toBe("failed");
    expect(store.transitionPost).toHaveBeenLastCalledWith("post-1", "publishing", "failed", { last_error: "Content too long (HTTP 400)." });
  });

  it("marks the post failed when the adapter throws, instead of leaving it in 'publishing'", async () => {
    store.transitionPost.mockResolvedValueOnce({ id: "post-1" }).mockResolvedValueOnce({ id: "post-1" });
    adapter.publish.mockRejectedValue(new Error("socket hang up"));
    const out = await publishPost(approvedPost());
    expect(out.result).toBe("failed");
    expect(store.transitionPost).toHaveBeenLastCalledWith("post-1", "publishing", "failed", { last_error: "socket hang up" });
  });
});

describe("safe retries", () => {
  it("allows a failed post to be retried (claimed from 'failed')", async () => {
    store.transitionPost.mockResolvedValueOnce({ id: "post-1" }).mockResolvedValueOnce({ id: "post-1" });
    adapter.publish.mockResolvedValue({ ok: true, externalPostId: "fb_2" });
    const out = await publishPost(approvedPost({ status: "failed" }));
    expect(out.result).toBe("published");
    expect(store.transitionPost.mock.calls[0]).toEqual(["post-1", "failed", "publishing"]);
  });

  it("uses the same UTM-tagged link on every attempt (no double tagging)", async () => {
    store.transitionPost.mockResolvedValueOnce({ id: "post-1" }).mockResolvedValueOnce({ id: "post-1" });
    adapter.publish.mockResolvedValue({ ok: true, externalPostId: "fb_3" });
    await publishPost(approvedPost({ link_url: "https://cyfsanavigator.com/?utm_source=facebook" }));
    const sent = adapter.publish.mock.calls[0][0].linkUrl as string;
    expect(sent.match(/utm_source=/g)).toHaveLength(1);
  });
});
