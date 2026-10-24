import { beforeEach, describe, expect, it, vi } from "vitest";

// A small bucket whose upload honours upsert:false the way Supabase Storage does.
const objects = new Map<string, string>();
let uploadError: { message: string; statusCode?: string } | null = null;
let downloadFails = false;
const uploads: { name: string; upsert: boolean }[] = [];

const fakeDb = {
  storage: {
    listBuckets: vi.fn(async () => ({ data: [{ name: "analysis_jobs", public: false }], error: null })),
    updateBucket: vi.fn(),
    createBucket: vi.fn(),
    from: vi.fn(() => ({
      upload: vi.fn(async (name: string, body: string, options: { upsert?: boolean }) => {
        uploads.push({ name, upsert: Boolean(options?.upsert) });
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

const { claimAnalysisJobDurable, getAnalysisJob } = await import("./analyzerStreaming.js");

const stored = (jobId: string, uid: string | null, status = "analyzing") =>
  JSON.stringify({ jobId, uid, mode: "fast", status, createdAt: 1, updatedAt: 1 });

beforeEach(() => {
  objects.clear();
  uploads.length = 0;
  uploadError = null;
  downloadFails = false;
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

  it("fails closed when the existing record cannot be read", async () => {
    objects.set("req_1700000000003_cccc.json", stored("req_1700000000003_cccc", "victim"));
    downloadFails = true;
    await expect(claimAnalysisJobDurable({ jobId: "req_1700000000003_cccc", uid: "attacker", mode: "fast" }))
      .rejects.toMatchObject({ code: "ANALYSIS_ID_CONFLICT" });
    expect(JSON.parse(objects.get("req_1700000000003_cccc.json")!).uid).toBe("victim");
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

  it("does not block an analysis on an unrelated storage error", async () => {
    uploadError = { message: "service unavailable", statusCode: "503" };
    const job = await claimAnalysisJobDurable({ jobId: "req_1700000000007_gggg", uid: "owner", mode: "fast" });
    expect(job.uid).toBe("owner");
  });
});
