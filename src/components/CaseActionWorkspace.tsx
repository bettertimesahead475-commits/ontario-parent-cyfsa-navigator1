/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Parent Case-Action / Reunification Workspace (Batch 2 UI)
 * Mobile-first, accessible parent interface for tracking legal requirements,
 * actions, evidence proof, and disputes.
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import { apiFetch, safeReadJson } from "../utils/api";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  Plus,
  Filter,
  RefreshCw,
  Shield,
  FileCheck,
  X,
  ChevronRight,
  ChevronDown,
  HelpCircle,
  Link2,
  Trash2,
  Check,
  AlertCircle,
  FolderPlus,
  BookOpen,
  Calendar,
  UserCheck,
  ArrowRight,
} from "lucide-react";

// Types corresponding to Backend API
export type AuthorityType =
  | "COURT_ORDERED"
  | "STATUTORY_REGULATORY"
  | "CAS_REQUESTED"
  | "SERVICE_PROVIDER_REQUESTED"
  | "AGREED_CONSENTED"
  | "LAWYER_REQUESTED"
  | "NAVIGATOR_SUGGESTED"
  | "PARENT_CREATED";

export type ReviewState = "PROPOSED" | "CONFIRMED" | "REJECTED" | "ARCHIVED";
export type CompletionState = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_APPLICABLE" | "SUPERSEDED";
export type DisputeState = "NOT_DISPUTED" | "DISPUTED" | "RESOLVED";
export type DisputeType = "NO_LEGAL_AUTHORITY" | "FACTUALLY_INACCURATE" | "UNREASONABLE_CONDITION" | "IMPOSSIBLE_DEADLINE" | "OTHER";
export type ProvenanceType = "DOCUMENT_ANALYZER_EXTRACTED" | "COURT_ORDER_PARSED" | "CAS_CORRESPONDENCE" | "PROFESSIONAL_RECOMMENDED" | "PARENT_MANUAL_ENTRY";
export type EvidenceType = "COMPLETION_CERTIFICATE" | "ATTENDANCE_RECORD" | "SCREENING_RESULT" | "RECEIPT_PROOF" | "CORRESPONDENCE_EMAIL_TEXT" | "COURT_FILING_STAMP" | "PARENT_JOURNAL_LOG" | "PHOTO_EVIDENCE";

export interface CaseAction {
  id: string;
  matter_id: string;
  requirement_id: string;
  title: string;
  description?: string | null;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  due_at?: string | null;
  completed_at?: string | null;
  sort_order: number;
  created_at: string;
}

export interface EvidenceLink {
  id: string;
  matter_id: string;
  requirement_id: string;
  action_id?: string | null;
  evidence_item_id?: string | null;
  document_id?: string | null;
  document_version_id?: string | null;
  evidence_type: EvidenceType;
  title: string;
  notes?: string | null;
  attached_at: string;
}

export interface CaseRequirement {
  id: string;
  matter_id: string;
  title: string;
  description?: string | null;
  authority_type: AuthorityType;
  review_state: ReviewState;
  completion_state: CompletionState;
  dispute_state: DisputeState;
  dispute_type?: DisputeType | null;
  dispute_note?: string | null;
  due_at?: string | null;
  completed_at?: string | null;
  provenance_type?: ProvenanceType | null;
  source_document_id?: string | null;
  source_page_number?: number | null;
  source_exact_quote?: string | null;
  source_author_or_speaker?: string | null;
  source_event_date?: string | null;
  linked_legal_provision_id?: string | null;
  verified_by_lawyer_at?: string | null;
  isOverdue?: boolean;
  actions?: CaseAction[];
  evidenceLinks?: EvidenceLink[];
  created_at: string;
  updated_at: string;
}

// Plain Language Authority Label Dictionary
export const AUTHORITY_LABELS: Record<AuthorityType, { label: string; bg: string; text: string; border: string; description: string }> = {
  COURT_ORDERED: {
    label: "Court ordered",
    bg: "bg-purple-100",
    text: "text-purple-900",
    border: "border-purple-300",
    description: "Legally binding requirement issued by a Family Court judge.",
  },
  STATUTORY_REGULATORY: {
    label: "Legal requirement",
    bg: "bg-blue-100",
    text: "text-blue-900",
    border: "border-blue-300",
    description: "Requirement based directly on Ontario CYFSA regulations.",
  },
  CAS_REQUESTED: {
    label: "CAS requested",
    bg: "bg-amber-100",
    text: "text-amber-900",
    border: "border-amber-300",
    description: "Requested by Children's Aid Society caseworkers. (Not a binding court order unless formally ordered by a judge).",
  },
  SERVICE_PROVIDER_REQUESTED: {
    label: "Service provider requested",
    bg: "bg-indigo-100",
    text: "text-indigo-900",
    border: "border-indigo-300",
    description: "Condition or recommendation from a community program or counselor.",
  },
  AGREED_CONSENTED: {
    label: "Agreed / consented",
    bg: "bg-teal-100",
    text: "text-teal-900",
    border: "border-teal-300",
    description: "Voluntarily agreed upon by parent and worker during planning meetings.",
  },
  LAWYER_REQUESTED: {
    label: "Lawyer requested",
    bg: "bg-cyan-100",
    text: "text-cyan-900",
    border: "border-cyan-300",
    description: "Strategic task or documentation requested by your legal counsel.",
  },
  NAVIGATOR_SUGGESTED: {
    label: "Navigator suggestion",
    bg: "bg-sky-100",
    text: "text-sky-900",
    border: "border-sky-300",
    description: "System or template suggestion to strengthen your parenting plan.",
  },
  PARENT_CREATED: {
    label: "My own action",
    bg: "bg-slate-100",
    text: "text-slate-900",
    border: "border-slate-300",
    description: "Self-directed parenting or advocacy goal created by you.",
  },
};

