/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CYFSA Navigator — Database Health & Configuration Integrity Checks
 * Verifies Supabase reachability, required tables, and configuration without retrieving or logging PII or secrets.
 */

import { getSupabase } from "../access.js";
import { configuredSupabaseHost, describeConfiguredKey, describeSupabaseFailure } from "../supabaseDiagnostics.js";
import { LATENCY_THRESHOLDS } from "./constants.js";
import type { CheckMetric, CheckStatus } from "./types.js";

const REQUIRED_TABLES = ["access_codes", "navigator_paid_sessions", "free_usage"] as const;

function classifyLatency(name: string, latencyMs: number): CheckStatus {
  const threshold = LATENCY_THRESHOLDS[name];
  if (!threshold) return "healthy";
  if (latencyMs >= threshold.failed) return "failed";
  if (latencyMs >= threshold.degraded) return "degraded";
  return "healthy";
}

export async function checkDatabaseHealth(): Promise<CheckMetric> {
  const start = Date.now();
  const tableResults: Record<string, { reachable: boolean; latencyMs: number; error: string | null }> = {};

  try {
    const db = getSupabase();
    let anyTableFailed = false;

    for (const table of REQUIRED_TABLES) {
      const tableStart = Date.now();
      try {
        // Head-only exact count query: reads NO rows, NO emails, NO codes, NO PII
        const { error } = await db
          .from(table)
          .select("*", { count: "exact", head: true });

        const tableLatency = Date.now() - tableStart;
        if (error) {
          anyTableFailed = true;
          tableResults[table] = {
            reachable: false,
            latencyMs: tableLatency,
            error: error.message || "Query failed",
          };
        } else {
          tableResults[table] = {
            reachable: true,
            latencyMs: tableLatency,
            error: null,
          };
        }
      } catch (err: any) {
        anyTableFailed = true;
        tableResults[table] = {
          reachable: false,
          latencyMs: Date.now() - tableStart,
          error: err.message || String(err),
        };
      }
    }

    const totalLatencyMs = Date.now() - start;

    if (anyTableFailed) {
      return {
        name: "database",
        status: "failed",
        latencyMs: totalLatencyMs,
        message: "One or more required Supabase tables are unreachable",
        details: { tables: tableResults },
        timestamp: new Date().toISOString(),
      };
    }

    const latencyStatus = classifyLatency("database", totalLatencyMs);
    return {
      name: "database",
      status: latencyStatus,
      latencyMs: totalLatencyMs,
      message: latencyStatus === "degraded" ? "Database reachable with high latency" : "Database and required tables healthy",
      details: { tables: tableResults },
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    const totalLatencyMs = Date.now() - start;
    const failure = describeSupabaseFailure(err);
    return {
      name: "database",
      status: "failed",
      latencyMs: totalLatencyMs,
      message: `Database connection failed: ${failure.message || err.message || String(err)}`,
      details: {
        kind: failure.kind,
        causeCode: failure.causeCode,
      },
      timestamp: new Date().toISOString(),
    };
  }
}

export function checkConfigurationIntegrity(): CheckMetric {
  const start = Date.now();
  try {
    const host = configuredSupabaseHost();
    const keyInfo = describeConfiguredKey();

    const isHostConfigured = Boolean(host && !host.startsWith("("));
    const isKeyConfigured = Boolean(keyInfo.source);

    if (!isHostConfigured || !isKeyConfigured) {
      return {
        name: "configIntegrity",
        status: "failed",
        latencyMs: Date.now() - start,
        message: "Critical configuration missing: Supabase host or service role key not resolved",
        details: {
          hostConfigured: isHostConfigured,
          keySource: keyInfo.source,
          keyFormat: keyInfo.format,
        },
        timestamp: new Date().toISOString(),
      };
    }

    // Extract non-sensitive project reference from host (e.g. qboidsfpjuxeqtfotryj)
    const projectRef = host ? host.split(".")[0] : null;

    return {
      name: "configIntegrity",
      status: "healthy",
      latencyMs: Date.now() - start,
      message: "Runtime configuration resolved and intact",
      details: {
        projectRef,
        keySource: keyInfo.source,
        keyFormat: keyInfo.format,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      name: "configIntegrity",
      status: "failed",
      latencyMs: Date.now() - start,
      message: `Configuration integrity check failed: ${err.message || String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }
}
