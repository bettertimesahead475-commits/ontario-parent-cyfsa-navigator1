// Provider failure classification, customer error mapping, diagnostic redaction, the Anthropic streaming adapter's
// failure paths and the direct-analysis eligibility/salvage helpers. Mocked transport only; no paid inference.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyzerError, formatAnalyzerErrorResponse, logAnalyzerDiagnostic, providerErrorClass, providerFailure, redactDiagnostic } from "./services/analyzerErrors";
import { createCloudflareGenerateFn } from "../functions/api/_analyzer-model-adapter";
import { repairTruncatedJsonObject, runDirectAnalysis, salvagePartialDirectSections } from "./services/directAnalyzer";

afterEach(() => vi.restoreAllMocks());
const quiet = () => { for (const l of ["log", "warn", "error"] as const) vi.spyOn(console, l).mockImplementation(() => {}); };

describe("providerFailure classification", () => {
  it("maps each provider failure to a safe customer error with the right retry decision", () => {
    quiet();
    const cases: Array<[any, string, number, boolean]> = [
      [{ message: "Request timed out" }, "AI_PROVIDER_TEMPORARILY_UNAVAILABLE", 503, true],
      [Object.assign(new Error("x"), { name: "AbortError" }), "AI_PROVIDER_TEMPORARILY_UNAVAILABLE", 503, true],
      [{ status: 404, message: "model not found" }, "AI_PROVIDER_CONFIGURATION_ERROR", 503, false],
      [{ status: 413, message: "too large" }, "AI_REQUEST_REJECTED", 502, false],
      [{ status: 403, message: "region blocked" }, "AI_PROVIDER_TEMPORARILY_UNAVAILABLE", 503, true],
      [{ status: 403, message: "invalid api key" }, "AI_PROVIDER_CONFIGURATION_ERROR", 503, false],
    ];
    for (const [error, code, statusCode, retryable] of cases) {
      expect(providerFailure(error, "claude", { requestId: "r1", stage: "section:overview" })).toMatchObject({ code, statusCode, retryable });
    }
    const timedOut = providerFailure({ message: "timeout" }, "claude");
    expect(timedOut.userMessage).toContain("timed out");
  });

  it("reads the class name from the constructor, and falls back to name for plain objects", () => {
    class APIConnectionTimeoutError extends Error {}
    expect(providerErrorClass(new APIConnectionTimeoutError("x"))).toBe("APIConnectionTimeoutError");
    expect(providerErrorClass({ name: "TypeError" })).toBe("TypeError");
    expect(providerErrorClass(Object.create(null))).toBe("Error");
  });
});

describe("formatAnalyzerErrorResponse", () => {
  it("keeps explicit lifecycle errors, maps other lifecycle errors to a usage outage, and never returns raw text", () => {
    expect(formatAnalyzerErrorResponse({ name: "LifecycleError", code: "EMPTY_SOURCE", message: "No text.", statusCode: 422 })).toEqual({ code: "EMPTY_SOURCE", error: "No text.", statusCode: 422, retryable: false });
    expect(formatAnalyzerErrorResponse({ name: "LifecycleError", code: "INVALID_SOURCE", message: "Bad." })).toMatchObject({ statusCode: 400, retryable: false });
    expect(formatAnalyzerErrorResponse({ name: "LifecycleError", message: "" })).toMatchObject({ code: "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE", statusCode: 503, retryable: true });
    expect(formatAnalyzerErrorResponse({ statusCode: 403, message: "nope" })).toMatchObject({ code: "ACCESS_DENIED", statusCode: 403 });
    expect(formatAnalyzerErrorResponse(new Error("please sign in"))).toMatchObject({ code: "ACCESS_DENIED", statusCode: 401 });
    expect(formatAnalyzerErrorResponse(new Error("Unexpected token in JSON at position 4"))).toMatchObject({ code: "AI_RESPONSE_INVALID", statusCode: 422 });
    const internal = formatAnalyzerErrorResponse({ statusCode: 700, message: "weird secret-ish text" });
    expect(internal).toMatchObject({ code: "INTERNAL_ANALYSIS_ERROR", statusCode: 500 });
    expect(internal.error).not.toContain("secret");
    expect(formatAnalyzerErrorResponse("plain string failure")).toMatchObject({ code: "INTERNAL_ANALYSIS_ERROR", statusCode: 500 });
  });
});

describe("diagnostic redaction", () => {
  it("handles empty input and logs a null error without throwing", () => {
    expect(redactDiagnostic(null)).toBe("");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logAnalyzerDiagnostic("stage", null);
    expect(warn.mock.calls[0][0]).toContain("[analyzer] stage failed (error)");
  });
});

