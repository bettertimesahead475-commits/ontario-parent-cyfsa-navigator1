// DEVIN-PERF-03: account-isolated report cache keys and policy. Synthetic data only.
import { describe, expect, it } from "vitest";
import {
  REPORT_CACHE_KEY_VERSION,
  documentFingerprint,
  evaluateCacheEntry,
  presentCachedReport,
  reportCacheKey,
  type ReportCacheEntry,
  type ReportCacheVersions,
} from "../../functions/api/_report-cache";

const SECRET = "s".repeat(40);
const VERSIONS: ReportCacheVersions = {
  mode: "full", analyzerVersion: "sections-2026-11-26", promptVersion: "p1", primaryModel: "claude-opus-5",
  verificationModel: "claude-opus-5", legalReferenceVersion: "CYFSA-2026-06-24", legalEffectiveDate: "2026-06-24",
};
const NOW = Date.parse("2026-11-26T12:00:00Z");

async function entryFor(owner: string, text: string, overrides: Partial<ReportCacheEntry> = {}): Promise<ReportCacheEntry> {
  const fp = await documentFingerprint(SECRET, owner, text);
  return {
    ownerUid: owner, cacheKey: await reportCacheKey(SECRET, owner, fp, VERSIONS), jobId: "req_1", status: "completed",
    completedAt: "2026-11-20T10:00:00.000Z", expiresAt: "2026-12-20T10:00:00.000Z", deletedAt: null,
    keyVersion: REPORT_CACHE_KEY_VERSION, ...overrides,
  };
}

describe("report cache fingerprints", () => {
  it("binds the fingerprint to the owner, so accounts cannot match each other's documents", async () => {
    const a = await documentFingerprint(SECRET, "uid_a", "Synthetic affidavit text.");
    const b = await documentFingerprint(SECRET, "uid_b", "Synthetic affidavit text.");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("changes on any word change but not on line-ending style", async () => {
    const base = await documentFingerprint(SECRET, "uid_a", "Line one\nLine two");
    expect(await documentFingerprint(SECRET, "uid_a", "Line one\r\nLine two")).toBe(base);
    expect(await documentFingerprint(SECRET, "uid_a", "Line one\nLine 2")).not.toBe(base);
    expect(await documentFingerprint(SECRET, "uid_a", "Line one\nLine two ")).not.toBe(base);
  });

  it("refuses a missing owner or a short secret", async () => {
    await expect(documentFingerprint(SECRET, "", "x")).rejects.toThrow();
    await expect(documentFingerprint("short", "uid_a", "x")).rejects.toThrow();
  });

  it("gives a different key for every version input", async () => {
    const fp = await documentFingerprint(SECRET, "uid_a", "Doc");
    const base = await reportCacheKey(SECRET, "uid_a", fp, VERSIONS);
    const changes: Partial<ReportCacheVersions>[] = [
      { mode: "fast" }, { analyzerVersion: "x" }, { promptVersion: "p2" }, { primaryModel: "claude-sonnet-5" },
      { verificationModel: null }, { legalReferenceVersion: "CYFSA-2027-01-01" }, { legalEffectiveDate: "2027-01-01" },
    ];
    for (const c of changes) expect(await reportCacheKey(SECRET, "uid_a", fp, { ...VERSIONS, ...c })).not.toBe(base);
    await expect(reportCacheKey(SECRET, "uid_a", fp, { ...VERSIONS, promptVersion: "" })).rejects.toThrow();
  });
});

describe("report cache policy", () => {
  it("uses only a completed, unexpired, undeleted entry of the same owner and key", async () => {
    const e = await entryFor("uid_a", "Doc");
    expect(evaluateCacheEntry(e, { ownerUid: "uid_a", cacheKey: e.cacheKey, now: NOW })).toEqual({ usable: true });
    expect(evaluateCacheEntry(e, { ownerUid: "uid_b", cacheKey: e.cacheKey, now: NOW })).toMatchObject({ reason: "OWNER_MISMATCH" });
    expect(evaluateCacheEntry(e, { ownerUid: "", cacheKey: e.cacheKey, now: NOW })).toMatchObject({ reason: "OWNER_MISMATCH" });
    expect(evaluateCacheEntry(e, { ownerUid: "uid_a", cacheKey: "other", now: NOW })).toMatchObject({ reason: "KEY_MISMATCH" });
    expect(evaluateCacheEntry({ ...e, deletedAt: "2026-11-21T00:00:00Z" }, { ownerUid: "uid_a", cacheKey: e.cacheKey, now: NOW })).toMatchObject({ reason: "DELETED" });
    expect(evaluateCacheEntry({ ...e, expiresAt: "2026-11-25T00:00:00Z" }, { ownerUid: "uid_a", cacheKey: e.cacheKey, now: NOW })).toMatchObject({ reason: "EXPIRED" });
    expect(evaluateCacheEntry({ ...e, expiresAt: "not a date" }, { ownerUid: "uid_a", cacheKey: e.cacheKey, now: NOW })).toMatchObject({ reason: "EXPIRED" });
    expect(evaluateCacheEntry({ ...e, status: "running" }, { ownerUid: "uid_a", cacheKey: e.cacheKey, now: NOW })).toMatchObject({ reason: "NOT_COMPLETED" });
    expect(evaluateCacheEntry({ ...e, keyVersion: "v0" }, { ownerUid: "uid_a", cacheKey: e.cacheKey, now: NOW })).toMatchObject({ reason: "KEY_VERSION" });
  });

  it("presents a hit as a previously completed report with its original time and no charge", async () => {
    const e = await entryFor("uid_a", "Doc");
    const out = presentCachedReport({ documentTitle: "T" }, e, NOW);
    expect(out.delivery).toEqual({ source: "previously_completed", originalJobId: "req_1", originalCompletedAt: "2026-11-20T10:00:00.000Z", retrievedAt: "2026-11-26T12:00:00.000Z", creditsCharged: 0 });
    expect(out.documentTitle).toBe("T");
  });
});
