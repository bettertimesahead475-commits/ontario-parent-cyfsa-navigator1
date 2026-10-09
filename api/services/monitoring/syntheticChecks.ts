/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CYFSA Navigator — Public Synthetic Health & Commercial Integrity Checks
 */

import { AUTHORITATIVE_COMMERCIAL_PRICES, LATENCY_THRESHOLDS } from "./constants.js";
import { sanitizeObject } from "./sanitizer.js";
import type { CheckMetric, CheckStatus } from "./types.js";

type FetchFn = typeof fetch;

function classifyLatency(name: string, latencyMs: number): CheckStatus {
  const threshold = LATENCY_THRESHOLDS[name];
  if (!threshold) return "healthy";
  if (latencyMs >= threshold.failed) return "degraded";
  if (latencyMs >= threshold.degraded) return "degraded";
  return "healthy";
}

export async function checkHomepage(baseUrl: string, fetchFn: FetchFn = fetch): Promise<CheckMetric> {
  const start = Date.now();
  try {
    const res = await fetchFn(baseUrl + "/");
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        name: "homepage",
        status: "failed",
        latencyMs,
        message: `Homepage returned HTTP ${res.status}`,
        timestamp: new Date().toISOString(),
      };
    }

    const html = await res.text();
    const hasTitle = /<title>[\s\S]*?CYFSA Navigator[\s\S]*?<\/title>/i.test(html);
    const hasRoot = html.includes('id="root"');

    if (!hasTitle || !hasRoot) {
      return {
        name: "homepage",
        status: "failed",
        latencyMs,
        message: `Homepage HTML missing critical markers (title: ${hasTitle}, root: ${hasRoot})`,
        timestamp: new Date().toISOString(),
      };
    }

    const latencyStatus = classifyLatency("homepage", latencyMs);
    return {
      name: "homepage",
      status: latencyStatus,
      latencyMs,
      message: latencyStatus === "degraded" ? "Homepage responded with high latency" : "Homepage loaded successfully",
      details: { titleVerified: hasTitle, rootVerified: hasRoot },
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      name: "homepage",
      status: "failed",
      latencyMs: Date.now() - start,
      message: `Homepage unreachable: ${err.message || String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }
}

export async function checkApiHealth(baseUrl: string, fetchFn: FetchFn = fetch): Promise<CheckMetric> {
  const start = Date.now();
  try {
    const res = await fetchFn(baseUrl + "/api/health");
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        name: "apiHealth",
        status: "failed",
        latencyMs,
        message: `/api/health returned HTTP ${res.status}`,
        timestamp: new Date().toISOString(),
      };
    }

    const data = await res.json();
    if (data.status !== "healthy") {
      return {
        name: "apiHealth",
        status: "failed",
        latencyMs,
        message: `/api/health reported unhealthy status: ${data.status}`,
        details: sanitizeObject(data),
        timestamp: new Date().toISOString(),
      };
    }

    const latencyStatus = classifyLatency("apiHealth", latencyMs);
    return {
      name: "apiHealth",
      status: latencyStatus,
      latencyMs,
      message: latencyStatus === "degraded" ? "/api/health responded with high latency" : "/api/health is healthy",
      details: { reportedTimestamp: data.timestamp },
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      name: "apiHealth",
      status: "failed",
      latencyMs: Date.now() - start,
      message: `/api/health request failed: ${err.message || String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }
}

export async function checkCommercialPricing(baseUrl: string, fetchFn: FetchFn = fetch): Promise<CheckMetric> {
  const start = Date.now();
  try {
    const res = await fetchFn(baseUrl + "/api/access-pricing");
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        name: "pricing",
        status: "failed",
        latencyMs,
        message: `/api/access-pricing returned HTTP ${res.status}`,
        timestamp: new Date().toISOString(),
      };
    }

    const data = await res.json();
    const prices = data.prices || {};
    const mismatches: Record<string, { expected: number | null; actual: any }> = {};

    for (const [tier, expectedPrice] of Object.entries(AUTHORITATIVE_COMMERCIAL_PRICES)) {
      if (prices[tier] !== expectedPrice) {
        mismatches[tier] = { expected: expectedPrice, actual: prices[tier] };
      }
    }

    const legacyPrices = data.legacy_prices || {};
    const hasLegacyPrices = Object.keys(legacyPrices).length > 0;

    if (Object.keys(mismatches).length > 0 || hasLegacyPrices) {
      return {
        name: "pricing",
        status: "failed",
        latencyMs,
        message: "Commercial pricing regression detected against authoritative model",
        details: {
          mismatches,
          hasUnexpectedLegacyPrices: hasLegacyPrices,
          receivedPrices: prices,
        },
        timestamp: new Date().toISOString(),
      };
    }

    const latencyStatus = classifyLatency("pricing", latencyMs);
    return {
      name: "pricing",
      status: latencyStatus,
      latencyMs,
      message: latencyStatus === "degraded" ? "Commercial pricing verified with high latency" : "Commercial pricing model verified",
      details: { verifiedTiersCount: Object.keys(AUTHORITATIVE_COMMERCIAL_PRICES).length },
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      name: "pricing",
      status: "failed",
      latencyMs: Date.now() - start,
      message: `/api/access-pricing check failed: ${err.message || String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }
}

export async function checkAnalyzerUsage(baseUrl: string, fetchFn: FetchFn = fetch): Promise<CheckMetric> {
  const start = Date.now();
  try {
    const res = await fetchFn(baseUrl + "/api/analyzer-usage");
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        name: "usage",
        status: "failed",
        latencyMs,
        message: `/api/analyzer-usage returned HTTP ${res.status}`,
        timestamp: new Date().toISOString(),
      };
    }

    const data = await res.json();
    if (data.type !== "free" || data.tier !== "Anonymous" || typeof data.limit !== "number" || typeof data.remaining !== "number") {
      return {
        name: "usage",
        status: "failed",
        latencyMs,
        message: "Anonymous usage endpoint returned unexpected schema",
        details: sanitizeObject(data),
        timestamp: new Date().toISOString(),
      };
    }

    const latencyStatus = classifyLatency("usage", latencyMs);
    return {
      name: "usage",
      status: latencyStatus,
      latencyMs,
      message: latencyStatus === "degraded" ? "Usage accounting verified with high latency" : "Usage accounting verified without credit consumption",
      details: {
        type: data.type,
        tier: data.tier,
        limit: data.limit,
        remaining: data.remaining,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      name: "usage",
      status: "failed",
      latencyMs: Date.now() - start,
      message: `/api/analyzer-usage check failed: ${err.message || String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }
}

