/**
 * Centralized AI Model Selection & Cost Accounting for CYFSA Document Analyzer.
 *
 * Enforces server-authoritative model routing:
 *   - Quick Document Review  -> Claude Sonnet ("claude-sonnet-5")
 *   - Forensic In-Depth       -> Claude Opus   ("claude-3-opus-20240229")
 *
 * The frontend cannot override or tamper with model selection to obtain unauthorized Opus access.
 * Silent downgrades from Opus to Sonnet are strictly forbidden.
 */

import { Tier, hasForensicInDepthAccess } from "./access.js";
import { LifecycleError } from "./lifecycleErrors.js";

export const DEFAULT_QUICK_MODEL = "claude-sonnet-5";
export const DEFAULT_FORENSIC_MODEL = "claude-opus-5";

export const ANALYZER_MODELS = {
  QUICK: process.env.ANTHROPIC_QUICK_MODEL || DEFAULT_QUICK_MODEL,
  FORENSIC: process.env.ANTHROPIC_FORENSIC_MODEL || DEFAULT_FORENSIC_MODEL,
} as const;

export const CLAUDE_MODELS = new Set<string>([
  "claude-sonnet-5",
  "claude-sonnet-5-5",
  "claude-opus-5",
  "claude-opus-5-5",
  "claude-haiku-5-5",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-opus-4-5-20251101",
  "claude-haiku-4-5-20251001",
  "claude-3-7-sonnet-20250219",
  "claude-3-7-sonnet-latest",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-latest",
  "claude-3-opus-20240229",
  "claude-3-opus-latest",
]);

/**
 * Resolves wire-level Anthropic model identifier, preserving canonical models without downgrade.
 */
export function resolveAnthropicWireModel(model: string): string {
  return model || DEFAULT_QUICK_MODEL;
}

export const TOKEN_BUDGETS = {
  QUICK: 8000,
  FORENSIC_PASS_1: 16000,
  FORENSIC_PASS_2: 16000,
} as const;

export const MODEL_TIMEOUTS = {
  QUICK: 90000,
  FORENSIC: 150000,
} as const;

// Pricing per million tokens (Anthropic API standard rates)
// Sonnet: $3.00 / MTok prompt, $15.00 / MTok completion
// Opus: $15.00 / MTok prompt, $75.00 / MTok completion
// CAD conversion constant: ~1.38 CAD per USD
export const USD_TO_CAD_RATE = 1.38;

