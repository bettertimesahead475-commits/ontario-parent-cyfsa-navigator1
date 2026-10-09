/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CYFSA Navigator — Monitoring History Rolling Ring Buffer
 * In-memory telemetry buffer retaining recent diagnostic runs without requiring database migrations.
 */

import type { Incident, MonitoringReport } from "./types.js";

const DEFAULT_CAPACITY = 50;

class MonitoringHistoryBuffer {
  private reports: MonitoringReport[] = [];
  private capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  recordReport(report: MonitoringReport): void {
    this.reports.unshift(report);
    if (this.reports.length > this.capacity) {
      this.reports.pop();
    }
  }

  getHistory(): MonitoringReport[] {
    return [...this.reports];
  }

  getLatestReport(): MonitoringReport | null {
    return this.reports[0] || null;
  }

  getIncidents(): Incident[] {
    const allIncidents: Incident[] = [];
    for (const r of this.reports) {
      allIncidents.push(...r.incidents);
    }
    // Deduplicate by incident ID or signature
    const seen = new Set<string>();
    return allIncidents.filter((inc) => {
      const key = `${inc.severity}:${inc.component}:${inc.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  clear(): void {
    this.reports = [];
  }
}

export const monitoringHistory = new MonitoringHistoryBuffer();
