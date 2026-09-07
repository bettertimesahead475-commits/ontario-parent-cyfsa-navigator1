/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive homepage demo of ParentShield's Evidence Strength analysis methodology.
 * Uses anonymized, representative findings from actual case analysis to demonstrate
 * the breadth and depth of ParentShield's document examination process.
 * 
 * DO NOT include identifying information in this demo.
 * DO NOT show this as a "legal violations detector."
 * DO PRESERVE nuance about gaps vs. falsity, untested vs. concluded.
 */

import React, { useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowRight, AlertCircle, CheckCircle2, HelpCircle, FileText, Clock, Scale } from "lucide-react";

interface DemoFinding {
  id: string;
  category: string;
  icon: React.ReactNode;
  title: string;
  finding: string;
  significance: string;
  color: "amber" | "blue" | "slate" | "orange" | "purple";
}

// Selected findings from the actual Evidence Strength Report
// These represent different analytical dimensions across the analyzer's methodology
const DEMO_FINDINGS: DemoFinding[] = [
  {
    id: "source-attribution",
    category: "Source & Attribution",
    icon: <AlertCircle className="w-5 h-5" />,
    title: "Secondhand Information Identified",
    finding: "The affidavit relies on information 'informed' by legal counsel about substantive events, rather than firsthand observation.",
    significance: "This isn't a violation—it's a question about evidentiary weight. The analyzer flags that legal conclusions were mixed with factual claims, which affects how a court may weigh the evidence.",
    color: "amber"
  },
  {
    id: "procedural-statement",
    category: "Procedural Statement",
    icon: <Clock className="w-5 h-5" />,
    title: "Procedural Timing Question Identified",
    finding: "The affidavit states: 'We did not inform the court the [period] had elapsed.'",
    significance: "This is a concrete statement worth verifying with counsel. The analyzer doesn't conclude wrongdoing—it flags that this admission deserves clarification about what legal rule it relates to.",
    color: "orange"
  },
  {
    id: "documentation-gap",
    category: "Documentation",
    icon: <FileText className="w-5 h-5" />,
    title: "Underlying Court Documents Missing",
    finding: "The affidavit references court documents 'finalized and issued' on a specific date, but those documents are not attached as exhibits.",
    significance: "The analyzer notes this gap—not as proof of misconduct, but as a factual incompleteness that affects how thoroughly you can assess the underlying application.",
    color: "slate"
  },
  {
    id: "legal-authority",
    category: "Legal Authority",
    icon: <Scale className="w-5 h-5" />,
    title: "Statutory Authority Unverified",
    finding: "The affidavit describes a worker's action but does not cite the specific CYFSA section authorizing that action.",
    significance: "The analyzer identifies this as an incomplete reference—not a violation, but a detail that should be clarified when reviewing with counsel.",
    color: "blue"
  },
  {
    id: "corroboration",
    category: "Corroboration",
    icon: <CheckCircle2 className="w-5 h-5" />,
    title: "Mixed Corroboration",
    finding: "Email exhibits directly corroborate the scheduling timeline described in the affidavit. However, other underlying materials referenced are not attached.",
    significance: "This shows nuance: some claims ARE supported by attached documents, while others would benefit from additional evidence. Not all-or-nothing.",
    color: "blue"
  },
  {
    id: "consistency-gap",
    category: "Internal Consistency",
    icon: <HelpCircle className="w-5 h-5" />,
    title: "Unexplained Reference",
    finding: "The affidavit references 'the 5 days' in a procedural context but does not define or explain what timeline this refers to.",
    significance: "The analyzer flags this as a clarity issue—not proof of deception, but something that requires verification to fully understand the procedural context.",
    color: "purple"
  },
  {
    id: "missing-substantive",
    category: "Substantive Claims",
    icon: <FileText className="w-5 h-5" />,
    title: "Substantive Application Materials Missing",
    finding: "This affidavit is procedural and administrative (about scheduling). The actual protection application setting out alleged grounds is not included in this document.",
    significance: "This is expected—this is a scheduling/motion affidavit, not the main application. But it means a complete assessment requires access to the substantive materials.",
    color: "slate"
  }
];

