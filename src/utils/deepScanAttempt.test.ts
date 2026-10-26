import { describe, expect, it } from "vitest";
import { clearDeepScanId, deepScanIdFor, isDeepScanAnalysisId, newDeepScanAnalysisId } from "./deepScanAttempt";

// The id must match the server's format, or the server cannot hold or recover the scan.
describe("deep scan attempt ids", () => {
  it("creates ids in the server's analysis id format", () => {
    const id = newDeepScanAnalysisId(1_770_000_000_000, () => 0.123456789);
    expect(isDeepScanAnalysisId(id)).toBe(true);
    expect(id).toMatch(/^req_1770000000000_[a-z0-9]{8}$/);
  });

  it("rejects malformed ids", () => {
    expect(isDeepScanAnalysisId("retry-id-12345")).toBe(false);
    expect(isDeepScanAnalysisId(undefined)).toBe(false);
  });

  it("reuses the id already in flight for a file, so a retry is recovered rather than repeated", () => {
    const first = deepScanIdFor({}, "file-1");
    const retry = deepScanIdFor(first.pending, "file-1");
    expect(retry.id).toBe(first.id);
    expect(retry.pending).toEqual(first.pending);
  });

  it("gives each file its own id", () => {
    const a = deepScanIdFor({}, "file-a");
    const b = deepScanIdFor(a.pending, "file-b");
    expect(b.id).not.toBe(a.id);
    expect(Object.keys(b.pending).sort()).toEqual(["file-a", "file-b"]);
  });

  it("replaces a malformed stored id rather than sending it", () => {
    const { id } = deepScanIdFor({ "file-1": "bad" }, "file-1");
    expect(isDeepScanAnalysisId(id)).toBe(true);
  });

  it("forgets a file's id once its scan has finished, so the next scan starts fresh", () => {
    const started = deepScanIdFor({}, "file-1");
    const cleared = clearDeepScanId(started.pending, "file-1");
    expect(cleared).toEqual({});
    expect(deepScanIdFor(cleared, "file-1").id).not.toBe(started.id);
  });
});
