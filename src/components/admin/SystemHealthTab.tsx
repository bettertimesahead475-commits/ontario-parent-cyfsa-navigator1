/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * System Health & Observability — Admin Console
 * Shows real-time synthetic diagnostics, database reachability, commercial pricing integrity,
 * fail-closed security status, and recent failure telemetry.
 */

import React, { useState, useEffect } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  Key,
  Lock,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  XCircle,
} from "lucide-react";

const ADMIN_SECRET_KEY = "cyfsa_admin_secret";

function getSecret(): string {
  try {
    return sessionStorage.getItem(ADMIN_SECRET_KEY) || "";
  } catch {
    return "";
  }
}

function setSecret(v: string) {
  try {
    if (v) sessionStorage.setItem(ADMIN_SECRET_KEY, v);
    else sessionStorage.removeItem(ADMIN_SECRET_KEY);
  } catch {}
}

export default function SystemHealthTab() {
  const [secret, setLocalSecret] = useState(getSecret());
  const [authed, setAuthed] = useState(Boolean(getSecret()));
  const [loading, setLoading] = useState(false);
  const [runningCheck, setRunningCheck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  async function fetchStatus(currentSecret = getSecret()) {
    if (!currentSecret) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/monitoring/status", {
        headers: { "x-admin-secret": currentSecret },
      });
      if (res.status === 401) {
        setAuthed(false);
        setError("Unauthorized: invalid admin secret.");
        return;
      }
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setAuthed(true);
    } catch (err: any) {
      setError(err.message || "Failed to load monitoring status");
    } finally {
      setLoading(false);
    }
  }

  async function runFreshCheck() {
    const currentSecret = getSecret();
    if (!currentSecret) return;
    setRunningCheck(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/monitoring/run", {
        method: "POST",
        headers: { "x-admin-secret": currentSecret },
      });
      if (res.status === 401) {
        setAuthed(false);
        setError("Unauthorized: invalid admin secret.");
        return;
      }
      await fetchStatus(currentSecret);
    } catch (err: any) {
      setError(err.message || "Failed to run diagnostics");
    } finally {
      setRunningCheck(false);
    }
  }

  useEffect(() => {
    if (authed) {
      fetchStatus();
    }
  }, [authed]);

  if (!authed) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 bg-white rounded-xl shadow-md border border-slate-200">
        <div className="flex items-center gap-3 mb-4 text-slate-800">
          <Lock className="w-6 h-6 text-indigo-600" />
          <h2 className="text-lg font-bold">Admin System Observability</h2>
        </div>
        <p className="text-sm text-slate-600 mb-4">
          Enter the admin secret (<code className="text-xs bg-slate-100 px-1 py-0.5 rounded">ADMIN_SECRET</code>) to view production observability metrics.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSecret(secret.trim());
            fetchStatus(secret.trim());
          }}
        >
          <input
            type="password"
            value={secret}
            onChange={(e) => setLocalSecret(e.target.value)}
            placeholder="Admin Secret"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg mb-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {error && <div className="text-xs text-rose-600 mb-3">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
          >
            {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
            Authenticate
          </button>
        </form>
      </div>
    );
  }

  const latest = data?.latest;
  const checks = latest?.checks || {};
  const incidents = latest?.incidents || [];
  const status = latest?.status || "unknown";

  const statusBg =
    status === "healthy"
      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
      : status === "degraded"
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-rose-50 border-rose-200 text-rose-800";

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header & Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-6 border-b border-slate-200 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Activity className="w-7 h-7 text-indigo-600" />
            <h1 className="text-2xl font-bold text-slate-900">Production Observability & Monitoring</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Authoritative synthetic health, fail-closed boundaries, database telemetry, and commercial pricing integrity.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/admin/marketing"
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Marketing Console
          </a>
          <button
            onClick={runFreshCheck}
            disabled={runningCheck || loading}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${runningCheck ? "animate-spin" : ""}`} />
            Run Diagnostics Now
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* System Status Banner */}
      <div className={`p-4 rounded-xl border mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${statusBg}`}>
        <div className="flex items-center gap-3">
          {status === "healthy" ? (
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          ) : status === "degraded" ? (
            <AlertTriangle className="w-8 h-8 text-amber-600" />
          ) : (
            <XCircle className="w-8 h-8 text-rose-600" />
          )}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider">Overall System Status</div>
            <div className="text-xl font-extrabold capitalize">{status}</div>
          </div>
        </div>
        <div className="flex items-center gap-6 text-xs">
          <div>
            <span className="opacity-75">Last Check: </span>
            <span className="font-semibold">
              {latest?.timestamp ? new Date(latest.timestamp).toLocaleTimeString() : "Never"}
            </span>
          </div>
          <div>
            <span className="opacity-75">Checks Passing: </span>
            <span className="font-semibold">
              {latest?.summary?.healthy || 0} / {latest?.summary?.total || 0}
            </span>
          </div>
        </div>
      </div>

      {/* Subsystem Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <SubsystemCard
          title="Homepage & Core Web"
          icon={<Server className="w-5 h-5 text-indigo-600" />}
          metric={checks.homepage}
        />
        <SubsystemCard
          title="API Health Endpoint"
          icon={<Activity className="w-5 h-5 text-indigo-600" />}
          metric={checks.apiHealth}
        />
        <SubsystemCard
          title="Commercial Pricing Integrity"
          icon={<ShoppingBag className="w-5 h-5 text-indigo-600" />}
          metric={checks.pricing}
        />
        <SubsystemCard
          title="Usage Accounting System"
          icon={<Clock className="w-5 h-5 text-indigo-600" />}
          metric={checks.usage}
        />
        <SubsystemCard
          title="Supabase Production DB"
          icon={<Database className="w-5 h-5 text-indigo-600" />}
          metric={checks.database}
        />
        <SubsystemCard
          title="Configuration Integrity"
          icon={<Key className="w-5 h-5 text-indigo-600" />}
          metric={checks.configIntegrity}
        />
        <SubsystemCard
          title="Analyzer Pipelines (Zero AI Burn)"
          icon={<ShieldCheck className="w-5 h-5 text-indigo-600" />}
          metric={checks.analyzerAvailability}
        />
        <SubsystemCard
          title="Authentication Fail-Closed"
          icon={<Lock className="w-5 h-5 text-indigo-600" />}
          metric={checks.authFailClosed}
        />
        <SubsystemCard
          title="Payment & Activation Pipeline"
          icon={<TrendingUp className="w-5 h-5 text-indigo-600" />}
          metric={checks.paymentObservability}
        />
      </div>

      {/* Recent Incidents & Failures Feed */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-slate-700" />
            Detected Incidents & Discrepancies
          </h2>
          <span className="text-xs text-slate-500 font-medium">
            {incidents.length} active incident{incidents.length === 1 ? "" : "s"}
          </span>
        </div>

        {incidents.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
            Zero active incidents detected. All monitored production systems operational.
          </div>
        ) : (
          <div className="space-y-3">
            {incidents.map((inc: any) => (
              <div
                key={inc.id}
                className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 flex items-start justify-between text-xs"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`px-2 py-0.5 rounded font-bold uppercase tracking-wider text-[10px] ${
                        inc.severity === "CRITICAL"
                          ? "bg-rose-100 text-rose-800"
                          : inc.severity === "HIGH"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {inc.severity}
                    </span>
                    <span className="font-semibold text-slate-800">{inc.component}</span>
                  </div>
                  <div className="text-slate-600">{inc.message}</div>
                </div>
                <div className="text-slate-400 font-mono text-[11px] whitespace-nowrap ml-4">
                  {new Date(inc.detectedAt).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SubsystemCard({ title, icon, metric }: { title: string; icon: React.ReactNode; metric?: any }) {
  const status = metric?.status || "unknown";
  const latency = metric?.latencyMs !== undefined ? `${metric.latencyMs}ms` : "-";

  const badgeColor =
    status === "healthy"
      ? "bg-emerald-100 text-emerald-800"
      : status === "degraded"
      ? "bg-amber-100 text-amber-800"
      : "bg-rose-100 text-rose-800";

  return (
    <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm">
            {icon}
            <span>{title}</span>
          </div>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${badgeColor}`}>
            {status}
          </span>
        </div>
        <p className="text-xs text-slate-500 mb-3">{metric?.message || "Awaiting telemetry data..."}</p>
      </div>
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
        <span>Response Latency:</span>
        <span className="font-mono font-medium text-slate-600">{latency}</span>
      </div>
    </div>
  );
}