export const MODEL_PRICING: Record<string, { inputCostPerMillionUsd: number; outputCostPerMillionUsd: number }> = {
  "claude-sonnet-5": {
    inputCostPerMillionUsd: 3.0,
    outputCostPerMillionUsd: 15.0,
  },
  "claude-sonnet-5-5": {
    inputCostPerMillionUsd: 3.0,
    outputCostPerMillionUsd: 15.0,
  },
  "claude-opus-5": {
    inputCostPerMillionUsd: 15.0,
    outputCostPerMillionUsd: 75.0,
  },
  "claude-opus-5-5": {
    inputCostPerMillionUsd: 15.0,
    outputCostPerMillionUsd: 75.0,
  },
  "claude-haiku-5-5": {
    inputCostPerMillionUsd: 0.8,
    outputCostPerMillionUsd: 4.0,
  },
  "claude-3-5-sonnet-20241022": {
    inputCostPerMillionUsd: 3.0,
    outputCostPerMillionUsd: 15.0,
  },
  "claude-3-5-sonnet-latest": {
    inputCostPerMillionUsd: 3.0,
    outputCostPerMillionUsd: 15.0,
  },
  "claude-3-opus-20240229": {
    inputCostPerMillionUsd: 15.0,
    outputCostPerMillionUsd: 75.0,
  },
  "claude-3-opus-latest": {
    inputCostPerMillionUsd: 15.0,
    outputCostPerMillionUsd: 75.0,
  },
  "claude-haiku-4-5-20251001": {
    inputCostPerMillionUsd: 0.8,
    outputCostPerMillionUsd: 4.0,
  },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CostEstimate {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  totalCostCad: number;
}

export interface ModelResolution {
  authoritativeModel: string;
  primaryModel: string;
  verificationModel?: string;
  engineDisplayName: string;
  mode: "fast" | "full";
  modeDisplayName: string;
  tokenBudget: number;
  timeoutMs: number;
}

export interface AnalysisModelMetadata {
  engine: string;
  model: string;
  engineName: string;
  mode: "fast" | "full";
  modeName: string;
  durationMs: number;
  usage: TokenUsage;
  cost: CostEstimate;
}

/**
 * Server-authoritative resolution of the model to execute.
 * Strips and ignores client-side model overrides that attempt unauthorized access.
 */
export function resolveServerAuthoritativeModel(params: {
  mode?: string;
  isPaid: boolean;
  tier: Tier | null;
  clientRequestedModel?: string;
}): ModelResolution {
  if (params.mode === "full") {
    if (!params.isPaid || !hasForensicInDepthAccess(params.tier)) {
      throw new LifecycleError(
        403,
        "FORENSIC_UPGRADE_REQUIRED",
        "Forensic In-Depth Dual-Pass scanning requires Document Analyzer Premium ($49.99) or CYFSA Case Access ($149/mo). Your free analysis includes Quick Document Review."
      );
    }

    return {
      authoritativeModel: ANALYZER_MODELS.FORENSIC,
      primaryModel: ANALYZER_MODELS.QUICK,
      verificationModel: ANALYZER_MODELS.FORENSIC,
      engineDisplayName: "Claude Sonnet + Claude Opus (Forensic In-Depth)",
      mode: "full",
      modeDisplayName: "Forensic In-Depth Dual-Pass",
      tokenBudget: TOKEN_BUDGETS.FORENSIC_PASS_1,
      timeoutMs: MODEL_TIMEOUTS.FORENSIC,
    };
  }

  if (params.mode === "fast") {
    return {
      authoritativeModel: ANALYZER_MODELS.QUICK,
      primaryModel: ANALYZER_MODELS.QUICK,
      engineDisplayName: "Claude Sonnet (Quick Review)",
      mode: "fast",
      modeDisplayName: "Quick Document Review",
      tokenBudget: TOKEN_BUDGETS.QUICK,
      timeoutMs: MODEL_TIMEOUTS.QUICK,
    };
  }

  // If mode was omitted (legacy callers):
  // Entitled paid users get Forensic Opus, whereas free/basic callers get Sonnet dual pass
  const isPaidForensic = params.isPaid && hasForensicInDepthAccess(params.tier);
  return {
    authoritativeModel: isPaidForensic ? ANALYZER_MODELS.FORENSIC : ANALYZER_MODELS.QUICK,
    primaryModel: ANALYZER_MODELS.QUICK,
    verificationModel: isPaidForensic ? ANALYZER_MODELS.FORENSIC : undefined,
    engineDisplayName: isPaidForensic
      ? "Claude Sonnet + Claude Opus (Forensic In-Depth)"
      : "Claude Sonnet (Dual-Pass)",
    mode: "full",
    modeDisplayName: isPaidForensic
      ? "Forensic In-Depth Dual-Pass"
      : "Dual-Pass Document Review",
    tokenBudget: TOKEN_BUDGETS.FORENSIC_PASS_1,
    timeoutMs: isPaidForensic ? MODEL_TIMEOUTS.FORENSIC : MODEL_TIMEOUTS.QUICK,
  };
}

/**
 * Calculates estimated API costs based on token usage.
 */
export function calculateEstimatedCost(
  model: string,
  usage: { input_tokens?: number; output_tokens?: number }
): CostEstimate {
  const inputTokens = Math.max(0, Number(usage.input_tokens) || 0);
  const outputTokens = Math.max(0, Number(usage.output_tokens) || 0);

  const pricing =
    MODEL_PRICING[model as keyof typeof MODEL_PRICING] ||
    MODEL_PRICING[ANALYZER_MODELS.QUICK];

  const inputCostUsd = (inputTokens / 1_000_000) * pricing.inputCostPerMillionUsd;
  const outputCostUsd = (outputTokens / 1_000_000) * pricing.outputCostPerMillionUsd;
  const totalCostUsd = Number((inputCostUsd + outputCostUsd).toFixed(5));
  const totalCostCad = Number((totalCostUsd * USD_TO_CAD_RATE).toFixed(4));

  return {
    inputCostUsd: Number(inputCostUsd.toFixed(5)),
    outputCostUsd: Number(outputCostUsd.toFixed(5)),
    totalCostUsd,
    totalCostCad,
  };
}
