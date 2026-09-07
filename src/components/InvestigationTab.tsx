/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { INVESTIGATION_STAGES, ORAM_STEPS, INVESTIGATION_WATCHPOINTS } from "../data-transferred";
import { Clock, ShieldAlert, CheckSquare, Square, AlertOctagon, Compass } from "lucide-react";
import { printBrandedDocument } from "../utils/printExport";

export default function InvestigationTab() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setChecked(prev => ({ ...prev, [id]: !prev[id] }));

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail?.type !== "investigation") return;
      const body = `
        ${INVESTIGATION_STAGES.map(s => `
          <div class="section-card">
            <div class="section-title">${s.dayRange} — ${s.title}</div>
            <p class="body-text">${s.description}</p>
            <p class="body-text"><strong>What CAS typically does:</strong> ${s.whatCASDoes}</p>
            <p class="body-text"><strong>What you can consider:</strong></p>
            <ul class="body-text">${s.whatYouShouldDo.map(a => `<li>${a}</li>`).join("")}</ul>
            ${s.warningNote ? `<div class="watch-item"><span class="watch-title">Note</span><span class="watch-desc">${s.warningNote}</span></div>` : ""}
          </div>`).join("")}
        <div class="section-card">
          <div class="section-title">Understanding ORAM</div>
          ${ORAM_STEPS.map(s => `<p class="body-text"><strong>${s.title}:</strong> ${s.body}</p>`).join("")}
        </div>
        <div class="section-card">
          <div class="section-title">Watchpoints Checked for Your Case</div>
          ${INVESTIGATION_WATCHPOINTS.filter(w => checked[w.id]).map(w => `<div class="watch-item"><span class="watch-title">${w.title}</span><span class="watch-desc">${w.description}</span></div>`).join("") || `<p class="body-text">No watchpoints selected yet — go back and tap any that apply to your case before printing.</p>`}
        </div>`;
      printBrandedDocument("How a CAS Investigation Typically Proceeds", body);
    };
    window.addEventListener("trigger-print-pdf", handler);
    return () => window.removeEventListener("trigger-print-pdf", handler);
  }, [checked]);

  return (
    <div className="space-y-8" id="investigation-tab">
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
          <Compass className="h-3.5 w-3.5" />
          <span>Ontario Child Protection Standards, 2016</span>
        </div>
        <h2 className="mt-3 font-display text-2xl font-bold text-gray-900">How a CAS Investigation Typically Proceeds</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Ontario's Child Protection Standards set an expected 45-day window to conclude an investigation,
          extendable to 60 days at a supervisor's discretion in complex cases. This is a ministry policy
          standard CAS is required to follow — not a section of the CYFSA statute itself. This is
          educational, not legal advice.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-slate-900">
          <Clock className="h-5 w-5 text-brand-600" /> Stage-by-Stage Sequence
        </h2>
        {INVESTIGATION_STAGES.map(stage => (
          <article key={stage.dayRange} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <span className="text-xs font-bold uppercase tracking-wide text-brand-600">{stage.dayRange}</span>
            <h3 className="mt-1 font-display text-base font-bold text-slate-900">{stage.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{stage.description}</p>
            <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="font-bold text-slate-700">What CAS typically does</p>
                <p className="mt-1 leading-relaxed text-slate-600">{stage.whatCASDoes}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="font-bold text-slate-700">What you can consider</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 leading-relaxed text-slate-600">
                  {stage.whatYouShouldDo.map(a => <li key={a}>{a}</li>)}
                </ul>
              </div>
            </div>
            {stage.warningNote && (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" /> <span>{stage.warningNote}</span>
              </p>
            )}
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-slate-900">
          <ShieldAlert className="h-5 w-5 text-brand-600" /> Understanding the Risk Assessment (ORAM)
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          CAS workers use standardized tools to evaluate risk, generally rated Low, Moderate, High, or Extreme.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {ORAM_STEPS.map(s => (
            <div key={s.title} className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs">
              <p className="font-bold text-slate-800">{s.title}</p>
              <p className="mt-1 leading-relaxed text-slate-600">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-slate-900">
          <CheckSquare className="h-5 w-5 text-brand-600" /> Watchpoints to Review With Your Lawyer
        </h2>
        <p className="mt-1 text-xs text-slate-500">Tap anything you've noticed in your own case, to bring up with your lawyer or Legal Aid Ontario.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {INVESTIGATION_WATCHPOINTS.map(w => {
            const isChecked = !!checked[w.id];
            return (
              <div
                key={w.id}
                onClick={() => toggle(w.id)}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-xs transition ${isChecked ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
              >
                {isChecked ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : <Square className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
                <div>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">{w.category}</span>
                  <p className="mt-1 font-bold text-slate-900">{w.title}</p>
                  <p className="mt-1 leading-relaxed text-slate-600">{w.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
