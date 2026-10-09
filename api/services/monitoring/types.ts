/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CYFSA Navigator — Phase 16: Production Monitoring & Observability Types
 */

export type CheckStatus = 'healthy' | 'degraded' | 'failed';
export type SystemStatus = 'healthy' | 'degraded' | 'failed';
export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM';
export type LatencyClassification = 'HEALTHY' | 'DEGRADED' | 'FAILED';

export interface CheckMetric {
  name: string;
  status: CheckStatus;
  latencyMs: number;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface Incident {
  id: string;
  severity: IncidentSeverity;
  component: string;
  message: string;
  detectedAt: string;
}

export interface LatencyMetric {
  latencyMs: number;
  classification: LatencyClassification;
  thresholds: {
    degraded: number;
    failed: number;
  };
}

export interface MonitoringReport {
  status: SystemStatus;
  timestamp: string;
  environment: string;
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    failed: number;
  };
  latencySummary: Record<string, LatencyMetric>;
  checks: {
    homepage: CheckMetric;
    apiHealth: CheckMetric;
    pricing: CheckMetric;
    usage: CheckMetric;
    database: CheckMetric;
    configIntegrity: CheckMetric;
    analyzerAvailability: CheckMetric;
    authFailClosed: CheckMetric;
    paymentObservability: CheckMetric;
  };
  incidents: Incident[];
}

export interface AlertPayload {
  severity: IncidentSeverity;
  title: string;
  systemStatus: SystemStatus;
  reportSummary: string;
  incidents: Incident[];
  timestamp: string;
}
