/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { CYFSA_TOPICS } from "../data";
import { CYFSATopic } from "../types";
import { BookOpen, Scale, AlertTriangle, ShieldCheck, CheckSquare, Info, ChevronRight, HelpCircle, FileText, Search, Lock, UploadCloud } from "lucide-react";

export default function CYFSAGuideTab() {
  const [selectedTopicId, setSelectedTopicId] = useState<string>("emergency-removal");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [revealedFictions, setRevealedFictions] = useState<Record<string, boolean>>({});

  const selectedTopic = CYFSA_TOPICS.find(t => t.id === selectedTopicId) || CYFSA_TOPICS[0];

  useEffect(() => {
    const handleFooterPrint = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.type === "guide" && selectedTopic) {
        printGuide(selectedTopic);
      }
    };
    window.addEventListener("trigger-print-pdf", handleFooterPrint);
    return () => window.removeEventListener("trigger-print-pdf", handleFooterPrint);
  }, [selectedTopic]);

  const printGuide = (topic: CYFSATopic) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow popups to save/print the statutory guide PDF.");
      return;
    }

    const htmlContent = `
      <html>
        <head>
          <title>${topic.title} - ParentShield</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,700;1,700&display=swap');
            body {
              font-family: 'Inter', sans-serif;
              color: #1e293b;
              margin: 40px;
              line-height: 1.6;
              background-color: #fff;
            }
            .no-print-btn {
              background-color: #1e3a8a;
              color: white;
              border: none;
              padding: 10px 18px;
              font-family: 'Inter', sans-serif;
              font-size: 13px;
              font-weight: bold;
              border-radius: 6px;
              cursor: pointer;
              margin-bottom: 25px;
            }
            @media print {
              .no-print-btn { display: none !important; }
              body { margin: 20px; }
            }
            .header-container {
              border-bottom: 3px double #1e3a8a;
              padding-bottom: 16px;
              margin-bottom: 30px;
            }
            .platform-label {
              font-size: 10px;
              text-transform: uppercase;
              font-weight: 800;
              letter-spacing: 0.1em;
              color: #4f46e5;
            }
            .title-main {
              font-family: 'Playfair Display', serif;
              font-size: 26px;
              font-weight: 700;
              color: #0f172a;
              margin: 5px 0 10px 0;
            }
            .meta-bar {
              display: flex;
              gap: 15px;
              font-size: 11px;
              color: #64748b;
              font-weight: 500;
              margin-bottom: 10px;
            }
            .badge-cat {
              background-color: #e0e7ff;
              color: #3730a3;
              padding: 2px 8px;
              border-radius: 4px;
              font-weight: bold;
            }
            .section-card {
              border: 1px solid #e2e8f0;
              border-radius: 12px;
              padding: 24px;
              margin-bottom: 24px;
              background-color: #fff;
              page-break-inside: avoid;
            }
            .section-title {
              font-size: 15px;
              font-weight: 800;
              color: #0f172a;
              border-bottom: 1.5px solid #e2e8f0;
              padding-bottom: 6px;
              margin-bottom: 16px;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .body-text {
              font-size: 13.5px;
              color: #334155;
              white-space: pre-line;
              text-align: justify;
            }
            .guide-list {
              padding: 0;
              margin: 0;
              list-style: none;
            }
            .guide-item {
              display: flex;
              margin-bottom: 14px;
              font-size: 13px;
              color: #334155;
              background: #f8fafc;
              padding: 12px 16px;
              border-radius: 8px;
              border-left: 4px solid #10b981;
            }
            .guide-num {
              font-weight: bold;
              color: #047857;
              margin-right: 12px;
              background-color: #d1fae5;
              width: 22px;
              height: 22px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 11px;
              flex-shrink: 0;
            }
            .checklist-item {
              border: 1px solid #fde68a;
              background-color: #fffbeb;
              padding: 16px;
              border-radius: 8px;
              margin-bottom: 12px;
              page-break-inside: avoid;
            }
            .checklist-title {
              font-weight: 700;
              font-size: 13.5px;
              color: #92400e;
              display: block;
              margin-bottom: 4px;
            }
            .checklist-desc {
              font-size: 12.5px;
              color: #78350f;
              line-height: 1.5;
            }
            .fvf-container {
              display: grid;
              grid-template-columns: 1fr;
              gap: 16px;
            }
            .fvf-card {
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              overflow: hidden;
              page-break-inside: avoid;
              margin-bottom: 15px;
            }
            .fvf-header {
              padding: 10px 14px;
              font-size: 11px;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.05em;
            }
            .fvf-fiction {
              background-color: #fef2f2;
              border-bottom: 1px solid #fee2e2;
            }
            .fvf-fiction-title {
              color: #991b1b;
            }
            .fvf-fiction-body {
              padding: 14px;
              font-style: italic;
              font-size: 13px;
              color: #7f1d1d;
            }
            .fvf-fact {
              background-color: #f0fdf4;
            }
            .fvf-fact-title {
              color: #166534;
            }
            .fvf-fact-body {
              padding: 14px;
              font-size: 13px;
              color: #14532d;
            }
            .fvf-expl {
              padding: 10px 14px;
              font-size: 11px;
              color: #0d9488;
              background-color: #f0fdfa;
              border-top: 1px solid #ccfbf1;
            }
            .primary-source-item {
              font-family: monospace;
              font-size: 11px;
              background-color: #f8fafc;
              padding: 8px 12px;
              border: 1px solid #e2e8f0;
              border-radius: 6px;
              margin-bottom: 8px;
              color: #475569;
            }
            .legal-disclaimer {
              background-color: #fafaf9;
              border: 1px solid #e7e5e4;
              padding: 16px;
              border-radius: 8px;
              font-size: 11px;
              color: #57534e;
              margin-top: 40px;
              line-height: 1.5;
              text-align: justify;
              page-break-inside: avoid;
            }
            .footer-signature {
              font-size: 10px;
              color: #94a3b8;
              text-align: center;
              margin-top: 30px;
              border-top: 1px solid #f1f5f9;
              padding-top: 15px;
            }
          </style>
        </head>
        <body>
          <button class="no-print-btn" onclick="window.print()">Print / Save as PDF</button>

          <div class="header-container">
            <span class="platform-label">ParentShield • Case Education Library</span>
            <h1 class="title-main">${topic.title}</h1>
            <div class="meta-bar">
              Category: <span class="badge-cat">${topic.category}</span>
              • Jurisdiction: Ontario Family Court
              • S.O. 2017 compliant
            </div>
          </div>

          <div class="section-card">
            <h3 class="section-title">⚖️ Statutory Background & Context</h3>
            <div class="body-text">${topic.fullBody}</div>
          </div>

          <div class="section-card">
            <h3 class="section-title">📋 Recommended Actions & Guidelines</h3>
            <div class="guide-list">
              ${topic.guidelines.map((guide: string, idx: number) => `
                <div class="guide-item">
                  <div class="guide-num">${idx + 1}</div>
                  <div>${guide}</div>
                </div>
              `).join("")}
            </div>
          </div>

          <div class="section-card">
            <h3 class="section-title">⚠️ Watchpoint Checklist for Parents</h3>
            <div style="margin-top: 10px;">
              ${topic.checklistItems.map((item: any) => `
                <div class="checklist-item">
                  <span class="checklist-title">✓ ${item.label}</span>
                  <span class="checklist-desc">${item.description}</span>
                </div>
              `).join("")}
            </div>
          </div>

          <div class="section-card">
            <h3 class="section-title">💡 Fact vs. Fiction Mythbusters</h3>
            <div class="fvf-container">
              ${topic.factVersusFiction.map((fvf: any) => `
                <div class="fvf-card">
                  <div class="fvf-header fvf-fiction">
                    <span class="fvf-fiction-title">Misconception (Fiction)</span>
                  </div>
                  <div class="fvf-fiction-body">"${fvf.fiction}"</div>
                  
                  <div class="fvf-header fvf-fact">
                    <span class="fvf-fact-title">Statutory Reality (Fact)</span>
                  </div>
                  <div class="fvf-fact-body">${fvf.fact}</div>
                  
                  <div class="fvf-expl">
                    <strong>Source Authority:</strong> ${fvf.sourceExplanation}
                  </div>
                </div>
              `).join("")}
            </div>
          </div>

          <div class="section-card">
            <h3 class="section-title">🔗 Official Verification Citations</h3>
            <div style="margin-top: 10px;">
              ${topic.primarySources.map((source: any) => `
                <div class="primary-source-item">
                  <strong>Source Label:</strong> ${source.label}<br/>
                  <strong>Live URL Path:</strong> ${source.url}
                </div>
              `).join("")}
            </div>
          </div>

          <div class="legal-disclaimer">
            <strong>MANDATORY LEGAL EDUCATIONAL STATEMENT:</strong> This document is generated for informational/educational objectives only under secondary statutory guidelines of the Child, Youth and Family Services Act (CYFSA) S.O. 2017, Chapter 14. This does not represent formal counsel or legal aid representations. Please immediately secure local, verified counsel from the Law Society of Ontario or Legal Aid Ontario to represent your case before the Court.
          </div>

          <div class="footer-signature">
            Primary sources verified current through Q2 2026 • Saved dynamically via OPA PDF Legal Desk.
          </div>

          <script>
            setTimeout(() => {
              window.print();
            }, 600);
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const categories = ["All", "Removal", "Protection Grounds", "Worker Authority", "Rights", "Evidence Rules", "Timelines"];

      const filteredTopics = CYFSA_TOPICS.filter(t => {
    const matchesCategory = categoryFilter === "All" || t.category === categoryFilter;
    const normalizedSearch = searchQuery.toLowerCase().replace(/s\.\s*(\d+)/g, 'section $1');
    const searchTerms = [
      t.title.toLowerCase(),
      t.summary.toLowerCase(),
      t.fullBody.toLowerCase(),
      ...t.primarySources.map(ps => ps.label.toLowerCase()),
      ...t.primarySources.map(ps => ps.url.toLowerCase()),
    ].join(' ');
    
    const matchesSearch = searchTerms.includes(normalizedSearch) || searchTerms.includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const toggleRevealFiction = (key: string) => {
    setRevealedFictions(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  return (
    <div className="space-y-8" id="cyfsa-guide-tab">
      {/* Educational Banner */}
      <div className="bg-amber-50 border-l-4 border-amber-500 p-5 rounded-r-xl shadow-xs" id="disclaimer-banner">
        <div className="flex gap-3">
          <Info className="text-amber-600 shrink-0 w-6 h-6" />
          <div>
            <h4 className="font-display font-medium text-amber-900 text-sm md:text-base">MANDATORY EDUCATIONAL LAW DISCLAIMER</h4>
            <p className="text-amber-800 text-xs md:text-sm mt-1 leading-relaxed">
              This platform covers child welfare statutory guidelines within the **Jurisdiction of Ontario, Canada** only. It is built strictly for parent educational empowerment. **This does not constitute legal advice.** All legal claims and processes must be reviewed with an active member of the Law Society of Ontario or Legal Aid Ontario.
            </p>
          </div>
        </div>
      </div>

      {/* Free Trial Upload & Privacy Banner */}
      <div className="bg-slate-50 border border-slate-200 p-5 rounded-xl shadow-xs grid grid-cols-1 md:grid-cols-12 gap-4 items-center" id="privacy-upload-banner">
        <div className="md:col-span-8 space-y-2">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-brand-50 border border-brand-150 rounded-md text-brand-700">
              <UploadCloud className="w-4 h-4 shrink-0" />
            </div>
            <h4 className="font-display font-bold text-slate-900 text-sm md:text-base tracking-tight">
              3 Free Document Uploads & Absolute Data Privacy
            </h4>
          </div>
          <p className="text-slate-600 text-xs md:text-sm leading-relaxed">
            Ready to audit your casework paperwork? You can upload up to <span className="font-extrabold text-brand-900">3 free documents</span> in our **Document Analyzer** tab for immediate statutory cross-referencing and parent-focused strategy mapping.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 font-medium">
            <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              No Server Saving
            </span>
            <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              No Persistent Downloads
            </span>
            <span className="flex items-center gap-1.5 text-brand-700 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500"></span>
              Transient Private Processing
            </span>
          </div>
        </div>
        <div className="md:col-span-4 bg-white border border-slate-150 p-4 rounded-lg flex flex-col justify-center items-center text-center space-y-1.5 shadow-2xs">
          <Lock className="w-5 h-5 text-brand-950" />
          <span className="font-display font-extrabold text-xs text-brand-950 uppercase tracking-wider">Zero Storage Active</span>
          <p className="text-[10px] text-slate-500 font-medium leading-normal max-w-xs">
            To ensure your family's safety, uploaded files remain strictly in active web memory and are destroyed instantly when you close this tab.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="guide-layout">
        {/* Left Sidebar: Topics List */}
        <div className="lg:col-span-5 space-y-4" id="sidebar-topics">
          <div>
            <h3 className="font-display text-lg font-semibold text-gray-900">Ontario CYFSA Registry</h3>
            <p className="text-xs text-slate-600 mt-1">Select topics below to access primary citations, limits, and checks.</p>
          </div>

          {/* Search Box */}
          <div className="relative" id="topic-search">
            <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search CYFSA statutes & topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all"
            />
          </div>

          {/* Categories Pill Buttons */}
          <div className="flex flex-wrap gap-1.5" id="category-pills">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                  categoryFilter === cat
                    ? "bg-brand-600 text-white shadow-xs"
                    : "bg-white hover:bg-slate-100 text-slate-700 border border-gray-200"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Topics Cards */}
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2" id="topic-cards-list">
            {filteredTopics.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                <Search className="mx-auto text-slate-400 w-8 h-8 mb-2" />
                <p className="text-xs text-slate-600">No matching educational statutes found.</p>
              </div>
            ) : (
              filteredTopics.map((topic) => (
                <div
                  key={topic.id}
                  id={`topic-card-${topic.id}`}
                  onClick={() => setSelectedTopicId(topic.id)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    selectedTopicId === topic.id
                      ? "bg-brand-50/70 border-brand-300 ring-1 ring-brand-300 shadow-xs"
                      : "bg-white hover:bg-gray-50 border-gray-200"
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="inline-block text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-brand-100 text-brand-800">
                      {topic.category}
                    </span>
                    {topic.badge && (
                      <span className="inline-block text-[9px] font-mono tracking-tight font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 animate-pulse">
                        {topic.badge}
                      </span>
                    )}
                  </div>
                  <h4 className="font-display font-medium text-gray-900 text-sm mt-2 flex items-center justify-between">
                    <span>{topic.title}</span>
                    <ChevronRight className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${selectedTopicId === topic.id ? "translate-x-1 text-brand-600" : ""}`} />
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                    {topic.summary}
                  </p>
                </div>
              ))
            )}
          </div>

          {/* Symmetrical Interactive Glossary Help Card */}
          <div className="bg-gradient-to-br from-brand-950 to-slate-900 rounded-2xl p-4 text-white space-y-3.5 shadow-sm border border-brand-900/40 text-left" id="sidebar-glossary-widget">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-amber-300 shrink-0 animate-pulse" />
              <h4 className="font-display font-bold text-xs uppercase tracking-wider text-slate-100">CYFSA Legal Translator</h4>
            </div>
            <p className="text-[11px] text-brand-200 leading-normal">
              Confused by complex child welfare terminology? Click any term below to translate official language into real protection strategies:
            </p>
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono font-bold">
              <button 
                onClick={() => window.dispatchEvent(new CustomEvent("open-terminology-glossary", { detail: { term: "Plan of Care" } }))}
                className="p-2.5 bg-white/10 hover:bg-white/20 text-amber-250 hover:text-white rounded-xl transition text-left cursor-pointer border border-white/5 truncate"
                title="Explain Plan of Care"
              >
                Plan of Care
              </button>
              <button 
                onClick={() => window.dispatchEvent(new CustomEvent("open-terminology-glossary", { detail: { term: "Temporary Care Agreement" } }))}
                className="p-2.5 bg-white/10 hover:bg-white/20 text-amber-250 hover:text-white rounded-xl transition text-left cursor-pointer border border-white/5 truncate"
                title="Explain Temporary Care Agreement"
              >
                TCA Agreement
              </button>
              <button 
                onClick={() => window.dispatchEvent(new CustomEvent("open-terminology-glossary", { detail: { term: "Supervision Order" } }))}
                className="p-2.5 bg-white/10 hover:bg-white/20 text-amber-250 hover:text-white rounded-xl transition text-left cursor-pointer border border-white/5 truncate"
                title="Explain Supervision Order"
              >
                Supervision Order
              </button>
              <button 
                onClick={() => window.dispatchEvent(new CustomEvent("open-terminology-glossary", { detail: { term: "Extended Society Care" } }))}
                className="p-2.5 bg-white/10 hover:bg-white/20 text-amber-250 hover:text-white rounded-xl transition text-left cursor-pointer border border-white/5 truncate"
                title="Explain Extended Society Care"
              >
                Extended Care
              </button>
              <button 
                onClick={() => window.dispatchEvent(new CustomEvent("open-terminology-glossary", { detail: { term: "Least Intrusive Intervention" } }))}
                className="p-2.5 bg-white/10 hover:bg-white/20 text-amber-250 hover:text-white rounded-xl transition text-left cursor-pointer border border-white/5 truncate col-span-2"
                title="Explain Least Intrusive principle"
              >
                Least Intrusive Principle
              </button>
            </div>
          </div>
        </div>

        {/* Right Content View: Live Topic Explainer */}
        <div className="lg:col-span-7" id="explainer-viewer">
          {selectedTopic ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden" id="topic-detail-card">
              {/* Header */}
              <div className="bg-brand-900 p-6 text-white text-left">
                <span className="text-[10px] font-mono tracking-wider uppercase px-2 py-0.5 rounded-md bg-brand-700/60 font-semibold border border-brand-500/30">
                  Ontario CYFSA Statutory Reference
                </span>
                <h2 className="font-display text-xl md:text-2xl font-bold mt-2">{selectedTopic.title}</h2>
                <p className="text-brand-100 text-xs md:text-sm mt-2 leading-relaxed font-light">
                  {selectedTopic.summary}
                </p>
              </div>

              {/* Body */}
              <div className="p-6 md:p-8 space-y-8 text-left">
                {/* Full Statutory Body */}
                <div className="prose max-w-none text-gray-700 text-sm space-y-4 font-normal" id="topic-fullbody">
                  <h3 className="font-display font-semibold text-gray-900 text-base border-b border-gray-100 pb-2">
                    Legislative Background & Limits
                  </h3>
                  <p className="whitespace-pre-line leading-relaxed text-slate-700">
                    {selectedTopic.fullBody}
                  </p>
                </div>

                {/* Primary Source Verification Links */}
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-150 space-y-3" id="primary-sources">
                  <span className="text-xs font-mono font-medium text-slate-600 uppercase flex items-center gap-1.5">
                    <Scale className="w-3.5 h-3.5 text-brand-600" /> Primary Statutory References
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedTopic.primarySources.map((source, i) => (
                      <a
                        key={i}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 p-2 bg-white rounded-lg border border-gray-200 hover:border-brand-400 hover:text-brand-700 transition-all text-xs text-slate-700"
                      >
                        <FileText className="w-4 h-4 text-brand-500 shrink-0" />
                        <span className="font-medium truncate">{source.label}</span>
                      </a>
                    ))}
                    {selectedTopic.primarySources.length === 0 && (
                      <div className="p-2 bg-amber-50 text-amber-800 text-xs rounded border border-amber-200">
                        Not verifiable from primary sources.
                      </div>
                    )}
                  </div>
                </div>

                {/* Guidelines */}
                <div className="space-y-3" id="parental-guidelines">
                  <h4 className="font-display font-semibold text-gray-900 text-sm uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" /> Recommended Action Steps
                  </h4>
                  <ul className="grid grid-cols-1 gap-2.5">
                    {selectedTopic.guidelines.map((guide, idx) => (
                      <li key={idx} className="flex gap-2.5 text-xs text-slate-700 leading-relaxed bg-emerald-50/40 p-2.5 rounded-lg border border-emerald-100/50">
                        <span className="w-5 h-5 flex items-center justify-center bg-emerald-100 text-emerald-800 font-mono text-[10px] rounded-full shrink-0 font-bold">
                          {idx + 1}
                        </span>
                        <span>{guide}</span>
                      </li>
                    ))}
                  </ul>

                  {/* AI Analyzer Advertisement Banner */}
                  <div className="mt-4 p-4 bg-brand-50 border-l-4 border-brand-600 rounded-r-xl space-y-2 text-left" id="analyzer-ad-banner">
                    <div className="flex items-center gap-2 text-brand-950 font-bold text-xs uppercase tracking-wider">
                      <span>🔍</span> Action Checklist: Audit Your Records
                    </div>
                    <p className="text-xs text-brand-900 leading-relaxed font-medium">
                      Always read through all casework records, notes, and letters from CAS carefully. You should point out any statutory violations, incorrect timelines, or uncorroborated assertions. 
                      You can upload these files directly to our <strong className="text-brand-950 underline font-extrabold">AI Document Analyzer</strong>, which will sweep your documents, pinpointing timeline errors, s. 74 protection ground mismatches, unauthorized entry violations, and hearsay patterns automatically!
                    </p>
                  </div>
                </div>

                {/* Parental Watch-For Checklist */}
                <div className="space-y-3" id="watchpoint-checklist">
                  <h4 className="font-display font-semibold text-gray-900 text-sm uppercase tracking-wider flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" /> Watch-For Checklist (Critique Assumptions)
                  </h4>
                  <div className="space-y-2">
                    {selectedTopic.checklistItems.map((item, idx) => (
                      <div key={idx} className="p-3 bg-amber-50/30 rounded-xl border border-amber-100 flex items-start gap-3">
                        <CheckSquare className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                        <div>
                          <span className="font-medium text-gray-800 text-xs block">{item.label}</span>
                          <span className="text-slate-700 text-xs leading-relaxed mt-0.5 block">{item.description}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Fact vs Fiction Interface */}
                <div className="space-y-4 pt-2" id="fact-versus-fiction">
                  <h3 className="font-display font-semibold text-gray-900 text-base border-b border-gray-100 pb-2 flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-brand-500" /> Fact vs. Fiction Mythbuster
                  </h3>
                  <div className="space-y-3">
                    {selectedTopic.factVersusFiction.map((fvf, idx) => {
                      const revealKey = `${selectedTopic.id}-${idx}`;
                      const isRevealed = revealedFictions[revealKey];
                      return (
                        <div key={idx} className="border border-gray-150 rounded-xl overflow-hidden shadow-2xs">
                          {/* Fiction Section */}
                          <div className="bg-rose-50/50 p-4 border-b border-gray-150">
                            <span className="text-[10px] uppercase font-mono font-bold tracking-wider px-2 py-0.5 bg-rose-100 text-rose-800 rounded">
                              Common Misconception (Fiction)
                            </span>
                            <p className="text-rose-900 font-medium text-xs md:text-sm mt-2 leading-relaxed">
                              "{fvf.fiction}"
                            </p>
                          </div>

                          {/* Action Button to Reveal Fact */}
                          <div className="bg-white p-3 flex justify-between items-center px-4">
                            <span className="text-xs text-slate-600 font-medium">Verified by Ontario S.O. statutory precedent</span>
                            <button
                              onClick={() => toggleRevealFiction(revealKey)}
                              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                            >
                              {isRevealed ? "Hide Statutory Reality" : "Reveal Ontario Court Law"}
                            </button>
                          </div>

                          {/* Fact Section */}
                          {isRevealed && (
                            <div className="bg-emerald-50/60 p-4 border-t border-gray-150 animate-fadeIn text-left">
                              <span className="text-[10px] uppercase font-mono font-bold tracking-wider px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded">
                                Legal Fact
                              </span>
                              <p className="text-emerald-900 font-medium text-xs md:text-sm mt-2 leading-relaxed">
                                {fvf.fact}
                              </p>
                              <div className="mt-3 flex items-center gap-1.5 bg-white/70 border border-emerald-100 p-2 rounded-lg text-[11px] text-emerald-800 leading-normal">
                                <Scale className="w-3.5 h-3.5 shrink-0" />
                                <span><strong>Authority Explanation:</strong> {fvf.sourceExplanation}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-20 bg-white rounded-2xl border border-gray-100 shadow-2xs">
              <BookOpen className="w-12 h-12 text-slate-400 mx-auto" />
              <h3 className="font-display text-gray-700 text-lg font-semibold mt-4">Select a Statute Topic</h3>
              <p className="text-slate-600 text-sm mt-1">Pick an item from the registry list to start analyzing rights and procedures.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
