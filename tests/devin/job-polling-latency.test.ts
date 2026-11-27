// DEVIN-PERF-02: completion of a running queued analysis is noticed within about 1 s, and concurrent pollers of the
// same job share one status request. Termination rules are unchanged (covered in src/utils/analysisJobRecovery.test.tsx).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/firebase", () => ({ auth: { currentUser: null } }));
const { pollAnalysisJob, ACTIVE_JOB_POLL_MS } = await import("../../src/utils/api");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pollAnalysisJob latency", () => {
  it("checks a running job about once a second instead of backing off to 5 s", async () => {
    vi.useFakeTimers();
    const running = () => json(200, { jobId: "j", status: "analyzing", percent: 50 });
    for (let i = 0; i < 8; i++) fetchMock.mockResolvedValueOnce(running());
    fetchMock.mockResolvedValueOnce(json(200, { jobId: "j", status: "completed", report: { documentTitle: "Done" } }));
    const outcome = pollAnalysisJob("req_1_abc");
    // Eight running snapshots then completion: at most 8 x 1.1 s, where the old backoff (3 s, 5 s cap) needed > 30 s.
    await vi.advanceTimersByTimeAsync(8 * ACTIVE_JOB_POLL_MS * 1.1 + 50);
    await expect(outcome).resolves.toEqual({ status: "completed", report: { documentTitle: "Done" } });
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it("never polls a running job faster than about once a second", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => json(200, { jobId: "j", status: "running" }));
    void pollAnalysisJob("req_2_abc", { maxWaitMs: 10_000 }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(7);
  });

  it("keeps backing off while the job record does not exist yet", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response("", { status: 404 }));
    void pollAnalysisJob("req_3_abc", { maxWaitMs: 60_000 }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("shares one in-flight status request between two pollers of the same job", async () => {
    let release: (r: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { release = r; }));
    const a = pollAnalysisJob("req_4_abc", { intervalMs: 1 });
    const b = pollAnalysisJob("req_4_abc", { intervalMs: 1 });
    await Promise.resolve();
    release(json(200, { jobId: "j", status: "completed", report: { documentTitle: "Shared" } }));
    await expect(a).resolves.toMatchObject({ status: "completed" });
    await expect(b).resolves.toMatchObject({ status: "completed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not share requests between different jobs", async () => {
    fetchMock.mockImplementation(async (url: string) => json(200, { jobId: url, status: "completed", report: { url } }));
    const [a, b] = await Promise.all([pollAnalysisJob("req_5_a", { intervalMs: 1 }), pollAnalysisJob("req_5_b", { intervalMs: 1 })]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((a as any).report.url).toContain("req_5_a");
    expect((b as any).report.url).toContain("req_5_b");
  });
});
