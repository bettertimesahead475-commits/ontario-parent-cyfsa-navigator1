/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Payment & Usage Monitoring — Admin Console
 * Provides authoritative visibility into:
 * - Customer email & verified identity
 * - Payment reference number & expected amount
 * - Notification status vs bank confirmation settlement status
 * - Credits purchased, used, and remaining
 * - Access status (active, suspended, revoked)
 * - Administrative controls: Confirm Bank Deposit, Flag Dispute, Suspend Usage, Restore Usage
 */

import React, { useState, useEffect } from "react";
import {
  CreditCard,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Lock,
  RefreshCw,
  Search,
  UserCheck,
  UserX,
  Clock,
  ExternalLink,
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

export interface PaymentRow {
  referenceNumber: string;
  customerEmail: string;
  package: string;
  amount: number;
  submittedAt: string;
  notificationStatus: string;
  bankSettlementStatus: "pending_settlement" | "bank_confirmed" | "missing_or_disputed" | string;
  creditsGranted: number;
  creditsConsumed: number;
  creditsRemaining: number;
  lastActivity: string;
  accessStatus: "active" | "suspended" | "revoked" | "pending" | "code_issued";
  sessionId: string | null;
  firebaseUid: string | null;
}

export default function PaymentMonitoringTab() {
  const [secret, setLocalSecret] = useState(getSecret());
  const [authed, setAuthed] = useState(Boolean(getSecret()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [filter, setFilter] = useState("");
  const [processingRef, setProcessingRef] = useState<string | null>(null);

  async function fetchPayments(currentSecret = getSecret()) {
    if (!currentSecret) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/overview", {
        headers: { "x-admin-secret": currentSecret },
      });
      if (res.status === 401) {
        setAuthed(false);
        setSecret("");
        setError("Invalid admin secret.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setPayments(data.payments || []);
    } catch (e: any) {
      setError(e.message || "Failed to load payment overview.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authed) {
      fetchPayments();
    }
  }, [authed]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim()) return;
    setSecret(secret.trim());
    setAuthed(true);
  }

  async function handleConfirmBank(referenceNumber: string) {
    setProcessingRef(referenceNumber);
    setActionSuccess(null);
    try {
      const res = await fetch("/api/admin/payments/confirm-bank", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": getSecret(),
        },
        body: JSON.stringify({ referenceNumber }),
      });
      if (!res.ok) throw new Error("Failed to confirm bank settlement.");
      setActionSuccess(`Payment ${referenceNumber} confirmed as deposited in bank.`);
      await fetchPayments();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProcessingRef(null);
    }
  }

  async function handleDispute(referenceNumber: string) {
    setProcessingRef(referenceNumber);
    setActionSuccess(null);
    try {
      const res = await fetch("/api/admin/payments/dispute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": getSecret(),
        },
        body: JSON.stringify({ referenceNumber, reason: "missing_deposit" }),
      });
      if (!res.ok) throw new Error("Failed to flag dispute.");
      setActionSuccess(`Payment ${referenceNumber} flagged as missing/disputed.`);
      await fetchPayments();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProcessingRef(null);
    }
  }

  async function handleSuspend(sessionId: string, referenceNumber: string) {
    setProcessingRef(referenceNumber);
    setActionSuccess(null);
    try {
      const res = await fetch("/api/admin/payments/suspend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": getSecret(),
        },
        body: JSON.stringify({ sessionId, reason: "Admin suspended pending deposit confirmation." }),
      });
      if (!res.ok) throw new Error("Failed to suspend session.");
      setActionSuccess(`Session suspended for ${referenceNumber}. Future paid analyses blocked.`);
      await fetchPayments();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProcessingRef(null);
    }
  }

  async function handleRestore(sessionId: string, referenceNumber: string) {
    setProcessingRef(referenceNumber);
    setActionSuccess(null);
    try {
      const res = await fetch("/api/admin/payments/restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": getSecret(),
        },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error("Failed to restore session.");
      setActionSuccess(`Access restored for ${referenceNumber}.`);
      await fetchPayments();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProcessingRef(null);
    }
  }

  if (!authed) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6 bg-slate-900 text-slate-100 font-sans">
        <form onSubmit={handleLogin} className="w-full max-w-md bg-slate-800 p-8 rounded-xl border border-slate-700 shadow-xl space-y-5">
          <div className="flex items-center gap-3">
            <Lock className="w-6 h-6 text-emerald-400" />
            <h1 className="text-xl font-bold">Admin Payment Observability</h1>
          </div>
          <p className="text-xs text-slate-400">
            Authoritative monitoring of trust-based payment notifications, bank settlement status, and customer analysis credit allowances.
          </p>
          <div>
            <label className="block text-xs uppercase text-slate-400 mb-1">Admin Secret</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setLocalSecret(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-100 font-mono text-sm focus:outline-none focus:border-emerald-500"
              placeholder="Paste ADMIN_SECRET"
            />
          </div>
          {error && <div className="text-xs text-rose-400">{error}</div>}
          <button
            type="submit"
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded text-sm transition"
          >
            Authenticate Console
          </button>
        </form>
      </div>
    );
  }

  const filtered = payments.filter((p) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      p.customerEmail?.toLowerCase().includes(q) ||
      p.referenceNumber?.toLowerCase().includes(q) ||
      p.package?.toLowerCase().includes(q)
    );
  });

  const totalRevenue = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const pendingSettlementCount = payments.filter((p) => p.bankSettlementStatus === "pending_settlement").length;
  const confirmedCount = payments.filter((p) => p.bankSettlementStatus === "bank_confirmed").length;
  const suspendedCount = payments.filter((p) => p.accessStatus === "suspended").length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <CreditCard className="w-7 h-7 text-emerald-400" />
              <h1 className="text-2xl font-black tracking-tight text-white">Payment & Usage Monitoring</h1>
              <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                Trust-Based Model Active
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Monitored Inbox: <code className="text-slate-300">donations.ontarioparentassist@gmail.com</code> | Public: <code className="text-slate-300">chris@cyfsanavigator.com</code>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchPayments()}
              disabled={loading}
              className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button
              onClick={() => {
                setAuthed(false);
                setSecret("");
              }}
              className="px-3 py-2 rounded bg-slate-900 hover:bg-slate-800 text-xs text-slate-400 border border-slate-800"
            >
              Lock Console
            </button>
          </div>
        </div>

        {actionSuccess && (
          <div className="p-3 bg-emerald-950/60 border border-emerald-800 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" /> {actionSuccess}
          </div>
        )}
        {error && (
          <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-lg text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400" /> {error}
          </div>
        )}

        {/* Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider">Total Purchases</div>
            <div className="text-2xl font-black text-white mt-1">{payments.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">${totalRevenue.toFixed(2)} CAD Total</div>
          </div>
          <div className="bg-slate-900 border border-amber-900/40 p-4 rounded-xl">
            <div className="text-[11px] text-amber-400 uppercase tracking-wider">Pending Bank Settlement</div>
            <div className="text-2xl font-black text-amber-300 mt-1">{pendingSettlementCount}</div>
            <div className="text-xs text-amber-500/80 mt-0.5">Trust access granted</div>
          </div>
          <div className="bg-slate-900 border border-emerald-900/40 p-4 rounded-xl">
            <div className="text-[11px] text-emerald-400 uppercase tracking-wider">Bank Confirmed</div>
            <div className="text-2xl font-black text-emerald-300 mt-1">{confirmedCount}</div>
            <div className="text-xs text-emerald-500/80 mt-0.5">Verified deposited</div>
          </div>
          <div className="bg-slate-900 border border-rose-900/40 p-4 rounded-xl">
            <div className="text-[11px] text-rose-400 uppercase tracking-wider">Suspended Sessions</div>
            <div className="text-2xl font-black text-rose-300 mt-1">{suspendedCount}</div>
            <div className="text-xs text-rose-500/80 mt-0.5">Cutoff enforced</div>
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 px-3.5 py-2 rounded-lg">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Filter by customer email, reference number (PS-XXXXX), or package..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
          />
        </div>

        {/* Customer Purchases & Usage Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-900/70 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Customer Entitlements & Credit Usage</h2>
            <span className="text-xs text-slate-400">{filtered.length} records</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Reference</th>
                  <th className="py-3 px-4">Customer Email</th>
                  <th className="py-3 px-4">Package</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Settlement Status</th>
                  <th className="py-3 px-4">Credits (Used / Max)</th>
                  <th className="py-3 px-4">Remaining</th>
                  <th className="py-3 px-4">Access Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500">
                      No customer payment records matching filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => {
                    const isProcessing = processingRef === row.referenceNumber;
                    return (
                      <tr key={row.referenceNumber} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                          {row.referenceNumber}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-200">
                          {row.customerEmail || "(unregistered)"}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-300">
                          {row.package}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-200">
                          ${row.amount} CAD
                        </td>
                        <td className="py-3 px-4">
                          {row.bankSettlementStatus === "bank_confirmed" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                              <CheckCircle2 className="w-3 h-3" /> Confirmed
                            </span>
                          ) : row.bankSettlementStatus === "missing_or_disputed" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800">
                              <AlertTriangle className="w-3 h-3" /> Disputed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">
                              <Clock className="w-3 h-3" /> Pending Settlement
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono">
                          <span className="text-slate-200 font-bold">{row.creditsConsumed}</span> / {row.creditsGranted}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold">
                          {row.creditsRemaining > 0 ? (
                            <span className="text-emerald-400">{row.creditsRemaining}</span>
                          ) : (
                            <span className="text-rose-400">0 (CUTOFF)</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {row.accessStatus === "active" ? (
                            <span className="text-[11px] text-emerald-400 font-medium">Active</span>
                          ) : row.accessStatus === "suspended" ? (
                            <span className="text-[11px] text-rose-400 font-bold bg-rose-950/80 px-2 py-0.5 rounded border border-rose-800">
                              Suspended
                            </span>
                          ) : row.accessStatus === "code_issued" ? (
                            <span className="text-[11px] text-sky-400">Code Issued</span>
                          ) : (
                            <span className="text-[11px] text-slate-500">{row.accessStatus}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                          {row.bankSettlementStatus !== "bank_confirmed" && (
                            <button
                              onClick={() => handleConfirmBank(row.referenceNumber)}
                              disabled={isProcessing}
                              className="px-2 py-1 text-[11px] font-semibold rounded bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-700 transition"
                            >
                              Confirm Deposit
                            </button>
                          )}

                          {row.bankSettlementStatus !== "missing_or_disputed" && (
                            <button
                              onClick={() => handleDispute(row.referenceNumber)}
                              disabled={isProcessing}
                              className="px-2 py-1 text-[11px] font-semibold rounded bg-amber-950 hover:bg-amber-900 text-amber-300 border border-amber-800 transition"
                            >
                              Flag Disputed
                            </button>
                          )}

                          {row.sessionId && row.accessStatus === "active" && (
                            <button
                              onClick={() => handleSuspend(row.sessionId!, row.referenceNumber)}
                              disabled={isProcessing}
                              className="px-2 py-1 text-[11px] font-semibold rounded bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800 transition"
                            >
                              Suspend
                            </button>
                          )}

                          {row.sessionId && row.accessStatus === "suspended" && (
                            <button
                              onClick={() => handleRestore(row.sessionId!, row.referenceNumber)}
                              disabled={isProcessing}
                              className="px-2 py-1 text-[11px] font-semibold rounded bg-sky-950 hover:bg-sky-900 text-sky-300 border border-sky-800 transition"
                            >
                              Restore
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
