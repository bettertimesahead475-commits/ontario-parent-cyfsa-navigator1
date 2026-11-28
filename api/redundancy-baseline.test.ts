/**
 * Baseline for analysis reuse across levels (mocked provider, no spend). Counts provider calls and transmitted
 * characters for each scenario on the current code. Reuse is not implemented yet, so these are the figures that
 * reuse would have to beat. Output goes to REDUNDANCY_OUT when set.
 */
import { describe, expect, it, vi } from "vitest";
import { runSectionedAnalysis, type GenerateFn } from "./services/analyzerSections.js";
import { COMPLETE_ANALYSIS, VERIFICATION_RESULT, completeVerification, isVerificationRequest, requestedSection } from "./analyzerTestFixtures.js";
import { writeFileSync } from "node:fs";

const PARA = "On March 3, 2026 a neighbour told the worker that the child was left alone for several hours. The worker did not attend. ";
const DOC = Array.from({ length: 50 }, (_, i) => `Page ${i + 1}\n` + PARA.repeat(24)).join("\n");

function counter() {
  const calls: Array<{ kind: string; chars: number }> = [];
  const generate = vi.fn(async (params: any) => {
    const kind = isVerificationRequest(params) ? "verification" : `section:${requestedSection(params)}`;
    calls.push({ kind, chars: JSON.stringify(params.messages ?? "").length });
    const body = isVerificationRequest(params) ? completeVerification(VERIFICATION_RESULT as any, params) : COMPLETE_ANALYSIS;
    return { text: JSON.stringify(body), usage: { input_tokens: 10, output_tokens: 5 }, model: "m", durationMs: 1, stopReason: "end_turn" };
  }) as unknown as GenerateFn;
  return { generate, calls };
}

async function run(mode: "fast" | "full", documentText: string, generate: GenerateFn) {
  return runSectionedAnalysis({
    mode, documentText, primaryModel: "claude-sonnet-5", verificationModel: mode === "full" ? "claude-opus-5" : undefined,
    generate, deadlineAt: Date.now() + 200_000, requestId: "req_redundancy",
  } as any);
}

describe("analysis reuse baseline (current code, mocked provider)", () => {
  it("measures the five scenarios", async () => {
    const rows: Record<string, unknown>[] = [];
    const summarise = (name: string, calls: Array<{ kind: string; chars: number }>) => ({
      scenario: name, providerCalls: calls.length,
      verificationCalls: calls.filter((c) => c.kind === "verification").length,
      transmittedChars: calls.reduce((s, c) => s + c.chars, 0),
      documentChars: DOC.length,
      extractionOperations: 0, // the analyzer receives text; extraction runs once per upload in /api/extract-text
      ocrOperations: 0,
    });

    const a = counter(); await run("fast", DOC, a.generate);
    rows.push(summarise("1 Basic Review, fresh document", a.calls));

    const b = counter(); await run("full", DOC, b.generate);
    rows.push(summarise("2 Deep Scan, fresh document", b.calls));

    // Deep Scan after Basic in the same account: today nothing is shared, so both runs are paid in full.
    const c1 = counter(); await run("fast", DOC, c1.generate);
    const c2 = counter(); await run("full", DOC, c2.generate);
    rows.push(summarise("3 Deep Scan after completed Basic (current code)", [...c1.calls, ...c2.calls]));

    // Repeated analysis of an unchanged document: the report cache is library-only and not wired.
    const d1 = counter(); await run("fast", DOC, d1.generate);
    const d2 = counter(); await run("fast", DOC, d2.generate);
    rows.push(summarise("5 Repeated Basic on unchanged document (second run)", d2.calls));

    // Final Case Assessment: one call over the raw page text of the matter's sources (not over per-document analyses).
    const pages = Array.from({ length: 3 }, (_, i) => `[S${i + 1}] Synthetic Document ${i + 1} page ${i + 1}\n${PARA.repeat(24)}`).join("\n\n");
    const fca = vi.fn(async (_p: any) => ({ text: JSON.stringify({ overview: [], chronology: [], conflicts: [], gaps: [], questions: [] }), usage: null, model: "m", durationMs: 1, stopReason: "end_turn" }));
    await fca({ messages: [{ role: "user", content: [{ type: "text", text: pages }] }] });
    rows.push({ scenario: "4 Final Case Assessment over 3 raw sources", providerCalls: 1, verificationCalls: 0, transmittedChars: JSON.stringify(pages).length, documentChars: pages.length, extractionOperations: 0, ocrOperations: 0 });

    console.info("[REDUNDANCY_BASELINE]", JSON.stringify(rows));
    if (process.env.REDUNDANCY_OUT) writeFileSync(process.env.REDUNDANCY_OUT, JSON.stringify(rows, null, 2) + "\n");
    expect(rows).toHaveLength(5);
  }, 120_000);
});
