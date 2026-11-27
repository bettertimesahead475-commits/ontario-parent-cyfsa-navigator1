import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../utils/api";
import { getUserKey } from "../utils/storage";
import type { AccessTier } from "../types";

type OrderState = "awaiting_verification" | "ready_to_activate" | "activated" | "refunded" | "cancelled" | "unknown";
type Order = { referenceNumber: string; plan: string; amount: number; state: OrderState; submittedAt: string | null; instructions?: string; priceOutdated?: boolean };
type Entitlement = { tier: string; expiresAt: string | null; daysLeft: number | null; renewalDue: boolean };

const STATE_LABEL: Record<OrderState, string> = {
  awaiting_verification: "Awaiting payment verification",
  ready_to_activate: "Payment verified — ready to activate",
  activated: "Activated",
  refunded: "Refunded",
  cancelled: "Cancelled",
  unknown: "Status temporarily unavailable",
};

const formatCad = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

/** The signed-in customer's own e-Transfer orders, their status, and one-click activation once an administrator has verified the funds. */
export default function MyOrdersPanel({ signedIn, onActivated, onRenewalDue }: { signedIn: boolean; onActivated: (tier: AccessTier) => void; onRenewalDue?: (tiers: string[]) => void }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [error, setError] = useState("");
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await apiFetch("/api/my-payments");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Your orders could not be loaded.");
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      const active: Entitlement[] = Array.isArray(data.entitlements) ? data.entitlements : [];
      setEntitlements(active);
      onRenewalDue?.(active.filter((e) => e.renewalDue).map((e) => e.tier));
    } catch (err: any) {
      setError(err?.message || "Your orders could not be loaded.");
    }
  }, [onRenewalDue]);

  useEffect(() => {
    if (signedIn) { void load(); return; }
    // Signed out: drop the previous account's orders.
    setOrders(null); setEntitlements([]); setMessage(""); setError("");
    onRenewalDue?.([]);
  }, [signedIn, load, onRenewalDue]);

  const activate = async (referenceNumber: string) => {
    setBusyRef(referenceNumber);
    setMessage("");
    setError("");
    try {
      const res = await apiFetch("/api/claim-purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Activation failed.");
      localStorage.setItem(getUserKey("ps_session_token") || "ps_session_token", data.token);
      localStorage.setItem(getUserKey("ps_session_email") || "ps_session_email", data.email);
      localStorage.setItem(getUserKey("ps_session_tier") || "ps_session_tier", data.tier);
      setMessage(`Your ${data.tier} plan is now active.`);
      onActivated(data.tier);
      await load();
    } catch (err: any) {
      setError(err?.message || "Activation failed.");
    } finally {
      setBusyRef(null);
    }
  };

  if (!signedIn || (orders !== null && orders.length === 0 && entitlements.length === 0 && !error)) return null;

  return (
    <section aria-labelledby="my-orders-heading" className="bg-white border border-gray-100 p-5 rounded-2xl space-y-3 shadow-3xs text-left">
      <div className="flex items-center justify-between gap-3">
        <h3 id="my-orders-heading" className="font-display font-black text-[#0f172a] text-lg">Your orders</h3>
        <button type="button" onClick={() => void load()} className="text-xs font-bold text-indigo-700 hover:underline">Refresh</button>
      </div>
      {entitlements.map((e) => (
        <p key={`${e.tier}-${e.expiresAt}`} className={`text-xs rounded-lg p-2.5 border ${e.renewalDue ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-emerald-50 border-emerald-200 text-emerald-900"}`}>
          <strong>{e.tier}</strong> access is active{e.expiresAt ? ` until ${new Date(e.expiresAt).toLocaleDateString("en-CA")}` : ""}.
          {e.renewalDue ? ` It ends in ${e.daysLeft} day${e.daysLeft === 1 ? "" : "s"}; choose a plan above to renew.` : ""}
        </p>
      ))}
      {orders === null && !error && <p className="text-xs text-slate-500">Loading your orders…</p>}
      <ul className="space-y-2">
        {(orders ?? []).map((o) => (
          <li key={o.referenceNumber} className="border border-slate-100 rounded-lg p-3 text-xs space-y-1.5">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-mono font-bold text-slate-800">{o.referenceNumber}</span>
              <span className="text-slate-600">{o.plan} · {formatCad(o.amount)}</span>
            </div>
            <p className="font-bold text-slate-700">{STATE_LABEL[o.state] ?? STATE_LABEL.unknown}</p>
            {o.state === "awaiting_verification" && o.instructions && <p className="text-slate-600 leading-relaxed">{o.instructions}</p>}
            {o.priceOutdated && <p className="text-amber-800 leading-relaxed">This order was recorded at an outdated price. Do not send a payment for it; choose the plan above for a new reference. If you already paid, contact support with this reference.</p>}
            {o.state === "ready_to_activate" && (
              <button type="button" disabled={busyRef !== null} onClick={() => void activate(o.referenceNumber)}
                className="bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 text-white font-bold px-3 py-1.5 rounded-lg">
                {busyRef === o.referenceNumber ? "Activating…" : "Activate now"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {message && <p role="status" className="text-xs text-emerald-800">{message}</p>}
      {error && <p role="alert" className="text-xs text-rose-800">{error}</p>}
    </section>
  );
}
