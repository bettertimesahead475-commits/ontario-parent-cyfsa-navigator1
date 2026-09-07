/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from "react";
import { LEAST_INTRUSIVE_ORDER_HIERARCHY, DEFENSE_CONSIDERATIONS } from "../data-transferred";
import { Scale, ShieldCheck } from "lucide-react";
import { printBrandedDocument } from "../utils/printExport";

export default function DefenseStrategiesTab() {
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail?.type !== "defense-strategies") return;
      const body = `
        <div class="section-card">
          <div class="section-title">The Order Hierarchy Under s.101(1)</div>
          <ol class="body-text">${LEAST_INTRUSIVE_ORDER_HIERARCHY.map(s => `<li><strong>${s.title}</strong> — ${s.body}</li>`).join("")}</ol>
          <p class="body-text">Under s.101(3), the court cannot remove a child from their current caregiver's care unless satisfied that less disruptive alternatives would be inadequate to protect the child.</p>
        </div>
        <div class="section-card">
          <div class="section-title">Things Worth Raising With Your Lawyer</div>
          ${DEFENSE_CONSIDERATIONS.map(c => `<p class="body-text"><strong>${c.topic}:</strong> ${c.body}</p>`).join("")}
        </div>`;
      printBrandedDocument("The Least Intrusive Alternative Principle", body);
    };
    window.addEventListener("trigger-print-pdf", handler);
    return () => window.removeEventListener("trigger-print-pdf", handler);
  }, []);

  return (
    <div className="space-y-8" id="defense-strategies-tab">
      <div className="max-w-3xl">
        <h2 className="font-display text-2xl font-bold text-gray-900">The "Least Intrusive Alternative" Principle</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          CYFSA s.1(2) requires that the least disruptive course of action available and appropriate be
          considered. This is background on how the Act is structured, not a guaranteed argument or legal
          advice — how it applies to your case is a question for your lawyer.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="flex items-center gap-2 font-display text-base font-bold text-slate-900">
          <Scale className="h-5 w-5 text-brand-600" /> The Order Hierarchy Under s.101(1)
        </h3>
        <div className="mt-4 space-y-3">
          {LEAST_INTRUSIVE_ORDER_HIERARCHY.map((step, i) => (
            <div key={step.title} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">{i + 1}</span>
              <div>
                {step.level && <span className="text-[10px] font-bold uppercase tracking-wide text-brand-600">{step.level}</span>}
                <p className="text-sm font-bold text-slate-900">{step.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Under s.101(3), the court cannot remove a child from their current caregiver's care unless
          satisfied that less disruptive alternatives would be inadequate to protect the child.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="font-display text-base font-bold text-slate-900">Things Worth Raising With Your Lawyer</h3>
        <div className="mt-4 space-y-4">
          {DEFENSE_CONSIDERATIONS.map(c => (
            <div key={c.topic} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-900">{c.topic}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-950">
        <ShieldCheck className="mb-2 h-5 w-5 text-amber-700" />
        <strong>This page describes how the Act is structured — it is not a legal strategy, a prediction of outcome, or a substitute for your own lawyer's judgment on your specific facts.</strong>
      </div>
    </div>
  );
}
