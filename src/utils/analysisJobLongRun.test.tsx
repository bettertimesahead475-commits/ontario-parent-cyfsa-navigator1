// Regression for the 2026-11-26 Forensic interruption: the browser stopped polling a job after 6 minutes while the server
// was still completing it (the completed run took 18 min 47 s). The browser must keep following the job for the whole
// server-side window. Mocked network and clock only; synthetic data.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./firebase", () => ({ auth: { currentUser: null } }));
const { pollAnalysisJob } = await import("./api");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("job polling covers a Forensic run longer than six minutes", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-26T14:51:43Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps polling a job that completes after 12 minutes and returns its report", async () => {
    const t0 = Date.now();
    const fetcher = vi.fn(async () => (Date.now() - t0 < 12 * 60_000
      ? json(200, { status: "running", progress: 50, stage: "building_chronology" })
      : json(200, { status: "completed", report: { ok: true } })));
    const pending = pollAnalysisJob("req_1795704701637_uqn41oybbso", { fetcher: fetcher as any });
    let settled: unknown = undefined;
    pending.then((v) => { settled = v; }, (e) => { settled = e; });
    for (let i = 0; i < 2000 && settled === undefined; i++) await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toEqual({ status: "completed", report: { ok: true } });
    expect(Date.now() - t0).toBeGreaterThan(6 * 60_000);
  });

  it("still ends a job that never completes, after the 30-minute window, with RECOVERY_TIMEOUT", async () => {
    const fetcher = vi.fn(async () => json(200, { status: "running", progress: 40 }));
    const pending = pollAnalysisJob("req_1795704701637_uqn41oybbso", { fetcher: fetcher as any }).catch((e) => e);
    let settled: any = undefined;
    pending.then((v) => { settled = v; });
    for (let i = 0; i < 4000 && settled === undefined; i++) await vi.advanceTimersByTimeAsync(10_000);
    expect(settled?.code).toBe("RECOVERY_TIMEOUT");
    expect(settled?.retryable).toBe(true);
  });
});
