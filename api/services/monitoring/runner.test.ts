/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runMonitoringChecks } from "./runner.js";
import * as synthetic from "./syntheticChecks.js";
import * as dbChecks from "./databaseChecks.js";
import * as analyzer from "./analyzerChecks.js";
import * as payment from "./paymentObservability.js";
import { monitoringHistory } from "./historyBuffer.js";

describe("Monitoring Runner", () => {
  beforeEach(() => {
    monitoringHistory.clear();
    vi.restoreAllMocks();
  });

  it("orchestrates all checks and reports healthy when all pass", async () => {
    vi.spyOn(dbChecks, "checkConfigurationIntegrity").mockReturnValue({
      name: "configIntegrity",
      status: "healthy",
      latencyMs: 1,
      message: "Config intact",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(synthetic, "checkHomepage").mockResolvedValue({
      name: "homepage",
      status: "healthy",
      latencyMs: 120,
      message: "OK",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(synthetic, "checkApiHealth").mockResolvedValue({
      name: "apiHealth",
      status: "healthy",
      latencyMs: 50,
      message: "OK",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(synthetic, "checkCommercialPricing").mockResolvedValue({
      name: "pricing",
      status: "healthy",
      latencyMs: 40,
      message: "OK",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(synthetic, "checkAnalyzerUsage").mockResolvedValue({
      name: "usage",
      status: "healthy",
      latencyMs: 60,
      message: "OK",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(synthetic, "checkAuthFailClosed").mockResolvedValue({
      name: "authFailClosed",
      status: "healthy",
      latencyMs: 80,
      message: "OK",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(dbChecks, "checkDatabaseHealth").mockResolvedValue({
      name: "database",
      status: "healthy",
      latencyMs: 70,
      message: "OK",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(analyzer, "checkAnalyzerAvailability").mockResolvedValue({
      name: "analyzerAvailability",
      status: "healthy",
      latencyMs: 90,
      message: "OK",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(payment, "checkPaymentObservability").mockResolvedValue({
      name: "paymentObservability",
      status: "healthy",
      latencyMs: 85,
      message: "OK",
      timestamp: new Date().toISOString(),
    });

    const report = await runMonitoringChecks({ skipAlertDispatch: true });
    expect(report.status).toBe("healthy");
    expect(report.summary.healthy).toBe(9);
    expect(report.summary.failed).toBe(0);
    expect(report.incidents.length).toBe(0);
    expect(monitoringHistory.getLatestReport()).not.toBeNull();
  });

  it("calculates overall status failed and generates incidents when a check fails", async () => {
    vi.spyOn(dbChecks, "checkConfigurationIntegrity").mockReturnValue({
      name: "configIntegrity",
      status: "failed",
      latencyMs: 2,
      message: "Missing host",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(synthetic, "checkHomepage").mockResolvedValue({
      name: "homepage",
      status: "healthy",
      latencyMs: 100,
      message: "OK",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(synthetic, "checkApiHealth").mockResolvedValue({
      name: "apiHealth",
      status: "healthy",
      latencyMs: 50,
      message: "OK",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(synthetic, "checkCommercialPricing").mockResolvedValue({
      name: "pricing",
      status: "failed",
      latencyMs: 50,
      message: "Pricing mismatch",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(synthetic, "checkAnalyzerUsage").mockResolvedValue({
      name: "usage",
      status: "healthy",
      latencyMs: 60,
      message: "OK",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(synthetic, "checkAuthFailClosed").mockResolvedValue({
      name: "authFailClosed",
      status: "healthy",
      latencyMs: 80,
      message: "OK",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(dbChecks, "checkDatabaseHealth").mockResolvedValue({
      name: "database",
      status: "healthy",
      latencyMs: 70,
      message: "OK",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(analyzer, "checkAnalyzerAvailability").mockResolvedValue({
      name: "analyzerAvailability",
      status: "healthy",
      latencyMs: 90,
      message: "OK",
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(payment, "checkPaymentObservability").mockResolvedValue({
      name: "paymentObservability",
      status: "healthy",
      latencyMs: 85,
      message: "OK",
      timestamp: new Date().toISOString(),
    });

    const report = await runMonitoringChecks({ skipAlertDispatch: true });
    expect(report.status).toBe("failed");
    expect(report.summary.failed).toBe(2);
    expect(report.incidents.length).toBe(2);

    const configInc = report.incidents.find((i) => i.component === "configIntegrity");
    expect(configInc?.severity).toBe("CRITICAL");

    const pricingInc = report.incidents.find((i) => i.component === "pricing");
    expect(pricingInc?.severity).toBe("HIGH");
  });
});
