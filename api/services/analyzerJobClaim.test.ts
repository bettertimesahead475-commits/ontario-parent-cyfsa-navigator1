import { beforeEach, describe, expect, it, vi } from "vitest";

// A small bucket whose upload honours upsert:false the way Supabase Storage does.
const objects = new Map<string, string>();
let uploadError: { message: string; statusCode?: string } | null = null;
let downloadFails = false;
let uploadThrows = false;
const uploads: { name: string; upsert: boolean }[] = [];

const fakeDb = {
  storage: {
    listBuckets: vi.fn(async () => ({ data: [{ name: "analysis_jobs", public: false }], error: null })),
    updateBucket: vi.fn(),
    createBucket: vi.fn(),
    from: vi.fn(() => ({
      upload: vi.fn(async (name: string, body: string, options: { upsert?: boolean }) => {
        uploads.push({ name, upsert: Boolean(options?.upsert) });
        if (uploadThrows) throw new Error("fetch failed");
        if (uploadError) return { data: null, error: uploadError };
        if (!options?.upsert && objects.has(name)) {
          return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
        }
        objects.set(name, body);
        return { data: {}, error: null };
      }),
      download: vi.fn(async (name: string) => {
        if (downloadFails) return { data: null, error: { message: "network" } };
        const body = objects.get(name);
        return body === undefined ? { data: null, error: { message: "not found" } } : { data: { text: async () => body }, error: null };
      }),
    })),
  },
};
const getSupabaseMock = vi.fn(() => fakeDb as unknown);

vi.mock("./access.js", async (orig) => ({
  ...(await orig<typeof import("./access.js")>()),
  getSupabase: () => getSupabaseMock(),
}));

const { claimAnalysisJobDurable, getAnalysisJob, completeAnalysisJobDurable, completeAnalysisJobStrict, updateAnalysisJobStage } =
  await import("./analyzerStreaming.js");

const stored = (jobId: string, uid: string | null, status = "analyzing") =>
  JSON.stringify({ jobId, uid, mode: "fast", status, createdAt: 1, updatedAt: 1 });

beforeEach(() => {
  objects.clear();
  uploads.length = 0;
  uploadError = null;
  downloadFails = false;
  uploadThrows = false;
  getSupabaseMock.mockImplementation(() => fakeDb as unknown);
});

