import { describe, expect, it } from "vitest";
import {
  ANALYZER_MODELS,
  CLAUDE_MODELS,
  TOKEN_BUDGETS,
  MODEL_TIMEOUTS,
  calculateEstimatedCost,
  resolveServerAuthoritativeModel,
  resolveAnthropicWireModel,
} from "./analyzerModels.js";
import { LifecycleError } from "./lifecycleErrors.js";

describe("analyzerModels service", () => {
  describe("Model resolution and server authority", () => {
    it("routes Quick Review to Claude Sonnet by default", () => {
      const resolution = resolveServerAuthoritativeModel({
        mode: "fast",
        isPaid: false,
        tier: null,
      });

      expect(resolution.authoritativeModel).toBe(ANALYZER_MODELS.QUICK);
      expect(resolution.authoritativeModel).toBe("claude-3-5-sonnet-20241022");
      expect(resolution.mode).toBe("fast");
      expect(resolution.tokenBudget).toBe(TOKEN_BUDGETS.QUICK);
      expect(resolution.timeoutMs).toBe(MODEL_TIMEOUTS.QUICK);
    });

    it("prevents frontend from forcing Opus in Quick Review mode", () => {
      const resolution = resolveServerAuthoritativeModel({
        mode: "fast",
        isPaid: true,
        tier: "Premium",
        clientRequestedModel: "claude-3-opus-20240229",
      });

      // Server authority overrides client override: Quick mode must always run Sonnet
      expect(resolution.authoritativeModel).toBe(ANALYZER_MODELS.QUICK);
      expect(resolution.authoritativeModel).toBe("claude-3-5-sonnet-20241022");
    });

    it("rejects Forensic mode for unpaid users with 403 FORENSIC_UPGRADE_REQUIRED", () => {
      expect(() =>
        resolveServerAuthoritativeModel({
          mode: "full",
          isPaid: false,
          tier: null,
        })
      ).toThrowError(LifecycleError);

      try {
        resolveServerAuthoritativeModel({
          mode: "full",
          isPaid: false,
          tier: null,
        });
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
        expect(err.code).toBe("FORENSIC_UPGRADE_REQUIRED");
      }
    });

    it("rejects Forensic mode for Basic tier users who do not have forensic access", () => {
      expect(() =>
        resolveServerAuthoritativeModel({
          mode: "full",
          isPaid: true,
          tier: "Basic",
        })
      ).toThrowError(LifecycleError);
    });

    it("routes Forensic mode to Claude Opus for Premium and Pro tiers", () => {
      const premiumRes = resolveServerAuthoritativeModel({
        mode: "full",
        isPaid: true,
        tier: "Premium",
      });
      expect(premiumRes.authoritativeModel).toBe(ANALYZER_MODELS.FORENSIC);
      expect(premiumRes.authoritativeModel).toBe("claude-3-opus-20240229");
      expect(premiumRes.mode).toBe("full");

      const proRes = resolveServerAuthoritativeModel({
        mode: "full",
        isPaid: true,
        tier: "Pro",
      });
      expect(proRes.authoritativeModel).toBe(ANALYZER_MODELS.FORENSIC);
      expect(proRes.authoritativeModel).toBe("claude-3-opus-20240229");
    });

    it("ensures all supported models are in CLAUDE_MODELS set", () => {
      expect(CLAUDE_MODELS.has(ANALYZER_MODELS.QUICK)).toBe(true);
      expect(CLAUDE_MODELS.has(ANALYZER_MODELS.FORENSIC)).toBe(true);
      expect(CLAUDE_MODELS.has("claude-3-opus-20240229")).toBe(true);
      expect(CLAUDE_MODELS.has("claude-sonnet-5")).toBe(true);
    });

    it("maps wire model aliases to official verified Anthropic models", () => {
      expect(resolveAnthropicWireModel("claude-sonnet-5")).toBe("claude-3-5-sonnet-20241022");
      expect(resolveAnthropicWireModel("claude-3-opus-20240229")).toBe("claude-3-opus-20240229");
      expect(resolveAnthropicWireModel("claude-3-5-sonnet-20241022")).toBe("claude-3-5-sonnet-20241022");
    });
  });

  describe("Cost estimation and accounting", () => {
    it("calculates accurate Sonnet cost based on token usage", () => {
      const estimate = calculateEstimatedCost(ANALYZER_MODELS.QUICK, {
        input_tokens: 10_000,
        output_tokens: 2_000,
      });

      // 10k input * $3/MTok = $0.030
      // 2k output * $15/MTok = $0.030
      // Total USD = $0.060
      expect(estimate.inputCostUsd).toBeCloseTo(0.03, 3);
      expect(estimate.outputCostUsd).toBeCloseTo(0.03, 3);
      expect(estimate.totalCostUsd).toBeCloseTo(0.06, 3);
      expect(estimate.totalCostCad).toBeGreaterThan(estimate.totalCostUsd);
    });

    it("calculates accurate Opus cost based on token usage", () => {
      const estimate = calculateEstimatedCost(ANALYZER_MODELS.FORENSIC, {
        input_tokens: 20_000,
        output_tokens: 4_000,
      });

      // 20k input * $15/MTok = $0.30
      // 4k output * $75/MTok = $0.30
      // Total USD = $0.60
      expect(estimate.inputCostUsd).toBeCloseTo(0.3, 3);
      expect(estimate.outputCostUsd).toBeCloseTo(0.3, 3);
      expect(estimate.totalCostUsd).toBeCloseTo(0.6, 3);
      expect(estimate.totalCostCad).toBeCloseTo(0.6 * 1.38, 2);
    });

    it("handles zero or missing usage safely", () => {
      const estimate = calculateEstimatedCost(ANALYZER_MODELS.QUICK, {});
      expect(estimate.inputCostUsd).toBe(0);
      expect(estimate.outputCostUsd).toBe(0);
      expect(estimate.totalCostUsd).toBe(0);
      expect(estimate.totalCostCad).toBe(0);
    });
  });
});
