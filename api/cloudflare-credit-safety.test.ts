import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYSIS_JOBS_BUCKET, saveCompletedJob, jobObjectUrl } from "../functions/api/_analysis-jobs";

const verify = vi.fn();
vi.mock("../functions/api/_auth-check", () => ({ verifyFirebaseRequest: (...a: unknown[]) => verify(...a) }));
const { handleExtractRequest } = await import("../functions/api/extract-text");

const png = fs.readFileSync(path.resolve(__dirname, "../tests/fixtures/synthetic/06-image.png")).toString("base64");
const req = () => new Request("https://s/api/extract-text", { method: "POST", headers: { Authorization: "Bearer a.b.c" }, body: JSON.stringify({ fileData: { base64: png, mimeType: "image/png", fileName: "p.png" } }) });

describe("credit safety: extraction never touches credits", () => {
  afterEach(() => verify.mockReset());

  it.each([
    ["Gemini 404", () => new Response('{"error":{"message":"models/gemini-2.0-flash is no longer available"}}', { status: 404 })],
    ["Gemini 429", () => new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 })],
    ["Gemini 500", () => new Response("{}", { status: 500 })],
    ["timeout", () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }],
    ["empty OCR", () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "[no text]" }] } }] }), { status: 200 })],
  ])("%s: the only outbound call is to Gemini; no credit RPC, no storage write", async (_name, respond) => {
    verify.mockResolvedValue({ status: "verified", uid: "u", email: null, emailVerified: false });
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return (respond as any)();
    });
    const res = await handleExtractRequest(req(), { FIREBASE_PROJECT_ID: "p", GEMINI_API_KEY: "k", STAGING_SUPABASE_URL: "https://x.supabase.co", STAGING_SUPABASE_SERVICE_ROLE_KEY: "svc" } as any, { fetcher: fetcher as any });
    expect(res.ok).toBe(false);
    expect(urls.every((u) => u.startsWith("https://generativelanguage.googleapis.com/"))).toBe(true);
    expect(urls.some((u) => /supabase|rpc|free_|paid_/.test(u))).toBe(false);
  });

  it("a malformed PDF is refused before any outbound call", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "u", email: null, emailVerified: false });
    const fetcher = vi.fn();
    const bad = fs.readFileSync(path.resolve(__dirname, "../tests/fixtures/synthetic/07-malformed.pdf")).toString("base64");
    const r = new Request("https://s/api/extract-text", { method: "POST", headers: { Authorization: "Bearer a.b.c" }, body: JSON.stringify({ fileData: { base64: bad, mimeType: "application/pdf" } }) });
    expect((await handleExtractRequest(r, { FIREBASE_PROJECT_ID: "p", GEMINI_API_KEY: "k" }, { fetcher: fetcher as any })).status).toBe(422);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("analysis job persistence", () => {
  it("writes to the bucket that exists (analysis_jobs), and reports a failed save", async () => {
    expect(ANALYSIS_JOBS_BUCKET).toBe("analysis_jobs");
    expect(jobObjectUrl("https://x.supabase.co", "req_123456789", "read")).toBe("https://x.supabase.co/storage/v1/object/authenticated/analysis_jobs/req_123456789.json");
    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await saveCompletedJob({ STAGING_SUPABASE_URL: "https://x.supabase.co", STAGING_SUPABASE_SERVICE_ROLE_KEY: "svc" }, { jobId: "req_123456789", uid: "u", report: {} }, ok as any)).toBe(true);
    expect(String((ok.mock.calls[0] as any)[0])).toBe("https://x.supabase.co/storage/v1/object/analysis_jobs/req_123456789.json");
    const missing = vi.fn(async () => new Response('{"error":"Bucket not found"}', { status: 404 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveCompletedJob({ STAGING_SUPABASE_URL: "https://x.supabase.co", STAGING_SUPABASE_SERVICE_ROLE_KEY: "svc" }, { jobId: "req_123456789", uid: "u", report: { secret: "report text" } }, missing as any)).toBe(false);
    expect(log.mock.calls.flat().join(" ")).not.toContain("report text");
    log.mockRestore();
  });
});
