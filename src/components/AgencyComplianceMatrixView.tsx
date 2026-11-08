/**
 * CYFSA Navigator — Agency Compliance & Evidence Matrix View
 *
 * Milestone 2 deliverable:
 * Visual presentation for the verified CAS Accountability, Parent Assistance,
 * and Agency Compliance Matrix Engine.
 *
 * Supports:
 * - Dual presentation modes: Educational Legal Analysis vs Courtroom-Style Evidence Matrix
 * - Category filter tabs (All, Law & Procedure, CAS Accountability, Parent Assistance, Reunification, Evidence & Contradictions)
 * - Strict neutrality compliance status badges with evidence quotes and citations
 * - Parent Assistance 15-Question Analysis multi-assessment card
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
  Shield,
  FolderOpen,
} from "lucide-react";
import type {
  ComplianceMatrixReport,
  ComplianceMatrixItem,
  AgencyComplianceStatus,
  ComplianceMatrixCategory,
  ParentAssistance15QuestionAnalysis,
  ParentAssistanceStatus,
} from "../../shared/complianceMatrixEngine";

interface AgencyComplianceMatrixViewProps {
  matrix?: ComplianceMatrixReport;
  openLegislativeReference?: (ref: string) => void;
}

const STATUS_CONFIG: Record<
  AgencyComplianceStatus,
  { label: string; bg: string; text: string; border: string; icon: React.FC<{ className?: string }> }
> = {
  COMPLIANT_ON_AVAILABLE_EVIDENCE: {
    label: "Documented Compliance",
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
    icon: CheckCircle2,
  },
  PARTIAL_COMPLIANCE: {
    label: "Partially Documented",
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    icon: AlertTriangle,
  },
  POTENTIAL_NONCOMPLIANCE: {
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
  INSUFFICIENT_EVIDENCE: {
    label: "Insufficient Evidence to Evaluate",
    bg: "bg-zinc-50",
    text: "text-zinc-700",
    border: "border-zinc-300",
    icon: HelpCircle,
  },
  NOT_APPLICABLE: {
    label: "Not Applicable to Stage",
    bg: "bg-gray-50",
    text: "text-gray-700",
    border: "border-gray-200",
    icon: Layers,
  },
  EXCEPTION_MAY_APPLY: {
    label: "Statutory Exception May Apply",
    bg: "bg-blue-50",
    text: "text-blue-800",
    border: "border-blue-200",
    icon: Info,
  },
  REQUIRES_LEGAL_REVIEW: {
    label: "Requires Counsel Review",
    bg: "bg-purple-50",
    text: "text-purple-800",
    border: "border-purple-200",
    icon: AlertTriangle,
  },
};

const CATEGORY_LABELS: Record<ComplianceMatrixCategory, string> = {
  LAW_AND_PROCEDURE: "Law & Procedure",
  CAS_ACCOUNTABILITY: "CAS Accountability",
  PARENT_ASSISTANCE: "Parent Assistance",
  REUNIFICATION: "Reunification & Preservation",
  EVIDENCE_AND_CONTRADICTIONS: "Evidence & Contradictions",
};

const PARENT_STATUS_LABELS: Record<ParentAssistanceStatus, { label: string; bg: string; text: string }> = {
  NEED_IDENTIFIED: { label: "Need Identified", bg: "bg-blue-100", text: "text-blue-800" },
  SERVICE_CONSIDERED: { label: "Service Considered", bg: "bg-indigo-100", text: "text-indigo-800" },
  SERVICE_OFFERED: { label: "Service Offered", bg: "bg-emerald-100", text: "text-emerald-800" },
  REFERRAL_MADE: { label: "Referral Made", bg: "bg-teal-100", text: "text-teal-800" },
  SERVICE_ACCESSIBLE: { label: "Accessible", bg: "bg-emerald-100", text: "text-emerald-800" },
  SERVICE_INACCESSIBLE: { label: "Barriers Documented", bg: "bg-rose-100", text: "text-rose-800" },
  SERVICE_ACCEPTED: { label: "Accepted by Parent", bg: "bg-emerald-100", text: "text-emerald-800" },
  SERVICE_DECLINED: { label: "Declined", bg: "bg-amber-100", text: "text-amber-800" },
  SERVICE_COMPLETED: { label: "Completed", bg: "bg-emerald-100", text: "text-emerald-800" },
  FOLLOW_UP_DOCUMENTED: { label: "Follow-Up Documented", bg: "bg-sky-100", text: "text-sky-800" },
  NO_OFFER_DOCUMENTED: { label: "Not Offered in Records", bg: "bg-slate-200", text: "text-slate-700" },
  UNKNOWN: { label: "Status Unknown", bg: "bg-slate-200", text: "text-slate-700" },
};

interface QuestionConfig {
  num: number;
  label: string;
  key: keyof ParentAssistance15QuestionAnalysis["questions"];
}

const FIFTEEN_QUESTIONS_CONFIG: QuestionConfig[] = [
  { num: 1, label: "Child Protection Concern", key: "q1_concernIdentifiedByCas" },
  { num: 2, label: "Underlying / Root Problem", key: "q2_rootProblemBehindConcern" },
  { num: 3, label: "Service to Reduce Risk", key: "q3_serviceCouldReduceRisk" },
  { num: 4, label: "Discussed with Parent", key: "q4_serviceDiscussedWithParent" },
  { num: 5, label: "Referral / Service Offered", key: "q5_referralOrServiceOffered" },
  { num: 6, label: "Timing (Prior to Removal)", key: "q6_whenWasItOffered" },
  { num: 7, label: "Follow-Up Responsibility", key: "q7_whoWasResponsibleForFollowUp" },
  { num: 8, label: "Realistic Accessibility", key: "q8_wasServiceAccessible" },
  { num: 9, label: "Parent Participation / Attempt", key: "q9_didParentParticipateOrAttempt" },
  { num: 10, label: "Documented Barriers", key: "q10_barriersPreventingParticipation" },
  { num: 11, label: "Plan Adjustment upon Barriers", key: "q11_didCasAdjustPlanWhenBarriersAppeared" },
  { num: 12, label: "Kinship & Community Alternatives", key: "q12_wereKinshipOrCommunitySupportsExplored" },
  { num: 13, label: "Reunification & Risk Impact", key: "q13_howDidAssistanceAffectRiskAndReunification" },
  { num: 14, label: "Documentary Proof in Records", key: "q14_whatEvidenceSupportsEachAnswer" },
  { num: 15, label: "Missing Records to Verify", key: "q15_whatRecordsAreMissing" },
];

export const AgencyComplianceMatrixView: React.FC<AgencyComplianceMatrixViewProps> = ({
  matrix,
  openLegislativeReference,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [activeMode, setActiveMode] = useState<"educational" | "courtroom">("educational");
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [showParentAssistanceCard, setShowParentAssistanceCard] = useState<boolean>(true);
  const [activeAssessmentIndex, setActiveAssessmentIndex] = useState<number>(0);

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
    compliant: matrix.items.filter((i) => i.assessment.complianceStatus === "COMPLIANT_ON_AVAILABLE_EVIDENCE").length,
    partiallyCompliant: matrix.items.filter((i) => i.assessment.complianceStatus === "PARTIAL_COMPLIANCE").length,
    potentialConcerns: matrix.items.filter((i) => i.assessment.complianceStatus === "POTENTIAL_NONCOMPLIANCE").length,
    notDocumentedInRecords: matrix.items.filter((i) => i.assessment.complianceStatus === "NOT_DOCUMENTED_IN_UPLOADED_RECORDS").length,
    contradictoryInRecords: matrix.items.filter((i) => (i.evidence.contradictoryEvidence || []).length > 0).length,
    exemptOrAlternative: matrix.items.filter((i) => i.assessment.complianceStatus === "EXCEPTION_MAY_APPLY").length,
    insufficientEvidence: matrix.items.filter((i) => i.assessment.complianceStatus === "INSUFFICIENT_EVIDENCE").length,
  };

  // Safe resolution of Parent Assistance assessments array with backwards compatibility
  const assessments: ParentAssistance15QuestionAnalysis[] = useMemo(() => {
    if (Array.isArray(matrix.parentAssistanceAnalyses) && matrix.parentAssistanceAnalyses.length > 0) {
      return matrix.parentAssistanceAnalyses;
    }
    if (matrix.parentAssistanceAnalysis) {
      return [matrix.parentAssistanceAnalysis];
    }
    return [];
  }, [matrix.parentAssistanceAnalyses, matrix.parentAssistanceAnalysis]);

  const currentAssessment = assessments[activeAssessmentIndex] || assessments[0] || null;

  // Active disclaimer with fallback
  const activeDisclaimer =
    matrix.neutralityAndMethodologyDisclaimer ||
    matrix.missingRecordsWarning ||
    "Absence of a documented action in uploaded records does not prove the agency breached its duty. Other internal files, unfiled disclosures, or supervisory notes may exist.";

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
            {activeDisclaimer}
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

      {/* Parent Assistance, Family Preservation & Reunification 15-Question Analysis Card */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div
          className="p-4 bg-gradient-to-r from-slate-50 to-amber-50/40 border-b border-slate-200 flex items-center justify-between cursor-pointer select-none"
          onClick={() => setShowParentAssistanceCard(!showParentAssistanceCard)}
        >
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
            <div>
              <h4 className="text-xs font-bold text-slate-900">
                Parent Assistance, Family Preservation & Reunification Assessment ({assessments.length} Domains Evaluated)
              </h4>
              <p className="text-[11px] text-slate-600">
                15-Question evidentiary inquiry into reasonable efforts, accessible assistance, less disruptive alternatives, and Standard 7 service plans
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
            {assessments.length === 0 ? (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-slate-600 text-center space-y-1">
                <FolderOpen className="w-6 h-6 text-slate-400 mx-auto" />
                <p className="font-semibold text-slate-800">No Specific Parent Assistance Needs Flagged in Uploaded Records</p>
                <p className="text-[11px] text-slate-500">
                  Where assistance was requested, offered, or denied in non-uploaded case conferences or field notes, request full Society disclosure.
                </p>
              </div>
            ) : (
              <>
                {/* Multi-Assessment Domain Tabs */}
                {assessments.length > 1 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-100">
                    {assessments.map((ass, idx) => (
                      <button
                        key={ass.needId || idx}
                        type="button"
                        onClick={() => setActiveAssessmentIndex(idx)}
                        className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-all cursor-pointer ${
                          activeAssessmentIndex === idx
                            ? "bg-amber-600 text-white shadow-sm"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        {idx + 1}. {ass.identifiedNeedTitle || `Assessment ${idx + 1}`}
                      </button>
                    ))}
                  </div>
                )}

                {/* Selected Assessment Content */}
                {currentAssessment && (
                  <div className="space-y-4">
                    {/* Assessment Header Info */}
                    <div className="p-3 bg-amber-50/50 border border-amber-200/80 rounded-xl space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-bold text-slate-900 text-xs">
                          {currentAssessment.identifiedNeedTitle}
                        </div>
                        <span className="px-2 py-0.5 bg-slate-200/80 text-slate-700 rounded text-[10px] font-medium">
                          {currentAssessment.legalForceClassification === "LEGALLY_REQUIRED"
                            ? "Statutory Legal Duty"
                            : "Standards-Based Duty"}
                        </span>
                      </div>

                      {/* Coexisting Status Pills */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mr-1">Status:</span>
                        {(currentAssessment.coexistingStatuses || []).map((st, sIdx) => {
                          const conf = PARENT_STATUS_LABELS[st] || { label: st, bg: "bg-slate-100", text: "text-slate-700" };
                          return (
                            <span
                              key={sIdx}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${conf.bg} ${conf.text}`}
                            >
                              {conf.label}
                            </span>
                          );
                        })}
                      </div>

                      {/* Statutory Non-Funding Rule Banner */}
                      {currentAssessment.statutoryNonFundingRuleTriggered && (
                        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 text-[11px] leading-relaxed flex items-start gap-2">
                          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          <div>
                            <strong className="font-semibold">CYFSA Non-Funding Protection Triggered (ss. 94(6)(c), 101(7)(c), 116(4)(c)): </strong>
                            {currentAssessment.statutoryNonFundingExplanation ||
                              "The court and agency cannot condition custody or return on the parent paying for services the agency or Ministry is mandated to facilitate or fund. Socioeconomic hardship and inability to afford private services cannot be treated as parental unfitness."}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Documented Evidence Excerpt */}
                    {currentAssessment.exactExcerpt && (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                        <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-slate-400" />
                          Documented Excerpt & Location ({currentAssessment.pageAndParagraphAttribution || "Record Excerpt"}):
                        </div>
                        <p className="text-[11px] text-slate-700 italic leading-relaxed">
                          "{currentAssessment.exactExcerpt}"
                        </p>
                      </div>
                    )}

                    {/* The 15 Parent Assistance & Preservation Questions */}
                    <div className="space-y-2">
                      <div className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-amber-600" />
                        15-Point Evidentiary Inquiry:
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {FIFTEEN_QUESTIONS_CONFIG.map((cfg) => {
                          const ansText = currentAssessment.questions?.[cfg.key] || "Not documented in uploaded record.";
                          const isNotDoc = /not\s+documented|no\s+record|absent/i.test(ansText);
                          const isDoc = /documented|confirmed|referred|attended/i.test(ansText) && !isNotDoc;

                          return (
                            <div
                              key={cfg.num}
                              className="p-2.5 bg-slate-50/80 border border-slate-200/90 rounded-xl space-y-1"
                            >
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="font-bold text-slate-900 text-[11px]">
                                  Q{cfg.num}. {cfg.label}
                                </span>
                                <span
                                  className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase shrink-0 ${
                                    isDoc
                                      ? "bg-emerald-100 text-emerald-800"
                                      : isNotDoc
                                      ? "bg-slate-200 text-slate-700"
                                      : "bg-blue-100 text-blue-800"
                                  }`}
                                >
                                  {isDoc ? "Documented" : isNotDoc ? "Not in Records" : "Evaluated"}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-700 leading-relaxed">
                                {ansText}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Missing Records to Verify */}
                    {currentAssessment.questions?.q15_whatRecordsAreMissing && (
                      <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 text-[11px] text-slate-700 space-y-1">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-slate-500" />
                          Recommended Specific Records to Request:
                        </div>
                        <p className="leading-relaxed">
                          {currentAssessment.questions.q15_whatRecordsAreMissing}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

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
          const statusStyle = STATUS_CONFIG[item.assessment.complianceStatus] || STATUS_CONFIG.INSUFFICIENT_EVIDENCE;
          const StatusIcon = statusStyle.icon;
          const isExpanded = !!expandedItems[item.itemId];

          return (
            <div
              key={item.itemId}
              className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow transition-all overflow-hidden"
            >
              {/* Card Header */}
              <div
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none bg-slate-50/40 hover:bg-slate-50 transition-colors"
                onClick={() => toggleExpand(item.itemId)}
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
                        openLegislativeReference?.(item.authority.exactSectionOrStandard);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-brand-700 hover:underline cursor-pointer"
                    >
                      {item.authority.exactSectionOrStandard}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </button>

                    <span className="text-[10px] px-2 py-0.5 bg-slate-200/70 text-slate-700 rounded-md font-medium">
                      {String(item.authority.legalForce).replace(/_/g, " ")}
                    </span>
                  </div>

                  <h4 className="text-xs font-bold text-slate-900 leading-snug">
                    {item.title}
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
                      <p className="leading-relaxed">{item.presentation.educationalMode.whatRuleRequires}</p>
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
                        {item.evidence.exactExcerpt || "No specific agency action documented in uploaded records."}
                      </p>
                      {item.evidence.corroboratingEvidence.length > 0 && (
                        <div className="pt-1.5 space-y-1 border-t border-slate-200">
                          <strong className="text-slate-800 text-[10px] uppercase tracking-wider">Corroborating Records:</strong>
                          <ul className="space-y-1">
                            {item.evidence.corroboratingEvidence.map((corrob, cIdx) => (
                              <li
                                key={cIdx}
                                className="p-1.5 bg-white border border-slate-200 rounded text-[11px] text-slate-700"
                              >
                                {corrob}
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
                          <strong>Triggering Event: </strong>
                          <span>{item.obligation.triggeringEvent}</span>
                        </div>
                        {item.obligation.deadline && (
                          <div>
                            <strong>Prescribed Timeframe: </strong>
                            <span>{item.obligation.deadline}</span>
                          </div>
                        )}
                        <div>
                          <strong>Responsible Role: </strong>
                          <span>{String(item.obligation.responsibleParty)}</span>
                        </div>
                        {item.assessment.potentialOversightPathway && (
                          <div className="pt-1">
                            <strong>Available Oversight Pathway: </strong>
                            <div className="mt-1">
                              <span className="px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 rounded text-[10px] font-medium">
                                {item.assessment.potentialOversightPathway.pathwayName} ({item.assessment.potentialOversightPathway.statutoryAuthority})
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Missing Records Note */}
                  {item.assessment.missingInformation.length > 0 && (
                    <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-xl text-[11px] text-amber-900 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <strong>Additional records necessary for definitive conclusion: </strong>
                        {item.assessment.missingInformation.join("; ")}
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
