// Unit tests for the analyzer's client-side response handling.
import { describe, expect, it, vi } from "vitest";

vi.mock("./firebase", () => ({ auth: { currentUser: null } }));
const { safeReadJson, readAnalysisResponse, ApiResponseError } = await import("./api");
const { normalizeAnalysisReport } = await import("./analysisReport");

function response(status: number, body: string, contentType = "application/json") {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

describe("safeReadJson", () => {
  it("returns parsed JSON for a successful response", async () => {
    await expect(safeReadJson(response(200, '{"ok":true}'))).resolves.toEqual({ ok: true });
  });

  it("keeps the server's code, status and retryable flag on failure", async () => {
    const err = await safeReadJson(
      response(402, JSON.stringify({ code: "FREE_LIMIT_REACHED", error: "You've used your free analysis." }))
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ApiResponseError);
    expect(err.message).toBe("You've used your free analysis.");
    expect(err.status).toBe(402);
    expect(err.code).toBe("FREE_LIMIT_REACHED");
    expect(err.retryable).toBe(false);
  });

  it("honours an explicit retryable flag and the isRateLimit flag", async () => {
    const outage = await safeReadJson(
      response(503, JSON.stringify({ code: "AI_PROVIDER_CONFIGURATION_ERROR", error: "x", retryable: false }))
    ).catch((e) => e);
    expect(outage.retryable).toBe(false);
    const limited = await safeReadJson(response(429, JSON.stringify({ code: "AI_RATE_LIMITED", error: "slow down", isRateLimit: true }))).catch((e) => e);
    expect(limited.isRateLimit).toBe(true);
    expect(limited.retryable).toBe(true);
  });

  it("turns a non-JSON gateway timeout into a readable, retryable message without raw HTML", async () => {
    const err = await safeReadJson(response(504, "<html><body>FUNCTION_INVOCATION_TIMEOUT</body></html>", "text/html")).catch((e) => e);
    expect(err).toBeInstanceOf(ApiResponseError);
    expect(err.retryable).toBe(true);
    expect(err.message).not.toMatch(/<html/i);
    expect(err.message).toMatch(/took too long/);
  });
});

describe("queued analyzer responses", () => {
  it("recognizes HTTP 202, polls the authenticated status URL and returns the saved report", async () => {
    const progress = vi.fn();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, JSON.stringify({ jobId: "job_12345678", status: "queued", currentStage: "queued", percent: 10, message: "Waiting for a worker." })))
      .mockResolvedValueOnce(response(200, JSON.stringify({ jobId: "job_12345678", status: "completed", report: { documentTitle: "Recovered" } })));
    const result = await readAnalysisResponse(response(202, JSON.stringify({ jobId: "job_12345678", status: "queued" })), {
      onStage: progress,
    }, { fetcher, intervalMs: 0 });
    expect(result).toEqual({ documentTitle: "Recovered" });
    expect(fetcher).toHaveBeenCalledWith("/api/analyze/job/job_12345678", { signal: expect.any(AbortSignal) });
    expect(progress).toHaveBeenCalledWith("queued", 10, "Waiting for a worker.");
  });

  it("keeps legacy JSON response handling unchanged", async () => {
    await expect(readAnalysisResponse(response(200, '{"documentTitle":"Legacy"}'))).resolves.toEqual({ documentTitle: "Legacy" });
  });

  it("keeps the existing SSE completion shape unchanged", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: complete\ndata: {"documentTitle":"SSE report"}\n\n'));
        controller.close();
      },
    });
    const result = await readAnalysisResponse(new Response(stream, { headers: { "content-type": "text/event-stream" } }));
    expect(result).toEqual({ documentTitle: "SSE report" });
  });
});

describe("normalizeAnalysisReport", () => {
  it("fills list fields a Fast Analysis report does not include", () => {
    const report = normalizeAnalysisReport({ documentTitle: "Fast only", redFlags: [{ id: "rf1", severity: "CRITICAL" } as any] } as any);
    expect(report.thresholdAnalysis).toEqual([]);
    expect(report.whatToVerify).toEqual([]);
    expect(report.whatIsMissing).toEqual([]);
    expect(report.whatToAskALawyer).toEqual([]);
    expect(report.proceduralTimelineViolations).toEqual([]);
    expect(report.charterAndHumanRightsIssues).toEqual([]);
    expect(report.lawyerCaseBrief).toEqual([]);
    expect(report.redFlags).toHaveLength(1);
    expect(report.documentTitle).toBe("Fast only");
  });

  it("never alters existing findings and tolerates malformed flags", () => {
    const flag = { id: "rf1", severity: "Worth Raising With Counsel", phraseDetected: "quote", locationInDocument: "Page 3" };
    const report = normalizeAnalysisReport({ redFlags: [flag, null, { id: "rf2" }], whatToVerify: ["a"] } as any);
    expect(report.redFlags[0]).toBe(flag);
    expect(report.redFlags).toHaveLength(2);
    expect(report.redFlags[1].severity).toBe("");
    expect(report.whatToVerify).toEqual(["a"]);
    expect(normalizeAnalysisReport(null)).toBeNull();
  });
});
