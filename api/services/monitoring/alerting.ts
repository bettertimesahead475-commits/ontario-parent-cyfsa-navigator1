/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CYFSA Navigator — Monitoring Alerting & Incident Classifier
 * Classifies failure severity (CRITICAL, HIGH, MEDIUM) and dispatches alerts safely.
 */

import { sanitizeObject } from "./sanitizer.js";
import type { AlertPayload, CheckMetric, Incident, IncidentSeverity, SystemStatus } from "./types.js";

export function classifyIncidentSeverity(checkName: string, status: string, message: string): IncidentSeverity {
  if (status === "degraded") {
    return "MEDIUM";
  }

  // Critical incidents
  if (checkName === "authFailClosed" && message.includes("CRITICAL SECURITY FAILURE")) {
    return "CRITICAL";
  }
  if (checkName === "configIntegrity" || checkName === "database" || checkName === "homepage" || checkName === "apiHealth") {
    return "CRITICAL";
  }

  // High incidents
  if (checkName === "pricing" || checkName === "usage" || checkName === "analyzerAvailability" || checkName === "paymentObservability") {
    return "HIGH";
  }

  return "MEDIUM";
}

export function createIncident(metric: CheckMetric): Incident {
  const severity = classifyIncidentSeverity(metric.name, metric.status, metric.message);
  const id = `inc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    severity,
    component: metric.name,
    message: metric.message,
    detectedAt: metric.timestamp,
  };
}

export async function dispatchAlert(
  payload: AlertPayload,
  webhookUrl?: string,
  fetchFn: typeof fetch = fetch
): Promise<{ dispatched: boolean; target: string; error?: string }> {
  const sanitized = sanitizeObject(payload);

  // 1. Structured server log
  console.error(
    `[MONITORING-ALERT] [${sanitized.severity}] ${sanitized.title}: ${sanitized.reportSummary}`,
    JSON.stringify(sanitized)
  );

  // 2. Optional webhook dispatch (e.g. Discord, Slack, PagerDuty, email bridge)
  const targetUrl = webhookUrl || process.env.MONITORING_ALERT_WEBHOOK_URL;
  if (!targetUrl) {
    return {
      dispatched: false,
      target: "console_only",
    };
  }

  try {
    const res = await fetchFn(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sanitized),
    });
    if (!res.ok) {
      console.warn(`[MONITORING-ALERT] Webhook dispatch returned HTTP ${res.status}`);
      return {
        dispatched: false,
        target: targetUrl,
        error: `Webhook returned HTTP ${res.status}`,
      };
    }
    return {
      dispatched: true,
      target: targetUrl,
    };
  } catch (err: any) {
    console.error("[MONITORING-ALERT] Failed to deliver webhook alert:", err.message);
    return {
      dispatched: false,
      target: targetUrl,
      error: err.message,
    };
  }
}
