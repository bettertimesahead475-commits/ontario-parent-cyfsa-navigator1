/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CYFSA Navigator — Monitoring Constants & Authoritative Baselines
 */

export const AUTHORITATIVE_COMMERCIAL_PRICES: Record<string, number | null> = {
  Basic: 19.99,
  AnalyzerBasic: 19.99,
  Premium: 49.99,
  AnalyzerPremium: 49.99,
  Pro: 149,
  Community5: 2000,
  Community10: 3500,
  Community25: 7500,
};

export const LATENCY_THRESHOLDS: Record<string, { degraded: number; failed: number }> = {
  homepage: { degraded: 1500, failed: 4000 },
  apiHealth: { degraded: 500, failed: 2000 },
  pricing: { degraded: 500, failed: 2000 },
  usage: { degraded: 800, failed: 2500 },
  database: { degraded: 800, failed: 2500 },
  configIntegrity: { degraded: 300, failed: 1000 },
  analyzerAvailability: { degraded: 800, failed: 2500 },
  authFailClosed: { degraded: 800, failed: 2500 },
  paymentObservability: { degraded: 800, failed: 2500 },
};

export const DEFAULT_PRODUCTION_URL = "https://cyfsanavigator.com";
