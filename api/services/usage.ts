// ---------------------------------------------------------------------------
// Enforces server-authoritative usage and credit allowances for CYFSA Navigator:
// - Free: 1 Free Quick Document Review
// - Document Analyzer Basic ($19.99 CAD): Exactly 3 Quick Document Reviews (no Forensic Dual-Pass)
// - Document Analyzer Premium ($49.99 CAD): Exactly 3 Forensic In-Depth Analyses (+ standard Quick Reviews)
// - Individual / Family CYFSA Case Access ($149 CAD/month): 5 Forensic In-Depth Analyses per billing cycle
// - Community Sponsorships (Community 5, 10, 25): 5 Forensic In-Depth Analyses per family per month
//
// All usage checks are server-authoritative, fail-closed, idempotent, and resilient against duplicate deductions.
// ---------------------------------------------------------------------------

import { getSupabase } from "./access.js";
import { LifecycleError } from "./lifecycleErrors.js";
import { withTransientRetry } from "./transientRetry.js";
import { logSupabaseFailure } from "./supabaseDiagnostics.js";

export const FREE_ANALYSES_LIMIT = 1;
export const BASIC_QUICK_REVIEWS_LIMIT = 3;
export const PREMIUM_FORENSIC_ANALYSES_LIMIT = 5;
export const CASE_ACCESS_FORENSIC_ANALYSES_LIMIT = 5;

export interface TierLimits {
  quickReviews: number;
  forensicAnalyses: number;
}

export const TIER_LIMITS: Record<string, TierLimits> = {
  Free: { quickReviews: 1, forensicAnalyses: 0 },
  Basic: { quickReviews: 3, forensicAnalyses: 0 },
  AnalyzerBasic: { quickReviews: 3, forensicAnalyses: 0 },
  Premium: { quickReviews: 5, forensicAnalyses: 5 },
  AnalyzerPremium: { quickReviews: 5, forensicAnalyses: 5 },
  Pro: { quickReviews: Infinity, forensicAnalyses: 5 },
  Community5: { quickReviews: Infinity, forensicAnalyses: 5 },
  Community10: { quickReviews: Infinity, forensicAnalyses: 5 },
  Community25: { quickReviews: Infinity, forensicAnalyses: 5 },
};

export type UsageAnalysisType = "quick" | "forensic";

export interface TierAllowanceCheckResult {
  allowed: boolean;
  alreadyConsumed?: boolean;
  code?: string;
  error?: string;
  used: number;
  limit: number;
  remaining: number | null;
  tier: string;
}

export interface CreditStatus {
  tier: string;
  quickReviewsUsed: number;
  quickReviewsLimit: number | null;
  quickReviewsRemaining: number | null;
  forensicAnalysesUsed: number;
  forensicAnalysesLimit: number | null;
  forensicAnalysesRemaining: number | null;
}

// In-memory idempotency cache ensuring duplicate requests/retries do not double-deduct
const idempotencyCache = new Set<string>();

export function isAnalysisAlreadyRecorded(idempotencyKey?: string | null): boolean {
  if (!idempotencyKey) return false;
  return idempotencyCache.has(idempotencyKey);
}

export function markAnalysisRecorded(idempotencyKey?: string | null): void {
  if (!idempotencyKey) return;
  idempotencyCache.add(idempotencyKey);
  if (idempotencyCache.size > 10000) {
    const toRemove = Array.from(idempotencyCache).slice(0, 2000);
    for (const key of toRemove) idempotencyCache.delete(key);
  }
}

export function resetUsageCachesForTesting(): void {
  idempotencyCache.clear();
}

function getBillingMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export function getPaidUsageKey(sessionId: string, tier: string, type: UsageAnalysisType): string {
  if (type === "quick") {
    return `paid_session_${sessionId}_quick`;
  }
  // Forensic analyses:
  if (tier === "Pro" || tier.startsWith("Community")) {
    return `paid_session_${sessionId}_forensic_${getBillingMonth()}`;
  }
  return `paid_session_${sessionId}_forensic`;
}

export async function getUsageCount(key: string): Promise<number> {
  try {
    return await withTransientRetry(async () => {
      const db = getSupabase();
      const { data, error } = await db
        .from("free_usage")
        .select("analyses_used")
        .eq("uid", key)
        .retry(false)
        .maybeSingle();
      if (error) {
        throw Object.assign(new Error(`Failed to read usage: ${error.message}`), { statusCode: 500, supabaseError: error });
      }
      return data?.analyses_used ?? 0;
    });
  } catch (err: any) {
    if (err instanceof LifecycleError) throw err;
    logSupabaseFailure("free_usage read", err?.supabaseError ?? err);
    throw new LifecycleError(
      503,
      "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE",
      "We couldn't verify your analysis access right now. Your document is safe. Please retry in a moment."
    );
  }
}

