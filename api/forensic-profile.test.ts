/**
 * Forensic pipeline profile with mocked provider responses (no network, no paid calls). It records, per run:
 * provider calls and their prompt sizes, the document text transmitted, and the non-provider CPU of the run
 * (orchestration, report guards, verification prompt build). Output is written to PERF_PROFILE_OUT when set.
 */
import { describe, expect, it, vi } from "vitest";
import { runSectionedAnalysis, applyReportGuards, buildSectionPrompt, buildVerificationPrompt, type GenerateFn } from "./services/analyzerSections.js";
import { COMPLETE_ANALYSIS, VERIFICATION_RESULT, completeVerification, isVerificationRequest, requestedSection } from "./analyzerTestFixtures.js";
import { writeFileSync } from "node:fs";

const PARAGRAPH = "On March 3, 2026 a neighbour told the worker that the child was left alone for several hours in the apartment. The worker did not attend. ";
function documentOfPages(pages: number): string {
  const page = `Page marker ${"-".repeat(3)} ` + PARAGRAPH.repeat(24);
  return Array.from({ length: pages }, (_, i) => page.replace("marker", `marker ${i + 1}`)).join("\n");
}

function recordingGenerate(log: Array<{ kind: string; chars: number }>): GenerateFn {
  return vi.fn(async (params: any) => {
    const kind = isVerificationRequest(params) ? "verification" : `section:${requestedSection(params)}`;
    const chars = JSON.stringify(params.messages ?? "").length;
    log.push({ kind, chars });
    const body = isVerificationRequest(params) ? completeVerification(VERIFICATION_RESULT as any, params) : COMPLETE_ANALYSIS;
    return { text: JSON.stringify(body), usage: { input_tokens: 10, output_tokens: 5 }, model: "m", durationMs: 1, stopReason: "end_turn" };
  }) as unknown as GenerateFn;
}

describe("Forensic pipeline profile (mocked provider)", () => {
  for (const pages of [5, 50, 200]) {
    it(`profiles a ${pages}-page Forensic run: calls, transmitted text and non-provider CPU`, async () => {
      const documentText = documentOfPages(pages);
      const log: Array<{ kind: string; chars: number }> = [];
      const generate = recordingGenerate(log);
      const t0 = performance.now();
      const { report } = await runSectionedAnalysis({
        mode: "full", documentText, primaryModel: "claude-opus-5", verificationModel: "claude-opus-5",
        generate, deadlineAt: Date.now() + 200_000, requestId: "req_profile_forensic",
      } as any);
      const runMs = performance.now() - t0;
      const t1 = performance.now();
      applyReportGuards(structuredClone(report), documentText);
      const guardMs = performance.now() - t1;
      const transmitted = log.reduce((s, c) => s + c.chars, 0);
      const docChars = documentText.length;
      const row = {
        pages, docChars, calls: log.length, sectionCalls: log.filter((c) => c.kind.startsWith("section")).length,
        verificationCalls: log.filter((c) => c.kind === "verification").length,
        transmittedChars: transmitted, transmittedOverDocument: +(transmitted / docChars).toFixed(2),
        runNonProviderMs: +runMs.toFixed(1), oneGuardPassMs: +guardMs.toFixed(1),
        redFlagPromptChars: log.find((c) => c.kind === "section:Evidence findings")?.chars ?? null,
      };
      console.info("[FORENSIC_PROFILE]", JSON.stringify(row));
      if (process.env.PERF_PROFILE_OUT) writeFileSync(process.env.PERF_PROFILE_OUT, JSON.stringify(row, null, 2) + "\n", { flag: "a" });
      expect(row.sectionCalls).toBeGreaterThanOrEqual(6);
      expect(report.forensicVerification).toBeTruthy();
    }, 120_000);
  }
});
