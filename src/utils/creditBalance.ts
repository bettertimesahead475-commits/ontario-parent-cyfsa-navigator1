/**
 * Normalizes the /api/analyzer-usage response for the credit pill. The Node and Cloudflare servers report a free
 * account as { remaining, limit } and a paid session as { creditsRemaining, creditsLimit }; the pill read only the
 * second form, so free accounts saw "Free: of analyses remaining" with no numbers.
 */
export interface CreditBalanceInfo {
  tier: string;
  creditsRemaining: number | null;
  creditsUsed: number | null;
  creditsLimit: number | null;
  isSuspended: boolean;
  suspendedReason?: string | null;
  allowsForensic: boolean;
  isMonthly: boolean;
  isAdminEntitled?: boolean;
  /** Free trial only: the one lifetime Quick Review and one lifetime Forensic Deep Scan, reported separately. */
  freeTrial?: { quickRemaining: number | null; quickLimit: number | null; forensicRemaining: number | null; forensicLimit: number | null; emailVerificationRequired: boolean };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function normalizeCreditBalance(data: any): CreditBalanceInfo | null {
  if (!data || typeof data !== "object") return null;
  const remaining = num(data.creditsRemaining) ?? num(data.remaining);
  const limit = num(data.creditsLimit) ?? num(data.limit);
  const used = num(data.creditsUsed) ?? num(data.quickReviewsUsed) ?? (remaining !== null && limit !== null ? Math.max(0, limit - remaining) : null);
  return {
    tier: typeof data.tier === "string" && data.tier ? data.tier : "free",
    creditsRemaining: remaining,
    creditsUsed: used,
    creditsLimit: limit,
    isSuspended: data.isSuspended === true,
    suspendedReason: typeof data.suspendedReason === "string" ? data.suspendedReason : null,
    allowsForensic: data.allowsForensic === true || (num(data.forensicAnalysesLimit) ?? 0) > 0,
    isMonthly: data.isMonthly === true,
    isAdminEntitled: data.isAdminEntitled === true,
    freeTrial: data.freeTrial === true ? {
      quickRemaining: num(data.quickReviewsRemaining), quickLimit: num(data.quickReviewsLimit),
      forensicRemaining: num(data.forensicAnalysesRemaining), forensicLimit: num(data.forensicAnalysesLimit),
      emailVerificationRequired: data.emailVerificationRequired === true,
    } : undefined,
  };
}

/** "Free Account: 2 of 3 analyses remaining", or without numbers when the server did not report them. */
export function creditPillLabel(b: CreditBalanceInfo): string {
  const t = b.freeTrial;
  if (t) {
    if (t.emailVerificationRequired) return "Free trial: verify your email to unlock 1 Quick Review and 1 Forensic Deep Scan";
    if (t.quickRemaining === null || t.forensicRemaining === null) return "Free trial";
    const q = `${t.quickRemaining} free Quick Review${t.quickRemaining === 1 ? "" : "s"}`;
    const f = `${t.forensicRemaining} free Forensic Deep Scan${t.forensicRemaining === 1 ? "" : "s"}`;
    return `Free trial: ${q} and ${f} remaining`;
  }
  const name = b.tier.toLowerCase() === "free" ? "Free Account" : b.tier;
  return b.creditsRemaining !== null && b.creditsLimit !== null ? `${name}: ${b.creditsRemaining} of ${b.creditsLimit} analyses remaining` : name;
}
