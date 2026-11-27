// Legacy Express path (api/_server.ts): job state in the private Supabase storage bucket, and the SSE emitter.
// A job file holds the customer's report, so the bucket must be private even if it was created public.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const db = vi.hoisted(() => ({ current: null as any }));
vi.mock("./services/access.js", () => ({ getSupabase: () => { if (!db.current) throw new Error("unconfigured"); return db.current; } }));

function fakeStorage(buckets: any[] | null, opts: { createError?: any; files?: Record<string, string> } = {}) {
  const files = opts.files ?? {};
  const storage = {
    listBuckets: vi.fn(async () => ({ data: buckets })),
    updateBucket: vi.fn(async () => ({ error: null })),
    createBucket: vi.fn(async () => ({ error: opts.createError ?? null })),
    upload: vi.fn(async (name: string, body: string) => { files[name] = body; return { error: null }; }),
    download: vi.fn(async (name: string) => files[name] ? { data: new Blob([files[name]]), error: null } : { data: null, error: { message: "not found" } }),
  };
  return { storage: { ...storage, from: () => storage }, raw: storage, files };
}

let mod: typeof import("./services/analyzerStreaming");
beforeEach(async () => { vi.resetModules(); db.current = null; mod = await import("./services/analyzerStreaming"); });
afterEach(() => vi.useRealTimers());

const job = (jobId: string) => ({ jobId, uid: "u", mode: "fast", status: "running", createdAt: Date.now() } as any);

describe("job storage", () => {
  it("makes an existing public bucket private before writing a job to it, then reads the job back", async () => {
    const s = fakeStorage([{ name: "analysis_jobs", public: true }]);
    db.current = { storage: s.storage };
    await mod.persistJobToStorage(job("a1"));
    expect(s.raw.updateBucket).toHaveBeenCalledWith("analysis_jobs", { public: false });
    expect(s.raw.updateBucket.mock.invocationCallOrder[0]).toBeLessThan(s.raw.upload.mock.invocationCallOrder[0]);
    expect((await mod.fetchJobFromStorage("a1"))?.jobId).toBe("a1");
    expect(await mod.fetchJobFromStorage("missing")).toBeNull();
    expect(s.raw.listBuckets).toHaveBeenCalledTimes(1);
  });

  it("creates the bucket private, accepts 'already exists', and writes nothing when creation fails", async () => {
    const created = fakeStorage([]);
    db.current = { storage: created.storage };
    await mod.persistJobToStorage(job("b1"));
    expect(created.raw.createBucket).toHaveBeenCalledWith("analysis_jobs", { public: false });
    expect(created.files["b1.json"]).toBeDefined();

    vi.resetModules(); mod = await import("./services/analyzerStreaming");
    const exists = fakeStorage(null, { createError: { message: "The resource already exists" } });
    db.current = { storage: exists.storage };
    await mod.persistJobToStorage(job("b2"));
    expect(exists.files["b2.json"]).toBeDefined();

    vi.resetModules(); mod = await import("./services/analyzerStreaming");
    const denied = fakeStorage([], { createError: { message: "permission denied" } });
    db.current = { storage: denied.storage };
    await mod.persistJobToStorage(job("b3"));
    expect(denied.raw.upload).not.toHaveBeenCalled();
    expect(await mod.fetchJobFromStorage("b3")).toBeNull();
  });

  it("storage failures never throw into the analysis; unconfigured storage is skipped", async () => {
    await expect(mod.persistJobToStorage(job("c0"))).resolves.toBeUndefined();
    expect(await mod.fetchJobFromStorage("c0")).toBeNull();
    const s = fakeStorage([{ name: "analysis_jobs", public: false }]);
    s.raw.upload.mockRejectedValueOnce(new Error("network"));
    s.raw.download.mockRejectedValueOnce(new Error("network"));
    db.current = { storage: s.storage };
    await expect(mod.persistJobToStorage(job("c1"))).resolves.toBeUndefined();
    expect(await mod.fetchJobFromStorage("c1")).toBeNull();
    vi.resetModules(); mod = await import("./services/analyzerStreaming");
    db.current = { storage: { listBuckets: async () => { throw new Error("down"); } } };
    expect(await mod.fetchJobFromStorage("c2")).toBeNull();
  });

  it("durable lookup falls back to storage when the job is not in memory", async () => {
    const s = fakeStorage([{ name: "analysis_jobs", public: false }], { files: { "d1.json": JSON.stringify(job("d1")) } });
    db.current = { storage: s.storage };
    expect((await mod.getAnalysisJobDurable("d1"))?.jobId).toBe("d1");
    expect(mod.getAnalysisJob("d1")?.jobId).toBe("d1");
  });
});

describe("SSE emitter", () => {
  function res() {
    const r: any = new EventEmitter();
    r.writes = [] as string[];
    r.setHeader = vi.fn(); r.flushHeaders = vi.fn(); r.writeHead = vi.fn(); r.end = vi.fn();
    r.write = (chunk: string) => { r.writes.push(chunk); return true; };
    r.flush = () => { throw new Error("no flush"); };
    return r;
  }
  it("sends keep-alives until the client disconnects, then stops writing", () => {
    vi.useFakeTimers();
    const r = res();
    mod.createAnalysisJob({ jobId: "e1", uid: "u", mode: "fast" });
    const emitter = new mod.SseStreamEmitter(r, "e1");
    vi.advanceTimersByTime(10_000);
    expect(r.writes.filter((w: string) => w.includes("keep-alive"))).toHaveLength(2);
    emitter.emitStage("reviewing_evidence", "Working", 42.6);
    expect(JSON.parse(r.writes.at(-1).slice(6))).toMatchObject({ type: "stage", percent: 43, message: "Working" });
    expect(mod.getAnalysisJob("e1")?.percent).toBe(43);
    r.emit("close");
    const count = r.writes.length;
    vi.advanceTimersByTime(10_000);
    emitter.emitSection("overview", {});
    emitter.emitError({ code: "X", message: "m", statusCode: 500, retryable: false });
    emitter.emitWithheld({ code: "X", message: "m", statusCode: 500, retryable: false });
    expect(r.writes.length).toBe(count);
  });
});
