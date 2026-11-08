/**
 * Lightweight tier definitions and access checks decoupled from backend runtime clients.
 * Safe for use in browser, edge workers, and Node environments.
 */

export type AnalyzerTier = "Basic" | "AnalyzerBasic" | "Premium" | "AnalyzerPremium";
export type CaseAccessTier = "Pro" | "Community5" | "Community10" | "Community25";
export type Tier = AnalyzerTier | CaseAccessTier;

export const TIER_PRICES: Record<string, number> = {
  Basic: 19.99,
  AnalyzerBasic: 19.99,
  Premium: 49.99,
  AnalyzerPremium: 49.99,
  Pro: 149,
  Community5: 2000,
  Community10: 3500,
  Community25: 7500,
};

export const ALL_TIER_PRICES: Record<string, number> = TIER_PRICES;

export function isAnalyzerTier(tier: string): boolean {
  return ["Basic", "AnalyzerBasic", "Premium", "AnalyzerPremium"].includes(tier);
}

export function isCaseAccessTier(tier: string): boolean {
  return ["Pro", "Community5", "Community10", "Community25"].includes(tier);
}

export function hasCaseAccess(tier: string): boolean {
  return isCaseAccessTier(tier);
}

export function hasAnalyzerAccess(tier: string): boolean {
  return isAnalyzerTier(tier) || isCaseAccessTier(tier);
}

export function hasForensicInDepthAccess(tier: string): boolean {
  return ["Premium", "AnalyzerPremium", "Pro", "Community5", "Community10", "Community25"].includes(tier);
}
