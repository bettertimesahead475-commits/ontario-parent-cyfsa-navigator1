/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { AccessTier } from "../types";
import {
  Check,
  Sparkles,
  Loader2,
  Shield,
  ArrowRight,
  CheckCircle,
  Scale,
  Coins,
  Info,
  HelpCircle,
  FileText,
  AlertTriangle,
  X,
  Copy,
  ExternalLink,
  FileSearch,
  Lock,
} from "lucide-react";
import { getUserKey } from "../utils/storage";
import { useLocation } from "wouter";
import { auth, signInMinimal } from "../utils/firebase";
import { apiFetch } from "../utils/api";

interface PricingTabProps {
  currentTier: AccessTier;
  onChangeTier: (tier: AccessTier) => void;
  userEmail?: string;
}

const FALLBACK_TIER_PRICES: Record<string, number> = {
  Basic: 19.99,
  AnalyzerBasic: 19.99,
  Premium: 49.99,
  AnalyzerPremium: 49.99,
  Pro: 149,
  Community5: 2000,
  Community10: 3500,
  Community25: 7500,
};

const PAYMENT_EMAIL = "chris@cyfsanavigator.com";

type PurchasableTier = "Pro" | "Premium" | "Basic" | "Community5" | "Community10" | "Community25";
type CheckoutStage = "idle" | "email" | "awaiting-code" | "verifying" | "success" | "error";

