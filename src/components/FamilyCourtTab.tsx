/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { COURT_STEPS } from "../data";
import { CourtStep } from "../types";
import { GitCommit, Download, Calendar, Scale, HelpCircle, Shield, AlertCircle, Sparkles, ChevronRight } from "lucide-react";

export default function FamilyCourtTab() {
  const [activeStepId, setActiveStepId] = useState<string>("step-1-apprehension");

  const activeStep = COURT_STEPS.find(s => s.id === activeStepId) || COURT_STEPS[0];

  const getStageBadgeColor = (stage: CourtStep["stage"]) => {
    switch(stage) {
      case "Pre-Court": return "bg-rose-50 text-rose-800 border-rose-200";
      case "Early Stage": return "bg-amber-50 text-amber-800 border-amber-200";
      case "Mid-Hearing": return "bg-brand-50 text-brand-800 border-brand-200";
      case "Resolution & Final": return "bg-emerald-50 text-emerald-800 border-emerald-200";
    }
  };

  return (
    <div className="space-y-8" id="family-court-tab">
      {/* Intro section */}
      <div className="text-left max-w-3xl">
        <h2 className="font-display text-2xl font-bold text-gray-900">Ontario Child Protection Court Lifecycle</h2>
        <p className="text-sm text-gray-600 mt-2 leading-relaxed">
          Child protection applications are ruled under the **Ontario Family Law Rules (O. Reg. 114/99)**. Below is an educational timeline charting the chronological order of a standard protection case. Click on any court milestone to investigate statutory purposes, filing forms, and strategic defense guidelines.
        </p>
      </div>

      {/* Interactive Lifecycle Timeline */}
      <div className="bg-black rounded-2xl border border-gray-100 p-6 shadow-sm relative overflow-hidden" id="timeline-navigation">
        <div className="absolute inset-0 bg-linear-to-b from-brand-50/10 to-transparent pointer-events-none" />
        
        {/* Horizontal scroll timeline on desktop / stack on mobile */}
        <div className="relative flex flex-col md:flex-row justify-between items-center gap-4 border-b border-gray-150 pb-6 overflow-x-auto" id="timeline-rail">
          {/* Connecting Line for design */}
          <div className="hidden md:block absolute top-[28px] left-[40px] right-[40px] h-0.5 bg-gray-200 -z-0" />

          {COURT_STEPS.map((step, idx) => {
            const isCompletedOrActive = COURT_STEPS.findIndex(s => s.id === activeStepId) >= idx;
            const isActive = step.id === activeStepId;
            return (
              <button
                key={step.id}
                onClick={() => setActiveStepId(step.id)}
                className="relative z-10 flex flex-row md:flex-col items-center gap-3 md:gap-2 focus:outline-none group cursor-pointer w-full md:w-auto text-left md:text-center"
              >
                {/* Node Dot Indicator */}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                    isActive
                      ? "bg-brand-600 border-brand-700 text-white shadow-md scale-110 ring-4 ring-brand-100"
                      : isCompletedOrActive
                      ? "bg-brand-50 border-brand-500 text-brand-700"
                      : "bg-black border-gray-300 text-gray-400 group-hover:border-gray-400"
                  }`}
                >
                  <span className="font-mono text-xs font-bold">{idx + 1}</span>
                </div>

                {/* Text Indicator */}
                <div className="md:max-w-[120px]">
                  <span
                    className={`block text-[11px] font-semibold tracking-tight transition-colors ${
                      isActive ? "text-brand-900 font-bold" : "text-gray-500 group-hover:text-gray-700"
                    }`}
                  >
                    {step.title.split("/")[0].split("(")[0]}
                  </span>
                  {step.timelineLimit && (
                    <span className="block text-[9px] text-amber-600 font-medium font-mono">
                      {step.timelineLimit}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Court Step Explainer */}
        {activeStep && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-8 text-left" id="step-details">
            {/* Left Description Block */}
            <div className="lg:col-span-7 space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getStageBadgeColor(activeStep.stage)}`}>
                  {activeStep.stage} Stage
                </span>
                <span className="text-xs font-mono font-medium text-gray-500 flex items-center gap-1">
                  <Scale className="w-3.5 h-3.5 text-brand-600" /> {activeStep.ruleReference}
                </span>
                {activeStep.timelineLimit && (
                  <span className="text-xs font-mono font-medium text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1.5 animate-pulse">
                    <Calendar className="w-3.5 h-3.5" /> Deadline: {activeStep.timelineLimit}
                  </span>
                )}
              </div>

              <div>
                <h3 className="font-display text-xl font-bold text-gray-900 flex items-center gap-2">
                  <span>{activeStep.title}</span>
                </h3>
                <p className="text-gray-600 text-sm leading-relaxed mt-3">
                  {activeStep.description}
                </p>
              </div>

              {/* Purpose and Mechanics */}
              <div className="bg-slate-50 border border-slate-100 p-5 rounded-xl space-y-3">
                <h4 className="font-display font-semibold text-slate-800 text-xs uppercase tracking-wider">
                  The Legal Purpose of this Step
                </h4>
                <p className="text-slate-600 text-xs md:text-sm leading-relaxed">
                  {activeStep.purpose}
                </p>
              </div>

              {/* Watchpoints & Guidance warnings */}
              <div className="space-y-3">
                <h4 className="font-display font-semibold text-gray-800 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-600" /> Crucial Parental Warnings & Watchpoints
                </h4>
                <div className="space-y-2">
                  {activeStep.watchpoints.map((watch, i) => (
                    <div key={i} className="p-3 bg-amber-50/40 border border-amber-100/50 rounded-lg flex gap-2 text-xs text-amber-900 leading-relaxed">
                      <span className="text-amber-500 font-bold">•</span>
                      <span>{watch}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Forms & Download Checkboard Block */}
            <div className="lg:col-span-5 space-y-6 lg:border-l lg:border-gray-150 lg:pl-8">
              <div>
                <h4 className="font-display font-semibold text-gray-900 text-sm">Official Court Forms Required</h4>
                <p className="text-xs text-gray-500 mt-1">
                  Download legal templates published by the Ontario Family Court services. Use only the exact form indicated.
                </p>
              </div>

              <div className="space-y-3">
                {activeStep.officialForms.map((form, key) => (
                  <div key={key} className="p-4 bg-black hover:bg-brand-50/30 rounded-xl border border-gray-200 hover:border-brand-300 transition-all flex flex-col justify-between gap-3 shadow-2xs">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="inline-block text-[10px] font-mono font-bold text-brand-700 bg-brand-55 hover:bg-brand-100 px-2 py-0.5 rounded">
                          {form.formNumber}
                        </span>
                        <h5 className="font-display font-semibold text-gray-800 text-xs md:text-sm mt-1">{form.name}</h5>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                        Ontario Verifiable
                      </span>
                    </div>
                    
                    <a
                      href={form.officialUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 py-1.5 bg-slate-900 hover:bg-brand-700 text-white rounded-lg text-xs font-medium cursor-pointer transition-colors w-full"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Forms Library Website</span>
                    </a>
                  </div>
                ))}
                {activeStep.officialForms.length === 0 && (
                  <div className="text-center py-6 bg-gray-50 rounded-lg text-xs text-gray-500 border border-dashed border-gray-200">
                    No specific statutory forms required for this sequence.
                  </div>
                )}
              </div>

              {/* Informational Guidance */}
              <div className="p-4 bg-emerald-50/50 border border-emerald-100/50 rounded-xl">
                <div className="flex gap-2.5">
                  <Shield className="text-emerald-700 w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <h5 className="text-xs font-semibold text-emerald-900">Parental Safety Reminder</h5>
                    <p className="text-[11px] text-emerald-800 leading-relaxed mt-1">
                      Always double check if the CAS worker served you documents within the statutory rules (no less than 24 hours prior to first hearing, and 7 business days for conference briefs under Rule 17). Protesting late service is your right.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Visual walkthrough infographic blocks */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2" id="family-court-briefings">
        <div className="bg-slate-950 p-5 rounded-2xl text-white text-left relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Scale className="w-16 h-16 text-white" />
          </div>
          <div>
            <span className="text-[9px] font-mono uppercase bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-semibold tracking-wider">
              Conference Brief
            </span>
            <h4 className="font-display text-base font-bold mt-2">The Case Brief Magic</h4>
            <p className="text-xs text-slate-400 mt-1 lines-clamp-3 leading-relaxed">
              Under Rule 17, Form 17B briefs are destroyed by the court once your conference ends. This is done to promote completely open negotiations. What is discussed at conferences cannot be used against you in a trial.
            </p>
          </div>
        </div>

        <div className="bg-slate-950 p-5 rounded-2xl text-white text-left relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <GitCommit className="w-16 h-16 text-white" />
          </div>
          <div>
            <span className="text-[9px] font-mono uppercase bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-semibold tracking-wider">
              Emergency Apprehensions
            </span>
            <h4 className="font-display text-base font-bold mt-2">The Strict 5-Day Rule</h4>
            <p className="text-xs text-slate-400 mt-1 lines-clamp-3 leading-relaxed">
              If CAS leaves your child with you but serves a protection brief, you are NOT removed. Only actual physical apprehension triggers Section 94's mandatory 5-day emergency courtroom appearance. Close tracking!
            </p>
          </div>
        </div>

        <div className="bg-slate-950 p-5 rounded-2xl text-white text-left relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Sparkles className="w-16 h-16 text-white" />
          </div>
          <div>
            <span className="text-[9px] font-mono uppercase bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-semibold tracking-wider">
              Evidentiary Strictness
            </span>
            <h4 className="font-display text-base font-bold mt-2">Explanatory Witnesses</h4>
            <p className="text-xs text-slate-400 mt-1 lines-clamp-3 leading-relaxed">
              Make sure your lawyer calls first-hand observers (like doctors, relatives, daycare supervisors) to file Form 14A affidavits. Relying on your own memory to counter CAS claims is rarely enough; direct evidence speaks loudest.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