export function EvidenceStrengthDemo() {
  const [activePhase, setActivePhase] = useState<"upload" | "analyze" | "findings" | "action">("upload");
  const [revealedFinding, setRevealedFinding] = useState<string | null>(null);

  useEffect(() => {
    // Auto-advance through phases after delays for demo effect
    const timers: NodeJS.Timeout[] = [];

    if (activePhase === "upload") {
      timers.push(setTimeout(() => setActivePhase("analyze"), 800));
    } else if (activePhase === "analyze") {
      timers.push(setTimeout(() => setActivePhase("findings"), 1600));
    } else if (activePhase === "findings") {
      // Reveal findings one at a time
      DEMO_FINDINGS.forEach((finding, index) => {
        timers.push(
          setTimeout(() => setRevealedFinding(finding.id), 2400 + index * 300)
        );
      });
      timers.push(setTimeout(() => setActivePhase("action"), 2400 + DEMO_FINDINGS.length * 300 + 800));
    }

    return () => timers.forEach(clearTimeout);
  }, [activePhase]);

  const colorClasses = {
    amber: "border-amber-200 bg-amber-50",
    blue: "border-blue-200 bg-blue-50",
    slate: "border-slate-200 bg-slate-50",
    orange: "border-orange-200 bg-orange-50",
    purple: "border-purple-200 bg-purple-50",
  };

  const colorTextClasses = {
    amber: "text-amber-900",
    blue: "text-blue-900",
    slate: "text-slate-900",
    orange: "text-orange-900",
    purple: "text-purple-900",
  };

  return (
    <section className="space-y-8 px-6 py-16 sm:px-10 md:py-24 bg-white">
      <div className="mx-auto max-w-5xl">
        <p className="text-center text-xs font-bold uppercase tracking-widest text-brand-600">Real Analysis. Multiple Dimensions.</p>
        <h2 className="mt-3 text-center font-display text-3xl font-bold text-slate-900 md:text-4xl">
          One document. Nine different evidence checks.
        </h2>
        <p className="mt-4 text-center text-base text-slate-600 max-w-2xl mx-auto">
          ParentShield doesn't simply summarize your paperwork. It examines how information is sourced, supported, corroborated, documented, and internally consistent.
        </p>
      </div>

      <div className="mx-auto max-w-5xl">
        {/* PHASE 1: Upload */}
        <div className={`transition-all duration-500 ${activePhase === "upload" ? "opacity-100" : "opacity-30"}`}>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white font-bold">1</div>
              <div>
                <p className="font-display text-xl font-bold text-slate-900">Document Uploaded</p>
                <p className="mt-2 text-sm text-slate-600">Form 14A Affidavit — [CASE TYPE REDACTED]</p>
                <p className="mt-1 text-xs text-slate-500">Character count: [REDACTED] | Page count: [REDACTED]</p>
              </div>
            </div>
          </div>
        </div>

        {/* PHASE 2: Analyzing */}
        <div className={`transition-all duration-500 ${activePhase === "analyze" || activePhase === "findings" || activePhase === "action" ? "opacity-100" : "opacity-30"} mt-6`}>
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white font-bold">2</div>
              <div className="flex-1">
                <p className="font-display text-xl font-bold text-slate-900">ParentShield Analyzing</p>
                <p className="mt-2 text-sm text-slate-600">Examining across multiple evidence dimensions...</p>
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    "Source Check",
                    "Corroboration",
                    "Consistency",
                    "Documentation",
                    "Authority",
                    "Completeness",
                    "Timing",
                    "Verification"
                  ].map((check, i) => (
                    <div
                      key={check}
                      className={`text-xs font-mono p-2 rounded border text-center transition-all ${
                        activePhase === "analyze" && i % 2 === 0
                          ? "bg-white border-brand-300 text-brand-700 font-bold"
                          : "bg-brand-100/50 border-brand-100 text-brand-600"
                      }`}
                    >
                      {check}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* PHASE 3: Scores */}
        {(activePhase === "findings" || activePhase === "action") && (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-8 transition-all duration-500">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold">3</div>
              <div className="flex-1">
                <p className="font-display text-xl font-bold text-slate-900">Evidence Profile Generated</p>
                <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div className="rounded-lg bg-white border border-emerald-200 p-4">
                    <p className="text-xs font-bold uppercase text-emerald-700">Evidence Strength</p>
                    <p className="mt-2 text-3xl font-bold text-emerald-900">46<span className="text-lg text-emerald-700">/100</span></p>
                    <p className="mt-1 text-xs text-slate-600">Educational heuristic</p>
                  </div>
                  <div className="rounded-lg bg-white border border-amber-200 p-4">
                    <p className="text-xs font-bold uppercase text-amber-700">Information Completeness</p>
                    <p className="mt-2 text-3xl font-bold text-amber-900">45<span className="text-lg text-amber-700">/100</span></p>
                    <p className="mt-1 text-xs text-slate-600">Coverage assessment</p>
                  </div>
                  <div className="rounded-lg bg-white border border-blue-200 p-4">
                    <p className="text-xs font-bold uppercase text-blue-700">Findings Identified</p>
                    <p className="mt-2 text-3xl font-bold text-blue-900">{DEMO_FINDINGS.length}</p>
                    <p className="mt-1 text-xs text-slate-600">Across all dimensions</p>
                  </div>
                  <div className="rounded-lg bg-white border border-purple-200 p-4">
                    <p className="text-xs font-bold uppercase text-purple-700">Verification Items</p>
                    <p className="mt-2 text-3xl font-bold text-purple-900">12+</p>
                    <p className="mt-1 text-xs text-slate-600">Worth discussing</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PHASE 4: Findings Cards */}
        {(activePhase === "findings" || activePhase === "action") && (
          <div className="mt-8">
            <p className="text-sm font-bold text-slate-700 mb-4">Key Findings (selected from analysis)</p>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
              {DEMO_FINDINGS.map((finding) => {
                const isRevealed = !revealedFinding || revealedFinding === finding.id || activePhase === "action";
                const pastReveal = revealedFinding && 
                  DEMO_FINDINGS.findIndex(f => f.id === revealedFinding) >= DEMO_FINDINGS.findIndex(f => f.id === finding.id) ||
                  activePhase === "action";

                return (
                  <div
                    key={finding.id}
                    className={`rounded-xl border p-4 transition-all duration-500 ${colorClasses[finding.color]} ${
                      pastReveal ? "opacity-100 scale-100" : "opacity-0 scale-95"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`shrink-0 mt-0.5 ${colorTextClasses[finding.color]}`}>
                        {finding.icon}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-600">{finding.category}</p>
                        <p className={`mt-1 font-bold text-sm ${colorTextClasses[finding.color]}`}>{finding.title}</p>
                        <p className="mt-2 text-xs leading-relaxed text-slate-700">{finding.finding}</p>
                        <p className="mt-2 text-xs italic text-slate-600 border-t border-current/10 pt-2">{finding.significance}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PHASE 5: Action */}
        {activePhase === "action" && (
          <div className="mt-10 rounded-2xl border-2 border-brand-300 bg-brand-50 p-8 transition-all duration-500">
            <h3 className="font-display text-2xl font-bold text-slate-900">What would ParentShield find in YOUR documents?</h3>
            <p className="mt-3 text-slate-700">
              Upload your case documents and see a detailed evidence audit of your affidavits, CAS correspondence, and court filings. Identify gaps, inconsistencies, missing corroboration, and procedural questions worth raising with counsel.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/document-analyzer">
                <span className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 font-bold text-white transition hover:bg-brand-700">
                  ANALYZE MY DOCUMENTS <ArrowRight className="h-5 w-5" />
                </span>
              </Link>
              <button
                onClick={() => {
                  setActivePhase("upload");
                  setRevealedFinding(null);
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-6 py-3 font-bold text-slate-700 transition hover:bg-slate-100"
              >
                Watch demo again
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Explanation section */}
      <div className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-slate-50 p-6">
        <p className="text-sm font-bold text-slate-900">What this demonstrates:</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          ParentShield examines your documents across <strong>eight different analytical dimensions</strong>: source attribution, corroboration, internal consistency, documentary support, legal authority verification, procedural documentation, information completeness, and verification requirements. The result is not a legal verdict, but a detailed map of what's strong in your case, what needs verification, and what gaps require discussion with counsel.
        </p>
      </div>
    </section>
  );
}