export async function checkAuthFailClosed(baseUrl: string, fetchFn: FetchFn = fetch): Promise<CheckMetric> {
  const start = Date.now();
  const probeResults: Record<string, { endpoint: string; expectedStatus: number; actualStatus: number; passed: boolean; criticalFailure: boolean }> = {};

  try {
    // 1. Activate Code without Auth -> Expect 401 SIGN_IN_REQUIRED
    const actRes = await fetchFn(baseUrl + "/api/activate-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "MONITOR-INVALID-PROBE" }),
    });
    probeResults.activateCode = {
      endpoint: "/api/activate-code",
      expectedStatus: 401,
      actualStatus: actRes.status,
      passed: actRes.status === 401,
      criticalFailure: actRes.status === 200,
    };

    // 2. Cases creation without Auth -> Expect 401 SIGN_IN_REQUIRED
    const casesRes = await fetchFn(baseUrl + "/api/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Probe Case" }),
    });
    probeResults.cases = {
      endpoint: "/api/cases",
      expectedStatus: 401,
      actualStatus: casesRes.status,
      passed: casesRes.status === 401,
      criticalFailure: casesRes.status === 200,
    };

    // 3. Forensic analyze mode="full" anonymous -> Expect 403 FORENSIC_UPGRADE_REQUIRED
    const forensicRes = await fetchFn(baseUrl + "/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ textContent: "Synthetic probe document text", mode: "full" }),
    });
    probeResults.forensicAnalyze = {
      endpoint: "/api/analyze (mode: full)",
      expectedStatus: 403,
      actualStatus: forensicRes.status,
      passed: forensicRes.status === 403,
      criticalFailure: forensicRes.status === 200,
    };

    // 4. Deep-scan anonymous -> Expect 402 SESSION_REQUIRED
    const deepScanRes = await fetchFn(baseUrl + "/api/deep-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentText: "Synthetic probe document text" }),
    });
    probeResults.deepScan = {
      endpoint: "/api/deep-scan",
      expectedStatus: 402,
      actualStatus: deepScanRes.status,
      passed: deepScanRes.status === 402,
      criticalFailure: deepScanRes.status === 200,
    };

    const latencyMs = Date.now() - start;
    const hasCritical = Object.values(probeResults).some((p) => p.criticalFailure);
    const allPassed = Object.values(probeResults).every((p) => p.passed);

    if (hasCritical) {
      return {
        name: "authFailClosed",
        status: "failed",
        latencyMs,
        message: "CRITICAL SECURITY FAILURE: Protected route returned HTTP 200 to unauthenticated probe",
        details: probeResults,
        timestamp: new Date().toISOString(),
      };
    }

    if (!allPassed) {
      return {
        name: "authFailClosed",
        status: "failed",
        latencyMs,
        message: "One or more protected endpoints did not return expected fail-closed rejection status",
        details: probeResults,
        timestamp: new Date().toISOString(),
      };
    }

    const latencyStatus = classifyLatency("authFailClosed", latencyMs);
    return {
      name: "authFailClosed",
      status: latencyStatus,
      latencyMs,
      message: latencyStatus === "degraded" ? "Authentication fail-closed verified with high latency" : "All protected routes verified fail-closed (401/402/403)",
      details: probeResults,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      name: "authFailClosed",
      status: "failed",
      latencyMs: Date.now() - start,
      message: `Auth fail-closed checks failed to execute: ${err.message || String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }
}
