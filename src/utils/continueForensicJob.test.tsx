import { describe, expect, it } from "vitest";
import { continueForensicJob, isContinuation, pollAnalysisJob, readAnalysisEventStream } from "./api";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const scripted = (replies: Array<Response | Error>) => {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    const next = replies.shift();
    if (!next) throw new Error("no more replies");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetcher, urls };
};
const noSleep = async () => {};

describe("continueForensicJob", () => {
  it("continues through progress, a busy step and a temporary failure to the report", async () => {
    const progress: number[] = [];
    const { fetcher, urls } = scripted([
      json(202, { percent: 40, message: "a" }),
      json(409, { code: "ANALYSIS_IN_PROGRESS", retryable: true, retryAfterMs: 1 }),
      json(503, { code: "AI_PROVIDER_TEMPORARILY_UNAVAILABLE", retryable: true }),
      new Error("network"),
      json(202, { percent: 80, message: "b" }),
      json(200, { redFlags: [], forensicEngine: { schema: "forensic-engine-v1" } }),
    ]);
    const report = await continueForensicJob("req_1_x", { fetcher, sleep: noSleep, onProgress: (p) => progress.push(p) });
    expect(report.forensicEngine.schema).toBe("forensic-engine-v1");
    expect(progress).toEqual([40, 80]);
    expect(urls.every((u) => u === "/api/analyze/job/req_1_x/continue")).toBe(true);
  });

  it("stops on a failed job with the server's code, without retrying", async () => {
    const { fetcher, urls } = scripted([json(410, { code: "ANALYSIS_FAILED", retryable: false, error: "Nothing was charged." })]);
    await expect(continueForensicJob("req_1_x", { fetcher, sleep: noSleep })).rejects.toMatchObject({ code: "ANALYSIS_FAILED", retryable: false, status: 410 });
    expect(urls).toHaveLength(1);
  });

  it("stops on a lost paid session so the parent can sign in and continue the same job", async () => {
    const { fetcher } = scripted([json(403, { code: "PAID_SESSION_REQUIRED", error: "Sign in." })]);
    await expect(continueForensicJob("req_1_x", { fetcher, sleep: noSleep })).rejects.toMatchObject({ code: "PAID_SESSION_REQUIRED" });
  });

  it("gives up after repeated temporary failures, keeping the job resumable", async () => {
    const { fetcher } = scripted(Array.from({ length: 6 }, () => json(503, { retryable: true, code: "AI_PROVIDER_TEMPORARILY_UNAVAILABLE" })));
    await expect(continueForensicJob("req_1_x", { fetcher, sleep: noSleep })).rejects.toMatchObject({ retryable: true });
  });

  it("can be cancelled", async () => {
    await expect(continueForensicJob("req_1_x", { fetcher: scripted([]).fetcher, isCancelled: () => true })).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

describe("recognizing a continuation", () => {
  it("returns a continuation from a streamed 'continue' event", async () => {
    const body = `data: ${JSON.stringify({ type: "stage", stage: "reviewing_evidence", percent: 40, message: "m" })}\n\ndata: ${JSON.stringify({ type: "continue", jobId: "req_1_x", percent: 50, message: "saved" })}\n\n`;
    const res = new Response(body, { headers: { "content-type": "text/event-stream" } });
    const result = await readAnalysisEventStream(res);
    expect(isContinuation(result)).toBe(true);
    expect(result.__continueJobId).toBe("req_1_x");
  });

  it("recognizes the JSON 202 reply and nothing else", () => {
    expect(isContinuation({ code: "ANALYSIS_CONTINUING", jobId: "j" })).toBe(true);
    expect(isContinuation({ redFlags: [] })).toBe(false);
    expect(isContinuation(null)).toBe(false);
  });

  it("recovery after a dropped connection continues a resumable job instead of waiting for it", async () => {
    const { fetcher, urls } = scripted([
      json(200, { jobId: "req_1_x", status: "analyzing", resumable: true, percent: 50 }),
      json(200, { redFlags: [], forensicEngine: { schema: "forensic-engine-v1" } }),
    ]);
    const outcome = await pollAnalysisJob("req_1_x", { fetcher, intervalMs: 1 });
    expect(outcome).toMatchObject({ status: "completed" });
    expect(urls).toEqual(["/api/analyze/job/req_1_x", "/api/analyze/job/req_1_x/continue"]);
  });
});