describe("claimAnalysisJobDurable", () => {
  it("creates a new job with an exclusive write", async () => {
    const job = await claimAnalysisJobDurable({ jobId: "req_1700000000001_aaaa", uid: "owner", mode: "fast" });
    expect(job.uid).toBe("owner");
    expect(uploads).toEqual([{ name: "req_1700000000001_aaaa.json", upsert: false }]);
    expect(JSON.parse(objects.get("req_1700000000001_aaaa.json")!).uid).toBe("owner");
    expect(getAnalysisJob("req_1700000000001_aaaa")?.uid).toBe("owner");
  });

  it("refuses an id another instance already created for a different account, and overwrites nothing", async () => {
    // Cross-instance case: Storage holds the other account's job, this instance's memory does not.
    objects.set("req_1700000000002_bbbb.json", stored("req_1700000000002_bbbb", "victim"));
    await expect(claimAnalysisJobDurable({ jobId: "req_1700000000002_bbbb", uid: "attacker", mode: "fast" }))
      .rejects.toMatchObject({ code: "ANALYSIS_ID_CONFLICT", statusCode: 409 });
    expect(JSON.parse(objects.get("req_1700000000002_bbbb.json")!).uid).toBe("victim");
    expect(uploads.every(u => !u.upsert)).toBe(true);
    // Reading the real owner's record may cache it here, but it is never recorded under the attacker.
    expect(getAnalysisJob("req_1700000000002_bbbb")?.uid ?? "victim").toBe("victim");
  });

  it("fails closed, with a retryable error, when the existing record cannot be read", async () => {
    objects.set("req_1700000000003_cccc.json", stored("req_1700000000003_cccc", "victim"));
    downloadFails = true;
    await expect(claimAnalysisJobDurable({ jobId: "req_1700000000003_cccc", uid: "attacker", mode: "fast" }))
      .rejects.toMatchObject({ code: "ANALYSIS_PERSISTENCE_FAILED", statusCode: 503, retryable: true });
    expect(JSON.parse(objects.get("req_1700000000003_cccc.json")!).uid).toBe("victim");
    expect(uploads.every(u => !u.upsert)).toBe(true);
  });

  it("does not turn an unreadable record into permission for the real owner either", async () => {
    objects.set("req_1700000000008_hhhh.json", stored("req_1700000000008_hhhh", "owner", "failed"));
    downloadFails = true;
    await expect(claimAnalysisJobDurable({ jobId: "req_1700000000008_hhhh", uid: "owner", mode: "fast" }))
      .rejects.toMatchObject({ retryable: true }); // the owner can simply retry
    downloadFails = false;
    const job = await claimAnalysisJobDurable({ jobId: "req_1700000000008_hhhh", uid: "owner", mode: "fast" });
    expect(job.status).toBe("analyzing");
  });

  it("lets the same account replace its own failed or stale job", async () => {
    objects.set("req_1700000000004_dddd.json", stored("req_1700000000004_dddd", "owner", "failed"));
    const job = await claimAnalysisJobDurable({ jobId: "req_1700000000004_dddd", uid: "owner", mode: "fast" });
    expect(job.status).toBe("analyzing");
    expect(JSON.parse(objects.get("req_1700000000004_dddd.json")!).status).toBe("analyzing");
  });

  it("refuses to take over a job held in this instance's memory", async () => {
    await claimAnalysisJobDurable({ jobId: "req_1700000000005_eeee", uid: "owner", mode: "fast" });
    await expect(claimAnalysisJobDurable({ jobId: "req_1700000000005_eeee", uid: "other", mode: "fast" }))
      .rejects.toMatchObject({ code: "ANALYSIS_ID_CONFLICT" });
    expect(getAnalysisJob("req_1700000000005_eeee")?.uid).toBe("owner");
  });

  it("keeps the existing best-effort behaviour when Storage is unavailable", async () => {
    getSupabaseMock.mockImplementation(() => { throw new Error("not configured"); });
    const job = await claimAnalysisJobDurable({ jobId: "req_1700000000006_ffff", uid: "owner", mode: "fast" });
    expect(job.uid).toBe("owner");
    expect(getAnalysisJob("req_1700000000006_ffff")?.uid).toBe("owner");
  });

  it("does not block an analysis on an unrelated storage error, but the job never writes to Storage", async () => {
    uploadError = { message: "service unavailable", statusCode: "503" };
    const job = await claimAnalysisJobDurable({ jobId: "req_1700000000007_gggg", uid: "owner", mode: "fast" });
    expect(job.uid).toBe("owner");
    // Storage recovers and another account's record appears. This job must not overwrite it.
    uploadError = null;
    objects.set("req_1700000000007_gggg.json", stored("req_1700000000007_gggg", "victim"));
    const before = uploads.length;
    updateAnalysisJobStage("req_1700000000007_gggg", "reviewing_evidence");
    await completeAnalysisJobDurable("req_1700000000007_gggg", { documentTitle: "mine" });
    expect(uploads.length).toBe(before);
    expect(JSON.parse(objects.get("req_1700000000007_gggg.json")!).uid).toBe("victim");
    expect(getAnalysisJob("req_1700000000007_gggg")?.status).toBe("completed"); // the analysis itself still completes
  });

  it("treats a thrown network error during the claim as no claim: memory-only, never written later", async () => {
    uploadThrows = true;
    const job = await claimAnalysisJobDurable({ jobId: "req_1700000000009_iiii", uid: "owner", mode: "fast" });
    expect(job.uid).toBe("owner");
    uploadThrows = false;
    objects.set("req_1700000000009_iiii.json", stored("req_1700000000009_iiii", "victim"));
    const before = uploads.length;
    await completeAnalysisJobDurable("req_1700000000009_iiii", { documentTitle: "mine" });
    expect(uploads.length).toBe(before);
    expect(JSON.parse(objects.get("req_1700000000009_iiii.json")!).uid).toBe("victim");
  });

  it("keeps a job memory-only when Storage was not configured at claim time, even if it appears mid-run", async () => {
    getSupabaseMock.mockImplementation(() => { throw new Error("not configured"); });
    await claimAnalysisJobDurable({ jobId: "req_1700000000010_jjjj", uid: "owner", mode: "fast" });
    getSupabaseMock.mockImplementation(() => fakeDb as unknown); // Storage becomes available
    objects.set("req_1700000000010_jjjj.json", stored("req_1700000000010_jjjj", "victim"));
    await completeAnalysisJobDurable("req_1700000000010_jjjj", { documentTitle: "mine" });
    expect(uploads).toEqual([]);
    expect(JSON.parse(objects.get("req_1700000000010_jjjj.json")!).uid).toBe("victim");
  });

  it("refuses a strict (confirmed-stored) completion for a memory-only job, so no parent view id is offered", async () => {
    uploadError = { message: "service unavailable", statusCode: "503" };
    await claimAnalysisJobDurable({ jobId: "req_1700000000011_kkkk", uid: "owner", mode: "fast" });
    uploadError = null;
    await expect(completeAnalysisJobStrict("req_1700000000011_kkkk", { documentTitle: "mine" })).rejects.toThrow();
    expect(objects.has("req_1700000000011_kkkk.json")).toBe(false);
  });

  it("a later successful exclusive claim of the same id by the same account is no longer memory-only", async () => {
    uploadError = { message: "service unavailable", statusCode: "503" };
    await claimAnalysisJobDurable({ jobId: "req_1700000000012_llll", uid: "owner", mode: "fast" });
    uploadError = null;
    await claimAnalysisJobDurable({ jobId: "req_1700000000012_llll", uid: "owner", mode: "fast" });
    expect(objects.has("req_1700000000012_llll.json")).toBe(true);
  });
});
