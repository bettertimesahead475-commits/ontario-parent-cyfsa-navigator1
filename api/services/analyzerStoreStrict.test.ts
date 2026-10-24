import { beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.fn();
const fakeDb = {
  storage: {
    listBuckets: vi.fn(async () => ({ data: [{ name: "analysis_jobs", public: false }], error: null })),
    updateBucket: vi.fn(),
    createBucket: vi.fn(),
    from: vi.fn(() => ({ upload })),
  },
};
const getSupabaseMock = vi.fn(() => fakeDb);

vi.mock("./access.js", async (orig) => ({
  ...(await orig<typeof import("./access.js")>()),
  getSupabase: () => getSupabaseMock(),
}));

const { storeCompletedJobStrict, getAnalysisJob } = await import("./analyzerStreaming.js");

beforeEach(() => {
  upload.mockReset();
  getSupabaseMock.mockReset();
  getSupabaseMock.mockImplementation(() => fakeDb);
});

describe("storeCompletedJobStrict", () => {
  it("resolves only after the record is uploaded", async () => {
    upload.mockResolvedValueOnce({ data: {}, error: null });
    await expect(
      storeCompletedJobStrict({ jobId: "req_1_abc", uid: "u1", mode: "full", report: { ok: true } }),
    ).resolves.toBeUndefined();
    expect(upload).toHaveBeenCalledWith("req_1_abc.json", expect.any(String), expect.objectContaining({ upsert: true }));
    const body = JSON.parse(upload.mock.calls[0][1]);
    expect(body).toMatchObject({ jobId: "req_1_abc", uid: "u1", status: "completed", report: { ok: true } });
  });

  it("throws when the upload is rejected, so the caller cannot report the job as stored", async () => {
    upload.mockResolvedValueOnce({ data: null, error: { message: "quota exceeded" } });
    await expect(
      storeCompletedJobStrict({ jobId: "req_2_abc", uid: "u1", mode: "full", report: {} }),
    ).rejects.toThrow("Job upload failed");
  });

  it("throws when storage is not configured", async () => {
    getSupabaseMock.mockImplementation(() => {
      throw new Error("not configured");
    });
    await expect(
      storeCompletedJobStrict({ jobId: "req_3_abc", uid: "u1", mode: "full", report: {} }),
    ).rejects.toThrow("Storage is not configured");
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not write a job into the in-memory store on failure", async () => {
    upload.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(
      storeCompletedJobStrict({ jobId: "req_4_abc", uid: "u1", mode: "full", report: {} }),
    ).rejects.toThrow();
    expect(getAnalysisJob("req_4_abc")).toBeNull();
  });
});
