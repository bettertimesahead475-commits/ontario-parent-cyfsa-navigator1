// Durable job storage and billing holds. Supabase reports upload failures in the returned `error`, not as a thrown
// exception, so these tests fail the upload that way: a silent failure would make a held report look safe.
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  uploadError: null as null | { message: string },
  uploads: [] as Array<{ path: string; body: string }>,
}));

vi.mock("./access.js", () => ({
  getSupabase: () => ({
    storage: {
      listBuckets: async () => ({ data: [{ name: "analysis_jobs", public: false }], error: null }),
      updateBucket: async () => ({ error: null }),
      createBucket: async () => ({ error: null }),
      from: () => ({
        upload: async (path: string, body: string) => {
          storage.uploads.push({ path, body });
          return storage.uploadError ? { data: null, error: storage.uploadError } : { data: { path }, error: null };
        },
        download: async () => ({ data: null, error: { message: "not found" } }),
      }),
    },
  }),
}));

const streaming = await import("./analyzerStreaming.js");

const JOB_ID = "req_1792951000000_billingtest";
const BILLING = { sessionId: "11111111-1111-4111-8111-111111111111", tier: "Premium", reservationId: "marker-1", documentName: "a.pdf" };
const REPORT = { documentTitle: "Affidavit", redFlags: [{ phraseDetected: "x" }] };

async function freshJob() {
  // A job created by this instance, as the analyze route does before any model call.
  await streaming.createAnalysisJobDurable({ jobId: JOB_ID, uid: "parent-uid", mode: "fast" } as any);
}

beforeEach(() => {
  storage.uploadError = null;
  storage.uploads.length = 0;
});

describe("silent persistence failures are no longer silent", () => {
  it("reports a durable write as failed when Supabase returns an upload error", async () => {
    await freshJob();
    storage.uploadError = { message: "bucket quota exceeded" };
    const job = { jobId: JOB_ID, uid: "parent-uid", status: "analyzing" } as any;
    await expect(streaming.persistJobToStorageStrict(job)).resolves.toBe(false);
  });

  it("reports a durable write as stored when the upload succeeds", async () => {
    const job = { jobId: JOB_ID, uid: "parent-uid", status: "analyzing" } as any;
    await expect(streaming.persistJobToStorageStrict(job)).resolves.toBe(true);
  });
});

describe("holding a validated report for billing", () => {
  it("holds the report only when the hold is durably stored", async () => {
    await freshJob();
    const held = await streaming.holdAnalysisJobForBilling(JOB_ID, REPORT, BILLING);
    expect(held).toBe(true);
    const stored = JSON.parse(storage.uploads[storage.uploads.length - 1].body);
    expect(stored.status).toBe("billing_pending");
    expect(stored.heldReport).toEqual(REPORT);
  });

  it("refuses to hold when the durable write fails, and leaves the job unchanged (fail closed)", async () => {
    await freshJob();
    storage.uploadError = { message: "unavailable" };
    const held = await streaming.holdAnalysisJobForBilling(JOB_ID, REPORT, BILLING);
    expect(held).toBe(false);
    // Nothing is held in memory either, so the caller cannot deliver the report.
    storage.uploadError = null;
    const completed = await streaming.completeHeldAnalysisJob({ jobId: JOB_ID, status: "analyzing" } as any);
    expect(completed).toBeNull();
  });
});

describe("the public job view never carries a held report", () => {
  it("removes the held report and the billing record", () => {
    const job = { jobId: JOB_ID, uid: "u", status: "billing_pending", heldReport: REPORT, billing: BILLING, percent: 99 } as any;
    const pub = streaming.publicAnalysisJob(job) as any;
    expect(pub).not.toHaveProperty("heldReport");
    expect(pub).not.toHaveProperty("billing");
    expect(pub.report).toBeUndefined();
    expect(pub.status).toBe("billing_pending");
  });

  it("keeps a completed report visible, because the credit was confirmed", () => {
    const job = { jobId: JOB_ID, uid: "u", status: "completed", report: REPORT } as any;
    expect((streaming.publicAnalysisJob(job) as any).report).toEqual(REPORT);
  });
});

describe("completing a held job after billing is confirmed", () => {
  it("returns the held report once, marks the job completed, and drops the hold", async () => {
    await freshJob();
    await streaming.holdAnalysisJobForBilling(JOB_ID, REPORT, BILLING);
    const job = { jobId: JOB_ID, uid: "parent-uid", status: "billing_pending", heldReport: REPORT, billing: BILLING } as any;
    const delivered = await streaming.completeHeldAnalysisJob(job);
    expect(delivered).toEqual(REPORT);
    expect(job.status).toBe("completed");
    expect(job).not.toHaveProperty("heldReport");
    expect(job).not.toHaveProperty("billing");
    expect(job.report).toEqual(REPORT);
    // A second completion finds nothing held, so the report cannot be delivered from the hold twice.
    expect(await streaming.completeHeldAnalysisJob(job)).toBeNull();
  });

  it("does nothing for a job that holds no report", async () => {
    const job = { jobId: JOB_ID, uid: "u", status: "analyzing" } as any;
    expect(await streaming.completeHeldAnalysisJob(job)).toBeNull();
  });
});
