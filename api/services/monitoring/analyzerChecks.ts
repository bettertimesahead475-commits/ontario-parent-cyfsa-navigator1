/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CYFSA Navigator — Analyzer Availability Checks
 * Verifies Analyzer pipelines without consuming credits or dispatching upstream AI requests.
 */

import { LATENCY_THRESHOLDS } from "./constants.js";
import type { CheckMetric, CheckStatus } from "./types.js";

type FetchFn = typeof fetch;

function classifyLatency(name: string, latencyMs: number): CheckStatus {
  const threshold = LATENCY_THRESHOLDS[name];
  if (!threshold) return "healthy";
  if (latencyMs >= threshold.failed) return "failed";
  if (latencyMs >= threshold.degraded) return "degraded";
  return "healthy";
}

export async function checkAnalyzerAvailability(baseUrl: string, fetchFn: FetchFn = fetch): Promise<CheckMetric> {
  const start = Date.now();
  const checks: Record<string, { expectedStatus: number; actualStatus: number; passed: boolean }> = {};

  try {
    // 1. Quick route input validation (Empty payload -> 400 Bad Request)
    const quickRes = await fetchFn(baseUrl + "/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    checks.quickValidation = {
      expectedStatus: 400,
      actualStatus: quickRes.status,
      passed: quickRes.status === 400,
    };

    // 2. Forensic route access control (Anonymous mode=full -> 403 FORENSIC_UPGRADE_REQUIRED)
    const forensicRes = await fetchFn(baseUrl + "/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ textContent: "Probe document", mode: "full" }),
    });
    checks.forensicFailClosed = {
      expectedStatus: 403,
      actualStatus: forensicRes.status,
      passed: forensicRes.status === 403,
    };

    // 3. Deep-scan dual-pass route access control (Anonymous -> 402 SESSION_REQUIRED)
    const deepScanRes = await fetchFn(baseUrl + "/api/deep-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentText: "Probe document" }),
    });
    checks.deepScanFailClosed = {
      expectedStatus: 402,
      actualStatus: deepScanRes.status,
      passed: deepScanRes.status === 402,
    };

    // 4. Usage accounting route responds (200 OK)
    const usageRes = await fetchFn(baseUrl + "/api/analyzer-usage");
    checks.usageAccounting = {
      expectedStatus: 200,
      actualStatus: usageRes.status,
      passed: usageRes.status === 200,
    };

    const latencyMs = Date.now() - start;
    const allPassed = Object.values(checks).every((c) => c.passed);

    if (!allPassed) {
      return {
        name: "analyzerAvailability",
        status: "failed",
        latencyMs,
        message: "Analyzer infrastructure failed route validation or fail-closed boundary check",
        details: checks,
        timestamp: new Date().toISOString(),
      };
    }

    const latencyStatus = classifyLatency("analyzerAvailability", latencyMs);
    return {
      name: "analyzerAvailability",
      status: latencyStatus,
      latencyMs,
      message: latencyStatus === "degraded" ? "Analyzer infrastructure verified with high latency" : "Analyzer pipeline active and verified fail-closed (0 AI tokens consumed)",
      details: checks,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      name: "analyzerAvailability",
      status: "failed",
      latencyMs: Date.now() - start,
      message: `Analyzer availability check failed to execute: ${err.message || String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }
}
