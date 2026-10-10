import { describe, it, expect, vi } from "vitest";
import {
  createAnalysisJob,
  getAnalysisJob,
  updateAnalysisJobStage,
  completeAnalysisJob,
  failAnalysisJob,
  SseStreamEmitter,
  STAGE_DEFINITIONS,
} from "./analyzerStreaming.js";

describe("analyzerStreaming service", () => {
  it("creates, tracks, updates, and completes analysis jobs", () => {
    const job = createAnalysisJob({
      jobId: "job-123",
      uid: "user-456",
      mode: "fast",
    });

    expect(job.jobId).toBe("job-123");
    expect(job.status).toBe("analyzing");
    expect(job.currentStage).toBe("verifying_access");

    updateAnalysisJobStage("job-123", "reviewing_evidence");
    const updated = getAnalysisJob("job-123");
    expect(updated?.currentStage).toBe("reviewing_evidence");
    expect(updated?.percent).toBe(STAGE_DEFINITIONS.reviewing_evidence.percent);

    completeAnalysisJob("job-123", { documentTitle: "Test Report" });
    const completed = getAnalysisJob("job-123");
    expect(completed?.status).toBe("completed");
    expect(completed?.percent).toBe(100);
    expect(completed?.report.documentTitle).toBe("Test Report");
  });

  it("handles failed jobs with retryable metadata", () => {
    createAnalysisJob({
      jobId: "job-err",
      uid: "user-err",
      mode: "full",
    });

    failAnalysisJob("job-err", {
      code: "AI_PROVIDER_TEMPORARILY_UNAVAILABLE",
      message: "Timed out",
      statusCode: 503,
      retryable: true,
    });

    const failed = getAnalysisJob("job-err");
    expect(failed?.status).toBe("failed");
    expect(failed?.error?.code).toBe("AI_PROVIDER_TEMPORARILY_UNAVAILABLE");
    expect(failed?.error?.retryable).toBe(true);
  });

  it("emits SSE events formatted according to W3C spec", () => {
    const writes: string[] = [];
    const mockRes: any = {
      setHeader: vi.fn(),
      write: vi.fn((data: string) => {
        writes.push(data);
        return true;
      }),
      end: vi.fn(),
      on: vi.fn(),
    };

    const emitter = new SseStreamEmitter(mockRes, "job-sse");
    expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream; charset=utf-8");

    emitter.emitStage("reviewing_evidence");
    expect(writes.length).toBe(1);
    expect(writes[0]).toContain('"type":"stage"');
    expect(writes[0]).toContain('"stage":"reviewing_evidence"');

    emitter.emitSection("core", { completenessScore: 85 });
    expect(writes.length).toBe(2);
    expect(writes[1]).toContain('"type":"section"');
    expect(writes[1]).toContain('"completenessScore":85');

    emitter.emitComplete({ fileSummary: "Done" });
    expect(writes.length).toBe(3);
    expect(writes[2]).toContain('"type":"complete"');
    expect(mockRes.end).toHaveBeenCalled();
  });
});
