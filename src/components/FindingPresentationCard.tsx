/**
 * CYFSA Navigator — Finding Presentation Card Component
 *
 * Implements two professional presentation modes for every finding:
 * 1. Educational Legal Analysis (statutory breakdown, evidentiary impact, parent rights)
 * 2. Courtroom-Style Legal Presentation (formal Ontario family-law courtroom advocacy)
 *
 * Plus a third expandable section:
 * "What Can This Finding Be Used For?"
 * Connecting the finding to the official Ontario Court Forms Education Library.
 */

import React, { useState } from "react";
import { 
  Scale, 
  BookOpen, 
  Gavel, 
  ChevronDown, 
  ChevronRight, 
  Check, 
  HelpCircle, 
  ShieldAlert, 
  FileText, 
  Search, 
  ExternalLink,
  MessageSquare,
  Sparkles,
  Info
} from "lucide-react";
import { 
  enhanceFindingPresentation, 
  type EnhancedFindingPresentation 
} from "../../shared/findingPresentation";
import { effectiveCitationStatus } from "../../shared/citationVerification";
import { effectiveQuoteStatus, QUOTE_DISPLAY } from "../../shared/quoteVerification";
import { ParagraphListenButton } from "./narration";
import FormattedReportText from "./FormattedReportText";

interface FindingPresentationCardProps {
  flag: any;
  idx: number;
  narrationActive?: boolean;
  factCheckEnabled?: boolean;
  openLegislativeReference: (ref: string) => void;
  setSearchQuery: (query: string) => void;
}

