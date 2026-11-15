import { describe, expect, it, vi } from "vitest";
import { runSectionedAnalysis } from "./services/analyzerSections";

describe("forensic section dispatch", () => {
  it("does not start a second wave after the first wave exhausts its attempts", async () => {
    const generate = vi.fn(async (_options: Parameters<Parameters<typeof runSectionedAnalysis>[0]["generate"]>[0]) => ({
      text: "{}",
      model: "claude-opus-test",
      durationMs: 0,
      stopReason: "end_turn",
    }));

    await expect(runSectionedAnalysis({
      mode: "full",
      documentText: "Synthetic Ontario child protection affidavit.",
      primaryModel: "claude-opus-test",
      deadlineAt: Date.now() + 120_000,
      generate,
    })).rejects.toThrow();

    const calls = generate.mock.calls.map(([options]) => options);
    expect(new Set(calls.map(options => options.stage)).size).toBe(3);
    expect(calls.every(options => options.retries === 0)).toBe(true);
  });
});
