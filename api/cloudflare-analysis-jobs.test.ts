import { describe, expect, it, vi } from "vitest";
import { handleAnalyzeRequest, type AnalyzerEnv } from "../functions/api/analyze";
import { AnalyzerError } from "./services/analyzerErrors";
import { effectiveJob, RUNNING_JOB_STALE_MS, saveJobState } from "../functions/api/_analysis-jobs";
import type { GenerateFn } from "./services/analyzerSections";

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
  STAGING_SUPABASE_URL: "https://staging.example.supabase.co",
  STAGING_SUPABASE_SERVICE_ROLE_KEY: "svc-key",
} as unknown as AnalyzerEnv;

/** Captures every job record write, and answers the credit RPCs. */
function harness() {
  const jobWrites: Array<Record<string, any>> = [];
  const storage = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/storage/v1/object/analysis_jobs/")) jobWrites.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 200 });
  });
  const rpc = vi.fn(async (name: string) => {
    if (name === "free_reserve_scan") return { status: "reserved", reservation_id: "res_1" };
    return { status: name === "free_finalize_scan" ? "consumed" : "released" };
  });
  return { jobWrites, storage, rpc };
}

const request = (requestId: string) =>
  new Request("https://staging.example/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer mock", "X-Analysis-Id": requestId, Accept: "application/json" },
    body: JSON.stringify({ documentText: DOC, mode: "fast", stream: false }),
  });

describe("analysis job records", () => {
  it("writes running when the analysis starts, then a failed record with the reason when the provider fails", async () => {
    mockAuthVerification.mockResolvedValueOnce({ status: "verified", uid: "user_free_1" });
    const h = harness();
    const generate = vi.fn(async () => {
      throw new AnalyzerError("AI_PROVIDER_TEMPORARILY_UNAVAILABLE", 503, "The AI analysis engine is temporarily unavailable. Please try again shortly. Nothing was charged.", true);
    }) as unknown as GenerateFn;

    const res = await handleAnalyzeRequest(request("req_job_failure_01"), ENV, { rpc: h.rpc, generate, fetcher: h.storage as any });

    expect(res.status).toBe(503);
    expect(h.jobWrites.map((w) => w.status)).toEqual(["running", "failed"]);
    expect(h.jobWrites[0]).toMatchObject({ jobId: "req_job_failure_01", uid: "user_free_1", currentStage: "running" });
    expect(h.jobWrites[1]).toMatchObject({
      jobId: "req_job_failure_01",
      currentStage: "failed",
      error: { code: "AI_PROVIDER_TEMPORARILY_UNAVAILABLE", retryable: true },
    });
    expect(h.jobWrites[1].error.message).toMatch(/Nothing was charged/);
    expect(h.rpc.mock.calls.map((c) => c[0])).toContain("free_release_scan");
  });

  it("never writes provider text into the stored record", async () => {
    mockAuthVerification.mockResolvedValueOnce({ status: "verified", uid: "user_free_2" });
    const h = harness();
    const generate = vi.fn(async () => {
      throw new Error("provider said: sk-ant-leaked-key and document text");
    }) as unknown as GenerateFn;
    await handleAnalyzeRequest(request("req_job_failure_02"), ENV, { rpc: h.rpc, generate, fetcher: h.storage as any });
    const stored = JSON.stringify(h.jobWrites);
    expect(stored).not.toMatch(/sk-ant-leaked-key|document text/);
  });
});

describe("reading a stored job", () => {
  const now = 1_000_000_000_000;

  it("a running record that is still fresh is reported as running", () => {
    expect(effectiveJob({ status: "running", updatedAt: now - 10_000 }, now)).toMatchObject({ status: "running" });
  });

  it("a running record older than any analysis budget is reported as timed out, with a retryable reason", () => {
    const job = effectiveJob({ status: "running", updatedAt: now - RUNNING_JOB_STALE_MS - 1 }, now) as any;
    expect(job.status).toBe("timed_out");
    expect(job.error).toMatchObject({ code: "ANALYSIS_TIMED_OUT", retryable: true });
  });

  it("completed and failed records are returned unchanged, however old", () => {
    expect(effectiveJob({ status: "failed", updatedAt: now - 9_999_999 }, now)).toMatchObject({ status: "failed" });
    expect(effectiveJob({ status: "completed", updatedAt: now - 9_999_999 }, now)).toMatchObject({ status: "completed" });
  });

  it("a failed record write is reported to the caller and does not throw", async () => {
    const failing = vi.fn(async () => new Response("err", { status: 500 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveJobState(ENV as any, { jobId: "req_x_12345678", uid: "u", status: "running", percent: 35, message: "m" }, failing as any)).toBe(false);
    log.mockRestore();
  });
});
