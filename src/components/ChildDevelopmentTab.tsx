/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { RESEARCH_SUMMARIES } from "../data";
import { ResearchSummary } from "../types";
import { Brain, Heart, Milestone, Users, FileSignature, GraduationCap, ArrowUpRight, Search } from "lucide-react";

export default function ChildDevelopmentTab() {
  const [selectedCat, setSelectedCat] = useState<string>("All");
  const [searchWord, setSearchWord] = useState<string>("");

  const categories = ["All", "Attachment Disruption", "Short & Long-term Trauma", "Reunification Success", "Systemic Factors"];

  const filteredStudies = RESEARCH_SUMMARIES.filter((study) => {
    const matchCat = selectedCat === "All" || study.category === selectedCat;
    const matchSearch = study.title.toLowerCase().includes(searchWord.toLowerCase()) ||
                        study.authorYear.toLowerCase().includes(searchWord.toLowerCase()) ||
                        study.evidenceSummary.toLowerCase().includes(searchWord.toLowerCase());
    return matchCat && matchSearch;
  });

  const getCategoryIcon = (category: ResearchSummary["category"]) => {
    switch (category) {
      case "Attachment Disruption": return <Heart className="w-5 h-5 text-rose-500" />;
      case "Short & Long-term Trauma": return <Brain className="w-5 h-5 text-purple-500" />;
      case "Reunification Success": return <Milestone className="w-5 h-5 text-emerald-500" />;
      case "Systemic Factors": return <Users className="w-5 h-5 text-brand-500" />;
    }
  };

  return (
    <div className="space-y-8" id="child-development-tab">
      {/* Intro Scholarly Block */}
      <div className="text-left max-w-3xl">
        <h2 className="font-display text-2xl font-bold text-gray-900">Evidence-Based Child Welfare Development Science</h2>
        <p className="text-sm text-gray-650 mt-2 leading-relaxed">
          Ontario courts are statutorily required to base actions on the **'best interests of the child' (CYFSA Sec 74(3))**. This child-centric interest is highly correlated with the neuroscience of stable caregiver attachments. Avoid opinionated arguments; use peer-reviewed clinical research summaries of child trauma to protect familial attachment.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-150 flex flex-col md:flex-row gap-4 items-center justify-between" id="research-toolbar">
        <div className="flex flex-wrap gap-1.5 w-full md:w-auto" id="research-categories">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCat(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                selectedCat === cat
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-slate-100 hover:bg-gray-200 text-gray-700"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72" id="research-search">
          <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search academic findings..."
            value={searchWord}
            onChange={(e) => setSearchWord(e.target.value)}
            className="w-full bg-slate-50 border border-gray-200 rounded-lg pl-9 pr-4 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 transition-all font-sans"
          />
        </div>
      </div>

      {/* Grid of Scholarly Summaries */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6" id="research-grid">
        {filteredStudies.map((study) => (
          <div
            key={study.id}
            id={`study-card-${study.id}`}
            className="bg-white rounded-2xl border border-gray-150 shadow-2xs hover:shadow-xs transition-shadow p-6 flex flex-col justify-between text-left"
          >
            <div className="space-y-4">
              {/* Category, Author, Title */}
              <div className="flex justify-between items-center bg-gray-50 -mx-6 -mt-6 p-4 border-b border-gray-150 rounded-t-2xl">
                <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-gray-550 flex items-center gap-1.5">
                  {getCategoryIcon(study.category)}
                  {study.category}
                </span>
                <span className="text-xs font-mono font-semibold text-brand-700 bg-brand-50 px-2.5 py-0.5 rounded-md border border-brand-100">
                  {study.authorYear}
                </span>
              </div>

              <div>
                <h4 className="font-display font-bold text-gray-950 text-sm md:text-base leading-snug">
                  {study.title}
                </h4>
              </div>

              {/* Research Methodology and Core findings summary */}
              <div className="space-y-3">
                <blockquote className="text-xs text-gray-650 italic leading-relaxed border-l-2 border-brand-350 pl-3">
                  "{study.evidenceSummary}"
                </blockquote>

                <div className="space-y-1.5 pt-1">
                  <h5 className="text-[11px] font-mono tracking-wider font-semibold text-slate-600 uppercase">
                    Key Peer-Reviewed Findings:
                  </h5>
                  <ul className="space-y-1.5">
                    {study.keyFindings.map((finding, index) => (
                      <li key={index} className="flex gap-2 text-xs text-slate-700 leading-relaxed">
                        <span className="text-brand-500 font-bold shrink-0">✓</span>
                        <span>{finding}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Verification & Citation Block */}
            <div className="mt-6 pt-4 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-secondary-light">
              <div className="text-[10px] text-slate-600 font-medium">
                <span className="font-semibold text-gray-700 block">Citation Source:</span>
                <span className="block mt-0.5 max-w-[280px] truncate">{study.sourceCitation}</span>
              </div>
              
              {study.pubMedOrCanLiiLink && (
                <a
                  href={study.pubMedOrCanLiiLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:text-brand-850 shrink-0"
                >
                  <span>Verification Portal</span>
                  <ArrowUpRight className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        ))}

        {filteredStudies.length === 0 && (
          <div className="col-span-full text-center py-16 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
            <GraduationCap className="mx-auto text-slate-400 w-12 h-12 mb-3" />
            <h4 className="font-display font-semibold text-gray-700">No Verified Research Found</h4>
            <p className="text-xs text-slate-600 mt-1">Refine your category filters or search inputs.</p>
          </div>
        )}
      </div>

      {/* System info on attachment biology */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 md:p-8 text-left relative overflow-hidden" id="child-impact-brief">
        <div className="absolute inset-0 bg-radial-to-r from-brand-600/10 to-transparent pointer-events-none" />
        <div className="max-w-3xl space-y-4">
          <div className="flex items-center gap-2">
            <Brain className="text-brand-400 w-6 h-6 animate-pulse" />
            <span className="text-xs font-mono font-bold tracking-widest text-brand-400 uppercase">
              Parent Educational Guidance
            </span>
          </div>
          <h3 className="font-display text-lg md:text-xl font-bold">How to Present This Evidence inside an Ontario Family Court</h3>
          <p className="text-xs md:text-sm text-slate-350 leading-relaxed font-light">
            When submitting responsive affidavits, avoid purely emotional attacks against child protective workers (e.g., 'the worker is malicious and hates our family'). Instead, present structured, positive parenting schedules backed by child attachment theories. Showcase that bringing your child home, or placing them immediately with kin relative to foster institutions, protects their neurological well-being and is highly compatible with peer-reviewed child science.
          </p>
          <div className="pt-2">
            <span className="text-[10px] text-slate-400 italic block">
              "Judges in Ontario are increasingly receptive to trauma-informed plans that establish concrete family stability." - Law Society of Ontario briefings.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
