import { describe, expect, it } from "vitest";
import {
  calculateTotalCumulativeSpend,
  estimateInputTokens,
  estimateWorstCaseRequestCost,
  makeGenerate,
} from "./forensicBenchmark.js";

describe("forensicBenchmark spending safety", () => {
  it("conservatively estimates input token counts from system and messages", () => {
    const params = {
      system: "You are a forensic legal engine.",
      messages: [
        { role: "user", content: "Analyze this document for CYFSA compliance." },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I have identified the following timeline entries." },
          ],
        },
      ],
    };

    const tokens = estimateInputTokens(params);
    expect(tokens).toBeGreaterThan(100);
    expect(tokens).toBeLessThan(1000);
  });

  it("calculates worst-case cost correctly based on model pricing and max_tokens cap", () => {
    const params = {
      system: "System prompt test",
      messages: [{ role: "user", content: "Short message" }],
      max_tokens: 16000,
    };

    // Claude Opus 5: $5/M input, $25/M output
    const estimate = estimateWorstCaseRequestCost("claude-opus-5", params);
    expect(estimate.maxOutputTokens).toBe(16000);
    expect(estimate.rates.inputCostPerMillionUsd).toBe(5.0);
    expect(estimate.rates.outputCostPerMillionUsd).toBe(25.0);
    // 16000 output tokens * $25 / 1M = $0.40 max output cost + a fraction of a cent for input
    expect(estimate.worstCaseCostUsd).toBeGreaterThan(0.40);
    expect(estimate.worstCaseCostUsd).toBeLessThan(0.42);
  });

  it("fails closed when encountering an unknown model with no pricing table entry", () => {
    const params = {
      messages: [{ role: "user", content: "Test" }],
    };

    expect(() =>
      estimateWorstCaseRequestCost("unknown-mystery-model-2026", params)
    ).toThrowError(/CRITICAL SPENDING GATE: Model "unknown-mystery-model-2026" has no pricing registered/);
  });

  it("fails closed in calculateTotalCumulativeSpend if past usage contains unknown models", () => {
    const usage = {
      "claude-opus-5": { input_tokens: 1000, output_tokens: 2000 },
      "unpriced-experimental-model": { input_tokens: 500, output_tokens: 500 },
    };

    expect(() => calculateTotalCumulativeSpend(usage)).toThrowError(
      /Model "unpriced-experimental-model" in usage record has no pricing registered/
    );
  });

  it("calculates cumulative spend from usage accurately", () => {
    const usage = {
      "claude-sonnet-5": { input_tokens: 500_000, output_tokens: 100_000 }, // (0.5 * 2) + (0.1 * 10) = 1.00 + 1.00 = 2.00
      "claude-opus-5": { input_tokens: 100_000, output_tokens: 20_000 },   // (0.1 * 5) + (0.02 * 25) = 0.50 + 0.50 = 1.00
    };

    const total = calculateTotalCumulativeSpend(usage);
    expect(total).toBeCloseTo(3.00, 2);
  });

  it("aborts before dispatching when worst-case cost would breach the remaining budget cap", async () => {
    const usage: Record<string, { input_tokens: number; output_tokens: number }> = {
      // Prior spend: ~ $1.90 on Opus 5
      // 100k input * 5 = 0.50, 56k output * 25 = 1.40 => $1.90
      "claude-opus-5": { input_tokens: 100_000, output_tokens: 56_000 },
    };
    const stageMetrics: Record<string, any> = {};

    // Spending cap is $2.00. Remaining allowance is only $0.10.
    const maxSpendUsd = 2.00;

    const mockClient = {
      messages: {
        stream: () => {
          throw new Error("FAIL: stream() must never be invoked if cap is breached pre-call!");
        },
      },
    } as any;

    const generate = makeGenerate(mockClient, usage, stageMetrics, maxSpendUsd);

    // Call requires max_tokens: 16000 on Opus (which alone is $0.40 max output cost)
    await expect(
      generate(
        {
          stage: "investigate",
          messages: [{ role: "user", content: "Deep forensic investigation." }],
          max_tokens: 16000,
        },
        "claude-opus-5"
      )
    ).rejects.toThrowError(/Pre-call spending cap violation prevented/);
  });

  it("aborts immediately if cumulative spend has already reached or exceeded the cap", async () => {
    const usage: Record<string, { input_tokens: number; output_tokens: number }> = {
      "claude-opus-5": { input_tokens: 200_000, output_tokens: 80_000 }, // $1.00 + $2.00 = $3.00
    };
    const stageMetrics: Record<string, any> = {};
    const maxSpendUsd = 2.50; // Cap was $2.50, but spend is $3.00

    const mockClient = {
      messages: {
        stream: () => {
          throw new Error("FAIL: stream() must not be called!");
        },
      },
    } as any;

    const generate = makeGenerate(mockClient, usage, stageMetrics, maxSpendUsd);

    await expect(
      generate(
        {
          stage: "extract",
          messages: [{ role: "user", content: "Test" }],
          max_tokens: 1000,
        },
        "claude-haiku-5-5"
      )
    ).rejects.toThrowError(/Spending cap reached: cumulative spend/);
  });

  it("allows the call, updates usage, and reconciles stage metrics when budget is sufficient", async () => {
    const usage: Record<string, { input_tokens: number; output_tokens: number }> = {};
    const stageMetrics: Record<string, any> = {};
    const maxSpendUsd = 10.00;

    let streamCalled = false;
    const mockClient = {
      messages: {
        stream: () => {
          streamCalled = true;
          return {
            finalMessage: async () => ({
              content: [{ type: "text", text: '{"findings": []}' }],
              usage: { input_tokens: 1200, output_tokens: 350 },
              stop_reason: "end_turn",
            }),
          };
        },
      },
    } as any;

    const generate = makeGenerate(mockClient, usage, stageMetrics, maxSpendUsd);

    const result = await generate(
      {
        stage: "investigation",
        messages: [{ role: "user", content: "Verify facts." }],
        max_tokens: 4000,
      },
      "claude-opus-5"
    );

    expect(streamCalled).toBe(true);
    expect(result.text).toBe('{"findings": []}');
    expect(result.usage).toEqual({ input_tokens: 1200, output_tokens: 350 });

    // Verify usage reconciled
    expect(usage["claude-opus-5"]).toEqual({ input_tokens: 1200, output_tokens: 350 });

    // Verify stageMetrics recorded
    expect(stageMetrics["investigation"].calls).toBe(1);
    expect(stageMetrics["investigation"].inputTokens).toBe(1200);
    expect(stageMetrics["investigation"].outputTokens).toBe(350);
  });

  it("throws if provider response is missing usage data", async () => {
    const usage: Record<string, { input_tokens: number; output_tokens: number }> = {};
    const stageMetrics: Record<string, any> = {};
    const maxSpendUsd = 10.00;

    const mockClient = {
      messages: {
        stream: () => ({
          finalMessage: async () => ({
            content: [{ type: "text", text: "hello" }],
            // missing usage!
          }),
        }),
      },
    } as any;

    const generate = makeGenerate(mockClient, usage, stageMetrics, maxSpendUsd);

    await expect(
      generate(
        {
          stage: "investigation",
          messages: [{ role: "user", content: "test" }],
        },
        "claude-opus-5"
      )
    ).rejects.toThrowError(/AI Provider response missing required usage token counts/);
  });
});
