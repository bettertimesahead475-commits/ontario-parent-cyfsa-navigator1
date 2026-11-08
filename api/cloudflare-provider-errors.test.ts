import { describe, expect, it, vi } from "vitest";
import { createCloudflareGenerateFn } from "../functions/api/_analyzer-model-adapter";

const PROVIDER_BODY = '{"type":"error","error":{"type":"invalid_request_error","message":"\'temperature\' is deprecated for this model. key sk-ant-secret123"}}';
const call = (status: number, retries = 0, headers: Record<string, string> = {}) => {
  const fetcher = vi.fn(async () => new Response(PROVIDER_BODY, { status, headers }));
  const gen = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: "sk-ant-test-key" }, fetcher as any);
  return { fetcher, run: gen({ system: "s", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], max_tokens: 100, timeoutMs: 5000, retries, requestId: "r", stage: "x", mode: "fast" } as any, "claude-sonnet-5") };
};

describe("Cloudflare Anthropic adapter: provider errors", () => {
  it.each([[400, false], [401, false], [403, false], [429, true], [500, true], [503, true]])(
    "HTTP %i reaches the customer with a fixed message, never the provider text or key", async (status, retryable) => {
      const { run } = call(status);
      const err: any = await run.catch((e) => e);
      expect(err.retryable).toBe(retryable);
      expect(err.userMessage).not.toMatch(/temperature|deprecated|sk-ant|secret|\{/);
      expect(err.message).not.toMatch(/sk-ant-secret123/);
    }
  );

  it("does not retry a 400 (the same request would fail again)", async () => {
    const { fetcher, run } = call(400, 3);
    await run.catch(() => {});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("a timed-out or dropped provider connection ends as a retryable error with a fixed message", async () => {
    const fetcher = vi.fn(async () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); });
    const gen = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: "sk-ant-test-key" }, fetcher as any);
    const err: any = await gen({ system: "s", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], max_tokens: 100, timeoutMs: 5000, retries: 0, requestId: "r", stage: "x", mode: "fast" } as any, "claude-sonnet-5").catch((e) => e);
    expect(err.code).toBe("AI_PROVIDER_TEMPORARILY_UNAVAILABLE");
    expect(err.retryable).toBe(true);
    expect(err.userMessage).toMatch(/did not respond in time/);
    expect(err.userMessage).not.toMatch(/aborted|timeout/i);
  });
});
