/**
 * CYFSA Navigator — Agency Compliance & Evidence Matrix View
 *
 * Milestone 2 deliverable:
 * Visual presentation for the verified CAS Accountability, Parent Assistance,
 * and Agency Compliance Matrix Engine.
 *
 * Supports:
 * - Dual presentation modes: Educational Legal Analysis vs Courtroom-Style Evidence Matrix
 * - Category filter tabs (All, Mandatory Duties, Parent Assistance, Child Participation, Court Orders, Complaints)
 * - Strict neutrality compliance status badges with evidence quotes and citations
 * - Parent Assistance 15-Question Analysis summary card
 * - Missing records and non-prejudgment legal disclaimers
 */

import React, { useState, useMemo } from "react";
import {
  Scale,
  BookOpen,
  Gavel,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  FileText,
  Filter,
  ChevronDown,
  ChevronRight,
  Info,
  Clock,
  Layers,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import type {
  ComplianceMatrixReport,
  ComplianceMatrixItem,
  AgencyComplianceStatus,
  ComplianceMatrixCategory,
} from "../../shared/complianceMatrixEngine";

interface AgencyComplianceMatrixViewProps {
  matrix?: ComplianceMatrixReport;
  openLegislativeReference?: (ref: string) => void;
}

const STATUS_CONFIG: Record<
  AgencyComplianceStatus,
  { label: string; bg: string; text: string; border: string; icon: React.FC<{ className?: string }> }
> = {
  COMPLIANT: {
    label: "Documented Compliance",
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
    icon: CheckCircle2,
  },
  PARTIALLY_COMPLIANT: {
    label: "Partially Documented",
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    icon: AlertTriangle,
  },
  NON_COMPLIANT_POTENTIAL: {
    label: "Potential Compliance Concern",
    bg: "bg-rose-50",
    text: "text-rose-800",
    border: "border-rose-200",
    icon: ShieldAlert,
  },
  NOT_DOCUMENTED_IN_UPLOADED_RECORDS: {
    label: "Not Documented in Uploaded Records",
    bg: "bg-slate-100",
    text: "text-slate-700",
    border: "border-slate-300",
    icon: HelpCircle,
  },
  CONTRADICTORY_IN_RECORDS: {
    label: "Contradictory in Records",
    bg: "bg-purple-50",
    text: "text-purple-800",
    border: "border-purple-200",
    icon: AlertTriangle,
  },
  EXEMPT_OR_ALTERNATIVE_PATHWAY: {
    label: "Exempt or Alternative Pathway",
    bg: "bg-blue-50",
    text: "text-blue-800",
    border: "border-blue-200",
    icon: Info,
  },
  INSUFFICIENT_EVIDENCE: {
    label: "Insufficient Evidence to Evaluate",
    bg: "bg-zinc-50",
    text: "text-zinc-700",
    border: "border-zinc-300",
    icon: HelpCircle,
  },
  SUPERSEDED_OR_AMENDED: {
    label: "Superseded or Amended",
    bg: "bg-gray-50",
    text: "text-gray-700",
    border: "border-gray-200",
    icon: Layers,
  },
};

const CATEGORY_LABELS: Record<ComplianceMatrixCategory, string> = {
  STATUTORY_CAS_DUTIES: "Statutory Duties",
  PARENT_ASSISTANCE_REUNIFICATION: "Parent Assistance & Reunification",
  CHILD_PARTICIPATION_CULTURAL: "Child Participation & Culture",
  COURT_ORDERS_AND_TIMELINES: "Court Orders & Timelines",
  DISCLOSURE_RECORDS_COMPLAINTS: "Disclosures & Complaints",
};

export const AgencyComplianceMatrixView: React.FC<AgencyComplianceMatrixViewProps> = ({
  matrix,
  openLegislativeReference,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [activeMode, setActiveMode] = useState<"educational" | "courtroom">("educational");
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [showParentAssistanceCard, setShowParentAssistanceCard] = useState<boolean>(true);

  if (!matrix || !matrix.items || matrix.items.length === 0) {
    return (
      <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center space-y-2">
        <Scale className="w-8 h-8 text-slate-400 mx-auto" />
        <h4 className="text-sm font-bold text-slate-800">Compliance Matrix Not Yet Generated</h4>
        <p className="text-xs text-slate-600 max-w-md mx-auto">
          The Agency Compliance & Evidence Matrix compares documented agency actions against statutory CYFSA mandates and Child Protection Standards. Run an analysis to view verified compliance findings.
        </p>
      </div>
    );
  }

  const filteredItems = useMemo(() => {
    if (activeCategory === "ALL") return matrix.items;
    return matrix.items.filter((item) => item.category === activeCategory);
  }, [matrix.items, activeCategory]);

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const counts = matrix.summaryCounts || {
    totalEvaluated: matrix.items.length,
    compliant: matrix.items.filter((i) => i.assessment.status === "COMPLIANT").length,
    partiallyCompliant: matrix.items.filter((i) => i.assessment.status === "PARTIALLY_COMPLIANT").length,
    potentialConcerns: matrix.items.filter((i) => i.assessment.status === "NON_COMPLIANT_POTENTIAL").length,
    notDocumentedInRecords: matrix.items.filter((i) => i.assessment.status === "NOT_DOCUMENTED_IN_UPLOADED_RECORDS").length,
    contradictoryInRecords: matrix.items.filter((i) => i.assessment.status === "CONTRADICTORY_IN_RECORDS").length,
    exemptOrAlternative: matrix.items.filter((i) => i.assessment.status === "EXEMPT_OR_ALTERNATIVE_PATHWAY").length,
    insufficientEvidence: matrix.items.filter((i) => i.assessment.status === "INSUFFICIENT_EVIDENCE").length,
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header with Neutrality Notice */}
      <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-sm border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Scale className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <h3 className="text-sm font-bold tracking-tight">Agency Compliance & Evidence Matrix</h3>
              <p className="text-[11px] text-slate-300">
                Verified Ontario Child Protection Accountability & Evidentiary Correlation Engine
              </p>
            </div>
          </div>

          {/* Presentation Mode Toggle */}
          <div className="inline-flex p-1 bg-slate-800 rounded-xl border border-slate-700 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveMode("educational")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeMode === "educational"
                  ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Educational Mode</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveMode("courtroom")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeMode === "courtroom"
                  ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Gavel className="w-3.5 h-3.5" />
              <span>Courtroom Mode</span>
            </button>
          </div>
        </div>

        {/* Missing Records Legal Disclaimer */}
        <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700/60 text-xs text-slate-300 flex items-start gap-2.5 leading-relaxed">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <strong className="text-amber-300 font-semibold">Non-Prejudgment Standard: </strong>
            {matrix.missingRecordsWarning ||
              "Absence of a documented action in uploaded records does not prove the agency breached its duty. Other internal files, unfiled disclosures, or supervisory notes may exist."}
          </div>
        </div>

        {/* Summary Metric Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          <div className="p-2.5 bg-slate-800/60 rounded-xl border border-slate-700 text-center">
            <div className="text-lg font-bold text-white">{counts.totalEvaluated}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Evaluated Rules</div>
          </div>
          <div className="p-2.5 bg-slate-800/60 rounded-xl border border-slate-700 text-center">
            <div className="text-lg font-bold text-emerald-400">{counts.compliant}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Documented Compliant</div>
          </div>
          <div className="p-2.5 bg-slate-800/60 rounded-xl border border-slate-700 text-center">
            <div className="text-lg font-bold text-rose-400">{counts.potentialConcerns}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Potential Concerns</div>
          </div>
          <div className="p-2.5 bg-slate-800/60 rounded-xl border border-slate-700 text-center">
            <div className="text-lg font-bold text-slate-300">{counts.notDocumentedInRecords}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Not in Records</div>
          </div>
        </div>
      </div>

      {/* Parent Assistance 15-Question Analysis Card */}
      {matrix.parentAssistanceAnalysis && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div
            className="p-4 bg-gradient-to-r from-slate-50 to-amber-50/40 border-b border-slate-200 flex items-center justify-between cursor-pointer select-none"
            onClick={() => setShowParentAssistanceCard(!showParentAssistanceCard)}
          >
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
              <div>
                <h4 className="text-xs font-bold text-slate-900">
                  Parent Assistance, Family Preservation & Reunification Assessment
                </h4>
                <p className="text-[11px] text-slate-600">
                  Analysis of reasonable efforts, accessible assistance, less disruptive alternatives, and Standard 7 service plans
                </p>
              </div>
            </div>
            {showParentAssistanceCard ? (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-500" />
            )}
          </div>

          {showParentAssistanceCard && (
            <div className="p-4 space-y-4 text-xs">
              <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-xl text-amber-900 leading-relaxed">
                <strong className="font-semibold">Summary Assessment: </strong>
                {matrix.parentAssistanceAnalysis.summaryAssessment}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {[
                  { q: "Was assistance offered to parent?", val: matrix.parentAssistanceAnalysis.assistanceOffered },
                  { q: "Was assistance realistically accessible?", val: matrix.parentAssistanceAnalysis.assistanceAccessible },
                  { q: "Were less disruptive alternatives considered?", val: matrix.parentAssistanceAnalysis.lessDisruptiveAlternativesConsidered },
                  { q: "Were reunification goals clearly identified?", val: matrix.parentAssistanceAnalysis.reunificationGoalsIdentified },
                  { q: "Was an initial service plan developed?", val: matrix.parentAssistanceAnalysis.servicePlanDeveloped },
                  { q: "Was service plan completed within 30 days (Standard 7)?", val: matrix.parentAssistanceAnalysis.servicePlanWithin30Days },
                  { q: "Was reunification review conducted at regular intervals?", val: matrix.parentAssistanceAnalysis.reunificationReviewConducted },
                  { q: "Was required supervisory approval documented?", val: matrix.parentAssistanceAnalysis.supervisoryApprovalDocumented },
                  { q: "Was kinship placement exploration conducted (Bill C-92 s. 16)?", val: matrix.parentAssistanceAnalysis.kinshipAssessmentConducted },
                  { q: "Was substance / mental health support facilitated?", val: matrix.parentAssistanceAnalysis.substanceOrMentalHealthSupportOffered },
                  { q: "Were housing / poverty factors addressed non-punitively?", val: matrix.parentAssistanceAnalysis.housingOrFinancialAssistanceConsidered },
                  { q: "Was customary care / band notice provided (CYFSA s. 72 / Bill C-92)?", val: matrix.parentAssistanceAnalysis.culturalContinuitySupported },
                  { q: "Was band or First Nations community consulted?", val: matrix.parentAssistanceAnalysis.bandOrCommunityConsulted },
                  { q: "Was parent access schedule facilitated (CYFSA s. 105)?", val: matrix.parentAssistanceAnalysis.accessScheduleFacilitated },
                  { q: "Was parent informed of rights and complaint pathways?", val: matrix.parentAssistanceAnalysis.parentInformedOfRightsAndComplaints },
                ].map((item, idx) => {
                  const isYes = item.val === true;
                  const isNo = item.val === false;
                  return (
                    <div
                      key={idx}
                      className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-2"
                    >
                      <span className="text-slate-700 font-medium text-[11px]">{item.q}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                          isYes
                            ? "bg-emerald-100 text-emerald-800"
                            : isNo
                            ? "bg-rose-100 text-rose-800"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {isYes ? "Documented" : isNo ? "Not in Records" : "Unclear"}
                      </span>
                    </div>
                  );
                })}
              </div>

              {matrix.parentAssistanceAnalysis.missingAssistanceRecords.length > 0 && (
                <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 text-[11px] text-slate-700 space-y-1">
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    Recommended Records to Request:
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {matrix.parentAssistanceAnalysis.missingAssistanceRecords.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Category Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
        <button
          type="button"
          onClick={() => setActiveCategory("ALL")}
          className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all cursor-pointer ${
            activeCategory === "ALL"
              ? "bg-brand-600 text-white shadow-sm"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          All Categories ({matrix.items.length})
        </button>
        {Object.entries(CATEGORY_LABELS).map(([catKey, label]) => {
          const catCount = matrix.items.filter((i) => i.category === catKey).length;
          return (
            <button
              key={catKey}
              type="button"
              onClick={() => setActiveCategory(catKey)}
              className={`px-3 py-1.5 rounded-xl font-medium whitespace-nowrap transition-all cursor-pointer ${
                activeCategory === catKey
                  ? "bg-brand-600 text-white font-bold shadow-sm"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {label} ({catCount})
            </button>
          );
        })}
      </div>

      {/* Matrix Item Cards */}
      <div className="space-y-3">
        {filteredItems.map((item) => {
          const statusStyle = STATUS_CONFIG[item.assessment.status] || STATUS_CONFIG.INSUFFICIENT_EVIDENCE;
          const StatusIcon = statusStyle.icon;
          const isExpanded = !!expandedItems[item.id];

          return (
            <div
              key={item.id}
              className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow transition-all overflow-hidden"
            >
              {/* Card Header */}
              <div
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none bg-slate-50/40 hover:bg-slate-50 transition-colors"
                onClick={() => toggleExpand(item.id)}
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                    >
                      <StatusIcon className="w-3 h-3" />
                      {statusStyle.label}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openLegislativeReference?.(item.authority.legalCitation);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-brand-700 hover:underline cursor-pointer"
                    >
                      {item.authority.legalCitation}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </button>

                    <span className="text-[10px] px-2 py-0.5 bg-slate-200/70 text-slate-700 rounded-md font-medium">
                      {item.authority.legalForce.replace(/_/g, " ")}
                    </span>
                  </div>

                  <h4 className="text-xs font-bold text-slate-900 leading-snug">
                    {item.obligation.mandateSummary}
                  </h4>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <span className="text-[10px] text-slate-500 font-medium">
                    {isExpanded ? "Collapse" : "View Evidence & Analysis"}
                  </span>
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-500" />
                  )}
                </div>
              </div>

              {/* Card Body (Expanded) */}
              {isExpanded && (
                <div className="p-4 border-t border-slate-200 space-y-4 text-xs bg-white">
                  {/* Mode-Specific Presentation */}
                  {activeMode === "educational" ? (
                    <div className="p-3.5 bg-amber-50/50 border border-amber-200/80 rounded-xl space-y-2 text-slate-800">
                      <div className="flex items-center gap-2 font-bold text-amber-900 text-[11px] uppercase tracking-wide">
                        <BookOpen className="w-3.5 h-3.5 text-amber-700" />
                        Plain-Language Educational Guidance
                      </div>
                      <p className="leading-relaxed">{item.presentation.educationalMode.plainLanguageExplanation}</p>
                      <div className="pt-1.5 border-t border-amber-200/60">
                        <strong className="text-slate-900 font-semibold">What this means for parents: </strong>
                        <span>{item.presentation.educationalMode.whatThisMeansForParent}</span>
                      </div>
                      {item.presentation.educationalMode.actionableStepsForParent.length > 0 && (
                        <div className="pt-1.5 space-y-1">
                          <strong className="text-slate-900 font-semibold">Action Steps:</strong>
                          <ul className="list-disc pl-5 space-y-0.5">
                            {item.presentation.educationalMode.actionableStepsForParent.map((step, sIdx) => (
                              <li key={sIdx}>{step}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-3.5 bg-slate-900 text-slate-100 rounded-xl space-y-2.5">
                      <div className="flex items-center gap-2 font-bold text-amber-400 text-[11px] uppercase tracking-wide">
                        <Gavel className="w-3.5 h-3.5" />
                        Courtroom-Style Evidentiary Framing
                      </div>
                      <p className="leading-relaxed text-slate-200 font-serif">
                        {item.presentation.courtroomMode.evidentiaryFraming}
                      </p>
                      {item.presentation.courtroomMode.crossExaminationAvenues.length > 0 && (
                        <div className="pt-2 border-t border-slate-800 space-y-1 text-slate-300">
                          <strong className="text-amber-300 font-semibold text-[11px]">
                            Potential Inquiries / Cross-Examination Avenues:
                          </strong>
                          <ul className="list-disc pl-5 space-y-1">
                            {item.presentation.courtroomMode.crossExaminationAvenues.map((ave, aIdx) => (
                              <li key={aIdx}>{ave}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {item.presentation.courtroomMode.admissibilityAndRule14_18Note && (
                        <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 leading-relaxed">
                          <strong className="text-slate-200">Admissibility / Rule 14(18) Note: </strong>
                          {item.presentation.courtroomMode.admissibilityAndRule14_18Note}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Documented Evidence & Attributions */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                      <div className="font-bold text-slate-900 text-[11px] flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        Documented Agency Actions in Record
                      </div>
                      <p className="text-slate-700 leading-relaxed text-[11px]">
                        {item.evidence.documentedActionInRecord || "No specific agency action documented in uploaded records."}
                      </p>
                      {item.evidence.recordExcerpts.length > 0 && (
                        <div className="pt-1.5 space-y-1 border-t border-slate-200">
                          <strong className="text-slate-800 text-[10px] uppercase tracking-wider">Record Quotations:</strong>
                          <ul className="space-y-1">
                            {item.evidence.recordExcerpts.map((excerpt, eIdx) => (
                              <li
                                key={eIdx}
                                className="p-1.5 bg-white border border-slate-200 rounded text-[11px] italic text-slate-700"
                              >
                                &ldquo;{excerpt}&rdquo;
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                      <div className="font-bold text-slate-900 text-[11px] flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        Applicability & Oversight Pathways
                      </div>
                      <div className="text-[11px] text-slate-700 space-y-1">
                        <div>
                          <strong>Stage of Case: </strong>
                          <span className="capitalize">{item.obligation.stageOfCase.toLowerCase().replace(/_/g, " ")}</span>
                        </div>
                        {item.obligation.timeframeRequirement && (
                          <div>
                            <strong>Prescribed Timeframe: </strong>
                            <span>{item.obligation.timeframeRequirement}</span>
                          </div>
                        )}
                        <div>
                          <strong>Responsible Role: </strong>
                          <span>{item.obligation.responsibleEntity}</span>
                        </div>
                        {item.assessment.oversightPathways.length > 0 && (
                          <div className="pt-1">
                            <strong>Available Oversight Pathways: </strong>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.assessment.oversightPathways.map((pathway, pIdx) => (
                                <span
                                  key={pIdx}
                                  className="px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 rounded text-[10px] font-medium"
                                >
                                  {pathway.replace(/_/g, " ")}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Missing Records Note */}
                  {item.evidence.missingRecordsIdentified.length > 0 && (
                    <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-xl text-[11px] text-amber-900 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <strong>Additional records necessary for definitive conclusion: </strong>
                        {item.evidence.missingRecordsIdentified.join("; ")}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
