/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CYFSA Navigator — Monitoring Master Runner
 * Runs all synthetic, database, commercial, analyzer, and security checks, computes status, and records telemetry.
 */

import { DEFAULT_PRODUCTION_URL, LATENCY_THRESHOLDS } from "./constants.js";
import { checkDatabaseHealth, checkConfigurationIntegrity } from "./databaseChecks.js";
import { checkAnalyzerAvailability } from "./analyzerChecks.js";
import { checkPaymentObservability } from "./paymentObservability.js";
import { checkHomepage, checkApiHealth, checkCommercialPricing, checkAnalyzerUsage, checkAuthFailClosed } from "./syntheticChecks.js";
import { createIncident, dispatchAlert } from "./alerting.js";
import { monitoringHistory } from "./historyBuffer.js";
import { sanitizeObject } from "./sanitizer.js";
import type {
  CheckMetric,
  Incident,
  IncidentSeverity,
  LatencyClassification,
  LatencyMetric,
  MonitoringReport,
  SystemStatus,
} from "./types.js";

export interface RunOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  skipAlertDispatch?: boolean;
}

function classifyLatency(name: string, latencyMs: number): LatencyClassification {
  const threshold = LATENCY_THRESHOLDS[name] || { degraded: 1000, failed: 3000 };
  if (latencyMs >= threshold.failed) return "FAILED";
  if (latencyMs >= threshold.degraded) return "DEGRADED";
  return "HEALTHY";
}

export async function runMonitoringChecks(options: RunOptions = {}): Promise<MonitoringReport> {
  const baseUrl = options.baseUrl || process.env.MONITORING_TARGET_URL || DEFAULT_PRODUCTION_URL;
  const fetchFn = options.fetchFn || fetch;

  // Configuration check is synchronous / instant
  const configMetric = checkConfigurationIntegrity();

  // Run external and database checks concurrently
  const [
    homepageMetric,
    apiHealthMetric,
    pricingMetric,
    usageMetric,
    authMetric,
    databaseMetric,
    analyzerMetric,
    paymentMetric,
  ] = await Promise.all([
    checkHomepage(baseUrl, fetchFn),
    checkApiHealth(baseUrl, fetchFn),
    checkCommercialPricing(baseUrl, fetchFn),
    checkAnalyzerUsage(baseUrl, fetchFn),
    checkAuthFailClosed(baseUrl, fetchFn),
    checkDatabaseHealth(),
    checkAnalyzerAvailability(baseUrl, fetchFn),
    checkPaymentObservability(baseUrl, fetchFn),
  ]);

  const checks: Record<string, CheckMetric> = {
    homepage: homepageMetric,
    apiHealth: apiHealthMetric,
    pricing: pricingMetric,
    usage: usageMetric,
    database: databaseMetric,
    configIntegrity: configMetric,
    analyzerAvailability: analyzerMetric,
    authFailClosed: authMetric,
    paymentObservability: paymentMetric,
  };

  const metricsList = Object.values(checks);
  const total = metricsList.length;
  const healthy = metricsList.filter((m) => m.status === "healthy").length;
  const degraded = metricsList.filter((m) => m.status === "degraded").length;
  const failed = metricsList.filter((m) => m.status === "failed").length;

  let overallStatus: SystemStatus = "healthy";
  if (failed > 0) {
    overallStatus = "failed";
  } else if (degraded > 0) {
    overallStatus = "degraded";
  }

  // Build latency summary
  const latencySummary: Record<string, LatencyMetric> = {};
  for (const [name, metric] of Object.entries(checks)) {
    const threshold = LATENCY_THRESHOLDS[name] || { degraded: 1000, failed: 3000 };
    latencySummary[name] = {
      latencyMs: metric.latencyMs,
      classification: classifyLatency(name, metric.latencyMs),
      thresholds: threshold,
    };
  }

  // Generate incidents for any non-healthy checks
  const incidents: Incident[] = [];
  for (const metric of metricsList) {
    if (metric.status !== "healthy") {
      incidents.push(createIncident(metric));
    }
  }

  const report: MonitoringReport = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "production",
    summary: { total, healthy, degraded, failed },
    latencySummary,
    checks: checks as unknown as MonitoringReport["checks"],
    incidents,
  };

  const sanitizedReport = sanitizeObject(report);

  // Record in rolling telemetry buffer
  monitoringHistory.recordReport(sanitizedReport);

  // Dispatch alert if any failure or degraded incident was detected
  if (incidents.length > 0 && !options.skipAlertDispatch) {
    const highestSeverity: IncidentSeverity = incidents.some((i) => i.severity === "CRITICAL")
      ? "CRITICAL"
      : incidents.some((i) => i.severity === "HIGH")
      ? "HIGH"
      : "MEDIUM";

    await dispatchAlert(
      {
        severity: highestSeverity,
        title: `CYFSA Navigator System ${overallStatus.toUpperCase()}`,
        systemStatus: overallStatus,
        reportSummary: `${failed} checks failed, ${degraded} degraded out of ${total} total checks.`,
        incidents,
        timestamp: report.timestamp,
      },
      undefined,
      fetchFn
    ).catch((err) => console.error("[runner] Alert dispatch error:", err));
  }

  return sanitizedReport;
}