export const FindingPresentationCard: React.FC<FindingPresentationCardProps> = ({
  flag,
  idx,
  narrationActive = false,
  factCheckEnabled = false,
  openLegislativeReference,
  setSearchQuery,
}) => {
  const [activeTab, setActiveTab] = useState<"educational" | "courtroom">("educational");
  const [isUsesExpanded, setIsUsesExpanded] = useState<boolean>(false);

  const enhanced: EnhancedFindingPresentation = enhanceFindingPresentation(flag);
  const { educationalAnalysis: edu, courtroomPresentation: court, practicalUses: uses } = enhanced;
  const flagId = flag.id || `rf-${idx + 1}`;

  return (
    <div
      id={`red-flag-card-${flagId}`}
      className={`bg-white border rounded-2xl p-5 space-y-4 text-xs shadow-xs transition-all duration-200 ${
        narrationActive 
          ? "border-rose-400 ring-2 ring-rose-500 bg-rose-50/30 shadow-md" 
          : "border-slate-200 hover:border-slate-300"
      }`}
    >
      {/* Top Header: Severity, Category, Evidence Badges, Listen, Statute Reference */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-slate-100">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Severity Badge */}
          <span
            className={`px-2.5 py-1 rounded-md text-[10px] font-sans font-bold tracking-wide uppercase ${
              flag.severity?.includes("CRITICAL")
                ? "bg-rose-100 text-rose-800 border border-rose-200"
                : flag.severity?.includes("Worth")
                ? "bg-amber-100 text-amber-800 border border-amber-200"
                : "bg-brand-100 text-brand-800 border border-brand-200"
            }`}
          >
            {flag.severity}
          </span>

          {/* Category Badge */}
          <span className="font-sans font-bold text-rose-800 text-xs px-2.5 py-0.5 bg-rose-50 rounded-md border border-rose-100">
            {flag.category}
          </span>

          {/* Evidence Classification Badge */}
          {flag.evidenceClassification && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-sans font-bold bg-slate-100 text-slate-800 border border-slate-200 uppercase tracking-wide">
              Evidence: {flag.evidenceClassification}
            </span>
          )}

          {/* Citation Status Badge (if fact-check enabled) */}
          {factCheckEnabled && (() => {
            const status = effectiveCitationStatus(flag);
            const matched = status === "INTERNAL_REFERENCE_MATCH";
            const none = status === "NONE";
            return (
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-sans font-bold tracking-wide uppercase ${
                  matched ? "bg-sky-100 text-sky-800" : none ? "bg-slate-100 text-slate-700" : "bg-rose-100 text-rose-800"
                }`}
                title={flag.citationReason || "Confirm this citation with counsel"}
              >
                {matched ? "Internal reference match" : none ? "No statute cited" : "Citation unverified"}
              </span>
            );
          })()}

          {/* Forensic Second Review Verdict Badge */}
          {flag.forensicVerification && (
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-sans font-bold tracking-wide uppercase border ${
                flag.forensicVerification.verdict === "SUPPORTED"
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : flag.forensicVerification.verdict === "NEEDS_CONTEXT"
                  ? "bg-slate-50 text-slate-700 border-slate-200"
                  : "bg-amber-50 text-amber-800 border-amber-200"
              }`}
              title={flag.forensicVerification.note || ""}
            >
              Second review: {flag.forensicVerification.verdict.replace("_", " ")}
            </span>
          )}
        </div>

        {/* Right Action Buttons: Narration Listen & Statute Reference */}
        <div className="flex items-center gap-2">
          <ParagraphListenButton segmentId={`rf-${flagId}`} />
          {flag.legalReference && (
            <button
              onClick={() => openLegislativeReference(flag.legalReference)}
              className="font-sans text-brand-700 hover:text-brand-900 font-bold text-xs bg-brand-50 hover:bg-brand-100 border border-brand-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
              title="Open the statute reference for this citation"
            >
              <Scale className="w-3.5 h-3.5 text-brand-600" />
              <span>Statute reference: {flag.legalReference} ↗</span>
            </button>
          )}
        </div>
      </div>

      {/* Quoted Document Passage with Verified Locator */}
      {flag.phraseDetected && (
        <div className="space-y-1.5 bg-slate-50/90 p-3.5 border border-slate-200 rounded-xl">
          <div className="flex justify-between items-center gap-2">
            <span className="text-[10px] font-sans font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
              <span>📄</span> Quoted Statement in Document:
            </span>
            <button
              onClick={() => {
                setSearchQuery(flag.phraseDetected);
                const docViewer = document.getElementById("file-plain-content-viewer");
                if (docViewer) {
                  docViewer.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              }}
              className="text-xs font-sans text-brand-700 bg-brand-50 hover:bg-brand-100 hover:text-brand-900 font-semibold px-2.5 py-1 rounded-md border border-brand-200 transition-colors cursor-pointer flex items-center gap-1"
            >
              <Search className="w-3 h-3" />
              <span>Locate Phrase</span>
            </button>
          </div>
          <p className="italic text-slate-800 leading-relaxed font-sans bg-white p-3 border-l-4 border-amber-400 rounded-r-lg border-y border-r border-slate-200 text-xs shadow-2xs">
            "{flag.phraseDetected}"
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-600 font-sans">
            {edu.documentLocator && (
              <span className="flex items-center gap-1 font-medium">
                <span>📌</span> <strong>Locator:</strong> {edu.documentLocator}
              </span>
            )}
            {(() => {
              const display = QUOTE_DISPLAY[effectiveQuoteStatus(flag)];
              const page = flag.quoteLocation?.page;
              return display.verified ? (
                <span className="text-emerald-700 font-semibold flex items-center gap-1">
                  <Check className="w-3 h-3 shrink-0" /> {display.label}{page ? ` (page ${page})` : ""}
                </span>
              ) : (
                <span className="text-amber-800 font-semibold bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                  ⚠️ {display.label}{page ? ` (page ${page})` : ""}
                </span>
              );
            })()}
          </div>
        </div>
      )}

      {/* TWO PRESENTATION MODES TAB SWITCHER */}
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
        <div className="flex border-b border-slate-200 bg-slate-50/70 p-1 gap-1" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "educational"}
            onClick={() => setActiveTab("educational")}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer font-sans ${
              activeTab === "educational"
                ? "bg-white text-brand-700 shadow-xs border border-slate-200/80 font-extrabold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-brand-600" />
            <span>Educational Legal Analysis</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "courtroom"}
            onClick={() => setActiveTab("courtroom")}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer font-sans ${
              activeTab === "courtroom"
                ? "bg-slate-900 text-white shadow-xs border border-slate-800 font-extrabold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <Gavel className="w-3.5 h-3.5 text-amber-400" />
            <span>Courtroom-Style Legal Presentation</span>
          </button>
        </div>

        {/* TAB 1: EDUCATIONAL LEGAL ANALYSIS */}
        {activeTab === "educational" && (
          <div className="p-4 space-y-3.5 font-sans animate-in fade-in duration-150">
            {/* Direct Finding Classification Banner */}
            <div className="p-3 bg-amber-50/60 border border-amber-200/70 rounded-xl space-y-1">
              <div className="flex items-center gap-1.5 text-amber-900 font-bold text-xs uppercase tracking-wider">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>{edu.nature}</span>
              </div>
              <p className="text-slate-800 text-xs font-medium leading-relaxed">
                {edu.directFindingStatement}
              </p>
            </div>

            {/* Applicable Authority & Case Law */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block">
                  Statutory & Procedural Authority:
                </span>
                <p className="font-semibold text-slate-800 text-xs">{edu.applicableLegislation}</p>
                <p className="text-[11px] text-slate-600 leading-normal">{edu.proceduralRule}</p>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block">
                  Verified Ontario Case Law:
                </span>
                <p className="font-semibold text-brand-900 text-xs">
                  {edu.verifiedCaseLaw.caseName} <span className="font-normal text-slate-500 font-mono text-[10px]">({edu.verifiedCaseLaw.citation})</span>
                </p>
                <p className="text-[11px] text-slate-600 leading-normal italic">
                  "{edu.verifiedCaseLaw.legalPrinciple}"
                </p>
              </div>
            </div>

            {/* Tri-Part Legal Breakdown: What it Establishes, What Law Requires, Why it Matters */}
            <div className="space-y-2 p-3.5 bg-white border border-slate-200 rounded-xl">
              <div className="space-y-1">
                <strong className="text-slate-900 font-bold text-xs block">What the Document Evidence Establishes:</strong>
                <p className="text-slate-700 leading-relaxed text-xs">{edu.whatEvidenceEstablishes}</p>
              </div>
              <div className="space-y-1 pt-1.5 border-t border-slate-100">
                <strong className="text-slate-900 font-bold text-xs block">What Ontario Law Requires:</strong>
                <p className="text-slate-700 leading-relaxed text-xs">{edu.whatLawRequires}</p>
              </div>
              <div className="space-y-1 pt-1.5 border-t border-slate-100">
                <strong className="text-slate-900 font-bold text-xs block">Evidentiary Significance & Why This Matters:</strong>
                <div className="text-slate-700 leading-relaxed text-xs">
                  <FormattedReportText text={edu.whyFindingMatters} />
                </div>
              </div>
            </div>

            {/* Missing Evidence Required to Resolve Point */}
            <div className="p-3 bg-rose-50/50 border border-rose-200/60 rounded-xl space-y-1 text-xs">
              <span className="font-bold text-rose-900 text-xs flex items-center gap-1">
                <span>🔍</span> Missing Evidence Required to Conclusively Resolve:
              </span>
              <p className="text-slate-700 leading-relaxed">{edu.missingEvidenceToResolve}</p>
            </div>

            {/* Parent Rights & Preparation Guidance */}
            <div className="p-3.5 bg-brand-50/70 border border-brand-100 rounded-xl space-y-2 text-xs text-brand-950">
              <div className="font-bold text-brand-900 flex items-center gap-1.5 border-b border-brand-100 pb-1">
                <Sparkles className="w-3.5 h-3.5 text-brand-600" />
                <span>Parent Rights & Examination Preparation Guidance:</span>
              </div>
              <ul className="space-y-1.5 list-disc pl-4 text-slate-800 leading-relaxed">
                {edu.parentExaminationGuidance.map((step, sIdx) => (
                  <li key={sIdx}>{step}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* TAB 2: COURTROOM-STYLE LEGAL PRESENTATION */}
        {activeTab === "courtroom" && (
          <div className="p-4 space-y-3.5 font-sans animate-in fade-in duration-150 bg-slate-950 text-slate-200">
            {/* Courtroom Context Banner */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Gavel className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <h6 className="font-bold text-white text-xs tracking-wide uppercase">
                    Formal Ontario Family Court Submissions
                  </h6>
                  <p className="text-[10px] text-slate-400">
                    Articulated in the Professional Language of a Family Law Advocate Addressing a Judge
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-amber-300 font-mono">
                Oral &amp; Written Advocacy Standard
              </span>
            </div>

            {/* Formal Courtroom Opening & Evidentiary Speech */}
            <div className="space-y-2.5 bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
              <div className="font-mono text-[11px] text-amber-400 font-bold uppercase tracking-wider">
                Courtroom Oral Submission Example:
              </div>
              <blockquote className="p-3.5 bg-slate-950 border-l-3 border-amber-400 rounded-r-lg text-xs leading-relaxed text-slate-100 italic font-serif">
                {court.courtroomDialogueExample}
              </blockquote>
            </div>

            {/* Legal Authority Submission */}
            <div className="space-y-1.5 p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl text-xs">
              <strong className="text-amber-300 font-bold block text-xs">
                Legal Authority &amp; Jurisprudential Application:
              </strong>
              <p className="text-slate-300 leading-relaxed">{court.legalAuthoritySubmission}</p>
            </div>

            {/* Factual Submissions & Standard of Proof */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">
                  Evidentiary Standard Status:
                </span>
                <p className="text-slate-300 leading-relaxed font-medium">
                  {court.evidentiaryStandardStatus}
                </p>
              </div>

              <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">
                  Substantive Submission for Relief:
                </span>
                <p className="text-slate-300 leading-relaxed font-medium">
                  {court.substantivePrayerForRelief}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* THIRD EXPANDABLE SECTION: WHAT CAN THIS FINDING BE USED FOR? */}
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
        <button
          type="button"
          onClick={() => setIsUsesExpanded(!isUsesExpanded)}
          className="w-full p-3.5 bg-slate-100/70 hover:bg-slate-100 transition-colors flex items-center justify-between text-left cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-600" />
            <h6 className="font-display font-bold text-slate-900 text-xs md:text-sm tracking-wide">
              What Can This Finding Be Used For? (Practical Litigation &amp; Ontario Court Forms)
            </h6>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-brand-700 font-semibold font-sans">
            <span>{isUsesExpanded ? "Collapse Details" : "Expand Practical Uses"}</span>
            {isUsesExpanded ? (
              <ChevronDown className="w-4 h-4 text-brand-700" />
            ) : (
              <ChevronRight className="w-4 h-4 text-brand-700" />
            )}
          </div>
        </button>

        {isUsesExpanded && (
          <div className="p-4 space-y-4 bg-white border-t border-slate-200 font-sans animate-in fade-in duration-150">
            {/* Practical Litigation Uses Grid: Cross-Exam, Objections, Disclosure */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* 1. Cross Examination */}
              <div className="p-3.5 bg-brand-50/50 border border-brand-100 rounded-xl space-y-2">
                <h6 className="font-bold text-brand-950 text-xs uppercase tracking-wider flex items-center gap-1 border-b border-brand-100 pb-1">
                  <MessageSquare className="w-3.5 h-3.5 text-brand-600" />
                  <span>1. Cross-Examination Questions</span>
                </h6>
                <ul className="space-y-1.5 text-xs text-slate-700 leading-relaxed">
                  {uses.crossExaminationQuestions.map((q, qIdx) => (
                    <li key={qIdx} className="italic bg-white p-2 rounded border border-brand-50">
                      {q}
                    </li>
                  ))}
                </ul>
              </div>

              {/* 2. Evidentiary Objections */}
              <div className="p-3.5 bg-amber-50/50 border border-amber-200/60 rounded-xl space-y-2">
                <h6 className="font-bold text-amber-950 text-xs uppercase tracking-wider flex items-center gap-1 border-b border-amber-200/50 pb-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                  <span>2. Evidentiary Objections on Weight</span>
                </h6>
                <ul className="space-y-1.5 text-xs text-slate-700 leading-relaxed">
                  {uses.evidentiaryObjections.map((obj, oIdx) => (
                    <li key={oIdx} className="bg-white p-2 rounded border border-amber-100">
                      {obj}
                    </li>
                  ))}
                </ul>
              </div>

              {/* 3. Disclosure Demands */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <h6 className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-1 border-b border-slate-200 pb-1">
                  <FileText className="w-3.5 h-3.5 text-slate-700" />
                  <span>3. Targeted Disclosure Demands</span>
                </h6>
                <ul className="space-y-1.5 text-xs text-slate-700 leading-relaxed">
                  {uses.disclosureDemands.map((disc, dIdx) => (
                    <li key={dIdx} className="bg-white p-2 rounded border border-slate-200/70">
                      {disc}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* OFFICIAL ONTARIO COURT FORMS EDUCATION LIBRARY CONNECTION */}
            <div className="bg-emerald-50/60 border border-emerald-200 rounded-2xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-200/80 pb-2">
                <div className="flex items-center gap-2">
                  <Gavel className="w-4 h-4 text-emerald-700 shrink-0" />
                  <div>
                    <h6 className="font-bold text-emerald-950 text-xs uppercase tracking-wide">
                      Official Ontario Court Forms Education Connection
                    </h6>
                    <p className="text-[11px] text-emerald-800">
                      Prescribed under Ontario Family Law Rules (O. Reg. 114/99)
                    </p>
                  </div>
                </div>
                <a
                  href={uses.courtForms.officialIndexUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-white hover:bg-emerald-100 border border-emerald-300 px-2.5 py-1 rounded-lg transition-colors shadow-2xs self-start sm:self-auto"
                >
                  <span>Ontario Court Forms Index</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Primary Prescribed Form Callout */}
              <div className="bg-white p-3.5 rounded-xl border border-emerald-200 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-emerald-900 text-xs">
                    Primary Applicable Form: <span className="font-mono bg-emerald-100 text-emerald-950 px-2 py-0.5 rounded border border-emerald-200">Form {uses.courtForms.primaryFormNumber}</span> — {uses.courtForms.primaryFormTitle}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {uses.courtForms.officialRulesCitation}
                  </span>
                </div>
                <div className="text-xs text-slate-700 space-y-1">
                  <strong>Relevant Form Section / Field:</strong>
                  <p className="font-medium text-slate-800 bg-slate-50 p-2 rounded border border-slate-200">
                    {uses.courtForms.applicableSectionOrField}
                  </p>
                </div>
                <div className="text-xs text-slate-700 space-y-1">
                  <strong>Educational Drafting Guidance:</strong>
                  <div className="text-slate-700 whitespace-pre-line leading-relaxed bg-emerald-50/30 p-2.5 rounded border border-emerald-100">
                    {uses.courtForms.educationalDraftingGuidance}
                  </div>
                </div>
              </div>

              {/* Secondary Related Forms */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
                <span className="font-bold text-emerald-950">Secondary Prescribed Forms:</span>
                {uses.courtForms.secondaryForms.map((sf, sfIdx) => (
                  <span key={sfIdx} className="bg-white px-2 py-1 rounded border border-emerald-200 text-[11px] font-medium" title={sf.purpose}>
                    <strong>Form {sf.formNumber}:</strong> {sf.title}
                  </span>
                ))}
              </div>

              {/* Mandatory Safeguard Notice */}
              <div className="p-2.5 bg-amber-50/70 border border-amber-200/80 rounded-xl flex items-start gap-2 text-[11px] text-amber-950">
                <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <p className="leading-normal font-medium">
                  {uses.courtForms.safeguardNotice}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
