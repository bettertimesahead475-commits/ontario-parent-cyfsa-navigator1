// Tests the AI content agent WITHOUT hitting the real Claude API (the SDK is
// mocked). The important guarantees here:
//   1. The guardrail system prompt that forbids legal advice / fabrication is
//      actually sent — a regression that strips it fails this test.
//   2. The agent never trusts the model blindly: it drops any platform it
//      didn't ask for, normalizes hashtags, and hard-caps content to each
//      platform's real character limit even if the model overshoots.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
    constructor(_opts: any) {}
  },
}));

process.env.ANTHROPIC_API_KEY = "test-key";
const { generateMarketingPosts } = await import("./ai.js");

function claudeReply(json: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(json) }] };
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe("generateMarketingPosts — guardrails are sent", () => {
  it("sends a system prompt that forbids legal advice and fabrication", async () => {
    mockCreate.mockResolvedValue(claudeReply([{ platform: "facebook", content: "Learn about the free guide.", hashtags: ["CYFSA"] }]));
    await generateMarketingPosts({ platforms: ["facebook"], topic: "the free guide" });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const args = mockCreate.mock.calls[0][0];
    expect(args.system).toMatch(/NO LEGAL ADVICE/i);
    expect(args.system).toMatch(/NO FABRICATION/i);
    expect(args.system).toMatch(/no fear-mongering/i);
    // Thinking is explicitly disabled for this structured task (same as the app's other AI calls).
    expect(args.thinking).toEqual({ type: "disabled" });
  });
});

describe("generateMarketingPosts — never trusts the model output blindly", () => {
  it("drops platforms that weren't requested", async () => {
    mockCreate.mockResolvedValue(
      claudeReply([
        { platform: "facebook", content: "ok", hashtags: [] },
        { platform: "tiktok", content: "should be dropped — not requested", hashtags: [] },
      ])
    );
    const { drafts } = await generateMarketingPosts({ platforms: ["facebook"], topic: "t" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].platform).toBe("facebook");
  });

  it("normalizes hashtags (strips leading # and blanks)", async () => {
    mockCreate.mockResolvedValue(claudeReply([{ platform: "facebook", content: "ok", hashtags: ["#CYFSA", "OntarioParents", "", "#KnowYourRights"] }]));
    const { drafts } = await generateMarketingPosts({ platforms: ["facebook"], topic: "t" });
    expect(drafts[0].hashtags).toEqual(["CYFSA", "OntarioParents", "KnowYourRights"]);
  });

  it("hard-caps content to the platform limit even if the model overshoots (X = 280)", async () => {
    mockCreate.mockResolvedValue(claudeReply([{ platform: "x", content: "a".repeat(500), hashtags: [] }]));
    const { drafts } = await generateMarketingPosts({ platforms: ["x"], topic: "t" });
    expect(drafts[0].content.length).toBe(280);
  });

  it("throws honestly when the model returns no usable drafts", async () => {
    mockCreate.mockResolvedValue(claudeReply([]));
    await expect(generateMarketingPosts({ platforms: ["facebook"], topic: "t" })).rejects.toThrow(/usable drafts/i);
  });

  it("validates input before calling the model", async () => {
    await expect(generateMarketingPosts({ platforms: [], topic: "t" })).rejects.toThrow(/at least one platform/i);
    await expect(generateMarketingPosts({ platforms: ["facebook"], topic: "" })).rejects.toThrow(/topic/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
