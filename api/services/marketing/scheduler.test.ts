// Tests that runScheduler() categorizes outcomes HONESTLY — in particular that a
// post whose platform isn't connected yet comes back as "waiting" and is NOT
// counted as failed (and definitely not as published). store.js and publisher.js
// are mocked so this is pure aggregation logic with no DB/network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPublishPost, mockRefreshMetricsFor, store } = vi.hoisted(() => ({
  mockPublishPost: vi.fn(),
  mockRefreshMetricsFor: vi.fn(),
  store: {
    listDuePosts: vi.fn(),
    listPublishedPosts: vi.fn(),
    logAgentAction: vi.fn(),
    upsertChannelState: vi.fn(),
  },
}));

vi.mock("./publisher.js", () => ({
  publishPost: mockPublishPost,
  refreshMetricsFor: mockRefreshMetricsFor,
}));
vi.mock("./store.js", () => store);

const { runScheduler } = await import("./scheduler.js");

beforeEach(() => {
  vi.clearAllMocks();
  store.listPublishedPosts.mockResolvedValue([]);
  store.logAgentAction.mockResolvedValue(undefined);
});

function post(id: string, platform = "facebook") {
  return { id, platform, status: "scheduled", content: "x", approved_by: "admin" };
}

describe("runScheduler", () => {
  it("publishes due posts and reports each category separately", async () => {
    store.listDuePosts.mockResolvedValue([post("p1"), post("p2", "x"), post("p3", "instagram")]);
    mockPublishPost
      .mockResolvedValueOnce({ postId: "p1", platform: "facebook", result: "published", detail: "ok", externalUrl: "u" })
      .mockResolvedValueOnce({ postId: "p2", platform: "x", result: "waiting", detail: "not connected" })
      .mockResolvedValueOnce({ postId: "p3", platform: "instagram", result: "failed", detail: "boom" });

    const r = await runScheduler({ refreshMetrics: false });

    expect(r.due).toBe(3);
    expect(r.published).toHaveLength(1);
    expect(r.waiting).toHaveLength(1);
    expect(r.failed).toHaveLength(1);
    // A "waiting" post (integration not ready) must never be miscounted as failed.
    expect(r.waiting[0].postId).toBe("p2");
    expect(r.failed[0].postId).toBe("p3");
  });

  it("does nothing destructive when there are no due posts", async () => {
    store.listDuePosts.mockResolvedValue([]);
    const r = await runScheduler({ refreshMetrics: false });
    expect(r.due).toBe(0);
    expect(mockPublishPost).not.toHaveBeenCalled();
  });

  it("refreshes metrics for published posts when enabled", async () => {
    store.listDuePosts.mockResolvedValue([]);
    store.listPublishedPosts.mockResolvedValue([post("p1"), post("p2")]);
    mockRefreshMetricsFor.mockResolvedValue(true);
    const r = await runScheduler({ refreshMetrics: true });
    expect(mockRefreshMetricsFor).toHaveBeenCalledTimes(2);
    expect(r.metricsRefreshed).toBe(2);
  });

  it("records a per-post failure without throwing the whole run", async () => {
    store.listDuePosts.mockResolvedValue([post("p1")]);
    mockPublishPost.mockRejectedValue(new Error("unexpected"));
    const r = await runScheduler({ refreshMetrics: false });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].detail).toContain("unexpected");
  });
});