export const REVIEW_STATE_LABELS: Record<ReviewState, { label: string; bg: string; text: string }> = {
  PROPOSED: { label: "Needs review", bg: "bg-amber-50", text: "text-amber-800" },
  CONFIRMED: { label: "Confirmed", bg: "bg-emerald-50", text: "text-emerald-800" },
  REJECTED: { label: "Declined", bg: "bg-slate-100", text: "text-slate-700" },
  ARCHIVED: { label: "Archived", bg: "bg-slate-100", text: "text-slate-600" },
};

export const COMPLETION_STATE_LABELS: Record<CompletionState, { label: string; bg: string; text: string }> = {
  NOT_STARTED: { label: "Not started", bg: "bg-slate-100", text: "text-slate-700" },
  IN_PROGRESS: { label: "In progress", bg: "bg-blue-50", text: "text-blue-800" },
  COMPLETED: { label: "Completed", bg: "bg-emerald-100", text: "text-emerald-800" },
  NOT_APPLICABLE: { label: "N/A", bg: "bg-slate-100", text: "text-slate-600" },
  SUPERSEDED: { label: "Superseded", bg: "bg-slate-100", text: "text-slate-600" },
};

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  COMPLETION_CERTIFICATE: "Completion Certificate",
  ATTENDANCE_RECORD: "Attendance Record",
  SCREENING_RESULT: "Screening / Test Result",
  RECEIPT_PROOF: "Receipt / Proof of Payment",
  CORRESPONDENCE_EMAIL_TEXT: "Email or Written Text",
  COURT_FILING_STAMP: "Court Filing Stamp",
  PARENT_JOURNAL_LOG: "Parent Journal Log",
  PHOTO_EVIDENCE: "Photo Evidence",
};

interface CaseActionWorkspaceProps {
  initialMatterId?: string;
}