// ---- Anthropic adapter -----------------------------------------------------------------------------------------
const KEY = "sk-ant-api03-syntheticSyntheticSyntheticKey00";
const sse = (events: unknown[]) => new Response(events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const complete = (text = "{}") => [{ type: "message_start", message: { usage: { input_tokens: 3 } } }, { type: "content_block_delta", delta: { type: "text_delta", text } }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }, { type: "message_stop" }];
const generate = (fetcher: any, opts: Record<string, unknown> = {}) =>
  createCloudflareGenerateFn({ ANTHROPIC_API_KEY: KEY } as any, fetcher)({ system: "s", messages: [{ role: "user", content: [{ type: "text", text: "synthetic" }] }], max_tokens: 100, timeoutMs: 10_000, ...opts } as any, "claude-sonnet-5");

describe("Anthropic adapter failure paths", () => {
  it("skips empty and [DONE] data lines and returns the streamed text", async () => {
    const r = await generate(async () => sse(["", "[DONE]", ...complete('{"ok":true}')]));
    expect(r).toMatchObject({ text: '{"ok":true}', stopReason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } });
  });

  it("an error event or an unparseable event fails the call as retryable, never as a partial success", async () => {
    quiet();
    await expect(generate(async () => sse([complete()[0], { type: "error", error: { type: "overloaded_error" } }]))).rejects.toMatchObject({ code: "AI_PROVIDER_TEMPORARILY_UNAVAILABLE", retryable: true });
    await expect(generate(async () => sse([complete()[0], "{not json"]))).rejects.toMatchObject({ code: "AI_RESPONSE_INVALID", statusCode: 422 });
  });

  it("an oversized single event is rejected", async () => {
    quiet();
    const huge = JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "x".repeat(1_048_600) } });
    await expect(generate(async () => new Response(`data: ${huge}\n\ndata: {"type":"message_stop"}\n\n`, { headers: { "content-type": "text/event-stream" } }))).rejects.toMatchObject({ code: "AI_RESPONSE_INVALID" });
  });

  it("a non-streaming JSON reply is accepted only when complete", async () => {
    quiet();
    const json = (body: unknown) => async () => Response.json(body);
    expect(await generate(json({ content: [{ type: "text", text: "done" }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" }))).toMatchObject({ text: "done", stopReason: "end_turn" });
    await expect(generate(json({ content: [], stop_reason: "end_turn" }))).rejects.toMatchObject({ code: "AI_RESPONSE_INVALID" });
  });

  it("a billing rejection is a non-retryable configuration error and an unreadable error body is tolerated", async () => {
    quiet();
    await expect(generate(async () => new Response('{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}', { status: 400 }))).rejects.toMatchObject({ code: "AI_PROVIDER_CONFIGURATION_ERROR", retryable: false });
    const unreadable = { ok: false, status: 502, headers: new Headers(), text: async () => { throw new Error("socket closed"); } };
    await expect(generate(async () => unreadable)).rejects.toMatchObject({ code: "AI_PROVIDER_TEMPORARILY_UNAVAILABLE" });
  });

  it("does not retry when the remaining budget cannot cover the backoff", async () => {
    quiet();
    const fetcher = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(generate(fetcher, { retries: 3, timeoutMs: 1_500 })).rejects.toMatchObject({ code: "AI_PROVIDER_TEMPORARILY_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

// ---- Direct analysis helpers ------------------------------------------------------------------------------------
describe("direct analysis helpers", () => {
  it("reports why a document is not eligible, without calling the model", async () => {
    const reasons: string[] = [];
    const generateFn = vi.fn();
    const base = { mode: "fast" as const, primaryModel: "m", generate: generateFn, requestId: "d1", onFailureReason: (r: string) => reasons.push(r) };
    expect(await runDirectAnalysis({ ...base, documentText: "  ", deadlineAt: Date.now() + 60_000 })).toBeNull();
    expect(await runDirectAnalysis({ ...base, documentText: "x".repeat(75_001), deadlineAt: Date.now() + 60_000 })).toBeNull();
    expect(await runDirectAnalysis({ ...base, documentText: "Synthetic note.", deadlineAt: Date.now() + 1_000 })).toBeNull();
    expect(reasons).toEqual(["oversized", "oversized", "timeout"]);
    expect(generateFn).not.toHaveBeenCalled();
  });

  it("repairs a truncated object with escaped quotes, and salvage returns nothing for empty or unparseable text", () => {
    expect(repairTruncatedJsonObject("")).toBeNull();
    expect(repairTruncatedJsonObject('{"a": "he said \\"hi')).toEqual({ a: 'he said "hi' });
    expect(salvagePartialDirectSections("", "full").missingKeys).toEqual(["overview", "redFlags", "chronology", "guidance", "thresholds", "timeline"]);
    expect(salvagePartialDirectSections("no json here", "fast")).toEqual({ salvagedReport: {}, completedKeys: [], missingKeys: ["overview", "redFlags", "chronology", "guidance"] });
  });
});