export default function PricingTab({ currentTier, onChangeTier, userEmail = "" }: PricingTabProps) {
  const [, setLocation] = useLocation();
  const [selectedTier, setSelectedTier] = useState<PurchasableTier | null>(null);
  const [stage, setStage] = useState<CheckoutStage>("idle");
  const [email, setEmail] = useState(userEmail);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [copiedMemo, setCopiedMemo] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  // Activator state
  const [sidebarEmail, setSidebarEmail] = useState(userEmail);
  const [sidebarCode, setSidebarCode] = useState("");
  const [sidebarError, setSidebarError] = useState("");
  const [sidebarBusy, setSidebarBusy] = useState(false);
  const [sidebarSuccess, setSidebarSuccess] = useState(false);

  // Authoritative prices & product configurations retrieved from /api/access-pricing
  const [TIER_PRICES, setTierPrices] = useState<Record<string, number>>(FALLBACK_TIER_PRICES);

  useEffect(() => {
    fetch("/api/access-pricing")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (data?.prices) {
          setTierPrices((prev) => ({
            ...prev,
            ...data.prices,
            ...(data.legacy_prices || {}),
          }));
        }
      })
      .catch(() => {
        // Fetch failed - keep the hardcoded fallback values already in state
      });
  }, []);

  // Sync user email when auth state changes
  useEffect(() => {
    if (userEmail) {
      setEmail(userEmail);
      setSidebarEmail(userEmail);
    }
  }, [userEmail]);

  // Handle pending plan stored prior to signup/login
  useEffect(() => {
    if (!userEmail) return;
    try {
      const pending = localStorage.getItem("cyfsa_pending_plan") as PurchasableTier | null;
      if (pending && (pending === "Pro" || pending === "Premium" || pending === "Basic" || pending.startsWith("Community"))) {
        localStorage.removeItem("cyfsa_pending_plan");
        setSelectedTier(pending);
        setEmail(userEmail);
        setStage("email");
      }
    } catch {}
  }, [userEmail]);

  const triggerCheckout = (tier: PurchasableTier) => {
    setSelectedTier(tier);
    setReferenceNumber("");
    setCodeInput("");
    setErrorMessage("");
    setCopiedMemo(false);
    setCopiedEmail(false);
    if (!userEmail) {
      try {
        localStorage.setItem("cyfsa_pending_plan", tier);
      } catch {}
      setStage("email");
      return;
    }
    setEmail(userEmail);
    setStage("email");
  };

  const handleCancelCheckout = () => {
    setStage("idle");
    setSelectedTier(null);
    setErrorMessage("");
  };

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setErrorMessage("");
    try {
      const user = await signInMinimal();
      if (user?.email) {
        setEmail(user.email);
        setSidebarEmail(user.email);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Sign-in was cancelled or failed. Please try again.");
    } finally {
      setIsSigningIn(false);
    }
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
      const res = await apiFetch("/api/request-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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
      const res = await apiFetch("/api/activate-code", {
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
      onError(err.message || "Verification failed. Check your email and access code.");
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
    setSidebarSuccess(false);
    redeemCode(sidebarCode, sidebarEmail, setSidebarError, setSidebarBusy, (tier) => {
      onChangeTier(tier);
      setSidebarSuccess(true);
      setSidebarCode("");
    });
  };

  const copyToClipboard = (text: string, type: "memo" | "email") => {
    try {
      navigator.clipboard.writeText(text);
      if (type === "memo") {
        setCopiedMemo(true);
        setTimeout(() => setCopiedMemo(false), 2500);
      } else {
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 2500);
      }
    } catch {}
  };

  const getTierDisplayLabel = (tier: AccessTier) => {
    switch (tier) {
      case "Pro":
        return "Individual / Family Case Access ($149/mo)";
      case "Premium":
        return "Document Analyzer — Premium ($49.99)";
      case "Basic":
        return "Free Default / Basic Plan";
      case "Community5":
        return "Community 5 ($2,000/mo)";
      case "Community10":
        return "Community 10 ($3,500/mo)";
      case "Community25":
        return "Community 25 ($7,500/mo)";
      default:
        return `${tier} Plan`;
    }
  };

  return (
    <div className="space-y-10 animate-fade-in text-slate-900" id="monetization-view">
      {/* 1. Header Banner */}
      <div
        className="bg-slate-950 rounded-2xl md:rounded-3xl p-6 sm:p-8 md:p-10 text-white relative overflow-hidden shadow-2xl border border-blue-900/40"
        style={{
          background:
            "radial-gradient(ellipse at 85% 30%, rgba(37, 99, 235, 0.28) 0%, rgba(14, 165, 233, 0.08) 40%, transparent 70%), linear-gradient(135deg, #030d22 0%, #071940 50%, #0a2558 100%)",
        }}
        id="pricing-banner-header"
      >
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none transform translate-x-12 -translate-y-12">
          <Scale className="w-96 h-96 text-white" />
        </div>
        <div className="relative z-10 max-w-3xl text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1 bg-blue-500/20 text-blue-300 rounded-full font-mono font-bold tracking-wider text-[11px] uppercase border border-blue-400/30">
              CYFSA Navigator Funding &amp; Membership
            </span>
            <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full font-mono font-semibold text-[10px] uppercase border border-emerald-500/30">
              Clear &amp; Upfront Pricing
            </span>
          </div>

          <h1 className="font-display font-black text-2xl sm:text-3xl md:text-4xl tracking-tight text-white mt-4">
            Membership Plans &amp; Document Analyzer Access
          </h1>

          <p className="text-blue-100/90 text-sm md:text-base mt-3 max-w-2xl leading-relaxed">
            Choose transparent, accessible access for self-represented Ontario parents and family advocates. Review documents, audit allegations, organize your case files, and prepare focused questions for counsel.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-2 bg-white/10 px-3.5 py-2 rounded-xl border border-white/15 backdrop-blur-xs">
              <span className="text-blue-300 font-bold font-mono">Your Current Status:</span>
              <span
                className={`px-2.5 py-0.5 rounded font-mono font-bold text-[11px] uppercase ${
                  currentTier === "Pro"
                    ? "bg-indigo-600 text-white"
                    : currentTier === "Premium"
                    ? "bg-purple-600 text-white"
                    : currentTier?.startsWith("Community")
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-700 text-slate-200"
                }`}
              >
                {getTierDisplayLabel(currentTier)}
              </span>
            </div>

            {userEmail && (
              <span className="text-slate-300 text-xs font-mono">
                Signed in as: <strong className="text-white">{userEmail}</strong>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2. Core Pricing Grid (4 Plans) */}
      <section className="space-y-4" aria-labelledby="primary-plans-heading">
        <div className="text-left">
          <h2 id="primary-plans-heading" className="font-display font-black text-2xl text-slate-900 tracking-tight">
            Choose Your Access Level
          </h2>
          <p className="text-slate-600 text-sm mt-1">
            Clearly structured packages. Single-document review packs are one-time payments with no subscription; Case Access provides monthly platform membership.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 pt-2" id="pricing-plan-grid">
          {/* PLAN 1: Free / Self-Represented */}
          <div
            className={`bg-white rounded-2xl border p-6 text-left flex flex-col justify-between transition-all relative ${
              currentTier === "Basic"
                ? "border-blue-400 ring-2 ring-blue-100 shadow-md"
                : "border-slate-200 hover:border-slate-300 shadow-xs"
            }`}
            id="plan-basic-card"
          >
            {currentTier === "Basic" && (
              <span className="absolute top-4 right-4 bg-blue-50 text-blue-800 border border-blue-200 font-mono text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                Current Default
              </span>
            )}
            <div className="space-y-4">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500 font-mono">
                  Educational Preview
                </span>
                <h3 className="font-display font-extrabold text-xl text-slate-900 mt-1">
                  Free / Self-Represented
                </h3>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  Free on-screen document understanding and statutory CYFSA education.
                </p>
              </div>

              <div className="py-2 border-y border-slate-100">
                <div className="flex items-baseline gap-1">
                  <span className="font-display font-black text-3xl sm:text-4xl text-slate-900">$0</span>
                  <span className="text-slate-500 text-xs font-semibold">CAD</span>
                </div>
                <span className="text-[11px] font-mono text-emerald-700 font-semibold block mt-0.5">
                  Free Forever • No card needed
                </span>
              </div>

              {/* Allocation pill */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1">
                <span className="font-bold text-slate-900 block font-mono text-[11px] uppercase tracking-wider">
                  Analysis Allocation:
                </span>
                <p className="text-slate-700 font-semibold text-xs flex items-center gap-1.5">
                  <FileSearch className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span>1 Free Quick Document Review</span>
                </p>
                <p className="text-[10.5px] text-slate-500 leading-tight pt-1 border-t border-slate-200/60">
                  When used, your on-screen report remains viewable. Upgrade to analyze new files.
                </p>
              </div>

              {/* Feature list */}
              <div className="space-y-2.5 pt-1 text-xs text-slate-700">
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>1 Free Quick Document Review</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>CYFSA Statutory Search Guides</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Ontario Family Court Process Checklists</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>On-Screen Document Understanding &amp; Timelines</span>
                </div>
                <div className="flex items-start gap-2.5 text-slate-400 line-through">
                  <span>Printable / PDF Lawyer Export Brief</span>
                </div>
                <div className="flex items-start gap-2.5 text-slate-400 line-through">
                  <span>Forensic In-Depth Dual-Pass scanning</span>
                </div>
                <div className="flex items-start gap-2.5 text-slate-400 line-through">
                  <span>Case Workspace &amp; Evidence Vault</span>
                </div>
              </div>
            </div>

            <div className="pt-6 mt-auto">
              <button
                type="button"
                disabled
                className="w-full py-3 bg-slate-100 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl cursor-default uppercase tracking-wider"
              >
                {currentTier === "Basic" ? "Active Default" : "Free Default"}
              </button>
            </div>
          </div>

          {/* PLAN 2: Analyzer Basic */}
          <div
            className="bg-white rounded-2xl border border-slate-200 hover:border-blue-400 p-6 text-left flex flex-col justify-between transition-all shadow-xs"
            id="plan-analyzer-basic-card"
          >
            <div className="space-y-4">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-blue-700 font-mono">
                  Document Review Pack
                </span>
                <h3 className="font-display font-extrabold text-xl text-slate-900 mt-1">
                  Analyzer Basic
                </h3>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  Single-document reviews with contemporaneous fact vs allegation audit.
                </p>
              </div>

              <div className="py-2 border-y border-slate-100">
                <div className="flex items-baseline gap-1">
                  <span className="font-display font-black text-3xl sm:text-4xl text-slate-900">
                    ${TIER_PRICES.Basic || 19.99}
                  </span>
                  <span className="text-slate-500 text-xs font-semibold">CAD</span>
                </div>
                <span className="text-[11px] font-mono text-blue-700 font-semibold block mt-0.5">
                  One-Time Payment • No Subscription
                </span>
              </div>

              {/* Allocation pill */}
              <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3 text-xs space-y-1">
                <span className="font-bold text-blue-950 block font-mono text-[11px] uppercase tracking-wider">
                  Analysis Allocation:
                </span>
                <p className="text-blue-900 font-bold text-xs flex items-center gap-1.5">
                  <FileSearch className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                  <span>3 Quick Document Reviews included</span>
                </p>
                <p className="text-[10.5px] text-blue-800 leading-tight pt-1 border-t border-blue-200">
                  When 3 analyses are used, saved reports remain accessible. Purchase a new pack anytime.
                </p>
              </div>

              {/* Feature list */}
              <div className="space-y-2.5 pt-1 text-xs text-slate-700">
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span className="font-semibold text-slate-900">3 Quick Document Reviews included</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Fact vs allegation extraction &amp; timeline</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Statutory CYFSA section reference mapping</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Printable on-screen red-flag audit summary</span>
                </div>
                <div className="flex items-start gap-2.5 text-slate-400 line-through">
                  <span>Forensic In-Depth Dual-Pass scanning</span>
                </div>
                <div className="flex items-start gap-2.5 text-slate-400 line-through">
                  <span>Case Workspace &amp; court form builders</span>
                </div>
                <div className="flex items-start gap-2.5 text-slate-400 line-through">
                  <span>Lawyer PDF Brief Export Desk</span>
                </div>
              </div>
            </div>

            <div className="pt-6 mt-auto">
              <button
                type="button"
                onClick={() => triggerCheckout("Basic")}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 active:bg-black text-white text-xs font-bold rounded-xl transition shadow-xs hover:shadow-md uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2"
                id="btn-get-access-analyzer-basic"
              >
                <span>Get Access (${TIER_PRICES.Basic || 19.99})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* PLAN 3: Analyzer Premium */}
          <div
            className={`bg-white rounded-2xl border-2 p-6 text-left flex flex-col justify-between transition-all relative shadow-sm ${
              currentTier === "Premium"
                ? "border-purple-600 ring-4 ring-purple-50"
                : "border-purple-300 hover:border-purple-500"
            }`}
            id="plan-analyzer-premium-card"
          >
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-purple-900 text-white font-mono text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-sm flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-purple-300" />
              <span>Full Forensic Pass</span>
            </div>

            {currentTier === "Premium" && (
              <span className="absolute top-4 right-4 bg-purple-600 text-white font-mono text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                Active Plan
              </span>
            )}

            <div className="space-y-4">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-purple-700 font-mono">
                  Deep Evidence Audit
                </span>
                <h3 className="font-display font-extrabold text-xl text-slate-900 mt-1">
                  Analyzer Premium
                </h3>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  Forensic Dual-Pass analysis, cross-examination vulnerabilities, and hearsay audit.
                </p>
              </div>

              <div className="py-2 border-y border-slate-100">
                <div className="flex items-baseline gap-1">
                  <span className="font-display font-black text-3xl sm:text-4xl text-slate-900">
                    ${TIER_PRICES.Premium || 49.99}
                  </span>
                  <span className="text-slate-500 text-xs font-semibold">CAD</span>
                </div>
                <span className="text-[11px] font-mono text-purple-700 font-semibold block mt-0.5">
                  One-Time Payment • No Subscription
                </span>
              </div>

              {/* Allocation pill */}
              <div className="bg-purple-50/80 border border-purple-200 rounded-xl p-3 text-xs space-y-1">
                <span className="font-bold text-purple-950 block font-mono text-[11px] uppercase tracking-wider">
                  Analysis Allocation:
                </span>
                <p className="text-purple-900 font-bold text-xs flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                  <span>5 Forensic Dual-Pass or Quick Analyses</span>
                </p>
                <p className="text-[10.5px] text-purple-800 leading-tight pt-1 border-t border-purple-200">
                  When 5 analyses are used, saved forensic reports remain accessible. Purchase a new pack anytime.
                </p>
              </div>

              {/* Feature list */}
              <div className="space-y-2.5 pt-1 text-xs text-slate-700">
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <span className="font-semibold text-slate-900">5 Forensic In-Depth Dual-Pass analyses</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <span>Dual-Pass Forensic and Quick Document Reviews</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <span>Cross-examination vulnerability scanner</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <span>Evidentiary Weight &amp; Hearsay objection audit</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <span>Contradiction and discrepancy detection</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <span>Priority analysis processing queue</span>
                </div>
                <div className="flex items-start gap-2.5 text-slate-400 line-through">
                  <span>Case Workspace &amp; court form builders</span>
                </div>
              </div>
            </div>

            <div className="pt-6 mt-auto">
              {currentTier === "Premium" ? (
                <button
                  type="button"
                  disabled
                  className="w-full py-3 bg-purple-50 border border-purple-200 text-purple-800 text-xs font-bold rounded-xl cursor-default uppercase tracking-wider"
                >
                  Active Plan
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => triggerCheckout("Premium")}
                  className="w-full py-3 bg-purple-950 hover:bg-purple-900 active:bg-black text-white text-xs font-bold rounded-xl transition shadow-xs hover:shadow-md uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2"
                  id="btn-get-access-analyzer-premium"
                >
                  <span>Get Access (${TIER_PRICES.Premium || 49.99})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* PLAN 4: Individual Case Access (Pro) */}
          <div
            className={`bg-linear-to-b from-white to-indigo-50/40 rounded-2xl border-2 p-6 text-left flex flex-col justify-between transition-all relative shadow-sm ${
              currentTier === "Pro"
                ? "border-indigo-600 ring-4 ring-indigo-50"
                : "border-indigo-300 hover:border-indigo-500"
            }`}
            id="plan-pro-card"
          >
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-indigo-950 text-white font-mono text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-sm flex items-center gap-1">
              <Shield className="w-3 h-3 text-indigo-400" />
              <span>Full Platform Access</span>
            </div>

            {currentTier === "Pro" && (
              <span className="absolute top-4 right-4 bg-indigo-600 text-white font-mono text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                Active Plan
              </span>
            )}

            <div className="space-y-4">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-indigo-700 font-mono">
                  Monthly Platform Access
                </span>
                <h3 className="font-display font-extrabold text-xl text-slate-900 mt-1">
                  Individual Case Access
                </h3>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  Full litigation case platform with active workspace, evidence vault, and court forms.
                </p>
              </div>

              <div className="py-2 border-y border-slate-100">
                <div className="flex items-baseline gap-1">
                  <span className="font-display font-black text-3xl sm:text-4xl text-slate-900">
                    ${TIER_PRICES.Pro || 149}
                  </span>
                  <span className="text-slate-500 text-xs font-semibold">CAD</span>
                  <span className="text-slate-500 text-xs font-semibold font-mono"> / month</span>
                </div>
                <span className="text-[11px] font-mono text-indigo-700 font-semibold block mt-0.5">
                  Monthly Access • Standard Entitlement Rules
                </span>
              </div>

              {/* Allocation pill */}
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs space-y-1">
                <span className="font-bold text-indigo-950 block font-mono text-[11px] uppercase tracking-wider">
                  Analysis Allocation:
                </span>
                <p className="text-indigo-900 font-bold text-xs flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>5 Forensic Analyses per monthly billing cycle</span>
                </p>
                <p className="text-[10.5px] text-indigo-800 leading-tight pt-1 border-t border-indigo-200">
                  Case Workspace &amp; forms stay open continuously; forensic quota refreshes monthly.
                </p>
              </div>

              {/* Feature list */}
              <div className="space-y-2.5 pt-1 text-xs text-slate-700">
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <span className="font-semibold text-slate-900">Full Premium Platform Access</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <span className="font-semibold text-slate-900">5 Forensic Analyses per monthly cycle</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <span>Case Workspace &amp; Evidence Management Vault</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <span>All 5 Ontario Court Template Builders Unlocked</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <span>Multi-File RAG Chat &amp; Forensic Workspace</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <span>Professional Lawyer PDF Export Desk</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <span>Cross-Document Matter Timelines &amp; Chronologies</span>
                </div>
              </div>
            </div>

            <div className="pt-6 mt-auto">
              {currentTier === "Pro" ? (
                <button
                  type="button"
                  disabled
                  className="w-full py-3 bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold rounded-xl cursor-default uppercase tracking-wider"
                >
                  Active Plan
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => triggerCheckout("Pro")}
                  className="w-full py-3 bg-indigo-950 hover:bg-indigo-900 active:bg-black text-white text-xs font-bold rounded-xl transition shadow-xs hover:shadow-md uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2"
                  id="btn-get-access-case-access"
                >
                  <span>Get Access (${TIER_PRICES.Pro || 149}/mo)</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 3. Detailed Feature Comparison Table (Responsive) */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 text-left shadow-xs space-y-6">
        <div>
          <span className="px-3 py-1 bg-slate-100 text-slate-800 rounded-full font-mono font-bold tracking-wider text-[10px] uppercase border border-slate-200">
            Side-by-Side Comparison
          </span>
          <h3 className="font-display font-extrabold text-xl text-slate-900 mt-2">
            Detailed Plan &amp; Feature Comparison
          </h3>
          <p className="text-slate-600 text-xs sm:text-sm mt-1">
            Compare document review capabilities, included analyses, and platform tools across each tier.
          </p>
        </div>

        {/* Scrollable table wrapper for small screens */}
        <div className="overflow-x-auto -mx-2 sm:mx-0">
          <table className="w-full text-left text-xs border-collapse min-w-[620px]">
            <thead>
              <tr className="border-b-2 border-slate-200 bg-slate-50/70">
                <th className="py-3 px-4 font-bold text-slate-800 uppercase tracking-wider text-[11px] w-1/3">
                  Capability / Feature
                </th>
                <th className="py-3 px-3 font-bold text-slate-800 text-center w-1/6">
                  Free
                  <span className="block text-[10px] font-normal text-slate-500 font-mono">$0 CAD</span>
                </th>
                <th className="py-3 px-3 font-bold text-blue-900 text-center w-1/6">
                  Analyzer Basic
                  <span className="block text-[10px] font-normal text-slate-500 font-mono">${TIER_PRICES.Basic || 19.99} CAD</span>
                </th>
                <th className="py-3 px-3 font-bold text-purple-900 text-center w-1/6">
                  Analyzer Premium
                  <span className="block text-[10px] font-normal text-slate-500 font-mono">${TIER_PRICES.Premium || 49.99} CAD</span>
                </th>
                <th className="py-3 px-3 font-bold text-indigo-900 text-center w-1/6">
                  Case Access
                  <span className="block text-[10px] font-normal text-slate-500 font-mono">${TIER_PRICES.Pro || 149}/mo CAD</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              <tr>
                <td className="py-3 px-4 font-semibold text-slate-900">Billing Type</td>
                <td className="py-3 px-3 text-center text-slate-600 font-mono text-[11px]">Free Forever</td>
                <td className="py-3 px-3 text-center text-blue-800 font-mono text-[11px]">One-Time</td>
                <td className="py-3 px-3 text-center text-purple-800 font-mono text-[11px]">One-Time</td>
                <td className="py-3 px-3 text-center text-indigo-800 font-mono text-[11px]">Monthly Membership</td>
              </tr>
              <tr className="bg-slate-50/40">
                <td className="py-3 px-4 font-semibold text-slate-900">Included Analyses</td>
                <td className="py-3 px-3 text-center font-bold text-slate-800">1 Quick Review</td>
                <td className="py-3 px-3 text-center font-bold text-blue-800">3 Quick Reviews</td>
                <td className="py-3 px-3 text-center font-bold text-purple-800">5 Forensic Dual-Pass</td>
                <td className="py-3 px-3 text-center font-bold text-indigo-800">5 Forensic / month</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold text-slate-900">When Quota Is Exhausted</td>
                <td className="py-3 px-3 text-center text-[11px] text-slate-500">Report viewable on-screen</td>
                <td className="py-3 px-3 text-center text-[11px] text-slate-600">Saved reports accessible; buy pack to add</td>
                <td className="py-3 px-3 text-center text-[11px] text-slate-600">Saved audits accessible; buy pack to add</td>
                <td className="py-3 px-3 text-center text-[11px] text-slate-600">Workspace stays open; resets monthly</td>
              </tr>
              <tr className="bg-slate-50/40">
                <td className="py-3 px-4 font-semibold text-slate-900">CYFSA Statutory Search Guides</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ Included</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ Included</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ Included</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ Included</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold text-slate-900">Fact vs Allegation Extraction</td>
                <td className="py-3 px-3 text-center text-slate-400">Preview Only</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ Full Core Audit</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ Full Forensic Audit</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ Full Forensic Audit</td>
              </tr>
              <tr className="bg-slate-50/40">
                <td className="py-3 px-4 font-semibold text-slate-900">Cross-Examination Vulnerabilities</td>
                <td className="py-3 px-3 text-center text-slate-300">—</td>
                <td className="py-3 px-3 text-center text-slate-300">—</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ Included</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ Included</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold text-slate-900">Hearsay &amp; Evidentiary Weight Scan</td>
                <td className="py-3 px-3 text-center text-slate-300">—</td>
                <td className="py-3 px-3 text-center text-slate-300">—</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ Included</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ Included</td>
              </tr>
              <tr className="bg-slate-50/40">
                <td className="py-3 px-4 font-semibold text-slate-900">Case Workspace &amp; Evidence Vault</td>
                <td className="py-3 px-3 text-center text-slate-300">—</td>
                <td className="py-3 px-3 text-center text-slate-300">—</td>
                <td className="py-3 px-3 text-center text-slate-300">—</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ Full Platform</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-semibold text-slate-900">Ontario Court Template Builders</td>
                <td className="py-3 px-3 text-center text-slate-300">—</td>
                <td className="py-3 px-3 text-center text-slate-300">—</td>
                <td className="py-3 px-3 text-center text-slate-300">—</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ All 5 Builders</td>
              </tr>
              <tr className="bg-slate-50/40">
                <td className="py-3 px-4 font-semibold text-slate-900">Lawyer PDF Brief Export Desk</td>
                <td className="py-3 px-3 text-center text-slate-300">—</td>
                <td className="py-3 px-3 text-center text-slate-300">—</td>
                <td className="py-3 px-3 text-center text-slate-300">—</td>
                <td className="py-3 px-3 text-center text-emerald-600 font-bold">✓ Unlimited</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. Community & Organizational Sponsorships */}
      <section className="bg-slate-50 border border-slate-200 rounded-2xl md:rounded-3xl p-6 sm:p-8 text-left space-y-6" id="community-sponsorship-tiers">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-emerald-50 text-emerald-800 rounded-full font-mono font-bold tracking-wider text-[10px] uppercase border border-emerald-200">
              Community &amp; Organizational Access
            </span>
          </div>
          <h2 className="font-display font-extrabold text-2xl text-slate-900 mt-2">
            Community &amp; Legal Clinic Sponsorship Plans
          </h2>
          <p className="text-slate-600 text-xs sm:text-sm mt-1 leading-relaxed">
            Empower Ontario family defense clinics, Indigenous child &amp; family wellbeing agencies, band councils, and grassroots advocacy teams with sponsored multi-family case access.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Community 5 */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3 shadow-2xs flex flex-col justify-between">
            <div className="space-y-2">
              <span className="text-[10px] font-mono font-bold uppercase text-indigo-700 tracking-wider block">
                Community 5
              </span>
              <div className="font-display font-black text-2xl text-slate-900">
                ${TIER_PRICES.Community5?.toLocaleString() || "2,000"}{" "}
                <span className="text-xs font-normal text-slate-500 font-mono">/mo CAD</span>
              </div>
              <p className="text-xs text-slate-800 font-bold flex items-center gap-1">
                <span>5 sponsored families</span>
              </p>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Full platform access and forensic analyses across 5 active parent matters.
              </p>
            </div>
            <button
              type="button"
              onClick={() => triggerCheckout("Community5")}
              className="w-full mt-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition uppercase tracking-wider"
            >
              Get Access
            </button>
          </div>

          {/* Community 10 */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3 shadow-2xs flex flex-col justify-between">
            <div className="space-y-2">
              <span className="text-[10px] font-mono font-bold uppercase text-indigo-700 tracking-wider block">
                Community 10
              </span>
              <div className="font-display font-black text-2xl text-slate-900">
                ${TIER_PRICES.Community10?.toLocaleString() || "3,500"}{" "}
                <span className="text-xs font-normal text-slate-500 font-mono">/mo CAD</span>
              </div>
              <p className="text-xs text-slate-800 font-bold flex items-center gap-1">
                <span>10 sponsored families</span>
              </p>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Dedicated casework and forensic allocations for 10 participating matters.
              </p>
            </div>
            <button
              type="button"
              onClick={() => triggerCheckout("Community10")}
              className="w-full mt-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition uppercase tracking-wider"
            >
              Get Access
            </button>
          </div>

          {/* Community 25 */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3 shadow-2xs flex flex-col justify-between">
            <div className="space-y-2">
              <span className="text-[10px] font-mono font-bold uppercase text-indigo-700 tracking-wider block">
                Community 25
              </span>
              <div className="font-display font-black text-2xl text-slate-900">
                ${TIER_PRICES.Community25?.toLocaleString() || "7,500"}{" "}
                <span className="text-xs font-normal text-slate-500 font-mono">/mo CAD</span>
              </div>
              <p className="text-xs text-slate-800 font-bold flex items-center gap-1">
                <span>25 sponsored families</span>
              </p>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Full-scale organizational allocation for 25 concurrent parent matters.
              </p>
            </div>
            <button
              type="button"
              onClick={() => triggerCheckout("Community25")}
              className="w-full mt-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition uppercase tracking-wider"
            >
              Get Access
            </button>
          </div>

          {/* Regional / Enterprise */}
          <div className="bg-white p-5 rounded-2xl border border-emerald-200 space-y-3 shadow-2xs flex flex-col justify-between">
            <div className="space-y-2">
              <span className="text-[10px] font-mono font-bold uppercase text-emerald-700 tracking-wider block">
                Regional / Enterprise
              </span>
              <div className="font-display font-black text-2xl text-slate-900">
                Custom <span className="text-xs font-normal text-slate-500 font-mono">pricing</span>
              </div>
              <p className="text-xs text-slate-800 font-bold flex items-center gap-1">
                <span>25+ sponsored families</span>
              </p>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Custom arrangements for regional legal clinics, band councils, and multi-office teams.
              </p>
            </div>
            <a
              href={`mailto:${PAYMENT_EMAIL}?subject=Enterprise%20Community%20Access%20Inquiry`}
              className="w-full mt-4 py-2.5 bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition uppercase tracking-wider text-center block"
            >
              Contact Intake
            </a>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-600">
          <p>
            For organizational onboarding, direct invoicing, or purchase order arrangements, contact our intake desk directly at{" "}
            <a href={`mailto:${PAYMENT_EMAIL}`} className="text-blue-700 underline font-semibold">
              {PAYMENT_EMAIL}
            </a>
            .
          </p>
        </div>
      </section>

      {/* 5. Analysis Limits & Quota Exhaustion Policy */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 text-left space-y-5 shadow-xs">
        <div className="flex items-center gap-2">
          <Info className="w-5 h-5 text-blue-600 shrink-0" />
          <h3 className="font-display font-extrabold text-lg text-slate-900">
            How Analysis Allocations Work &amp; What Happens When Exhausted
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs text-slate-700">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
            <p className="font-bold text-slate-900 text-sm">1. How analyses are counted</p>
            <p className="text-slate-600 leading-relaxed">
              Each uploaded document scanned through the analyzer uses 1 analysis allocation. Quick Document Reviews cover allegation mapping and timeline; Forensic Dual-Pass executes in-depth hearsay and cross-examination audits.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
            <p className="font-bold text-slate-900 text-sm">2. Your work is never locked</p>
            <p className="text-slate-600 leading-relaxed">
              When your analysis allocation reaches zero, your completed reports, extractions, chronologies, and workbooks remain completely accessible and printable in your browser. We never restrict access to work you already generated.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
            <p className="font-bold text-slate-900 text-sm">3. Adding more analyses</p>
            <p className="text-slate-600 leading-relaxed">
              Whenever you receive new court affidavits or disclosure, simply purchase another review pack or upgrade to Individual Case Access. Monthly Case Access refreshes its 5-analysis quota on every monthly renewal.
            </p>
          </div>
        </div>
      </section>

      {/* 6. How Membership Works */}
      <div className="bg-white border-2 border-indigo-100 rounded-2xl p-6 md:p-8 shadow-xs" id="checkout-how-it-works">
        <div className="flex flex-col md:flex-row gap-6 md:items-center md:justify-between text-left">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-700 font-mono">
              Simple 3-Step Checkout Flow
            </span>
            <h3 className="text-xl font-black text-slate-900 mt-1">
              Select Plan, Send e-Transfer, Activate Instantly
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 mt-2 max-w-2xl leading-relaxed">
              Choose your plan above. If you are not signed in, you will be prompted to sign in with Google to associate your payment. CYFSA Navigator creates your unique payment reference number and displays the exact e-Transfer amount, address, and memo.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 shrink-0 text-center">
            {["1. Select Plan", "2. Send e-Transfer", "3. Activate Code"].map((step) => (
              <div key={step} className="px-3 py-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700">
                {step}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 7. Access Code Activator */}
      <div
        className="bg-linear-to-r from-[#eef2ff] to-[#f0fdf4] border border-indigo-100 rounded-2xl p-6 text-left shadow-2xs space-y-4"
        id="etransfer-activator"
      >
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
              If you already sent an Interac e-Transfer to <strong>{PAYMENT_EMAIL}</strong> and received a code, enter the same email and code here to unlock instantly. To start a new payment, select a plan above.
            </p>
          </div>

          <div className="bg-white border text-left border-gray-100 p-5 rounded-2xl space-y-2.5 shrink-0 w-full md:w-80 shadow-3xs">
            <span className="text-[10px] uppercase font-bold text-slate-500 font-mono tracking-widest block">
              Enter Credentials
            </span>
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
            {sidebarSuccess && (
              <p className="text-[10px] text-emerald-700 font-semibold flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Access code successfully activated!</span>
              </p>
            )}
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

      {/* 8. Trust & Payment Reliability Notice */}
      <div
        className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6"
        id="monetization-trust-badges"
      >
        <div className="flex items-start gap-4 text-left max-w-xl">
          <div className="p-3 bg-slate-100 rounded-xl text-slate-700 shrink-0 mt-1">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-display font-bold text-gray-900 text-sm">
              Ontario Legal Compliance &amp; Data Privacy
            </h4>
            <p className="text-gray-500 text-xs mt-1 leading-relaxed">
              No card numbers or banking passwords are ever collected. Payment is completed securely via standard Interac e-Transfer. Our automated system monitors incoming transfer notifications for your unique payment reference and issues your access code once verified. Bank settlement clears per standard Interac banking rules.
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

      {/* 9. Checkout Modal Flow */}
      {stage !== "idle" && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[100] p-4 font-sans animate-fade-in"
          id="checkout-sheet-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-modal-title"
        >
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-100 overflow-hidden text-left relative flex flex-col max-h-[90vh]">
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-400/20">
                  <Coins className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="checkout-modal-title" className="font-display font-extrabold text-sm uppercase tracking-wide">
                    Interac e-Transfer Checkout
                  </h3>
                  <p className="text-[10px] text-emerald-400 font-semibold font-mono">
                    {selectedTier} Plan — ${selectedTier ? TIER_PRICES[selectedTier] : 0} CAD
                  </p>
                </div>
              </div>
              {stage !== "verifying" && stage !== "success" && (
                <button
                  onClick={handleCancelCheckout}
                  className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer transition-colors"
                  aria-label="Close checkout modal"
                >
                  ✕
                </button>
              )}
            </div>

            {/* STAGE: Email / Sign-in required */}
            {stage === "email" && (
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                {!userEmail ? (
                  <div className="space-y-4">
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900 space-y-1">
                      <p className="font-bold flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-blue-600" />
                        <span>Sign-in required to link your access</span>
                      </p>
                      <p className="text-[11px] text-blue-800 leading-relaxed">
                        Sign in with Google to associate your payment reference number and receive your access code securely.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={isSigningIn}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition cursor-pointer uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs"
                    >
                      {isSigningIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                      <span>{isSigningIn ? "Signing in..." : "Sign in with Google"}</span>
                    </button>

                    <div className="text-center text-[11px] text-slate-500">
                      <span>or confirm email address to proceed:</span>
                    </div>

                    <input
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full text-xs border border-slate-200 bg-slate-50 text-slate-800 p-3 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
                    />

                    {errorMessage && <p className="text-xs text-red-600 font-semibold">{errorMessage}</p>}

                    <button
                      type="button"
                      onClick={handleRequestAccess}
                      className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition cursor-pointer uppercase tracking-wider"
                    >
                      Generate Payment Reference
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Confirm your signed-in email below. Your unique payment reference will link directly to this address.
                    </p>
                    <input
                      type="email"
                      value={email}
                      readOnly
                      className="w-full text-sm border border-slate-200 bg-slate-100 text-slate-800 p-3 rounded-lg outline-none cursor-default font-mono text-xs"
                    />
                    {errorMessage && <p className="text-xs text-red-600 font-semibold">{errorMessage}</p>}
                    <button
                      type="button"
                      onClick={handleRequestAccess}
                      className="w-full py-3 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-bold rounded-xl transition cursor-pointer uppercase tracking-wider shadow-xs"
                    >
                      Create Payment Instructions
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* STAGE: Instructions + Code Entry */}
            {stage === "awaiting-code" && (
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-xs">
                  {/* Step 1: Destination email */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider block">
                      1. Send Interac e-Transfer To:
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="bg-slate-900 text-white font-mono text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-950 select-all tracking-wide">
                        {PAYMENT_EMAIL}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(PAYMENT_EMAIL, "email")}
                        className="p-1.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-md text-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        title="Copy email"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>{copiedEmail ? "Copied!" : "Copy"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Step 2: Amount & Memo */}
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider block">
                        2. Exact Amount:
                      </span>
                      <span className="font-bold text-slate-900 text-sm">
                        ${selectedTier ? TIER_PRICES[selectedTier] : 0} CAD
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider block">
                        3. Transfer Memo / Note:
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-xs text-indigo-900 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 font-bold select-all break-all">
                          {referenceNumber}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(referenceNumber, "memo")}
                          className="p-1 bg-white border border-slate-300 hover:bg-slate-100 rounded text-slate-700 text-[10px] font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                          title="Copy memo"
                        >
                          <Copy className="w-3 h-3" />
                          <span>{copiedMemo ? "Copied!" : "Copy"}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3 text-[11px] text-blue-900 leading-relaxed">
                  <p className="font-semibold mb-1 flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 text-blue-700" />
                    <span>Automated Notification &amp; Activation Process</span>
                  </p>
                  <p className="text-blue-800 text-[10.5px]">
                    Keep this page open or return later. Our automated payment listener continuously checks incoming Interac e-Transfer notifications for your unique payment reference. Once your transfer notification is received and verified, your access code is delivered directly to your email and can be activated here. (Bank settlement occurs per standard Interac timelines.)
                  </p>
                </div>

                {/* Code Entry Form */}
                <div className="bg-white border border-indigo-100 p-4 rounded-xl space-y-3 shadow-3xs">
                  <label className="text-[10.5px] font-mono font-bold text-indigo-950 uppercase tracking-wider block">
                    Enter Access Code to Unlock
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="XXXX-XXXX-XX"
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value)}
                      className="flex-1 text-xs font-mono border border-slate-200 bg-slate-50 text-slate-800 p-2.5 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 uppercase tracking-widest text-center"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyInModal}
                      className="px-4 py-2.5 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-bold rounded-lg transition tracking-wide uppercase select-none cursor-pointer"
                    >
                      Verify
                    </button>
                  </div>
                  {errorMessage && <p className="text-[10px] text-red-600 font-semibold">{errorMessage}</p>}
                </div>

                <button
                  type="button"
                  onClick={handleCancelCheckout}
                  className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition cursor-pointer text-center"
                >
                  Close (I'll enter my code later)
                </button>
              </div>
            )}

            {/* STAGE: Verifying / in-flight */}
            {stage === "verifying" && (
              <div className="p-12 text-center flex flex-col items-center justify-center space-y-6">
                <Loader2 className="w-12 h-12 text-indigo-900 animate-spin" />
                <div className="space-y-1">
                  <h4 className="font-display font-extrabold text-slate-800 text-base">Working...</h4>
                  <p className="text-xs text-gray-500">Communicating with the server, one moment.</p>
                </div>
              </div>
            )}

            {/* STAGE: Success */}
            {stage === "success" && (
              <div className="p-10 text-center flex flex-col items-center justify-center space-y-6 animate-fade-in" id="checkout-success-feedback">
                <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shadow-xs shadow-emerald-200">
                  <Check className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h4 className="font-display font-black text-indigo-950 text-lg">Access Unlocked!</h4>
                  <p className="text-xs text-indigo-800 max-w-sm mx-auto leading-relaxed">
                    Your <strong>{selectedTier} Plan</strong> is now active.
                  </p>
                </div>
                <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4 w-full text-left space-y-2">
                  <div className="flex items-center gap-2 text-xs text-emerald-800">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span>Free-tier limits disabled</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-emerald-800">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span>Document Analyzer &amp; Case Tools active</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCancelCheckout}
                  className="w-full py-3 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-bold rounded-xl transition cursor-pointer text-center font-display tracking-wider uppercase shadow-xs hover:shadow-sm"
                >
                  Return to Plans
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