export default function CaseActionWorkspace({ initialMatterId }: CaseActionWorkspaceProps) {
  const [matters, setMatters] = useState<{ id: string; title: string }[]>([]);
  const [matterId, setMatterId] = useState<string>(initialMatterId || "");
  const [manualMatterInput, setManualMatterInput] = useState<string>("");

  const [activeTab, setActiveTab] = useState<"today" | "requirements" | "checklist" | "evidence" | "disputed" | "history">("today");
  const [requirements, setRequirements] = useState<CaseRequirement[]>([]);
  const [selectedReq, setSelectedReq] = useState<CaseRequirement | null>(null);

  // Filters
  const [filterAuthority, setFilterAuthority] = useState<string>("");
  const [filterCompletion, setFilterCompletion] = useState<string>("");
  const [filterReview, setFilterReview] = useState<string>("");

  // States
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");

  // Modals
  const [showCreateReqModal, setShowCreateReqModal] = useState<boolean>(false);
  const [showAddActionModal, setShowAddActionModal] = useState<CaseRequirement | null>(null);
  const [showAttachEvidenceModal, setShowAttachEvidenceModal] = useState<CaseRequirement | null>(null);
  const [showDisputeModal, setShowDisputeModal] = useState<CaseRequirement | null>(null);

  // Form Inputs
  const [newReqTitle, setNewReqTitle] = useState("");
  const [newReqDesc, setNewReqDesc] = useState("");
  const [newReqAuthority, setNewReqAuthority] = useState<AuthorityType>("PARENT_CREATED");
  const [newReqDueAt, setNewReqDueAt] = useState("");

  const [newActionTitle, setNewActionTitle] = useState("");
  const [newActionDueAt, setNewActionDueAt] = useState("");

  const [newEvidenceTitle, setNewEvidenceTitle] = useState("");
  const [newEvidenceType, setNewEvidenceType] = useState<EvidenceType>("COMPLETION_CERTIFICATE");
  const [newEvidenceNotes, setNewEvidenceNotes] = useState("");

  const [disputeType, setDisputeType] = useState<DisputeType>("NO_LEGAL_AUTHORITY");
  const [disputeNote, setDisputeNote] = useState("");

  // Fetch Available Matters
  const fetchMatters = useCallback(async () => {
    try {
      const res = await apiFetch("/api/review-matters");
      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          setMatters(data.items);
          if (!matterId) setMatterId(data.items[0].id);
        }
      }
    } catch (e) {
      console.warn("Could not auto-load matter list:", e);
    }
  }, [matterId]);

  useEffect(() => {
    void fetchMatters();
  }, [fetchMatters]);

  // Fetch Requirements for Selected Matter
  const fetchRequirements = useCallback(async () => {
    if (!matterId) return;
    setLoading(true);
    setError("");
    try {
      const queryParams = new URLSearchParams();
      if (filterAuthority) queryParams.set("authorityType", filterAuthority);
      if (filterCompletion) queryParams.set("completionState", filterCompletion);
      if (filterReview) queryParams.set("reviewState", filterReview);

      const targetUrl = `/api/matters/${encodeURIComponent(matterId)}/case-actions/requirements?${queryParams.toString()}`;
      const res = await apiFetch(targetUrl);
      const data = await safeReadJson(res);
      setRequirements(data);
    } catch (e: any) {
      setError(e.message || "Failed to load requirements for this case matter.");
    } finally {
      setLoading(false);
    }
  }, [matterId, filterAuthority, filterCompletion, filterReview]);

  useEffect(() => {
    void fetchRequirements();
  }, [fetchRequirements]);

  // Fetch Detailed Requirement Inspection
  const inspectRequirement = async (reqId: string) => {
    if (!matterId) return;
    try {
      const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/case-actions/requirements/${encodeURIComponent(reqId)}`);
      const data = await safeReadJson(res);
      setSelectedReq(data);
    } catch (e: any) {
      setError(e.message || "Failed to load requirement details.");
    }
  };

  // Requirement CRUD Actions
  const handleCreateRequirement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matterId) {
      setError("Please select or enter a valid Case Matter ID first.");
      return;
    }
    if (!newReqTitle.trim()) {
      setError("Requirement title is required.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/case-actions/requirements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newReqTitle.trim(),
          description: newReqDesc.trim() || null,
          authorityType: newReqAuthority,
          dueAt: newReqDueAt ? new Date(newReqDueAt).toISOString() : null,
          provenanceType: "PARENT_MANUAL_ENTRY",
        }),
      });
      await safeReadJson(res);
      setNotice("New item successfully added to your action workspace.");
      setShowCreateReqModal(false);
      setNewReqTitle("");
      setNewReqDesc("");
      setNewReqAuthority("PARENT_CREATED");
      setNewReqDueAt("");
      await fetchRequirements();
    } catch (err: any) {
      setError(err.message || "Failed to create requirement.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmProposed = async (reqId: string) => {
    if (!matterId) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/case-actions/requirements/${encodeURIComponent(reqId)}/confirm`, {
        method: "POST",
      });
      await safeReadJson(res);
      setNotice("Requirement confirmed.");
      await fetchRequirements();
      if (selectedReq?.id === reqId) await inspectRequirement(reqId);
    } catch (err: any) {
      setError(err.message || "Failed to confirm item.");
    } finally {
      setSaving(false);
    }
  };

  const handleRejectProposed = async (reqId: string) => {
    if (!matterId) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/case-actions/requirements/${encodeURIComponent(reqId)}/reject`, {
        method: "POST",
      });
      await safeReadJson(res);
      setNotice("Requirement declined.");
      await fetchRequirements();
      if (selectedReq?.id === reqId) setSelectedReq(null);
    } catch (err: any) {
      setError(err.message || "Failed to decline item.");
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveRequirement = async (reqId: string) => {
    if (!matterId) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/case-actions/requirements/${encodeURIComponent(reqId)}/archive`, {
        method: "POST",
      });
      await safeReadJson(res);
      setNotice("Requirement archived.");
      await fetchRequirements();
      if (selectedReq?.id === reqId) setSelectedReq(null);
    } catch (err: any) {
      setError(err.message || "Failed to archive item.");
    } finally {
      setSaving(false);
    }
  };

  const handleSetDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matterId || !showDisputeModal) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/case-actions/requirements/${encodeURIComponent(showDisputeModal.id)}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disputeType,
          disputeNote: disputeNote.trim() || null,
        }),
      });
      await safeReadJson(res);
      setNotice("Item marked as disputed.");
      setShowDisputeModal(null);
      setDisputeNote("");
      await fetchRequirements();
      if (selectedReq?.id === showDisputeModal.id) await inspectRequirement(showDisputeModal.id);
    } catch (err: any) {
      setError(err.message || "Failed to record dispute.");
    } finally {
      setSaving(false);
    }
  };

  const handleResolveDispute = async (reqId: string) => {
    if (!matterId) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/case-actions/requirements/${encodeURIComponent(reqId)}/resolve-dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionNote: "Dispute resolved by parent" }),
      });
      await safeReadJson(res);
      setNotice("Dispute resolved.");
      await fetchRequirements();
      if (selectedReq?.id === reqId) await inspectRequirement(reqId);
    } catch (err: any) {
      setError(err.message || "Failed to resolve dispute.");
    } finally {
      setSaving(false);
    }
  };

  // Action Operations
  const handleCreateAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matterId || !showAddActionModal) return;
    if (!newActionTitle.trim()) {
      setError("Action title is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/case-actions/requirements/${encodeURIComponent(showAddActionModal.id)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newActionTitle.trim(),
          dueAt: newActionDueAt ? new Date(newActionDueAt).toISOString() : null,
        }),
      });
      await safeReadJson(res);
      setNotice("Action created.");
      setShowAddActionModal(null);
      setNewActionTitle("");
      setNewActionDueAt("");
      await fetchRequirements();
      if (selectedReq?.id === showAddActionModal.id) await inspectRequirement(showAddActionModal.id);
    } catch (err: any) {
      setError(err.message || "Failed to create action task.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActionComplete = async (actionId: string, currentStatus: string, reqId: string) => {
    if (!matterId) return;
    setSaving(true);
    const endpoint = currentStatus === "COMPLETED" ? "reopen" : "complete";
    try {
      const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/case-actions/actions/${encodeURIComponent(actionId)}/${endpoint}`, {
        method: "POST",
      });
      await safeReadJson(res);
      await fetchRequirements();
      if (selectedReq?.id === reqId) await inspectRequirement(reqId);
    } catch (err: any) {
      setError(err.message || "Failed to update action status.");
    } finally {
      setSaving(false);
    }
  };

  // Evidence Link Operations
  const handleAttachEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matterId || !showAttachEvidenceModal) return;
    if (!newEvidenceTitle.trim()) {
      setError("Evidence title is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/case-actions/requirements/${encodeURIComponent(showAttachEvidenceModal.id)}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newEvidenceTitle.trim(),
          evidenceType: newEvidenceType,
          notes: newEvidenceNotes.trim() || null,
        }),
      });
      await safeReadJson(res);
      setNotice("Proof attached to requirement.");
      setShowAttachEvidenceModal(null);
      setNewEvidenceTitle("");
      setNewEvidenceNotes("");
      await fetchRequirements();
      if (selectedReq?.id === showAttachEvidenceModal.id) await inspectRequirement(showAttachEvidenceModal.id);
    } catch (err: any) {
      setError(err.message || "Failed to attach evidence proof.");
    } finally {
      setSaving(false);
    }
  };

  const handleUnlinkEvidence = async (linkId: string, reqId: string) => {
    if (!matterId) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/case-actions/evidence/${encodeURIComponent(linkId)}`, {
        method: "DELETE",
      });
      await safeReadJson(res);
      setNotice("Evidence link removed.");
      await fetchRequirements();
      if (selectedReq?.id === reqId) await inspectRequirement(reqId);
    } catch (err: any) {
      setError(err.message || "Failed to unlink evidence.");
    } finally {
      setSaving(false);
    }
  };

  // Derived Groups for Tabs
  const activeRequirements = requirements.filter((r) => r.review_state !== "ARCHIVED" && r.review_state !== "REJECTED");
  const urgentRequirements = activeRequirements.filter((r) => r.isOverdue || r.review_state === "PROPOSED" || r.dispute_state === "DISPUTED");
  const disputedRequirements = activeRequirements.filter((r) => r.dispute_state === "DISPUTED");
  const historyRequirements = requirements.filter((r) => r.review_state === "ARCHIVED" || r.review_state === "REJECTED");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16" id="case-action-workspace">
      {/* Top Header Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-xl md:text-2xl font-bold font-display text-slate-900 flex items-center gap-2" id="workspace-title">
                <Shield className="w-6 h-6 text-brand-600 shrink-0" />
                <span>Parent Case-Action Workspace</span>
              </h1>
              <p className="text-xs md:text-sm text-slate-600 mt-1">
                Track legal deadlines, CAS requests, actions, and evidence proof in one clear roadmap.
              </p>
            </div>

            {/* Matter Switcher & Action Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
                <label htmlFor="matter-selector" className="text-xs font-semibold text-slate-600 pl-2">
                  Case Matter:
                </label>
                {matters.length > 0 ? (
                  <select
                    id="matter-selector"
                    value={matterId}
                    onChange={(e) => setMatterId(e.target.value)}
                    className="bg-white border border-slate-300 text-xs rounded-lg px-2.5 py-1.5 font-medium focus:ring-2 focus:ring-brand-500 focus:outline-none"
                  >
                    {matters.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="Enter Matter UUID"
                    value={manualMatterInput || matterId}
                    onChange={(e) => {
                      setManualMatterInput(e.target.value);
                      setMatterId(e.target.value.trim());
                    }}
                    className="bg-white border border-slate-300 text-xs rounded-lg px-2.5 py-1.5 font-mono focus:ring-2 focus:ring-brand-500 focus:outline-none w-48"
                  />
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowCreateReqModal(true)}
                disabled={!matterId}
                className="min-h-[44px] px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl flex items-center gap-2 shadow-xs transition-colors focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
              >
                <Plus className="w-4 h-4" />
                <span>Add Item</span>
              </button>
            </div>
          </div>

          {/* Navigation Rail Tabs */}
          <nav className="flex gap-2 overflow-x-auto mt-4 pt-2 border-t border-slate-100 no-scrollbar" aria-label="Workspace views">
            {[
              { id: "today", label: "Today / Next", count: urgentRequirements.length, icon: Clock, badge: urgentRequirements.length > 0 },
              { id: "requirements", label: "All Requirements", count: activeRequirements.length, icon: FileText },
              { id: "checklist", label: "Action Checklist", icon: CheckCircle2 },
              { id: "evidence", label: "Evidence Attached", icon: Link2 },
              { id: "disputed", label: "Disputed Items", count: disputedRequirements.length, icon: AlertTriangle },
              { id: "history", label: "History & Archived", count: historyRequirements.length, icon: BookOpen },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`min-h-[44px] px-4 py-2 text-xs font-semibold rounded-xl whitespace-nowrap flex items-center gap-2 transition-all focus:ring-2 focus:ring-brand-500 focus:outline-none ${
                    isActive ? "bg-brand-600 text-white shadow-xs" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${isActive ? "bg-white/20 text-white" : "bg-slate-200 text-slate-800"}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* ARIA Live Status Messages */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4" aria-live="polite">
        {notice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-medium flex items-center justify-between mb-4">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              {notice}
            </span>
            <button onClick={() => setNotice("")} className="text-emerald-700 hover:text-emerald-900">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl text-xs font-medium flex items-center justify-between mb-4">
            <span className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              {error}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchRequirements()}
                className="px-2.5 py-1 bg-rose-200 hover:bg-rose-300 text-rose-900 text-[11px] font-bold rounded-lg transition-colors"
              >
                Retry
              </button>
              <button onClick={() => setError("")} className="text-rose-700 hover:text-rose-900">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
        {!matterId ? (
          <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl shadow-xs">
            <Shield className="w-12 h-12 text-brand-500 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-slate-900">No Case Matter Selected</h2>
            <p className="text-xs text-slate-600 max-w-md mx-auto mt-1">
              Select an existing matter from the dropdown above or enter your Case Matter ID to open your workspace.
            </p>
          </div>
        ) : loading ? (
          <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl" aria-busy="true" aria-label="Loading requirements">
            <RefreshCw className="w-8 h-8 text-brand-600 animate-spin mx-auto mb-3" />
            <p className="text-xs font-semibold text-slate-600">Loading your case actions roadmap...</p>
          </div>
        ) : (
          <>
            {/* VIEW 1: TODAY / NEXT */}
            {activeTab === "today" && (
              <div className="space-y-6">
                {/* Urgent Header Summary */}
                <div className="p-4 bg-gradient-to-r from-brand-700 to-brand-900 text-white rounded-2xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold flex items-center gap-2">
                      <Clock className="w-5 h-5 text-amber-300" />
                      <span>Action Focus Desk</span>
                    </h2>
                    <p className="text-xs text-brand-100 mt-0.5">
                      Review urgent deadlines, proposed requests, and items marked for attention.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold px-3 py-1 bg-white/10 rounded-lg">
                      {urgentRequirements.length} urgent item{urgentRequirements.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>

                {urgentRequirements.length === 0 ? (
                  <div className="p-10 text-center bg-white border border-slate-200 rounded-2xl">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                    <h3 className="text-sm font-bold text-slate-900">All Caught Up!</h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                      You have no overdue deadlines, proposed items awaiting review, or active disputes right now.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {urgentRequirements.map((req) => (
                      <RequirementCard
                        key={req.id}
                        requirement={req}
                        onInspect={() => inspectRequirement(req.id)}
                        onConfirm={() => handleConfirmProposed(req.id)}
                        onReject={() => handleRejectProposed(req.id)}
                        onDispute={() => setShowDisputeModal(req)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* VIEW 2: ALL REQUIREMENTS */}
            {activeTab === "requirements" && (
              <div className="space-y-4">
                {/* Filter Toolbar */}
                <div className="p-4 bg-white border border-slate-200 rounded-2xl flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    <Filter className="w-4 h-4 text-slate-400" />
                    <span>Filter:</span>
                  </div>

                  <select
                    aria-label="Filter by Authority"
                    value={filterAuthority}
                    onChange={(e) => setFilterAuthority(e.target.value)}
                    className="bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">All Authority Types</option>
                    {Object.keys(AUTHORITY_LABELS).map((k) => (
                      <option key={k} value={k}>
                        {AUTHORITY_LABELS[k as AuthorityType].label}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Filter by Completion State"
                    value={filterCompletion}
                    onChange={(e) => setFilterCompletion(e.target.value)}
                    className="bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">All Completion States</option>
                    {Object.keys(COMPLETION_STATE_LABELS).map((k) => (
                      <option key={k} value={k}>
                        {COMPLETION_STATE_LABELS[k as CompletionState].label}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Filter by Review State"
                    value={filterReview}
                    onChange={(e) => setFilterReview(e.target.value)}
                    className="bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">All Review States</option>
                    {Object.keys(REVIEW_STATE_LABELS).map((k) => (
                      <option key={k} value={k}>
                        {REVIEW_STATE_LABELS[k as ReviewState].label}
                      </option>
                    ))}
                  </select>
                </div>

                {activeRequirements.length === 0 ? (
                  <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl">
                    <FileText className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                    <h3 className="text-sm font-bold text-slate-900">No Requirements Found</h3>
                    <p className="text-xs text-slate-500 mt-1">Try clearing filters or add your first requirement item.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {activeRequirements.map((req) => (
                      <RequirementCard
                        key={req.id}
                        requirement={req}
                        onInspect={() => inspectRequirement(req.id)}
                        onConfirm={() => handleConfirmProposed(req.id)}
                        onReject={() => handleRejectProposed(req.id)}
                        onDispute={() => setShowDisputeModal(req)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* VIEW 3: ACTION CHECKLIST */}
            {activeTab === "checklist" && (
              <div className="p-6 bg-white border border-slate-200 rounded-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Action Checklist</h2>
                    <p className="text-xs text-slate-500">Specific steps and tasks linked to your legal requirements.</p>
                  </div>
                </div>

                {activeRequirements.flatMap((r) => r.actions || []).length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">No action steps created yet. Inspect a requirement to add tasks.</p>
                ) : (
                  <div className="space-y-2">
                    {activeRequirements.map((req) => (
                      <div key={req.id} className="space-y-2">
                        {req.actions && req.actions.length > 0 && (
                          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                            <span className="text-xs font-bold text-slate-700 block">{req.title}</span>
                            {req.actions.map((act) => (
                              <div key={act.id} className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200 text-xs">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleActionComplete(act.id, act.status, req.id)}
                                    className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                                      act.status === "COMPLETED" ? "bg-emerald-600 border-emerald-600 text-white" : "border-slate-300 hover:border-brand-500"
                                    }`}
                                    aria-label={`Mark action ${act.title} as ${act.status === "COMPLETED" ? "incomplete" : "completed"}`}
                                  >
                                    {act.status === "COMPLETED" && <Check className="w-3.5 h-3.5" />}
                                  </button>
                                  <span className={act.status === "COMPLETED" ? "line-through text-slate-400" : "font-medium text-slate-800"}>{act.title}</span>
                                </div>
                                {act.due_at && (
                                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                    <Clock className="w-3 h-3 text-slate-400" />
                                    {new Date(act.due_at).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* VIEW 4: EVIDENCE VIEW */}
            {activeTab === "evidence" && (
              <div className="p-6 bg-white border border-slate-200 rounded-2xl space-y-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Attached Proof & Evidence Links</h2>
                  <p className="text-xs text-slate-500">Official completion certificates, test results, and receipts attached to your requirements.</p>
                </div>

                {activeRequirements.flatMap((r) => r.evidenceLinks || []).length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">No evidence links attached yet.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {activeRequirements.map((req) =>
                      (req.evidenceLinks || []).map((link) => (
                        <div key={link.id} className="p-3 border border-slate-200 rounded-xl bg-slate-50 flex justify-between items-start text-xs">
                          <div>
                            <span className="font-bold text-slate-900 block">{link.title}</span>
                            <span className="text-[10px] font-semibold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full inline-block mt-1">
                              {EVIDENCE_TYPE_LABELS[link.evidence_type] || link.evidence_type}
                            </span>
                            <span className="block text-[11px] text-slate-600 mt-1">Linked to: {req.title}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleUnlinkEvidence(link.id, req.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-white"
                            aria-label={`Unlink evidence ${link.title}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* VIEW 5: DISPUTED ITEMS */}
            {activeTab === "disputed" && (
              <div className="space-y-4">
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900">
                  <h2 className="font-bold text-sm text-amber-950 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>Disputed Items Desk</span>
                  </h2>
                  <p className="mt-1">
                    You marked these items as disputed. Please note: marking an item as disputed communicates your disagreement but does not automatically replace or cancel a court order.
                  </p>
                </div>

                {disputedRequirements.length === 0 ? (
                  <div className="p-10 text-center bg-white border border-slate-200 rounded-2xl text-xs text-slate-500">
                    No active disputed items.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {disputedRequirements.map((req) => (
                      <div key={req.id} className="p-4 bg-white border border-amber-300 rounded-2xl shadow-xs space-y-3">
                        <div className="flex justify-between items-start">
                          <span className="text-xs font-bold px-2.5 py-1 bg-amber-100 text-amber-900 rounded-lg">
                            {req.dispute_type || "DISPUTED"}
                          </span>
                          <span className="text-[10px] text-slate-500">{AUTHORITY_LABELS[req.authority_type]?.label}</span>
                        </div>
                        <h3 className="font-bold text-sm text-slate-900">{req.title}</h3>
                        {req.dispute_note && <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border font-sans font-normal">"{req.dispute_note}"</p>}
                        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => handleResolveDispute(req.id)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl"
                          >
                            Mark Dispute Resolved
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* VIEW 6: HISTORY & ARCHIVED */}
            {activeTab === "history" && (
              <div className="space-y-4">
                {historyRequirements.length === 0 ? (
                  <div className="p-10 text-center bg-white border border-slate-200 rounded-2xl text-xs text-slate-500">
                    No archived or declined items in history.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {historyRequirements.map((req) => (
                      <RequirementCard key={req.id} requirement={req} onInspect={() => inspectRequirement(req.id)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* REQUIREMENT DETAIL MODAL / DRAWER */}
      {selectedReq && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex justify-end overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="detail-title">
          <div className="w-full max-w-xl bg-white min-h-full p-6 space-y-6 flex flex-col justify-between shadow-2xl">
            <div className="space-y-6">
              {/* Top Bar */}
              <div className="flex justify-between items-start border-b border-slate-100 pb-4">
                <div>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase border ${AUTHORITY_LABELS[selectedReq.authority_type]?.bg} ${AUTHORITY_LABELS[selectedReq.authority_type]?.text} ${AUTHORITY_LABELS[selectedReq.authority_type]?.border}`}>
                    {AUTHORITY_LABELS[selectedReq.authority_type]?.label}
                  </span>
                  <h2 id="detail-title" className="text-lg font-bold text-slate-900 mt-2">
                    {selectedReq.title}
                  </h2>
                </div>
                <button onClick={() => setSelectedReq(null)} className="p-2 text-slate-400 hover:text-slate-700 rounded-xl" aria-label="Close detail panel">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Description */}
              {selectedReq.description && (
                <div className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="font-bold text-slate-900 block mb-1">Details:</span>
                  {selectedReq.description}
                </div>
              )}

              {/* Authority Explanation */}
              <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-xl text-xs text-blue-900">
                <span className="font-bold block text-blue-950">{AUTHORITY_LABELS[selectedReq.authority_type]?.label}</span>
                <p className="mt-0.5 text-slate-600">{AUTHORITY_LABELS[selectedReq.authority_type]?.description}</p>
              </div>

              {/* Source Provenance */}
              {selectedReq.provenance_type && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                  <span className="font-bold text-slate-900 block">Origin & Source:</span>
                  <p className="text-slate-600">Type: {selectedReq.provenance_type}</p>
                  {selectedReq.source_author_or_speaker && <p className="text-slate-600">Speaker/Author: {selectedReq.source_author_or_speaker}</p>}
                  {selectedReq.source_exact_quote && <p className="italic text-slate-700 bg-white p-2 rounded border mt-1 font-serif">"{selectedReq.source_exact_quote}"</p>}
                </div>
              )}

              {/* Actions Sub-List */}
              <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Action Steps ({selectedReq.actions?.length || 0})</h3>
                  <button
                    type="button"
                    onClick={() => setShowAddActionModal(selectedReq)}
                    className="text-xs font-semibold text-brand-600 hover:text-brand-800 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Task</span>
                  </button>
                </div>
                {selectedReq.actions && selectedReq.actions.length > 0 ? (
                  <div className="space-y-2">
                    {selectedReq.actions.map((act) => (
                      <div key={act.id} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                        <span className={act.status === "COMPLETED" ? "line-through text-slate-400 font-medium" : "text-slate-800 font-medium"}>{act.title}</span>
                        <button
                          type="button"
                          onClick={() => handleToggleActionComplete(act.id, act.status, selectedReq.id)}
                          className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border ${
                            act.status === "COMPLETED" ? "bg-emerald-100 text-emerald-800 border-emerald-300" : "bg-white text-slate-700 border-slate-300"
                          }`}
                        >
                          {act.status === "COMPLETED" ? "Completed" : "Mark Complete"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">No tasks created yet.</p>
                )}
              </div>

              {/* Evidence Sub-List */}
              <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Attached Evidence ({selectedReq.evidenceLinks?.length || 0})</h3>
                  <button
                    type="button"
                    onClick={() => setShowAttachEvidenceModal(selectedReq)}
                    className="text-xs font-semibold text-brand-600 hover:text-brand-800 flex items-center gap-1"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>Attach Proof</span>
                  </button>
                </div>
                {selectedReq.evidenceLinks && selectedReq.evidenceLinks.length > 0 ? (
                  <div className="space-y-2">
                    {selectedReq.evidenceLinks.map((link) => (
                      <div key={link.id} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                        <div>
                          <span className="font-bold text-slate-900 block">{link.title}</span>
                          <span className="text-[10px] text-slate-500">{EVIDENCE_TYPE_LABELS[link.evidence_type]}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUnlinkEvidence(link.id, selectedReq.id)}
                          className="p-1 text-slate-400 hover:text-rose-600"
                          aria-label={`Unlink ${link.title}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">No evidence proof attached yet.</p>
                )}
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="pt-4 border-t border-slate-100 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => handleArchiveRequirement(selectedReq.id)}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl"
              >
                Archive Item
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDisputeModal(selectedReq);
                  setSelectedReq(null);
                }}
                className="px-3 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-semibold rounded-xl"
              >
                Dispute Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE REQUIREMENT MODAL */}
      {showCreateReqModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="create-title">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h2 id="create-title" className="text-base font-bold text-slate-900">
                Add New Requirement Item
              </h2>
              <button onClick={() => setShowCreateReqModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRequirement} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Complete Triple P Parenting Course"
                  value={newReqTitle}
                  onChange={(e) => setNewReqTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Authority Category *</label>
                <select
                  value={newReqAuthority}
                  onChange={(e) => setNewReqAuthority(e.target.value as AuthorityType)}
                  className="w-full bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                >
                  {Object.keys(AUTHORITY_LABELS).map((k) => (
                    <option key={k} value={k}>
                      {AUTHORITY_LABELS[k as AuthorityType].label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1 font-medium">{AUTHORITY_LABELS[newReqAuthority]?.description}</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description / Conditions</label>
                <textarea
                  rows={3}
                  placeholder="Additional context or worker instructions..."
                  value={newReqDesc}
                  onChange={(e) => setNewReqDesc(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target Due Date</label>
                <input
                  type="date"
                  value={newReqDueAt}
                  onChange={(e) => setNewReqDueAt(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateReqModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Requirement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DISPUTE MODAL */}
      {showDisputeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="dispute-title">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h2 id="dispute-title" className="text-base font-bold text-slate-900">
                Dispute Item: {showDisputeModal.title}
              </h2>
              <button onClick={() => setShowDisputeModal(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSetDispute} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reason for Dispute *</label>
                <select
                  value={disputeType}
                  onChange={(e) => setDisputeType(e.target.value as DisputeType)}
                  className="w-full bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                >
                  <option value="NO_LEGAL_AUTHORITY">No Legal Authority / Not in Court Order</option>
                  <option value="FACTUALLY_INACCURATE">Factually Inaccurate</option>
                  <option value="UNREASONABLE_CONDITION">Unreasonable Condition</option>
                  <option value="IMPOSSIBLE_DEADLINE">Impossible Deadline</option>
                  <option value="OTHER">Other Reason</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Dispute Note & Explanation</label>
                <textarea
                  rows={3}
                  placeholder="Explain why this condition is disputed or unreasonable..."
                  value={disputeNote}
                  onChange={(e) => setDisputeNote(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
              </div>

              <div className="p-3 bg-amber-50 text-amber-900 rounded-xl text-[11px]">
                Note: Recording a dispute expresses your objection to this item for your records and advocacy.
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowDisputeModal(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
                >
                  {saving ? "Recording..." : "Record Dispute"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE ACTION MODAL */}
      {showAddActionModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="action-modal-title">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h2 id="action-modal-title" className="text-base font-bold text-slate-900">
                Add Task for: {showAddActionModal.title}
              </h2>
              <button onClick={() => setShowAddActionModal(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAction} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Task Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Call program director to enroll"
                  value={newActionTitle}
                  onChange={(e) => setNewActionTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target Completion Date</label>
                <input
                  type="date"
                  value={newActionDueAt}
                  onChange={(e) => setNewActionDueAt(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddActionModal(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Add Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ATTACH EVIDENCE MODAL */}
      {showAttachEvidenceModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="evidence-modal-title">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h2 id="evidence-modal-title" className="text-base font-bold text-slate-900">
                Attach Proof for: {showAttachEvidenceModal.title}
              </h2>
              <button onClick={() => setShowAttachEvidenceModal(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAttachEvidence} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Proof Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Parenting Program Certificate Copy"
                  value={newEvidenceTitle}
                  onChange={(e) => setNewEvidenceTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Type of Evidence *</label>
                <select
                  value={newEvidenceType}
                  onChange={(e) => setNewEvidenceType(e.target.value as EvidenceType)}
                  className="w-full bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                >
                  {Object.keys(EVIDENCE_TYPE_LABELS).map((k) => (
                    <option key={k} value={k}>
                      {EVIDENCE_TYPE_LABELS[k as EvidenceType]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Optional details..."
                  value={newEvidenceNotes}
                  onChange={(e) => setNewEvidenceNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-xs rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAttachEvidenceModal(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-xl disabled:opacity-50"
                >
                  {saving ? "Attaching..." : "Attach Proof"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

interface RequirementCardProps {
  key?: string;
  requirement: CaseRequirement;
  onInspect: () => void;
  onConfirm?: () => void;
  onReject?: () => void;
  onDispute?: () => void;
}

// Requirement Card Helper Component
function RequirementCard({
  requirement,
  onInspect,
  onConfirm,
  onReject,
  onDispute,
}: RequirementCardProps) {
  const authMeta = AUTHORITY_LABELS[requirement.authority_type] || AUTHORITY_LABELS.PARENT_CREATED;
  const reviewMeta = REVIEW_STATE_LABELS[requirement.review_state] || REVIEW_STATE_LABELS.CONFIRMED;
  const compMeta = COMPLETION_STATE_LABELS[requirement.completion_state] || COMPLETION_STATE_LABELS.NOT_STARTED;

  return (
    <div className="p-4 bg-white border border-slate-200 hover:border-slate-300 rounded-2xl shadow-xs space-y-3 flex flex-col justify-between transition-all">
      <div className="space-y-2">
        {/* Top Badges */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase border ${authMeta.bg} ${authMeta.text} ${authMeta.border}`}>
            {authMeta.label}
          </span>
          <div className="flex items-center gap-1">
            {requirement.review_state === "PROPOSED" && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${reviewMeta.bg} ${reviewMeta.text}`}>
                {reviewMeta.label}
              </span>
            )}
            {requirement.dispute_state === "DISPUTED" && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-amber-600" />
                Disputed
              </span>
            )}
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${compMeta.bg} ${compMeta.text}`}>
              {compMeta.label}
            </span>
          </div>
        </div>

        {/* Title */}
        <button type="button" onClick={onInspect} className="text-left font-bold text-sm text-slate-900 hover:text-brand-600 block leading-snug">
          {requirement.title}
        </button>

        {/* Description snippet */}
        {requirement.description && <p className="text-xs text-slate-600 line-clamp-2">{requirement.description}</p>}
      </div>

      {/* Bottom Metadata & Controls */}
      <div className="pt-3 border-t border-slate-100 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
          {requirement.due_at ? (
            <span className={`flex items-center gap-1 ${requirement.isOverdue ? "text-rose-600 font-bold" : ""}`}>
              <Clock className="w-3.5 h-3.5" />
              {requirement.isOverdue ? "OVERDUE" : `Due ${new Date(requirement.due_at).toLocaleDateString()}`}
            </span>
          ) : (
            <span>No deadline</span>
          )}

          <div className="flex items-center gap-2">
            <span>{requirement.actions?.length || 0} tasks</span>
            <span>·</span>
            <span>{requirement.evidenceLinks?.length || 0} proof</span>
          </div>
        </div>

        {/* Action Controls for Proposed items */}
        {requirement.review_state === "PROPOSED" && onConfirm && onReject && (
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onConfirm}
              className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onReject}
              className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl"
            >
              Decline
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
