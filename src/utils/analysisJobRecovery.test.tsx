// Client recovery after a dropped analysis stream: the job record is followed until it finishes,
// and nothing here ever re-sends (or pays for) the analysis itself.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./firebase", () => ({ auth: { currentUser: null } }));
const { pollAnalysisJob, readAnalysisEventStream, ApiResponseError, STREAM_INTERRUPTED } = await import("./api");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function sseResponse(chunks: string[]) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pollAnalysisJob", () => {
  it("reports real progress, then resolves with the finished report", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { jobId: "j", status: "analyzing", percent: 60, message: "2 of 4", sections: { overview: {} } }))
      .mockResolvedValueOnce(json(200, { jobId: "j", status: "completed", report: { documentTitle: "Done" } }));
    const progress: any[] = [];
    const outcome = await pollAnalysisJob("req_1_abc", { intervalMs: 1, onProgress: (j) => progress.push(j) });
    expect(outcome).toEqual({ status: "completed", report: { documentTitle: "Done" } });
    expect(progress[0].percent).toBe(60);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("/api/analyze/job/"))).toBe(true);
  });

  it("returns the server's failure (whose credit was released) instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { jobId: "j", status: "failed", error: { code: "AI_RATE_LIMITED", message: "slow down", statusCode: 429, retryable: true } })
    );
    const outcome = await pollAnalysisJob("req_1_abc", { intervalMs: 1 });
    expect(outcome).toMatchObject({ status: "failed", error: { code: "AI_RATE_LIMITED" } });
  });

  it("stops with JOB_NOT_FOUND when the job never existed, and SIGN_IN_REQUIRED on 401", async () => {
    fetchMock.mockResolvedValue(json(404, { code: "JOB_NOT_FOUND" }));
    await expect(pollAnalysisJob("req_1_abc", { intervalMs: 1 })).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(json(401, { code: "SIGN_IN_REQUIRED" }));
    await expect(pollAnalysisJob("req_1_abc", { intervalMs: 1 })).rejects.toMatchObject({ code: "SIGN_IN_REQUIRED" });
  });

  it("gives up with RECOVERY_TIMEOUT (outcome unknown) after the wait limit", async () => {
    fetchMock.mockImplementation(async () => json(200, { jobId: "j", status: "analyzing", percent: 40 }));
    const err = await pollAnalysisJob("req_1_abc", { intervalMs: 1, maxWaitMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiResponseError);
    expect(err.code).toBe("RECOVERY_TIMEOUT");
    expect(err.message).not.toMatch(/no credit|zero credit|nothing was charged/i);
  });
});

describe("readAnalysisEventStream", () => {
  it("reports a stream that ends before the result as recoverable, without claiming nothing was charged", async () => {
    const res = sseResponse([`data: ${JSON.stringify({ type: "stage", stage: "reviewing_evidence", percent: 45, message: "m" })}\n\n`]);
    const err = await readAnalysisEventStream(res).catch((e) => e);
    expect(err.code).toBe(STREAM_INTERRUPTED);
    expect(err.message).not.toMatch(/zero credits|no credits/i);
  });

  it("delivers validated sections as they arrive and resolves with the final report", async () => {
    const sections: string[] = [];
    const res = sseResponse([
      `data: ${JSON.stringify({ type: "section", section: "overview", data: { fileSummary: "s" } })}\n\n`,
      `data: ${JSON.stringify({ type: "complete", report: { documentTitle: "T" } })}\n\n`,
    ]);
    const report = await readAnalysisEventStream(res, { onSection: (s) => sections.push(s) });
    expect(sections).toEqual(["overview"]);
    expect(report.documentTitle).toBe("T");
  });
});
