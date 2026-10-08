/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { AccessTier } from "../types";
import { Check, Sparkles, Loader2, Shield, ArrowRight, CheckCircle, Scale, Coins } from "lucide-react";
import { getUserKey } from "../utils/storage";
import { useLocation } from "wouter";

interface PricingTabProps {
  currentTier: AccessTier;
  onChangeTier: (tier: AccessTier) => void;
  userEmail?: string;
}

const FALLBACK_TIER_PRICES: Record<"Pro" | "Premium", number> = { Pro: 149, Premium: 49 };
const PAYMENT_EMAIL = "donations.ontarioparentassist@gmail.com";

type CheckoutStage = "idle" | "email" | "awaiting-code" | "verifying" | "success" | "error";

export default function PricingTab({ currentTier, onChangeTier, userEmail = "" }: PricingTabProps) {
  const [, setLocation] = useLocation();
  const [selectedTier, setSelectedTier] = useState<"Pro" | "Premium" | null>(null);
  const [stage, setStage] = useState<CheckoutStage>("idle");
  const [email, setEmail] = useState(userEmail);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [sidebarEmail, setSidebarEmail] = useState(userEmail);
  const [sidebarCode, setSidebarCode] = useState("");
  const [sidebarError, setSidebarError] = useState("");
  const [sidebarBusy, setSidebarBusy] = useState(false);

  // BUG FOUND IN AUDIT: the real prices are enforced server-side in api/services/access.ts,
  // but this component had its own hardcoded copy - two sources of truth that happened to
  // match today but had nothing keeping them in sync. If the backend price ever changed,
  // this page would keep quoting the old number with no warning. There's also an existing
  // /api/access-pricing endpoint that returns the real values but nothing was calling it.
  // Now this fetches the real prices on load, falling back to the hardcoded values only if
  // that fetch fails, so the UI never breaks even when offline/erroring.
  const [TIER_PRICES, setTierPrices] = useState<Record<"Pro" | "Premium", number>>(FALLBACK_TIER_PRICES);
  React.useEffect(() => {
    fetch("/api/access-pricing")
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then(data => {
        if (data?.prices?.Pro && data?.prices?.Premium) {
          setTierPrices(data.prices);
        }
      })
      .catch(() => {
        // Fetch failed - keep the hardcoded fallback values already in state, no user-facing error needed.
      });
  }, []);

  React.useEffect(() => {
    if (!userEmail) return;
    try {
      const pending = localStorage.getItem("cyfsa_pending_plan");
      if (pending === "Pro" || pending === "Premium") {
        localStorage.removeItem("cyfsa_pending_plan");
        setSelectedTier(pending);
        setEmail(userEmail);
        setStage("email");
      }
    } catch {}
  }, [userEmail]);

  const triggerCheckout = (tier: "Pro" | "Premium") => {
    if (!userEmail) {
      try { localStorage.setItem("cyfsa_pending_plan", tier); } catch {}
      setLocation("/signup");
      return;
    }
    setSelectedTier(tier);
    setStage("email");
    setEmail(userEmail);
    setReferenceNumber("");
    setCodeInput("");
    setErrorMessage("");
  };

  const handleCancelCheckout = () => {
    setStage("idle");
    setSelectedTier(null);
  };

  const handleRequestAccess = async () => {
    if (!selectedTier) return;
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setErrorMessage("Enter a valid email address first.");
      return;
    }
    setStage("verifying");
    setErrorMessage("");
    try {
      const res = await fetch("/api/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tier: selectedTier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed.");
      setReferenceNumber(data.referenceNumber);
      setStage("awaiting-code");
    } catch (err: any) {
      setErrorMessage(err.message || "Something went wrong. Try again.");
      setStage("email");
    }
  };

  const redeemCode = async (
    codeToRedeem: string,
    emailToUse: string,
    onError: (msg: string) => void,
    onBusy: (busy: boolean) => void,
    onSuccess: (tier: AccessTier) => void
  ) => {
    if (!codeToRedeem.trim()) {
      onError("Enter your access code first.");
      return;
    }
    onBusy(true);
    onError("");
    try {
      const res = await fetch("/api/activate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailToUse, code: codeToRedeem.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid email or code.");
      localStorage.setItem(getUserKey("ps_session_token") || "ps_session_token", data.token);
      localStorage.setItem(getUserKey("ps_session_email") || "ps_session_email", data.email);
      localStorage.setItem(getUserKey("ps_session_tier") || "ps_session_tier", data.tier);
      onSuccess(data.tier);
    } catch (err: any) {
      onError(err.message || "Verification failed.");
    } finally {
      onBusy(false);
    }
  };

  const handleVerifyInModal = () => {
    redeemCode(
      codeInput,
      email,
      setErrorMessage,
      (busy) => setStage(busy ? "verifying" : "awaiting-code"),
      (tier) => {
        onChangeTier(tier);
        setStage("success");
      }
    );
  };

  const handleVerifyInSidebar = () => {
    redeemCode(sidebarCode, sidebarEmail, setSidebarError, setSidebarBusy, (tier) => {
      onChangeTier(tier);
      setSidebarCode("");
    });
  };

  return (
    <div className="space-y-8 animate-fade-in" id="monetization-view">

      {/* Visual Header Grid */}
      <div className="bg-slate-900 rounded-2xl p-6 md:p-8 text-white relative overflow-hidden shadow-xl" id="pricing-banner-header">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none transform translate-x-12 -translate-y-12">
          <Scale className="w-96 h-96 text-white" />
        </div>
        <div className="relative z-10 max-w-3xl text-left">
          <span className="px-3 py-1 bg-indigo-500/20 text-indigo-300 rounded-full font-mono font-bold tracking-wider text-[10px] uppercase border border-indigo-400/25">
            CYFSA Navigator Funding & Subscriptions
          </span>
          <h1 className="font-display font-black text-2xl md:text-3.5xl tracking-tight mt-3">
            Secure Full Advocacy Tools and Unlimited AI Support
          </h1>
          <p className="text-slate-300 text-xs md:text-sm mt-2 max-w-2xl leading-relaxed">
            Choose your plan, sign in or create your free account, then follow the on-screen Interac e-Transfer checkout. Your payment receives a unique reference so it can be matched securely to your membership.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-lg border border-white/10">
              <span className="text-indigo-300 font-bold font-mono">My Active Tier:</span>
              <span className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] uppercase ${
                currentTier === "Premium" ? "bg-emerald-500 text-white" : currentTier === "Pro" ? "bg-indigo-500 text-white" : "bg-slate-700 text-slate-300"
              }`}>
                {currentTier} Plan
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid of Plans */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2" id="pricing-plan-grid">

        {/* Basic Plan */}
        <div className={`bg-white rounded-2xl border p-6 text-left flex flex-col justify-between transition-all relative ${
          currentTier === "Basic" ? "border-slate-300 ring-2 ring-slate-100 shadow-sm" : "border-gray-100 hover:border-gray-200"
        }`} id="plan-basic-card">
          {currentTier === "Basic" && (
            <span className="absolute top-4 right-4 bg-slate-100 text-slate-800 font-mono text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Selected</span>
          )}
          <div className="space-y-4">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Basic Tier</span>
              <h3 className="font-display font-extrabold text-xl text-slate-800 mt-1">Free / Self-Represented</h3>
              <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                On-screen document understanding. No premium report download/export/print.
              </p>
            </div>
            <div className="py-2">
              <span className="font-display font-black text-3.5xl text-slate-900">$0</span>
              <span className="text-gray-400 text-xs font-semibold font-sans"> / forever CAD</span>
            </div>
            <div className="border-t border-slate-100 pt-4 space-y-2.5">
              <div className="flex items-start gap-2.5 text-xs text-slate-700">
                <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>CYFSA Statutory Search Guides</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-slate-700">
                <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>Ontario Family Court Process Checklists</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-slate-700">
                <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>On-Screen Document Understanding & Timelines</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-slate-600 line-through opacity-60">
                <span>Premium Report Download / Export / Print</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-slate-600 line-through opacity-60">
                <span>Forensic In-Depth Multi-Document Analysis</span>
              </div>
            </div>
          </div>
          <div className="pt-6 mt-auto">
            <button type="button" disabled className="w-full py-2.5 bg-slate-50 border border-slate-200 text-slate-500 text-xs font-bold rounded-xl cursor-not-allowed uppercase tracking-wider">
              {currentTier === "Basic" ? "Active Plan" : "Free Default"}
            </button>
          </div>
        </div>

        {/* Pro Plan - Individual / Family Case Access */}
        <div className={`bg-gradient-to-b from-white to-slate-50 rounded-2xl border-2 p-6 text-left flex flex-col justify-between transition-all relative ${
          currentTier === "Pro" ? "border-indigo-600 ring-4 ring-indigo-50 shadow-md" : "border-indigo-200/80 hover:border-indigo-300 shadow-xs"
        }`} id="plan-pro-card">
          <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-indigo-950 text-white font-mono text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-sm flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <span>Most Popular Choice</span>
          </div>
          {currentTier === "Pro" && (
            <span className="absolute top-4 right-4 bg-indigo-600 text-white font-mono text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Selected</span>
          )}
          <div className="space-y-4">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-indigo-600">Individual & Family</span>
              <h3 className="font-display font-extrabold text-xl text-slate-800 mt-1">Individual / Family Case Access</h3>
              <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                Includes premium platform access and five Forensic In-Depth analyses per billing cycle.
              </p>
            </div>
            <div className="py-2">
              <span className="font-display font-black text-3.5xl text-slate-900">${TIER_PRICES.Pro}</span>
              <span className="text-gray-400 text-xs font-semibold font-sans"> / month CAD</span>
            </div>
            <div className="border-t border-slate-100 pt-4 space-y-2.5">
              <div className="flex items-start gap-2.5 text-xs text-slate-800">
                <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <span className="font-semibold">Full Premium Platform Access</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-slate-700">
                <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <span>5 Forensic In-Depth Analyses per cycle</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-slate-700">
                <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <span>All 5 Court Template Builders Unlocked</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-slate-700">
                <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <span>Multi-File RAG Chat & Forensic Workspace</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-slate-700">
                <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <span>Professional Lawyer PDF Export Desk</span>
              </div>
            </div>
          </div>
          <div className="pt-6 mt-auto">
            {currentTier === "Pro" ? (
              <button type="button" disabled className="w-full py-2.5 bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold rounded-xl cursor-not-allowed uppercase tracking-wider">
                Selected Plan Active
              </button>
            ) : (
              <button type="button" onClick={() => triggerCheckout("Pro")} className="w-full py-2.5 bg-indigo-950 hover:bg-indigo-900 border border-indigo-950 text-white text-xs font-bold rounded-xl transition shadow-xs hover:shadow-md uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2">
                <span>{userEmail ? "Upgrade to Individual Access" : "Sign Up & Choose Individual Access"}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Premium Plan */}
        <div className={`bg-gradient-to-b from-white to-emerald-50/20 rounded-2xl border p-6 text-left flex flex-col justify-between transition-all relative ${
          currentTier === "Premium" ? "border-emerald-600 ring-4 ring-emerald-50 shadow-md" : "border-gray-100 hover:border-gray-200"
        }`} id="plan-premium-card">
          {currentTier === "Premium" && (
            <span className="absolute top-4 right-4 bg-emerald-600 text-white font-mono text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Selected</span>
          )}
          <div className="space-y-4">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-600">Premium Attorney</span>
              <h3 className="font-display font-extrabold text-xl text-slate-800 mt-1">Full Legal Defense</h3>
              <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                Complete system listing, advanced audio roleplay preps, and priority compute processing.
              </p>
            </div>
            <div className="py-2">
              <span className="font-display font-black text-3.5xl text-slate-900">${TIER_PRICES.Premium}</span>
              <span className="text-gray-400 text-xs font-semibold font-sans"> / month CAD</span>
            </div>
            <div className="border-t border-slate-100 pt-4 space-y-2.5">
              <div className="flex items-start gap-2.5 text-xs text-slate-800 font-semibold">
                <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>All Pro features included</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-slate-700">
                <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>Exclusive Attorney Listing Profile Slots</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-slate-700">
                <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>Priority RAG vector indexing compute</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-slate-700">
                <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>Unlimited Audio Voice Transcription hours</span>
              </div>
            </div>
          </div>
          <div className="pt-6 mt-auto">
            {currentTier === "Premium" ? (
              <button type="button" disabled className="w-full py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl cursor-not-allowed uppercase tracking-wider">
                Selected Plan Active
              </button>
            ) : (
              <button type="button" onClick={() => triggerCheckout("Premium")} className="w-full py-2.5 bg-emerald-900 hover:bg-emerald-950 border border-emerald-900 text-white text-xs font-bold rounded-xl transition shadow-xs hover:shadow-md uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2">
                <span>{userEmail ? "Choose Premium" : "Sign Up & Choose Premium"}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Community & Organizational Sponsorships */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 md:p-8 text-left space-y-6" id="community-sponsorship-tiers">
        <div className="max-w-3xl">
          <span className="px-3 py-1 bg-brand-50 text-brand-700 rounded-full font-mono font-bold tracking-wider text-[10px] uppercase border border-brand-200">
            Organizational & Community Access
          </span>
          <h2 className="font-display font-extrabold text-xl text-slate-900 mt-2">
            Community & Legal Clinic Sponsorship Tiers
          </h2>
          <p className="text-slate-600 text-xs md:text-sm mt-1">
            Empower legal clinics, Indigenous child & family services, grassroots advocacy groups, and family defense collectives with sponsored multi-seat case access.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
            <span className="text-[10px] font-mono font-bold uppercase text-indigo-600 tracking-wider">Community 5</span>
            <div className="font-display font-black text-2xl text-slate-900">$2,000 <span className="text-xs font-normal text-slate-500">/mo CAD</span></div>
            <p className="text-xs text-slate-600 font-medium">5 sponsored families</p>
            <p className="text-[11px] text-slate-500">Full platform and forensic analysis allocations for 5 active matters.</p>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
            <span className="text-[10px] font-mono font-bold uppercase text-indigo-600 tracking-wider">Community 10</span>
            <div className="font-display font-black text-2xl text-slate-900">$3,500 <span className="text-xs font-normal text-slate-500">/mo CAD</span></div>
            <p className="text-xs text-slate-600 font-medium">10 sponsored families</p>
            <p className="text-[11px] text-slate-500">Dedicated casework allocations for 10 active parent matters.</p>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
            <span className="text-[10px] font-mono font-bold uppercase text-indigo-600 tracking-wider">Community 25</span>
            <div className="font-display font-black text-2xl text-slate-900">$7,500 <span className="text-xs font-normal text-slate-500">/mo CAD</span></div>
            <p className="text-xs text-slate-600 font-medium">25 sponsored families</p>
            <p className="text-[11px] text-slate-500">Full-scale community organization allocation for 25 parent matters.</p>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
            <span className="text-[10px] font-mono font-bold uppercase text-emerald-600 tracking-wider">Regional / Enterprise</span>
            <div className="font-display font-black text-2xl text-slate-900">Custom <span className="text-xs font-normal text-slate-500">pricing</span></div>
            <p className="text-xs text-slate-600 font-medium">25+ sponsored families</p>
            <p className="text-[11px] text-slate-500">Regional service authorities, band councils, and multi-office legal teams.</p>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 italic">
          For organizational billing, direct invoicing, or customized allocations, contact our intake team at <a href={`mailto:${PAYMENT_EMAIL}`} className="text-brand-600 underline font-semibold">{PAYMENT_EMAIL}</a>.
        </p>
      </div>

      <div className="bg-white border-2 border-indigo-100 rounded-2xl p-6 md:p-7 shadow-sm" id="checkout-how-it-works">
        <div className="flex flex-col md:flex-row gap-5 md:items-center md:justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">How membership works</span>
            <h2 className="text-xl font-black text-slate-900 mt-1">Sign up, pay, activate — all from this page</h2>
            <p className="text-sm text-slate-600 mt-2 max-w-2xl leading-6">Choose Pro or Premium above. If you are not signed in, we will take you to secure Google sign-in first and bring you back to checkout. Then CYFSA Navigator creates your unique payment reference and shows the exact e-Transfer amount, address, and memo.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 shrink-0 text-center">
            {["1. Sign in","2. Send e-Transfer","3. Activate"].map(step => <div key={step} className="px-3 py-3 rounded-xl bg-slate-50 border text-xs font-bold text-slate-700">{step}</div>)}
          </div>
        </div>
      </div>

      {/* Real e-transfer activation widget — server-verified, no demo codes */}
      <div className="bg-linear-to-r from-[#eef2ff] to-[#f0fdf4] border border-indigo-100 rounded-2xl p-6 text-left shadow-2xs space-y-4" id="etransfer-activator">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <span className="bg-indigo-100 text-indigo-800 border border-indigo-200 text-[10px] uppercase font-mono font-bold px-2.5 py-0.5 rounded-full tracking-wider inline-block">
              Already have a code?
            </span>
            <h3 className="font-display font-black text-[#0f172a] text-lg flex items-center gap-2">
              <Coins className="w-5 h-5 text-indigo-700 shrink-0" />
              <span>Activate with your Access Code</span>
            </h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              If you already sent an Interac e-Transfer to <strong>{PAYMENT_EMAIL}</strong> and received a code, enter the same email and code here to unlock instantly. To start a new payment, use the Upgrade buttons above.
            </p>
          </div>

          <div className="bg-white border text-left border-gray-100 p-5 rounded-2xl space-y-2.5 shrink-0 w-full md:w-80 shadow-3xs">
            <span className="text-[10px] uppercase font-bold text-slate-500 font-mono tracking-widest block">Activate</span>
            <input
              type="email"
              placeholder="the email you used to pay"
              value={sidebarEmail}
              onChange={(e) => setSidebarEmail(e.target.value)}
              className="w-full text-xs border border-slate-200 bg-slate-50 text-slate-800 p-2.5 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <input
              type="text"
              placeholder="XXXX-XXXX-XX"
              value={sidebarCode}
              onChange={(e) => setSidebarCode(e.target.value)}
              className="w-full text-xs font-mono border border-slate-200 bg-slate-50 text-slate-800 p-2.5 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 uppercase tracking-widest text-center"
            />
            {sidebarError && <p className="text-[10px] text-red-600 font-semibold">{sidebarError}</p>}
            <button
              type="button"
              onClick={handleVerifyInSidebar}
              disabled={sidebarBusy}
              className="w-full py-2.5 bg-indigo-950 hover:bg-indigo-900 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition tracking-wide uppercase select-none cursor-pointer text-center"
            >
              {sidebarBusy ? "Verifying..." : "Verify & Activate"}
            </button>
          </div>
        </div>
      </div>

      {/* Trust badging */}
      <div className="bg-white border rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6" id="monetization-trust-badges">
        <div className="flex items-start gap-4 text-left max-w-xl">
          <div className="p-3 bg-slate-100 rounded-xl text-slate-700 shrink-0 mt-1">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-display font-bold text-gray-900 text-sm">Ontario Legal Compliance & Data Privacy</h4>
            <p className="text-gray-500 text-xs mt-1 leading-relaxed">
              No card numbers are ever collected. Payment is by Interac e-Transfer, matched manually against your reference number before any access code is issued.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-gray-400 shrink-0">
          <div className="flex flex-col items-center">
            <span className="font-mono text-xs font-bold text-slate-800">INTERAC</span>
            <span className="text-[10px] text-gray-400">e-Transfer Only</span>
          </div>
          <div className="w-px h-8 bg-gray-200"></div>
          <div className="flex flex-col items-center">
            <span className="font-mono text-xs font-bold text-slate-800">ACCESS CODE</span>
            <span className="text-[10px] text-gray-400">Server-Verified</span>
          </div>
        </div>
      </div>

      {/* Checkout drawer — real request/verify flow, no simulated payment */}
      {stage !== "idle" && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[100] p-4 font-sans animate-fade-in" id="checkout-sheet-modal">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-100 overflow-hidden text-left relative flex flex-col max-h-[90vh]">

            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-400/20">
                  <Coins className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-extrabold text-sm uppercase tracking-wide">Interac e-Transfer Activation</h3>
                  <p className="text-[10px] text-emerald-400 font-semibold font-mono">{selectedTier} Plan — ${selectedTier ? TIER_PRICES[selectedTier] : 0} CAD</p>
                </div>
              </div>
              {stage !== "verifying" && stage !== "success" && (
                <button onClick={handleCancelCheckout} className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer transition-colors">✕</button>
              )}
            </div>

            {/* Stage: enter email, request a reference number */}
            {stage === "email" && (
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Confirm the signed-in email below. This email links your payment request and is required when you activate the access code.
                </p>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  readOnly={Boolean(userEmail)}
                  className="w-full text-sm border border-slate-200 bg-slate-50 text-slate-800 p-3 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 read-only:bg-slate-100"
                />
                {errorMessage && <p className="text-xs text-red-600 font-semibold">{errorMessage}</p>}
                <button type="button" onClick={handleRequestAccess} className="w-full py-3 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-bold rounded-xl transition cursor-pointer uppercase tracking-wider">
                  Create Payment Instructions
                </button>
              </div>
            )}

            {/* Stage: instructions + code entry */}
            {stage === "awaiting-code" && (
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                <div className="bg-white border rounded-lg p-3 space-y-2.5 text-xs">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">1. Send Interac e-Transfer To:</span>
                    <span className="bg-slate-900 text-white font-mono text-xs font-bold px-2.5 py-1 rounded border border-slate-950 select-all tracking-wide inline-block w-fit">
                      {PAYMENT_EMAIL}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                    <div>
                      <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">2. Amount:</span>
                      <span className="font-semibold text-slate-800">${selectedTier ? TIER_PRICES[selectedTier] : 0} CAD</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">3. Transfer Memo:</span>
                      <span className="font-mono text-[11px] text-slate-800 underline break-all select-all font-bold">{referenceNumber}</span>
                    </div>
                  </div>
                </div>
                <p className="text-[10.5px] text-gray-500 leading-relaxed italic">
                  Keep this page or return later. The system checks incoming e-Transfers against your unique reference. After approval, your access code is sent to your payment email. Enter it below to unlock your plan.
                </p>
                <div className="bg-white border border-indigo-100 p-4 rounded-xl space-y-3 shadow-3xs">
                  <label className="text-[10.5px] font-mono font-bold text-indigo-900 uppercase tracking-wider block">Enter Access Code</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="XXXX-XXXX-XX"
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value)}
                      className="flex-1 text-xs font-mono border border-slate-200 bg-slate-50 text-slate-800 p-2.5 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 uppercase tracking-widest text-center"
                    />
                    <button type="button" onClick={handleVerifyInModal} className="px-4 py-2.5 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-bold rounded-lg transition tracking-wide uppercase select-none cursor-pointer">
                      Verify
                    </button>
                  </div>
                  {errorMessage && <p className="text-[10px] text-red-600 font-semibold">{errorMessage}</p>}
                </div>
                <button type="button" onClick={handleCancelCheckout} className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition cursor-pointer text-center">
                  Close (I'll enter my code later)
                </button>
              </div>
            )}

            {/* Stage: request/verify in flight */}
            {stage === "verifying" && (
              <div className="p-12 text-center flex flex-col items-center justify-center space-y-6">
                <Loader2 className="w-12 h-12 text-indigo-900 animate-spin" />
                <div className="space-y-1">
                  <h4 className="font-display font-extrabold text-slate-800 text-base">Working...</h4>
                  <p className="text-xs text-gray-500">Talking to the server, one moment.</p>
                </div>
              </div>
            )}

            {/* Stage: success */}
            {stage === "success" && (
              <div className="p-10 text-center flex flex-col items-center justify-center space-y-6 animate-fade-in" id="checkout-success-feedback">
                <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shadow-xs shadow-emerald-200">
                  <Check className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h4 className="font-display font-black text-indigo-950 text-lg">Access Unlocked!</h4>
                  <p className="text-xs text-indigo-800 max-w-sm mx-auto leading-relaxed">
                    Your <strong>{selectedTier} Plan</strong> is now active for this device.
                  </p>
                </div>
                <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4 w-full text-left space-y-2">
                  <div className="flex items-center gap-2 text-xs text-emerald-800">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span>Free-tier limits disabled</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-emerald-800">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span>All template workbooks active</span>
                  </div>
                </div>
                <button type="button" onClick={handleCancelCheckout} className="w-full py-3 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-bold rounded-xl transition cursor-pointer text-center font-display tracking-wider uppercase shadow-xs hover:shadow-sm">
                  Return to Workspace
                </button>
              </div>
            )}

          </div>
        </div>
      )}

    </div>
  );
}
