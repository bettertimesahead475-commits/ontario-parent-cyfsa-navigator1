import { describe, expect, it, vi } from "vitest";
import { handleAnalyzeRequest, type AnalyzerEnv } from "../functions/api/analyze";
import { createCloudflareGenerateFn } from "../functions/api/_analyzer-model-adapter";
import type { GenerateFn } from "./services/analyzerSections";

/*
 * Reproduction for the Quick Review that stays at 40% and never reports an error or a result.
 *
 * 40% is set immediately before the single direct model call. Nothing else moves the progress until that call returns.
 * So a call that never returns, and never raises an error, leaves the browser at 40% indefinitely.
 */

const mockAuthVerification = vi.fn();
vi.mock("../functions/api/_auth-check", () => ({
  verifyFirebaseRequest: (req: Request, env: any) => mockAuthVerification(req, env),
  onRequestGet: vi.fn(),
}));
vi.mock("../functions/api/_supabase-paid-session", () => ({ readVerifiedPaidSession: vi.fn() }));

const DOC = "AFFIDAVIT. On October 12, 2026 the Society opened an investigation. The worker attended on October 14, 2026.";

const ENV = {
  ANALYZER_ENABLED: "true",
  FIREBASE_PROJECT_ID: "p",
  ANTHROPIC_API_KEY: "sk-ant-test",
  QUICK_ANALYSIS_BUDGET_MS: "10000",
  STAGING_SUPABASE_URL: "https://staging.example.supabase.co",
  STAGING_SUPABASE_SERVICE_ROLE_KEY: "svc-key",
} as unknown as AnalyzerEnv;

function rpcStub() {
  return vi.fn(async (name: string) => {
    if (name === "free_reserve_scan") return { status: "reserved", reservation_id: "res_1" };
    return { status: name === "free_finalize_scan" ? "consumed" : "released" };
  });
}

/** Reads an SSE body until it closes or the overall limit passes. Returns the event names seen and whether it closed. */
async function readSse(res: Response, limitMs: number) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];
  let text = "";
  const started = Date.now();
  let closed = false;
  while (Date.now() - started < limitMs) {
    const remaining = limitMs - (Date.now() - started);
    const result = await Promise.race([
      reader.read(),
      new Promise<null>((r) => setTimeout(() => r(null), remaining)),
    ]);
    if (result === null) break;
    if (result.done) {
      closed = true;
      break;
    }
    text += decoder.decode(result.value, { stream: true });
    for (const m of text.matchAll(/^event: (\w+)$/gm)) events.push(m[1]);
  }
  return { events, closed, elapsedMs: Date.now() - started, text };
}

describe("Quick Review that never returns from the model", () => {
  it("the provider adapter bounds the response body, not only the response headers", async () => {
    // Headers arrive, then the body never ends. The adapter must still give up at its timeout.
    const fetcher = vi.fn(async () => {
      const body = new ReadableStream({ start() {} }); // open, never closes
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    });
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: "sk-ant-test" }, fetcher as any);
    const started = Date.now();
    const outcome = await Promise.race([
      generate({ system: "s", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], max_tokens: 100, timeoutMs: 500, retries: 0 } as any, "claude-sonnet-5")
        .then(() => "resolved", (e: any) => `rejected:${e?.code ?? e?.name}`),
      new Promise<string>((r) => setTimeout(() => r("still pending after 5s"), 5000)),
    ]);
    expect(outcome).toMatch(/^rejected:/);
    expect(Date.now() - started).toBeLessThan(4000);
  }, 10000);

  it("the stream reports an error and releases the credit when the model call never returns", async () => {
    mockAuthVerification.mockResolvedValueOnce({ status: "verified", uid: "user_free_1" });
    const rpc = rpcStub();
    const jobWrites: Array<Record<string, any>> = [];
    const storage = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/storage/v1/object/analysis_jobs/")) jobWrites.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    });
    // The provider call ignores its abort signal and never resolves, the failure mode that leaves the UI at 40%.
    const generate = vi.fn(() => new Promise<never>(() => {})) as unknown as GenerateFn;

    const req = new Request("https://staging.example/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer mock", Accept: "text/event-stream", "X-Analysis-Id": "req_stall_1" },
      body: JSON.stringify({ documentText: DOC, mode: "fast", stream: true }),
    });
    const res = await handleAnalyzeRequest(req, ENV, { rpc, generate, fetcher: storage as any }, (p) => {
      void p;
    });
    expect(res.status).toBe(200);

    const out = await readSse(res, 25_000);
    expect(out.events).toContain("error");
    expect(out.closed).toBe(true);
    expect(out.elapsedMs).toBeLessThan(20_000);
    expect(rpc.mock.calls.map((c) => c[0])).toContain("free_release_scan");
    expect(jobWrites.map((w) => w.status)).toEqual(["running", "failed"]);
  }, 40000);
});