export async function incrementUsageCount(key: string, email: string | null): Promise<number> {
  try {
    const current = await getUsageCount(key);
    const next = current + 1;
    const now = new Date().toISOString();
    await withTransientRetry(async () => {
      const db = getSupabase();
      const { error } = await db.from("free_usage").upsert(
        {
          uid: key,
          email,
          analyses_used: next,
          first_analysis_at: current === 0 ? now : undefined,
          last_analysis_at: now,
        },
        { onConflict: "uid" }
      );
      if (error) {
        throw Object.assign(new Error(`Failed to record usage: ${error.message}`), { statusCode: 500, supabaseError: error });
      }
    });
    return next;
  } catch (err: any) {
    if (err instanceof LifecycleError) throw err;
    logSupabaseFailure("free_usage write", err?.supabaseError ?? err);
    throw new LifecycleError(
      503,
      "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE",
      "We couldn't update your analysis usage right now. Please try again in a moment."
    );
  }
}

/**
 * Checks whether a paid session has available allowance for a quick or forensic analysis.
 * Fails closed before any external AI model calls are made.
 */
export async function checkPaidUsage(
  sessionId: string,
  tier: string,
  type: UsageAnalysisType,
  idempotencyKey?: string | null
): Promise<TierAllowanceCheckResult> {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.Basic;
  const limit = type === "quick" ? limits.quickReviews : limits.forensicAnalyses;

  const key = getPaidUsageKey(sessionId, tier, type);
  const used = await getUsageCount(key);

  if (idempotencyKey && isAnalysisAlreadyRecorded(idempotencyKey)) {
    return {
      allowed: true,
      alreadyConsumed: true,
      used,
      limit,
      remaining: limit === Infinity ? null : Math.max(0, limit - used),
      tier,
    };
  }

  if (limit !== Infinity && used >= limit) {
    return {
      allowed: false,
      code: "ANALYSIS_LIMIT_REACHED",
      error: "You've used all analyses included in your package. Purchase additional analyses to continue.",
      used,
      limit,
      remaining: 0,
      tier,
    };
  }

  return {
    allowed: true,
    used,
    limit,
    remaining: limit === Infinity ? null : Math.max(0, limit - used),
    tier,
  };
}

/**
 * Deducts credit ONLY after an analysis successfully completes.
 * Safe against double deductions and network retry duplicate consumption.
 */
export async function recordPaidUse(
  sessionId: string,
  tier: string,
  email: string | null,
  type: UsageAnalysisType,
  idempotencyKey?: string | null
): Promise<number> {
  if (idempotencyKey && isAnalysisAlreadyRecorded(idempotencyKey)) {
    const key = getPaidUsageKey(sessionId, tier, type);
    return await getUsageCount(key);
  }

  const key = getPaidUsageKey(sessionId, tier, type);
  const next = await incrementUsageCount(key, email);
  if (idempotencyKey) {
    markAnalysisRecorded(idempotencyKey);
  }
  return next;
}

/**
 * Returns the current credit status for a paid session.
 */
export async function getPaidUsageStatus(sessionId: string, tier: string): Promise<CreditStatus> {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.Basic;

  const quickKey = getPaidUsageKey(sessionId, tier, "quick");
  const forensicKey = getPaidUsageKey(sessionId, tier, "forensic");

  const [quickUsed, forensicUsed] = await Promise.all([
    getUsageCount(quickKey),
    getUsageCount(forensicKey),
  ]);

  return {
    tier,
    quickReviewsUsed: quickUsed,
    quickReviewsLimit: limits.quickReviews === Infinity ? null : limits.quickReviews,
    quickReviewsRemaining: limits.quickReviews === Infinity ? null : Math.max(0, limits.quickReviews - quickUsed),
    forensicAnalysesUsed: forensicUsed,
    forensicAnalysesLimit: limits.forensicAnalyses,
    forensicAnalysesRemaining: Math.max(0, limits.forensicAnalyses - forensicUsed),
  };
}

// ---------------------------------------------------------------------------
// Free tier functions (preserved for backward compatibility)
// ---------------------------------------------------------------------------

export async function getFreeUsage(uid: string): Promise<number> {
  return await getUsageCount(uid);
}

/**
 * Call ONLY after an analysis actually succeeds — a failed attempt (bad AI
 * call, malformed upload, etc.) should never cost a parent their one free
 * try. Upserts the row and increments the count.
 */
export async function recordFreeUse(uid: string, email: string | null): Promise<void> {
  await incrementUsageCount(uid, email);
}
