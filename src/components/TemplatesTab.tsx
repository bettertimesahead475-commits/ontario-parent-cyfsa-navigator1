/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppReset } from "../hooks/useAppReset";
import React, { useState, useEffect } from "react";
import { EMPTY_AFFIDAVIT } from "../data";
import { AffidavitDraft, CaseTimelineItem, EvidenceLogItem, IssueSummarySheet, ParentPrepWorksheet, Form33BAnswer, PlanOfCare } from "../types";
import { Plus, Trash, Printer, ShieldAlert, CheckCircle, Scale, FileText, LayoutGrid, Calendar, BookOpen, Clock, Layers, Info, Mic, Square, Sparkles, Loader2, RefreshCw, AlertTriangle, Save, ArrowRight, Check, Lock, Heart, CloudUpload } from "lucide-react";
import { apiFetch, safeReadJson } from "../utils/api";
import { db, auth } from "../firebase";
import { doc, setDoc } from "firebase/firestore";

const EMPTY_FORM33B: Form33BAnswer = {
  courtRegistryName: "Ontario Court of Justice",
  caseNumber: "",
  applicantName: "",
  respondentName: "",
  childNames: "",
  applicationDate: "",
  claimDetails: "The respondent requests that the application be dismissed, and that the children be returned to the care and custody of the respondent parent with supportive community services under Section 94 of the CYFSA.",
  agreedFacts: "",
  disagreedFacts: [],
  parentStatementOfFacts: ""
};

const EMPTY_PLANOFCARE: PlanOfCare = {
  childName: "",
  birthdate: "",
  livingArrangements: "The child will reside full-time with the respondent parent in a fully furnished, child-safe apartment. Parent has established a stable, drug-free home environment.",
  safetySupervision: "Respondent parent will have primary supervision. Maternal grandmother (approved kinship contact) is available for secondary backup supervision.",
  educationNeeds: "Child is enrolled in local public school and will continue attendance. Parent has registered the child for free after-school reading programs and tutoring if required.",
  healthcareDevelopment: "Child is registered with a family pediatrician (Dr. Evans). Routine dental and wellness visits will occur. Mental health counseling or play-therapy will be scheduled if recommended by school or pediatric staff.",
  cultureReligion: "The family is committed to connecting the child to their cultural/heritage community by attending weekly cultural heritage center workshops, cultural celebrations, and community events.",
  contactAccessArrangements: "Open contact with extended kinship relatives (maternal grandparents, aunts/uncles) to preserve healthy family bonds. CAS access visits as required by the interim court guidelines.",
  parentSupportServices: "Parent is actively participating in Positive Parenting Programs (Triple P), weekly family support group counseling, and home visit family support check-ins."
};


export default function TemplatesTab() {
  const { resetAll } = useAppReset();
  // Save status indicator
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Helper to visually indicate auto-filled vs manual input
  const getHighlightClass = (val: any) => {
    const isFilled = typeof val === "string" ? val.trim().length > 0 : (Array.isArray(val) && val.length > 0);
    return isFilled 
      ? "bg-emerald-50/20 border-emerald-300 focus:ring-emerald-500 shadow-inner" 
      : "bg-amber-50/20 border-amber-300 focus:ring-amber-500 placeholder:text-amber-400";
  };

  // Parse saved progressive states
  const parsedProg = (() => {
    try {
      const saved = localStorage.getItem("OPA_TEMPLATES_PROGRESS");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to parse templates progressive draft from localStorage:", e);
    }
    return null;
  })();

  // Track if we recovered an unsaved non-empty draft to show a banner
  const [showRecoveryBanner, setShowRecoveryBanner] = useState<boolean>(() => {
    if (!parsedProg) return false;
    try {
      const hasData = (
        (parsedProg.affidavit && (
          parsedProg.affidavit.courtRegistryName || 
          parsedProg.affidavit.applicantName || 
          parsedProg.affidavit.respondentName || 
          parsedProg.affidavit.childNames || 
          parsedProg.affidavit.backgroundStatement || 
          (parsedProg.affidavit.factualEvents && parsedProg.affidavit.factualEvents.length > 0)
        )) ||
        (parsedProg.timelineItems && parsedProg.timelineItems.length > 0) ||
        (parsedProg.evidenceLog && parsedProg.evidenceLog.length > 0) ||
        (parsedProg.issueSheets && parsedProg.issueSheets.length > 0) ||
        (parsedProg.prepSheet && (
          parsedProg.prepSheet.nextHearingDate || 
          parsedProg.prepSheet.hearingType || 
          parsedProg.prepSheet.mainEducationalGoals || 
          parsedProg.prepSheet.mentalGroundingPlan || 
          parsedProg.prepSheet.whoIsTakingNotes || 
          (parsedProg.prepSheet.topThreePriorities && parsedProg.prepSheet.topThreePriorities.length > 0)
        )) ||
        (parsedProg.form33b && (
          parsedProg.form33b.caseNumber ||
          parsedProg.form33b.respondentName ||
          parsedProg.form33b.childNames ||
          parsedProg.form33b.claimDetails
        )) ||
        (parsedProg.planOfCare && (
          parsedProg.planOfCare.childName ||
          parsedProg.planOfCare.livingArrangements ||
          parsedProg.planOfCare.safetySupervision
        ))
      );
      return !!hasData;
    } catch (e) {
      return false;
    }
  });

  const [resetConfirm, setResetConfirm] = useState<boolean>(false);
  const [bannerResetConfirm, setBannerResetConfirm] = useState<boolean>(false);
  
  const [activeBuilderTab, setActiveBuilderTab] = useState<"affidavit" | "timeline" | "evidence-log" | "issue-sheet" | "prep" | "answer-33b" | "plan-of-care">(() => {
    return parsedProg?.activeBuilderTab || "affidavit";
  });

  // State representations
  const [affidavit, setAffidavit] = useState<AffidavitDraft>(() => {
    return parsedProg?.affidavit || JSON.parse(JSON.stringify(EMPTY_AFFIDAVIT));
  });

  const [form33b, setForm33b] = useState<Form33BAnswer>(() => {
    return parsedProg?.form33b || JSON.parse(JSON.stringify(EMPTY_FORM33B));
  });

  const [planOfCare, setPlanOfCare] = useState<PlanOfCare>(() => {
    return parsedProg?.planOfCare || JSON.parse(JSON.stringify(EMPTY_PLANOFCARE));
  });

  
  const [timelineItems, setTimelineItems] = useState<CaseTimelineItem[]>(() => {
    return parsedProg?.timelineItems || [];
  });

  const [evidenceLog, setEvidenceLog] = useState<EvidenceLogItem[]>(() => {
    return parsedProg?.evidenceLog || [];
  });

  // Voice recording & AI extraction states
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionSuccess, setExtractionSuccess] = useState<string | null>(null);
  const [recognitionInstance, setRecognitionInstance] = useState<any>(null);

  const [handoverDocName, setHandoverDocName] = useState<string | null>(null);

  useEffect(() => {
    const docName = localStorage.getItem("OPA_HANDOVER_ALERT");
    if (docName) {
      setHandoverDocName(docName);
      try {
        const saved = localStorage.getItem("OPA_TEMPLATES_PROGRESS");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.form33b) setForm33b(parsed.form33b);
          if (parsed.prepSheet) setPrepSheet(parsed.prepSheet);
          if (parsed.affidavit) setAffidavit(parsed.affidavit);
          if (parsed.planOfCare) setPlanOfCare(parsed.planOfCare);
          if (parsed.activeBuilderTab) setActiveBuilderTab(parsed.activeBuilderTab);
        }
      } catch (err) {
        console.error("Failed to load handover data:", err);
      }
      localStorage.removeItem("OPA_HANDOVER_ALERT");
    }
  }, []);

  const startRecording = () => {
    setVoiceError(null);
    setExtractionSuccess(null);
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError("Your browser does not support the Web Speech API. Please type or paste your narrative in the box below instead.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-CA"; // Canadian English format

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onresult = (event: any) => {
        let finalTrans = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTrans += event.results[i][0].transcript + " ";
          }
        }
        if (finalTrans) {
          setTranscript(prev => prev + finalTrans);
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === "not-allowed") {
          setVoiceError("Microphone permission was denied/blocked. Please grant microphone access in your browser or type manually below.");
        } else {
          setVoiceError(`Voice recognition exception: ${event.error}`);
        }
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognition.start();
      setRecognitionInstance(recognition);
    } catch (e: any) {
      setVoiceError(`Failed to initialize speech system: ${e.message}`);
    }
  };

  const stopRecording = () => {
    if (recognitionInstance) {
      recognitionInstance.stop();
      setIsRecording(false);
    }
  };

  const handleAIExtract = async () => {
    if (!transcript.trim()) {
      setVoiceError("Please record speech or type/edit a narrative event description first.");
      return;
    }

    setIsExtracting(true);
    setVoiceError(null);
    setExtractionSuccess(null);
    
    try {
      const response = await apiFetch("/api/extract-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ narrativeText: transcript })
      });

      const data = await safeReadJson(response);
      
      const newLog: EvidenceLogItem = {
        id: "el-" + Date.now(),
        date: data.date || "2026-06-06",
        involvedWorkers: data.involvedWorkers || "",
        whatHappened: data.whatHappened || "",
        statementsMade: data.statementsMade || "",
        hearsayFlag: (data.hearsayFlag as any) || "Direct Evidence",
        audioPhotoLog: data.audioPhotoLog || "",
        questionsForCounsel: data.questionsForCounsel || ""
      };

      setEvidenceLog(prev => [newLog, ...prev]);
      setTranscript("");
      setExtractionSuccess("AI Extraction Successful! A structured log entry has been generated and pre-filled below directly into your evidentiary diary card list.");
      
      // Auto scroll down or clear the notification after a few seconds
      setTimeout(() => {
        setExtractionSuccess(null);
      }, 8000);

    } catch (err: any) {
      console.error("Error in AI extraction:", err);
      setVoiceError(err.message || "Failed to route narrative extraction to analysis backend.");
    } finally {
      setIsExtracting(false);
    }
  };

  const [issueSheets, setIssueSheets] = useState<IssueSummarySheet[]>(() => {
    return parsedProg?.issueSheets || [];
  });

  const [prepSheet, setPrepSheet] = useState<ParentPrepWorksheet>(() => {
    return parsedProg?.prepSheet || {
      nextHearingDate: "",
      hearingType: "",
      mainEducationalGoals: "",
      topThreePriorities: [],
      mentalGroundingPlan: "",
      whoIsTakingNotes: ""
    };
  });

  const [isAutoSaving, setIsAutoSaving] = useState(false);

  // Save progress explicitly
  const saveProgress = () => {
    try {
      const stateToSave = {
        activeBuilderTab,
        affidavit,
        timelineItems,
        evidenceLog,
        issueSheets,
        prepSheet,
        form33b,
        planOfCare,
        lastSaved: Date.now()
      };
      localStorage.setItem("OPA_TEMPLATES_PROGRESS", JSON.stringify(stateToSave));
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setSaveStatus(`Saved at ${timeStr}`);
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      console.error("Failed to manually save Templates state to localStorage:", e);
      setSaveStatus("Limit Exceeded");
    }
  };

  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const saveToCloud = async () => {
    if (!auth.currentUser) {
      alert("You must be logged in to save to the cloud. Please visit the Advocate Passport tab.");
      return;
    }
    
    setIsSavingToCloud(true);
    try {
      const stateToSave = {
        activeBuilderTab,
        affidavit,
        timelineItems,
        evidenceLog,
        issueSheets,
        prepSheet,
        form33b,
        planOfCare,
        lastSaved: Date.now()
      };
      
      const docId = `template_${Date.now()}`;
      await setDoc(doc(db, "users", auth.currentUser.uid, "saved_documents", docId), {
        id: docId,
        userId: auth.currentUser.uid,
        title: form33b.applicantName ? `Templates Draft - ${form33b.applicantName} vs ${form33b.respondentName}` : 'Templates Draft',
        type: 'template',
        content: JSON.stringify(stateToSave),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      setSaveStatus("Saved to Cloud ✓");
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (e: any) {
      console.error("Failed to save to cloud:", e);
      alert("Failed to save to cloud: " + (e.message || "Unknown error"));
    } finally {
      setIsSavingToCloud(false);
    }
  };

  // Auto-save whenever structural state changes (with 800ms debounce)
  useEffect(() => {
    setIsAutoSaving(true);
    const timer = setTimeout(() => {
      try {
        const stateToSave = {
          activeBuilderTab,
          affidavit,
          timelineItems,
          evidenceLog,
          issueSheets,
          prepSheet,
          form33b,
          planOfCare,
          lastSaved: Date.now()
        };
        localStorage.setItem("OPA_TEMPLATES_PROGRESS", JSON.stringify(stateToSave));
        setIsAutoSaving(false);
      } catch (e) {
        console.warn("Storage quota warning for auto-save in templates:", e);
        setIsAutoSaving(false);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [activeBuilderTab, affidavit, timelineItems, evidenceLog, issueSheets, prepSheet, form33b, planOfCare]);


  const isPremium = true;

  // Builders Dynamic Helpers
  const addTimelineItem = () => {
    const newItem: CaseTimelineItem = {
      id: "tl-" + Date.now(),
      date: "",
      title: "New Action Milestone",
      description: "",
      isCourtDate: false,
      actionRequired: ""
    };
    setTimelineItems([...timelineItems, newItem]);
  };

  const removeTimelineItem = (id: string) => {
    setTimelineItems(timelineItems.filter(item => item.id !== id));
  };

  const addEvidenceLogItem = () => {
    const newItem: EvidenceLogItem = {
      id: "el-" + Date.now(),
      date: "",
      involvedWorkers: "",
      whatHappened: "",
      statementsMade: "",
      hearsayFlag: "Direct Evidence",
      questionsForCounsel: ""
    };
    setEvidenceLog([...evidenceLog, newItem]);
  };

  const removeEvidenceLogItem = (id: string) => {
    setEvidenceLog(evidenceLog.filter(item => item.id !== id));
  };

  const addIssueSheet = () => {
    const newItem: IssueSummarySheet = {
      id: "is-" + Date.now(),
      agencyAssertion: "",
      ourParentResponse: "",
      primaryEvidenceWeHave: "",
      missingEvidenceNeeded: ""
    };
    setIssueSheets([...issueSheets, newItem]);
  };

  const removeIssueSheet = (id: string) => {
    setIssueSheets(issueSheets.filter(item => item.id !== id));
  };


  useEffect(() => {
    const handleFooterPrint = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.type === "template") {
        printTemplate();
      }
    };
    window.addEventListener("trigger-print-pdf", handleFooterPrint);
    return () => window.removeEventListener("trigger-print-pdf", handleFooterPrint);
  }, [activeBuilderTab, affidavit, timelineItems, evidenceLog, issueSheets, prepSheet]);

  const printTemplate = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow popups to save/print the template draft as a clean PDF.");
      return;
    }

    let title = "Document Draft";
    let bodyContent = "";

    const sharedStyle = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        body {
          font-family: 'Inter', sans-serif;
          color: #1e293b;
          margin: 40px;
          line-height: 1.5;
          background-color: #fff;
        }
        .no-print-btn {
          background-color: #0f172a;
          color: white;
          border: none;
          padding: 10px 18px;
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
        .court-header {
          border-bottom: 2px solid #0f172a;
          padding-bottom: 12px;
          margin-bottom: 30px;
          text-align: center;
        }
        .court-title {
          font-size: 15px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #0f172a;
        }
        .draft-notice {
          font-size: 11px;
          color: #dc2626;
          font-weight: bold;
          text-transform: uppercase;
          margin-top: 5px;
          letter-spacing: 0.1em;
        }
        .jurisdiction {
          font-size: 11px;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-top: 2px;
        }
        .court-box-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 25px;
          font-size: 12px;
        }
        .court-box-table td {
          border: 1px solid #cbd5e1;
          padding: 10px;
          width: 50%;
          vertical-align: top;
        }
        .document-title {
          font-size: 18px;
          font-weight: 800;
          text-transform: uppercase;
          text-align: center;
          margin: 20px 0;
          letter-spacing: 0.05em;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 8px;
        }
        .section-header {
          font-size: 13px;
          font-weight: bold;
          text-transform: uppercase;
          color: #0f172a;
          border-bottom: 1.5px solid #0f172a;
          padding-bottom: 4px;
          margin: 25px 0 12px 0;
          letter-spacing: 0.03em;
          page-break-after: avoid;
        }
        .text-block {
          font-size: 13px;
          color: #334155;
          line-height: 1.6;
          white-space: pre-line;
          margin-bottom: 15px;
          text-align: justify;
        }
        table.data-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
          margin-bottom: 25px;
          font-size: 11.5px;
        }
        table.data-table th {
          background-color: #f8fafc;
          border: 1px solid #cbd5e1;
          font-weight: bold;
          text-align: left;
          padding: 8px;
          color: #0f172a;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }
        table.data-table td {
          border: 1px solid #cbd5e1;
          padding: 8px;
          vertical-align: top;
          color: #334155;
        }
        .item-row {
          page-break-inside: avoid;
        }
        .notary-box {
          border: 1.5px solid #94a3b8;
          border-radius: 6px;
          padding: 16px;
          margin-top: 40px;
          page-break-inside: avoid;
          font-size: 12px;
          color: #475569;
          background-color: #f8fafc;
          line-height: 1.6;
        }
        .legal-notice {
          font-size: 10.5px;
          color: #64748b;
          text-align: center;
          margin-top: 35px;
          border-top: 1px solid #e2e8f0;
          padding-top: 12px;
          page-break-inside: avoid;
        }
      </style>
    `;

    if (activeBuilderTab === "affidavit") {
      title = "Affidavit Draft";
      bodyContent = `
        <div class="court-header">
          <div class="court-title">Ontario Court of Justice (Family Branch)</div>
          <div class="jurisdiction">Province of Ontario, Canada • Family Law Rules</div>
          <div class="draft-notice">PRE-COUNSEL EDUCATIONAL COURT DRAFT ONLY</div>
        </div>

        <table class="court-box-table">
          <tr>
            <td>
              <strong>Applicant (Parent/Party):</strong><br/>
              ${affidavit.applicantName || "Not Specified"}<br/><br/>
              <strong>Respondent(s):</strong><br/>
              ${affidavit.respondentName || "Not Specified"}
            </td>
            <td>
              <strong>Court Registry Local Office:</strong><br/>
              ${affidavit.courtRegistryName || "Not Specified"}<br/><br/>
              <strong>Subject Children names & Dates of Birth:</strong><br/>
              ${affidavit.childNames || "Not Specified"} ${affidavit.childBirthdates ? `(Born: ${affidavit.childBirthdates})` : ""}
            </td>
          </tr>
        </table>

        <div class="document-title">Affidavit of ${affidavit.authorName || "Drafting Parent"}</div>

        <div class="text-block">
          I, <strong>${affidavit.authorName || "Drafting Parent"}</strong>, of the Province of Ontario, Canada, make oath and say (or solemnly affirm) as follows:
        </div>

        <div class="section-header">1. Background Statement</div>
        <div class="text-block">${affidavit.backgroundStatement || "No background statement provided."}</div>

        <div class="section-header">2. Chronological Record of Material Facts & Interactions</div>
        <div class="text-block" style="font-size:12px; font-style:italic;">
          The following fact-basis chronology lists direct, personal observations, statements, or events verified by the affiant.
        </div>
        
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 15%">Date / Time</th>
              <th style="width: 55%">Verbatim Detailed Statement / Circumstances</th>
              <th style="width: 30%">Corroborative Evidence (Audio / Photos / Logs)</th>
            </tr>
          </thead>
          <tbody>
            ${affidavit.factualEvents.map((ev: any) => `
              <tr class="item-row">
                <td><strong>${ev.date || "N/A"}</strong>${ev.time ? `<br/>${ev.time}` : ""}</td>
                <td>
                  ${ev.eventDescription || "No details entered."}
                  ${ev.unsupportedOrHearsayWarn ? `<br/><span style="color: #b45309; font-size: 10px; font-weight: bold;">⚠️ EDUCATIONAL ADVISORY: Contains possible hearsay statements or unverified claims. Consult lawyer to formulate.</span>` : ""}
                </td>
                <td>${ev.witnessesOrEvidence || "None itemized."}</td>
              </tr>
            `).join("")}
            ${affidavit.factualEvents.length === 0 ? `<tr><td colspan="3" style="text-align: center; color: #64748b;">No chronological factual statements added yet.</td></tr>` : ""}
          </tbody>
        </table>

        <div class="section-header">3. Subject Children's Perspectives & Expressed Preferences</div>
        <div class="text-block">${affidavit.childsPerspectiveText || "No statements recorded."}</div>

        <div class="section-header">4. Proposed Educational & Support Care Arrangements</div>
        <div class="text-block">${affidavit.proposedCareArrangement || "No proposed care plan drafted."}</div>

        <div class="section-header">5. Exhibits Referenced and Attached Under Solemn Affirmation</div>
        <table class="data-table" style="width: 80%; margin: 10px 0 25px 0;">
          <thead>
            <tr>
              <th style="width: 25%">Exhibit Mark</th>
              <th>Prereq Summary & Description of Attached Asset</th>
            </tr>
          </thead>
          <tbody>
            ${affidavit.exhibits.map((ex: any) => `
              <tr class="item-row">
                <td><strong>Exhibit "${ex.letter || "A"}"</strong></td>
                <td>
                  ${ex.description || "N/A"}<br/>
                  <span style="font-size: 9.5px; color: ${ex.verifiedWithPrimary ? '#15803d' : '#475569'}; font-weight: 500;">
                    ${ex.verifiedWithPrimary ? '✓ Verified with primary audit material' : '• Raw reference'}
                  </span>
                </td>
              </tr>
            `).join("")}
            ${affidavit.exhibits.length === 0 ? `<tr><td colspan="2" style="text-align: center; color: #64748b;">No exhibits attached to affidavit yet.</td></tr>` : ""}
          </tbody>
        </table>

        <div class="notary-box">
          <strong>COMMISSIONER FOR TAKING AFFIDAVITS DECLARATION BOX:</strong><br/>
          Sworn (or Solemnly Affirmed) before me at the City of ___________________________, <br/>
          in the Province of Ontario, Canada, on the ________ day of _______________________, 20____.<br/><br/>
          <table style="width: 100%; border: none; margin-top: 20px;">
            <tr style="border: none;">
              <td style="width: 50%; border: none; padding: 0;">
                ____________________________________________________<br/>
                <strong>Signature of Affiant (Drafting Parent)</strong>
              </td>
              <td style="width: 50%; border: none; padding: 0;">
                ____________________________________________________<br/>
                <strong>Signature of Commissioner (LSO licensed legal practitioner)</strong>
              </td>
            </tr>
          </table>
        </div>
      `;
    } else if (activeBuilderTab === "timeline") {
      title = "Case Chronology Draft";
      bodyContent = `
        <div class="court-header">
          <div class="court-title">Chronology of Events & Statutory Timeline Audit</div>
          <div class="jurisdiction">Ontario Court of Justice Case Log • S.O. 2017 compliant</div>
        </div>

        <div class="document-title">Chronology of Child Welfare Milestones</div>

        <div class="text-block">
          This document summarizes casework milestones and provides visual comparisons with statutory child-welfare timelines in Ontario family court proceedings.
        </div>

        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 15%">Milestone Date</th>
              <th style="width: 30%">Milestone / Event Name</th>
              <th style="width: 35%">Factual Description (Interaction Details)</th>
              <th style="width: 20%">Parent Action Required</th>
            </tr>
          </thead>
          <tbody>
            ${timelineItems.map((item: any) => `
              <tr class="item-row" style="${item.isCourtDate ? 'background-color: #fef2f2;' : ''}">
                <td>
                  <strong>${item.date || "N/A"}</strong>
                  ${item.isCourtDate ? '<br/><span style="color:#dc2626; font-size:9px; font-weight:bold; text-transform:uppercase;">⚖️ COURT DATE</span>' : ''}
                </td>
                <td>
                  <strong>${item.title || "No Title"}</strong>
                  ${item.statutoryDeadline ? `<br/><span style="color:#1e3a8a; font-size:9.5px; font-weight:550;">Deadline: ${item.statutoryDeadline}</span>` : ""}
                </td>
                <td>${item.description || "N/A"}</td>
                <td>${item.actionRequired || "None specified."}</td>
              </tr>
            `).join("")}
            ${timelineItems.length === 0 ? `<tr><td colspan="4" style="text-align: center; color: #64748b;">No chronology timeline records entered.</td></tr>` : ""}
          </tbody>
        </table>
      `;
    } else if (activeBuilderTab === "evidence-log") {
      title = "Evidentiary Diary Log";
      bodyContent = `
        <div class="court-header">
          <div class="court-title">Evidentiary Audit Log</div>
          <div class="jurisdiction">Casework Diary & Conversation Veracity Index • Ontario Family Proceedings</div>
        </div>

        <div class="document-title">Casework Interaction Diary & Hearsay Audit</div>
        
        <div class="text-block">
          Draft statements of interactions, casework contact items, and associated direct vs. hearsay checks compiled to assist legal counsel in evaluating admissibility under the Canada Evidence Act.
        </div>

        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 12%">Date</th>
              <th style="width: 20%">Involved Case Workers</th>
              <th style="width: 50%">Factual Context & Verbatim Assertions Made</th>
              <th style="width: 18%">Admissibility Index / Action Check</th>
            </tr>
          </thead>
          <tbody>
            ${evidenceLog.map((log: any) => `
              <tr class="item-row">
                <td><strong>${log.date || "N/A"}</strong></td>
                <td><strong>${log.involvedWorkers || "Not Specified"}</strong></td>
                <td>
                  <strong>Incident/What Happened:</strong><br/>
                  ${log.whatHappened || "N/A"}<br/><br/>
                  <strong>Specific Statements/Alleged Quotes Made:</strong><br/>
                  <span style="font-family: inherit; font-style: italic; color: #0f172a;">"${log.statementsMade || "None recorded."}"</span><br/><br/>
                  <strong>Questions for Retained Legal Counsel:</strong><br/>
                  <span style="color:#4f46e5; font-size:10.5px;">${log.questionsForCounsel || "No specific questions added."}</span>
                </td>
                <td>
                  <span style="display:inline-block; font-size:9.5px; font-weight:bold; padding:2px 6px; border-radius:4px;
                    ${log.hearsayFlag === 'Direct Evidence' ? 'background-color:#d1fae5; color:#065f46;' :
                      log.hearsayFlag === 'Hearsay (Worker told me)' ? 'background-color:#fee2e2; color:#991b1b;' :
                      'background-color:#fef3c7; color:#92400e;'}">
                    ${log.hearsayFlag}
                  </span>
                  ${log.audioPhotoLog ? `<br/><br/><strong style="font-size:9.5px;">Linked Proof:</strong><br/><span style="font-size:9.5px; color:#475569;">${log.audioPhotoLog}</span>` : ""}
                </td>
              </tr>
            `).join("")}
            ${evidenceLog.length === 0 ? `<tr><td colspan="4" style="text-align: center; color: #64748b;">No interactive interaction logs created yet.</td></tr>` : ""}
          </tbody>
        </table>
      `;
    } else if (activeBuilderTab === "issue-sheet") {
      title = "Issue Summary Sheet";
      bodyContent = `
        <div class="court-header">
          <div class="court-title">Assertions & Rebuttals Defenses Summary</div>
          <div class="jurisdiction">Court-Ready Issue Breakdown • Legal Aid & Private Counsel Workbook</div>
        </div>

        <div class="document-title">Discrepancy Audit & Defense Position Map</div>

        <div class="text-block">
          Use the side-by-side positioning index below to contrast social agency assertions directly against parent defense responses, linking direct evidentiary exhibits.
        </div>

        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 30%">Apposition Agency Allegation / Claim</th>
              <th style="width: 30%">Fact-Based Parent Defense Position</th>
              <th style="width: 20%">Exhibits / Primary Proof We Hold</th>
              <th style="width: 20%">Outstanding / Missing Evidence to Retrieve</th>
            </tr>
          </thead>
          <tbody>
            ${issueSheets.map((sheet: any) => `
              <tr class="item-row">
                <td style="color: #991b1b; font-weight: bold;">${sheet.agencyAssertion || "No claim listed."}</td>
                <td style="color: #166534; font-weight: 500;">${sheet.ourParentResponse || "No rebuttal entered."}</td>
                <td>${sheet.primaryEvidenceWeHave || "N/A"}</td>
                <td style="color: #4f46e5;">${sheet.missingEvidenceNeeded || "None requested."}</td>
              </tr>
            `).join("")}
            ${issueSheets.length === 0 ? `<tr><td colspan="4" style="text-align: center; color: #64748b;">No assertion-rebuttal sheets defined yet.</td></tr>` : ""}
          </tbody>
        </table>
      `;
    } else if (activeBuilderTab === "prep") {
      title = "Hearing Preparation Workbook";
      bodyContent = `
        <div class="court-header">
          <div class="court-title">Audience & Hearing Self-Preparation workbook</div>
          <div class="jurisdiction">Ontario Parent Empowerment Support Module</div>
        </div>

        <div class="document-title">Courtroom Preparation & Grounding Guide</div>

        <table class="court-box-table" style="margin-bottom: 25px;">
          <tr>
            <td>
              <strong>Next Scheduled Hearing Date:</strong><br/>
              <span style="font-size: 14px; font-weight: bold; color: #dc2626;">${prepSheet.nextHearingDate || "Not Set"}</span>
            </td>
            <td>
              <strong>Target Hearing Category:</strong><br/>
              <span style="font-size: 14px; font-weight: bold; color: #1e3a8a;">${prepSheet.hearingType || "Not Specified"}</span>
            </td>
          </tr>
        </table>

        <div class="section-header">1. Main Case Educational Goals (What the Judge Must Understand)</div>
        <div class="text-block">${prepSheet.mainEducationalGoals || "No goals drafted."}</div>

        <div class="section-header">2. Top Case Priorities for the Parent</div>
        <table class="data-table" style="width: 70%; margin: 10px 0 25px 0;">
          <thead>
            <tr>
              <th style="width: 15%">Rank</th>
              <th>Task Priorities / Legal Objectives</th>
            </tr>
          </thead>
          <tbody>
            ${(prepSheet.topThreePriorities || []).map((p: string, idx: number) => `
              <tr class="item-row">
                <td><strong># ${idx + 1}</strong></td>
                <td><strong>${p || "N/A"}</strong></td>
              </tr>
            `).join("")}
            ${(!prepSheet.topThreePriorities || prepSheet.topThreePriorities.length === 0) ? `<tr><td colspan="2" style="text-align: center; color: #64748b;">No priorities entered.</td></tr>` : ""}
          </tbody>
        </table>

        <div class="section-header">3. Self-Regulation & Personal Grounding Plan (Stress Management)</div>
        <div class="text-block">${prepSheet.mentalGroundingPlan || "No grounding notes listed."}</div>

        <div class="section-header">4. Courtroom Support Role Allocation</div>
        <div class="text-block">
          <strong>Identified Support Note-Taker:</strong> ${prepSheet.whoIsTakingNotes || "None assigned. Family member can sit in courtroom support desks."}
        </div>
      `;
    } else if (activeBuilderTab === "answer-33b") {
      title = "Form 33B Answer Draft";
      bodyContent = `
        <div class="court-header">
          <div class="court-title">Ontario Court of Justice (Family Branch)</div>
          <div class="jurisdiction">Province of Ontario, Canada • Family Law Rules</div>
          <div class="draft-notice">FORM 33B: ANSWER (CHILD PROTECTION) - EDUCATIONAL WORKBOOK DRAFT</div>
        </div>

        <table class="court-box-table">
          <tr>
            <td>
              <strong>Applicant (Children's Aid Society Name):</strong><br/>
              ${form33b.applicantName || "Children's Aid Society"}<br/><br/>
              <strong>Respondent Parent:</strong><br/>
              ${form33b.respondentName || "Not Specified"}<br/><br/>
              <strong>Date of Society's Application:</strong><br/>
              ${form33b.applicationDate || "Not Specified"}
            </td>
            <td>
              <strong>Court Registry Local Office:</strong><br/>
              ${form33b.courtRegistryName || "Not Specified"}<br/><br/>
              <strong>Court File Number (Case #):</strong><br/>
              ${form33b.caseNumber || "Not Specified"}<br/><br/>
              <strong>Subject Child(ren) names:</strong><br/>
              ${form33b.childNames || "Not Specified"}
            </td>
          </tr>
        </table>

        <div class="document-title">Respondent's Answer (Child Protection)</div>

        <div class="section-header">1. Respondent parent's legal claim details</div>
        <div class="text-block"><strong>Proposed Order Requested:</strong><br/>${form33b.claimDetails || "Not Specified"}</div>

        <div class="section-header">2. Agreed Statements of Fact</div>
        <div class="text-block">The Respondent Parent agrees with the following statements of fact made in the Society's application:<br/>${form33b.agreedFacts || "No specific agreed paragraphs listed."}</div>

        <div class="section-header">3. Disagreed CAS Assertions & Counter-Evidence (Rule 17 Reply Index)</div>
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 33%">CAS Allegation Statement</th>
              <th style="width: 33%">Parent Counter-Explanation (The Truth)</th>
              <th style="width: 34%">Direct Proof & Evidentiary Reference</th>
            </tr>
          </thead>
          <tbody>
            ${form33b.disagreedFacts.map((item: any) => `
              <tr class="item-row">
                <td style="color: #991b1b; font-weight: bold;">${item.societyStatement || "N/A"}</td>
                <td style="color: #166534; font-weight: 500;">${item.parentResponse || "N/A"}</td>
                <td>${item.supportingEvidence || "N/A"}</td>
              </tr>
            `).join("")}
            ${form33b.disagreedFacts.length === 0 ? `<tr><td colspan="3" style="text-align: center; color: #64748b;">No disagreed assertions listed.</td></tr>` : ""}
          </tbody>
        </table>

        <div class="section-header">4. Respondent Parent's Statement of Factual Circumstances (Omitted by Society)</div>
        <div class="text-block">${form33b.parentStatementOfFacts || "No additional factual statements entered."}</div>
      `;
    } else if (activeBuilderTab === "plan-of-care") {
      title = "Personalized Plan of Care";
      bodyContent = `
        <div class="court-header">
          <div class="court-title">ONTARIO CHILD PROTECTION PLAN OF CARE</div>
          <div class="jurisdiction">S.O. 2017, C. 14 SECTION 94 COMPLIANCE WORKBOOK</div>
          <div class="draft-notice">EDUCATIONAL DRAFT DESIGNED FOR COUNSEL CONSULTATION</div>
        </div>

        <table class="court-box-table" style="margin-bottom: 25px;">
          <tr>
            <td>
              <strong>Child(ren) Names:</strong><br/>
              <span style="font-size: 13px; font-weight: bold; color: #b91c1c;">${planOfCare.childName || "Not Entered"}</span>
            </td>
            <td>
              <strong>Birthdate & Age:</strong><br/>
              <span style="font-size: 13px; font-weight: bold; color: #1e3a8a;">${planOfCare.birthdate || "Not Entered"}</span>
            </td>
          </tr>
        </table>

        <div class="document-title">Parent's Personalized Plan of Care</div>

        <div class="section-header">1. Proposed Living & Placement Arrangements</div>
        <div class="text-block">${planOfCare.livingArrangements || "No housing plan details entered."}</div>

        <div class="section-header">2. Safety Protocols & Supervision Plan (Kinship Network)</div>
        <div class="text-block">${planOfCare.safetySupervision || "No safety/supervision protocols entered."}</div>

        <div class="section-header">3. Educational Goals & School Continuity</div>
        <div class="text-block">${planOfCare.educationNeeds || "No educational details entered."}</div>

        <div class="section-header">4. Healthcare, Dental & Pediatric Therapy Coordination</div>
        <div class="text-block">${planOfCare.healthcareDevelopment || "No health development schedules entered."}</div>

        <div class="section-header">5. Cultural Preservation & Heritage Connections</div>
        <div class="text-block">${planOfCare.cultureReligion || "No cultural or religious heritage activities entered."}</div>

        <div class="section-header">6. Parent-Child Bond preservation & Kinship Access Schedules</div>
        <div class="text-block">${planOfCare.contactAccessArrangements || "No access details entered."}</div>

        <div class="section-header">7. Active Parent Counseling & Positive Parenting Support Programs</div>
        <div class="text-block">${planOfCare.parentSupportServices || "No rehabilitation programs listed."}</div>
      `;
    }

    const htmlContent = `
      <html>
        <head>
          <title>${title} - OPA Educational Desk</title>
          ${sharedStyle}
        </head>
        <body>
          <button class="no-print-btn" onclick="window.print()">Print / Save as PDF</button>
          
          ${bodyContent}

          <div class="legal-notice">
            <strong>CRITICAL EDUCATIONAL FOOTNOTE NOTICE:</strong> This court-ready document represents a self-prepared draft workbook created strictly for child-protection education and parent legal counsel consultations. S.O. 2017, c. 14 compliant workspace. Do not execute or serve without professional screening by a licensed member of the Law Society of Ontario.
          </div>
          <div style="text-align:center; font-size:9.5px; color:#cbd5e1; margin-top:10px;">
            Generated via ParentShield PDF Export Suite. Primary statutes refreshed 2026.
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

  const handlePrint = () => {
    printTemplate();
  };

  return (
    <div className="space-y-8" id="templates-tab">
      {/* Handover Alert Banner */}
      {handoverDocName && (
        <div className="bg-emerald-50 border border-emerald-200 p-4.5 rounded-xl flex items-center justify-between gap-4 animate-fade-in text-left no-print shadow-3xs">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg shrink-0 mt-0.5">
              <CheckCircle className="w-4 h-4 text-emerald-600 animate-bounce" />
            </div>
            <div>
              <p className="font-display font-semibold text-emerald-900 text-xs md:text-sm">
                🎉 Forms Auto-Populated Successfully!
              </p>
              <p className="text-emerald-700 text-[11px] mt-0.5 leading-relaxed font-sans">
                We've successfully handed over the audited findings from <strong>{handoverDocName}</strong>. Your Form 33B Answer, Affidavit, and Plan of Care drafts have been pre-filled directly from the document's objections, timelines, and facts!
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setHandoverDocName(null)}
            className="text-emerald-600 hover:text-emerald-800 text-xs font-bold px-3 py-1 bg-white hover:bg-emerald-100/30 border border-emerald-200 rounded-lg cursor-pointer transition-all uppercase tracking-wider font-sans shrink-0"
          >
            Got it
          </button>
        </div>
      )}

      {/* Disclaimer on educational draft templates */}
      <div className="bg-amber-50 border-l-4 border-amber-500 p-5 rounded-r-xl shadow-xs" id="template-educational-disclaimer">
        <div className="flex gap-3">
          <Info className="text-amber-600 shrink-0 w-6 h-6" />
          <div>
            <h4 className="font-display font-medium text-amber-900 text-sm md:text-base">EDUCATIONAL TEMPLATES WARNING</h4>
            <p className="text-amber-800 text-xs md:text-sm mt-1 leading-relaxed">
              These auto-fill sheets generate **informally prepared educational drafts** to structure your thoughts and evidentiary indexes. **They are not court-ready legal filings.** Do not submit these directly to the court registry without your defense counsel's review and signature.
            </p>
          </div>
        </div>
      </div>

      {/* Builder Select tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3" id="builder-tabs-list">
        <button
          onClick={() => setActiveBuilderTab("affidavit")}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border cursor-pointer transition-all ${
            activeBuilderTab === "affidavit"
              ? "bg-brand-900 border-brand-950 text-white shadow-xs"
              : "bg-white hover:bg-gray-50 text-gray-700 border-gray-200"
          }`}
        >
          <Scale className="w-3.5 h-3.5" />
          <span>1. Affidavit Draft Builder</span>
        </button>

        <button
          onClick={() => setActiveBuilderTab("timeline")}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border cursor-pointer transition-all ${
            activeBuilderTab === "timeline"
              ? "bg-brand-900 border-brand-950 text-white shadow-xs"
              : "bg-white hover:bg-gray-50 text-gray-700 border-gray-200"
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>2. Factual Case Timeline</span>
          
        </button>

        <button
          onClick={() => setActiveBuilderTab("evidence-log")}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border cursor-pointer transition-all ${
            activeBuilderTab === "evidence-log"
              ? "bg-brand-900 border-brand-950 text-white shadow-xs"
              : "bg-white hover:bg-gray-50 text-gray-700 border-gray-200"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>3. Evidentiary Audit Log</span>
          
        </button>

        <button
          onClick={() => setActiveBuilderTab("issue-sheet")}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border cursor-pointer transition-all ${
            activeBuilderTab === "issue-sheet"
              ? "bg-brand-900 border-brand-950 text-white shadow-xs"
              : "bg-white hover:bg-gray-50 text-gray-700 border-gray-200"
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>4. CAS Allegations Reply</span>
          
        </button>

        <button
          onClick={() => setActiveBuilderTab("prep")}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border cursor-pointer transition-all ${
            activeBuilderTab === "prep"
              ? "bg-brand-900 border-brand-950 text-white shadow-xs"
              : "bg-white hover:bg-gray-50 text-gray-700 border-gray-200"
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>5. Hearing Preparation Sheet</span>
          
        </button>

        <button
          onClick={() => setActiveBuilderTab("answer-33b")}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border cursor-pointer transition-all ${
            activeBuilderTab === "answer-33b"
              ? "bg-brand-900 border-brand-950 text-white shadow-xs"
              : "bg-white hover:bg-gray-50 text-gray-700 border-gray-200"
          }`}
        >
          <Scale className="w-3.5 h-3.5 text-brand-500" />
          <span>6. Form 33B Answer</span>
          
        </button>

        <button
          onClick={() => setActiveBuilderTab("plan-of-care")}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border cursor-pointer transition-all ${
            activeBuilderTab === "plan-of-care"
              ? "bg-brand-900 border-brand-950 text-white shadow-xs"
              : "bg-white hover:bg-gray-50 text-gray-700 border-gray-200"
          }`}
        >
          <Heart className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
          <span>7. Personalized Plan of Care</span>
          
        </button>
      </div>

      {/* Persistent Draft Recovery Banner */}
      {showRecoveryBanner && (
        <div className="bg-brand-50 border border-brand-200/80 p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-fade-in text-left no-print" id="draft-recovery-status-banner">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-brand-100 text-brand-700 rounded-lg shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4 text-brand-600" />
            </div>
            <div>
              <p className="font-display font-semibold text-brand-900 text-xs md:text-sm">
                Saved Draft Restored
              </p>
              <p className="text-brand-700 text-[11px] mt-0.5 leading-relaxed font-sans">
                We've recovered your pre-saved draft from browser storage {parsedProg?.lastSaved ? `(recorded ${new Date(parsedProg.lastSaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })})` : "from your last session"}. Safe local caching persists even on refresh.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => setShowRecoveryBanner(false)}
              className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-brand-200 text-brand-800 text-xs font-semibold rounded-lg cursor-pointer transition-all"
            >
              Keep Editing
            </button>
            <button
              type="button"
              onClick={() => {
                if (!bannerResetConfirm) {
                  setBannerResetConfirm(true);
                  setTimeout(() => setBannerResetConfirm(false), 3000);
                } else {
                  resetAll();
                }
              }}
              className={`px-3 py-1.5 ${bannerResetConfirm ? "bg-red-600 text-white" : "bg-rose-50 hover:bg-rose-100 text-rose-700"} border border-rose-150 text-xs font-semibold rounded-lg cursor-pointer transition-all`}
            >
              {bannerResetConfirm ? "Click to Confirm Wipe" : "Start Fresh"}
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace Frame container */}
      <div className="bg-white rounded-2xl border border-gray-150 p-6 md:p-8 text-left shadow-2xs relative print-card" id="builder-workspace">
        
        {/* Dynamic Tool Actions (eg Print/Download) */}

        {/* Auto-fill Legend */}
        <div className="no-print mt-2 mb-6 flex flex-wrap items-center gap-3 text-[10px] font-mono border-b border-gray-150 pb-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse border border-emerald-600"></span>
            <span className="text-slate-500">Green = Successfully Auto-filled</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse border border-amber-600"></span>
            <span className="text-slate-500">Yellow = Requires Manual Parent Input</span>
          </div>
        </div>
        <div className="no-print absolute top-6 right-6 flex flex-wrap items-center gap-2">
          {/* Active Session status & manual save controller */}
          <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl p-1 border border-slate-200">
            <span className="text-[9px] text-slate-500 font-mono pl-1.5 shrink-0 flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${
                isAutoSaving 
                  ? "bg-amber-500 animate-pulse" 
                  : saveStatus 
                    ? "bg-brand-500 animate-bounce" 
                    : "bg-emerald-500 animate-pulse"
              }`} />
              {isAutoSaving 
                ? "Saving..." 
                : saveStatus 
                  ? saveStatus 
                  : "Auto-saved Device Draft"}
            </span>

            <button
              onClick={saveToCloud}
              disabled={isSavingToCloud}
              className="px-1.5 py-0.5 bg-purple-50 hover:bg-purple-100 text-purple-700 font-sans font-bold text-[9px] rounded cursor-pointer border border-purple-200 uppercase tracking-wide flex items-center gap-0.5 transition-all hover:shadow-2xs animate-fade-in disabled:opacity-50"
              title="Save to your account in the cloud"
            >
              {isSavingToCloud ? <Loader2 className="w-2.5 h-2.5 text-purple-600 animate-spin" /> : <CloudUpload className="w-2.5 h-2.5 text-purple-600" />}
              Cloud Save
            </button>
            <button
              onClick={saveProgress}
              className="px-1.5 py-0.5 bg-white hover:bg-slate-50 text-slate-700 font-sans font-bold text-[9px] rounded cursor-pointer border border-slate-200 uppercase tracking-wide flex items-center gap-0.5 transition-all hover:shadow-2xs animate-fade-in"
              title="Save all changes securely to browser storage"
            >
              <Save className="w-2.5 h-2.5 text-brand-600" />
              Save Progress
            </button>

            

            <button
              type="button"
              onClick={() => {
                if (!resetConfirm) {
                  setResetConfirm(true);
                  setTimeout(() => setResetConfirm(false), 3000);
                } else {
                  resetAll();
                }
              }}
              className={`px-1 py-0.5 ${resetConfirm ? "bg-red-500 text-white" : "bg-transparent hover:bg-rose-50 text-slate-400 hover:text-red-600"} rounded text-[8px] font-mono cursor-pointer uppercase transition-colors`}
              title="Wipe worksheets draft cache"
            >
              {resetConfirm ? "Confirm" : "Reset"}
            </button>
          </div>

          <button
            onClick={handlePrint}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 hover:bg-brand-700 text-white text-xs font-medium rounded-lg cursor-pointer transition-colors shadow-2xs"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print / Save as PDF</span>
          </button>
        </div>

            {/* 1. AFFIDAVIT DRAFT BUILDER */}
            {activeBuilderTab === "affidavit" && (
          <div className="space-y-6" id="affidavit-workspace">
            <div>
              <h3 className="font-display text-lg font-bold text-gray-900">Ontario Protection Draft Affidavit</h3>
              <p className="text-xs text-slate-600 mt-1">This builder matches the structure of Form 14A. Fill blocks below to organize factual sequences.</p>
            </div>

            {/* Registry Info Columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">Ontario Registry Name</label>
                <input
                  type="text"
                  value={affidavit.courtRegistryName}
                  onChange={(e) => setAffidavit({ ...affidavit, courtRegistryName: e.target.value })}
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(affidavit.courtRegistryName)}`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">Applicant (CAS Agency)</label>
                <input
                  type="text"
                  value={affidavit.applicantName}
                  onChange={(e) => setAffidavit({ ...affidavit, applicantName: e.target.value })}
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(affidavit.applicantName)}`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">Respondent (Your Name & Title)</label>
                <input
                  type="text"
                  value={affidavit.respondentName}
                  onChange={(e) => setAffidavit({ ...affidavit, respondentName: e.target.value })}
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(affidavit.respondentName)}`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">Child Name and Birthdate</label>
                <input
                  type="text"
                  value={affidavit.childNames}
                  onChange={(e) => setAffidavit({ ...affidavit, childNames: e.target.value })}
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(affidavit.childNames)}`}
                />
              </div>
            </div>

            {/* Narrative Preamble */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">Background Statement (Solemn Oath)</label>
              <textarea
                value={affidavit.backgroundStatement}
                onChange={(e) => setAffidavit({ ...affidavit, backgroundStatement: e.target.value })}
                rows={3}
                className={`border w-full   text-xs p-3 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(affidavit.backgroundStatement)}`}
              />
            </div>

            {/* Events loop with Hearsay Warnings */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-800 uppercase tracking-wide block">Factual Chronological Statements</span>
                <button
                  type="button"
                  onClick={() => {
                    const updatedEvents = [...(affidavit.factualEvents || []), {
                      date: "",
                      time: "",
                      eventDescription: "",
                      unsupportedOrHearsayWarn: false,
                      witnessesOrEvidence: ""
                    }];
                    setAffidavit({ ...affidavit, factualEvents: updatedEvents });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1 bg-brand-50 hover:bg-brand-100 text-brand-900 border border-brand-200 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-brand-600" />
                  <span>Add Affidavit Statement Block</span>
                </button>
              </div>
              
              <div className="space-y-4">
                {(affidavit.factualEvents || []).map((evt, idx) => (
                  <div key={idx} className="p-4 border border-gray-200 rounded-xl space-y-3 relative bg-slate-50/20">
                    <button
                      type="button"
                      onClick={() => {
                        const updated = affidavit.factualEvents.filter((_, i) => i !== idx);
                        setAffidavit({ ...affidavit, factualEvents: updated });
                      }}
                      className="absolute top-3 right-3 text-rose-500 hover:text-rose-700 p-1 rounded-md hover:bg-rose-50 border border-transparent hover:border-rose-100 transition-all cursor-pointer"
                      title="Delete event statement"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-gray-150 pb-2">
                      <div className="text-xs font-semibold text-slate-600 flex items-center">Event Statement #{idx + 1}</div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-500 font-bold uppercase shrink-0">Date</span>
                        <input
                          type="text"
                          value={evt.date || ""}
                          placeholder="YYYY-MM-DD"
                          onChange={(e) => {
                            const updated = [...affidavit.factualEvents];
                            updated[idx] = { ...updated[idx], date: e.target.value };
                            setAffidavit({ ...affidavit, factualEvents: updated });
                          }}
                          className={`border w-full   text-xs px-2 py-1 rounded focus:outline-none transition-colors ${getHighlightClass(evt.date || "")}`}
                        />
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-500 font-bold uppercase shrink-0">Hearsay Indicator</span>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...affidavit.factualEvents];
                            updated[idx] = { ...updated[idx], unsupportedOrHearsayWarn: !evt.unsupportedOrHearsayWarn };
                            setAffidavit({ ...affidavit, factualEvents: updated });
                          }}
                          className={`px-2 py-1 rounded text-[10px] capitalize font-mono font-bold border transition-colors cursor-pointer w-full text-center ${
                            evt.unsupportedOrHearsayWarn 
                              ? "bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100" 
                              : "bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100"
                          }`}
                        >
                          {evt.unsupportedOrHearsayWarn ? "⚠ Hearsay Warning ACTIVE" : "✓ Direct Personal Proof"}
                        </button>
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">Factual Narrative Statement (Omit opinions, state exact physical times and actions)</span>
                      <textarea
                        value={evt.eventDescription || ""}
                        placeholder="On 2026-06-15 at 14:00, worker Smith arrived in the home room..."
                        rows={3}
                        onChange={(e) => {
                          const updated = [...affidavit.factualEvents];
                          const txt = e.target.value;
                          const hasHearsayKeywords = /\b(said that|told me|informed me|heard that|according to|stated that|worker said)\b/i.test(txt);
                          updated[idx] = { 
                            ...updated[idx], 
                            eventDescription: txt,
                            unsupportedOrHearsayWarn: hasHearsayKeywords ? true : updated[idx].unsupportedOrHearsayWarn
                          };
                          setAffidavit({ ...affidavit, factualEvents: updated });
                        }}
                        className={`border w-full   text-xs p-3 rounded-lg focus:outline-none   leading-relaxed transition-colors ${getHighlightClass(evt.eventDescription || "")}`}
                      />
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">Supporting Verification / Exhibits / Witnesses</span>
                      <input
                        type="text"
                        value={evt.witnessesOrEvidence || ""}
                        placeholder="E.g., Text messages from Smith (Exhibit A), Aunt Martha was present..."
                        onChange={(e) => {
                          const updated = [...affidavit.factualEvents];
                          updated[idx] = { ...updated[idx], witnessesOrEvidence: e.target.value };
                          setAffidavit({ ...affidavit, factualEvents: updated });
                        }}
                        className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(evt.witnessesOrEvidence || "")}`}
                      />
                    </div>

                    {/* Educational Helper Tip Box */}
                    {evt.unsupportedOrHearsayWarn && (
                      <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-lg text-[11px] text-amber-900 leading-normal flex gap-2">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5 animate-pulse" />
                        <span>This statement has been flagged with a <strong>Hearsay Warning</strong>. If this refers to statements where another individual described things to you, it must be backed by their separate direct witness affidavit to remain admissible under Ontario family evidence rules.</span>
                      </div>
                    )}
                  </div>
                ))}

                {(affidavit.factualEvents || []).length === 0 && (
                  <div className="p-8 border border-dashed rounded-xl text-center text-xs text-slate-500">
                    No chronological factual statements added yet. Click "+ Add Affidavit Statement Block" to draft items.
                  </div>
                )}
              </div>
            </div>

            {/* Child perspective & Proposed arrangements */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">The Child's Perspective (Emotional attachment)</label>
                <textarea
                  value={affidavit.childsPerspectiveText}
                  onChange={(e) => setAffidavit({ ...affidavit, childsPerspectiveText: e.target.value })}
                  rows={4}
                  className={`border w-full   text-xs p-3 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(affidavit.childsPerspectiveText)}`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">Proposed Parenting / Safekeeping Plan</label>
                <textarea
                  value={affidavit.proposedCareArrangement}
                  onChange={(e) => setAffidavit({ ...affidavit, proposedCareArrangement: e.target.value })}
                  rows={4}
                  className={`border w-full   text-xs p-3 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(affidavit.proposedCareArrangement)}`}
                />
              </div>
            </div>
          </div>
        )}

        {/* 2. CASE TIMELINE BUILDER */}
        {activeBuilderTab === "timeline" && (
          <div className="space-y-6" id="timeline-workspace">
            <div>
              <h3 className="font-display text-lg font-bold text-gray-900">Custom Case Timeline Tracker</h3>
              <p className="text-xs text-slate-600 mt-1">Trace critical events Chronologically to cross-verify mandatory Statutory time ceilings.</p>
            </div>

            <div className="space-y-3">
              {timelineItems.map((item, index) => (
                <div key={item.id} className="p-5 border border-gray-150 rounded-xl flex flex-col justify-between gap-4 bg-slate-50/40 relative">
                  
                  {/* Row 1: Date Input and Step Type Switcher */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-150 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold font-mono text-slate-500">Date/Time</span>
                      <input
                        type="text"
                        value={item.date || ""}
                        placeholder="E.g., 2026-06-15"
                        onChange={(e) => {
                          const updated = [...timelineItems];
                          updated[index] = { ...updated[index], date: e.target.value };
                          setTimelineItems(updated);
                        }}
                        className={`border rounded px-2 py-1 text-xs focus:outline-none   font-mono w-32 transition-colors ${getHighlightClass(item.date || "")}`}
                      />
                    </div>
                    
                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...timelineItems];
                        updated[index] = { ...updated[index], isCourtDate: !item.isCourtDate };
                        setTimelineItems(updated);
                      }}
                      className={`px-3 py-1 rounded text-[11px] font-mono font-bold hover:shadow-2xs transition-all ${
                        item.isCourtDate 
                          ? "bg-brand-100 text-brand-800 border border-brand-200" 
                          : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                      }`}
                    >
                      {item.isCourtDate ? "⚖️ Court Date (Click to Swap)" : "📋 Incident / Observation (Click to Swap)"}
                    </button>
                  </div>

                  {/* Row 2: Title and Description Fields */}
                  <div className="space-y-3 text-left w-full">
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">Milestone/Event Title</span>
                      <input
                        type="text"
                        value={item.title || ""}
                        placeholder="E.g., Supervised visit completed, CAS filed warrant application..."
                        onChange={(e) => {
                          const updated = [...timelineItems];
                          updated[index] = { ...updated[index], title: e.target.value };
                          setTimelineItems(updated);
                        }}
                        className={`border w-full   font-display font-semibold text-gray-900 text-sm px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(item.title || "")}`}
                      />
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">Factual Chronology Narrative Details</span>
                      <textarea
                        value={item.description || ""}
                        placeholder="Detail the factual observations, behaviors, or files received..."
                        rows={3}
                        onChange={(e) => {
                          const updated = [...timelineItems];
                          updated[index] = { ...updated[index], description: e.target.value };
                          setTimelineItems(updated);
                        }}
                        className={`border w-full   text-xs text-gray-650 p-3 rounded-lg focus:outline-none   leading-relaxed transition-colors ${getHighlightClass(item.description || "")}`}
                      />
                    </div>
                  </div>

                  {/* Row 3: Action Required and Statutory Deadline */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    <div className="bg-brand-50/50 p-2.5 rounded-xl border border-brand-100 flex items-center gap-2 text-xs">
                      <span className="text-brand-900 font-bold shrink-0">Action Items:</span>
                      <input
                        type="text"
                        value={item.actionRequired || ""}
                        placeholder="What needs to be done next? (e.g. obtain photos)..."
                        onChange={(e) => {
                          const updated = [...timelineItems];
                          updated[index] = { ...updated[index], actionRequired: e.target.value };
                          setTimelineItems(updated);
                        }}
                        className={`border w-full bg-transparent border-none text-xs text-slate-800 focus:outline-none transition-colors ${getHighlightClass(item.actionRequired || "")}`}
                      />
                    </div>

                    <div className="bg-amber-50/50 p-2.5 rounded-xl border border-amber-100 flex items-center gap-2 text-xs">
                      <span className="text-amber-900 font-bold shrink-0">Rule Limit:</span>
                      <input
                        type="text"
                        value={item.statutoryDeadline || ""}
                        placeholder="E.g., 5-day warrant limit, 30 days max (optional)..."
                        onChange={(e) => {
                          const updated = [...timelineItems];
                          updated[index] = { ...updated[index], statutoryDeadline: e.target.value };
                          setTimelineItems(updated);
                        }}
                        className={`border w-full bg-transparent border-none text-xs text-slate-800 focus:outline-none font-mono transition-colors ${getHighlightClass(item.statutoryDeadline || "")}`}
                      />
                    </div>
                  </div>

                  {/* Absolute Trash Button top-right */}
                  <div className="no-print absolute top-3 right-3 shrink-0">
                    <button
                      onClick={() => removeTimelineItem(item.id)}
                      className="p-1.5 border border-rose-200 hover:border-rose-400 text-rose-500 hover:text-rose-700 bg-white hover:bg-rose-50 rounded-full cursor-pointer transition-colors"
                      title="Remove event"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="no-print flex justify-start">
              <button
                onClick={addTimelineItem}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Insert Next Case Event</span>
              </button>
            </div>
          </div>
        )}

        {/* 3. EVIDENCE LOG BUILDER */}
        {activeBuilderTab === "evidence-log" && (
          <div className="space-y-6" id="evidence-log-workspace">
            <div>
              <h3 className="font-display text-lg font-bold text-gray-900">Evidentiary Audit Diary</h3>
              <p className="text-xs text-slate-600 mt-1">Keep an accurate daily journal of interactions with CAS representatives to avoid unrecorded allegations.</p>
            </div>

            {/* AI-Powered Voice Dictation & Structuring Panel */}
            <div className="no-print bg-gradient-to-br from-brand-50/70 via-white to-slate-50 border border-brand-150 rounded-2xl p-5 md:p-6 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-brand-600 text-white rounded-xl shadow-xs">
                    <Sparkles className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="font-display font-bold text-gray-900 text-sm md:text-md">AI-Powered Verbal Diary & Info Extractor</h4>
                    <p className="text-[11px] text-slate-600 mt-0.5">Quickly dictate or type accounts to auto-populate structured files containing times, quotes, and legal notes.</p>
                  </div>
                </div>
                
                <span className="px-2 py-0.5 rounded-full border border-brand-200 bg-brand-50 text-brand-750 font-mono text-[9px] font-extrabold uppercase">
                  Premium Assist active
                </span>
              </div>

              {/* Dictation Box Controls */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-4 flex flex-col justify-between p-4 bg-white border border-gray-150 rounded-xl space-y-3">
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wide block">Recording Status</span>
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${isRecording ? "bg-red-500 animate-ping" : "bg-gray-300"}`} />
                      <span className="text-xs font-semibold text-gray-700">
                        {isRecording ? "Recording Audio..." : "Microphone Idle"}
                      </span>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-600 leading-relaxed">
                    Speak clearly about the date, caseworker name, direct verbal quotes, and physical evidence observed (e.g. "On Friday, caseworker Sarah F. arrived at 2 PM. She alleged my house was untidy. I answered that we are currently teething.").
                  </div>

                  <div className="flex gap-2">
                    {!isRecording ? (
                      <button
                        onClick={startRecording}
                        className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold cursor-pointer shadow-2xs hover:shadow-xs transition-all duration-150 group"
                      >
                        <Mic className="w-4 h-4 text-white group-hover:scale-110 transition-transform" />
                        <span>Dictate Narrative</span>
                      </button>
                    ) : (
                      <button
                        onClick={stopRecording}
                        className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold cursor-pointer animate-pulse shadow-2xs hover:shadow-xs transition-all duration-150"
                      >
                        <Square className="w-4 h-4 fill-white text-white" />
                        <span>Stop Voice Input</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Live Transcript Edit Field */}
                <div className="lg:col-span-8 flex flex-col space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wide">Live Dictation Transcript & Narrative Text</span>
                    <button
                      onClick={() => setTranscript("")}
                      disabled={!transcript}
                      className="text-[10px] font-mono text-slate-500 hover:text-slate-700 font-bold disabled:opacity-30 disabled:pointer-events-none uppercase tracking-wide"
                    >
                      Clear Text
                    </button>
                  </div>

                  <textarea
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder="Transcription generates here in real-time as you dictate. You can also edit, type, or paste details into this text field freely before processing."
                    className={`border flex-1 min-h-[140px]   p-3 text-xs leading-relaxed rounded-xl focus:outline-none   resize-none transition-colors ${getHighlightClass(transcript)}`}
                  />

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={handleAIExtract}
                      disabled={isExtracting || !transcript.trim()}
                      className="flex items-center gap-2 py-2 px-4 bg-slate-900 border border-slate-950 text-white disabled:bg-slate-100 disabled:text-slate-500 disabled:border-transparent rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer enabled:hover:bg-slate-800 disabled:cursor-not-allowed group"
                    >
                      {isExtracting ? (
                        <>
                          <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
                          <span>Extracting details...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-brand-400 group-hover:scale-110 transition-transform" />
                          <span>Generate & Structured Export</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Warnings and errors logs display inside visual container */}
              {voiceError && (
                <div className="p-3 bg-red-55/70 border border-red-150 rounded-xl text-xs text-red-900 leading-normal flex items-start gap-2.5 animate-fadeIn">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span className="flex-1">{voiceError}</span>
                </div>
              )}

              {extractionSuccess && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-150 rounded-xl text-xs text-emerald-950 leading-relaxed flex items-start gap-2.5 animate-fadeIn">
                  <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-bold font-display block mb-0.5">Extraction Success</span>
                    <span>{extractionSuccess}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {evidenceLog.map((log, idx) => (
                <div key={log.id} className="p-5 border border-gray-150 rounded-2xl bg-white shadow-2xs space-y-4">
                  <div className="flex flex-wrap justify-between items-center gap-2 border-b pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-600 font-mono">Entry #{idx + 1}</span>
                      <span className="text-xs px-2.5 py-0.5 rounded bg-brand-50 border text-brand-800 font-semibold font-mono">
                        {log.date || "YY-MM-DD"}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-slate-600">Credibility Weight Classification:</span>
                      <select
                        value={log.hearsayFlag}
                        onChange={(e) => {
                          const updated = [...evidenceLog];
                          updated[idx] = { ...updated[idx], hearsayFlag: e.target.value as any };
                          setEvidenceLog(updated);
                        }}
                        className="text-xs border rounded-lg bg-slate-50 px-2 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      >
                        <option value="Direct Evidence">Direct Fact (I observed/filmed)</option>
                        <option value="Hearsay (Worker told me)">Hearsay (Another person said)</option>
                        <option value="Double Hearsay (Worker said another said)">Double Hearsay (A told B told C)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">Involved CAS Workers</span>
                      <input
                        type="text"
                        value={log.involvedWorkers}
                        placeholder="Caseworker Sarah F., Supervisor Miller..."
                        onChange={(e) => {
                          const updated = [...evidenceLog];
                          updated[idx] = { ...updated[idx], involvedWorkers: e.target.value };
                          setEvidenceLog(updated);
                        }}
                        className={`border w-full   text-xs px-2.5 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(log.involvedWorkers)}`}
                      />
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">Audio / Image Logs</span>
                      <input
                        type="text"
                        value={log.audioPhotoLog || ""}
                        placeholder="Voice clip 14:35.mp3, clean fridge photograph..."
                        onChange={(e) => {
                          const updated = [...evidenceLog];
                          updated[idx] = { ...updated[idx], audioPhotoLog: e.target.value };
                          setEvidenceLog(updated);
                        }}
                        className={`border w-full   text-xs px-2.5 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(log.audioPhotoLog || "")}`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">Direct Factual Observations</span>
                      <textarea
                        value={log.whatHappened}
                        rows={3}
                        placeholder="Detail exactly what behaviors occurred, what resources were loaded..."
                        onChange={(e) => {
                          const updated = [...evidenceLog];
                          updated[idx] = { ...updated[idx], whatHappened: e.target.value };
                          setEvidenceLog(updated);
                        }}
                        className={`border w-full   text-xs p-2.5 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(log.whatHappened)}`}
                      />
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">Explicit Quotes & Statements Heard</span>
                      <textarea
                        value={log.statementsMade}
                        rows={3}
                        placeholder="Detail who stated what, utilizing precise quotation records..."
                        onChange={(e) => {
                          const updated = [...evidenceLog];
                          updated[idx] = { ...updated[idx], statementsMade: e.target.value };
                          setEvidenceLog(updated);
                        }}
                        className={`border w-full   text-xs p-2.5 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(log.statementsMade)}`}
                      />
                    </div>
                  </div>

                  <div className="bg-brand-50/40 p-2.5 rounded-xl border border-brand-100/60 flex items-start gap-2 text-xs">
                    <span className="text-brand-700 font-semibold font-mono">Q for Attorney:</span>
                    <input
                      type="text"
                      value={log.questionsForCounsel}
                      placeholder="Can I submit direct proof showing this is factually untrue?"
                      onChange={(e) => {
                        const updated = [...evidenceLog];
                        updated[idx] = { ...updated[idx], questionsForCounsel: e.target.value };
                        setEvidenceLog(updated);
                      }}
                      className={`border w-full bg-transparent border-none text-xs focus:outline-none text-slate-800 transition-colors ${getHighlightClass(log.questionsForCounsel)}`}
                    />
                  </div>

                  <div className="no-print pt-2 flex justify-end">
                    <button
                      onClick={() => removeEvidenceLogItem(log.id)}
                      className="flex items-center gap-1 px-3 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-lg border border-rose-200 cursor-pointer"
                    >
                      <Trash className="w-3.5 h-3.5" />
                      <span>Remove log entry</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="no-print flex justify-start">
              <button
                onClick={addEvidenceLogItem}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add Custom Log Block</span>
              </button>
            </div>
          </div>
        )}

        {/* 4. ISSUE SUMMARY SHEET */}
        {activeBuilderTab === "issue-sheet" && (
          <div className="space-y-6" id="issue-sheet-workspace">
            <div>
              <h3 className="font-display text-lg font-bold text-gray-900">CAS Allegation Response Index</h3>
              <p className="text-xs text-slate-600 mt-1">Isolate each child welfare claim individually to match it against physical receipts, calendars, and doctors' logs.</p>
            </div>

            <div className="space-y-4">
              {issueSheets.map((item, index) => (
                <div key={item.id} className="p-5 border rounded-2xl bg-slate-50/30 space-y-4">
                  <div className="flex justify-between items-center pb-2 border-b">
                    <span className="text-xs font-bold text-slate-650 font-mono">Assertion Case #{index + 1}</span>
                    <button
                      onClick={() => removeIssueSheet(item.id)}
                      className="text-rose-600 text-xs font-bold hover:underline cursor-pointer"
                    >
                      Remove row
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">1. Adverse Agency Assertion (What CAS Claims)</span>
                      <textarea
                        value={item.agencyAssertion}
                        rows={2}
                        placeholder="CAS claims the child missed preschool three times..."
                        onChange={(e) => {
                          const updated = [...issueSheets];
                          updated[index] = { ...updated[index], agencyAssertion: e.target.value };
                          setIssueSheets(updated);
                        }}
                        className={`border w-full   text-xs p-2.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(item.agencyAssertion)}`}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">2. Our Factual Reply (What really happened)</span>
                      <textarea
                        value={item.ourParentResponse}
                        rows={2}
                        placeholder="Child had clinical teething hives, pediatric advice was home containment..."
                        onChange={(e) => {
                          const updated = [...issueSheets];
                          updated[index] = { ...updated[index], ourParentResponse: e.target.value };
                          setIssueSheets(updated);
                        }}
                        className={`border w-full   text-xs p-2.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(item.ourParentResponse)}`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">3. Direct Evidence / Proof elements we hold</span>
                      <textarea
                        value={item.primaryEvidenceWeHave}
                        rows={2}
                        placeholder="Doctor emails, clinical notes from clinic..."
                        onChange={(e) => {
                          const updated = [...issueSheets];
                          updated[index] = { ...updated[index], primaryEvidenceWeHave: e.target.value };
                          setIssueSheets(updated);
                        }}
                        className={`border w-full   text-xs p-2.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(item.primaryEvidenceWeHave)}`}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block">4. Gaps in Evidence (What we still need to fetch)</span>
                      <textarea
                        value={item.missingEvidenceNeeded}
                        rows={2}
                        placeholder="Preschool sign-off records, pharmacy receipts..."
                        onChange={(e) => {
                          const updated = [...issueSheets];
                          updated[index] = { ...updated[index], missingEvidenceNeeded: e.target.value };
                          setIssueSheets(updated);
                        }}
                        className={`border w-full   text-xs p-2.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(item.missingEvidenceNeeded)}`}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="no-print flex justify-start">
              <button
                onClick={addIssueSheet}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Link Another Allegation</span>
              </button>
            </div>
          </div>
        )}

        {/* 5. HEARING PREPARATION WORKSHEET */}
        {activeBuilderTab === "prep" && (
          <div className="space-y-6" id="prep-workspace">
            <div>
              <h3 className="font-display text-lg font-bold text-gray-900">Ontario Hearing Preparation Checklist</h3>
              <p className="text-xs text-slate-600 mt-1">Familiarize with court limits, outline personal goals, and manage emotional grounding rules before entry.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">Target Hearing Date</label>
                <input
                  type="date"
                  value={prepSheet.nextHearingDate}
                  onChange={(e) => setPrepSheet({ ...prepSheet, nextHearingDate: e.target.value })}
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(prepSheet.nextHearingDate)}`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">Hearing Type (Rule 14 / Rule 17)</label>
                <input
                  type="text"
                  value={prepSheet.hearingType}
                  onChange={(e) => setPrepSheet({ ...prepSheet, hearingType: e.target.value })}
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(prepSheet.hearingType)}`}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">Our Primary Educational Aims in this Hearing</label>
                <textarea
                  value={prepSheet.mainEducationalGoals}
                  rows={2}
                  onChange={(e) => setPrepSheet({ ...prepSheet, mainEducationalGoals: e.target.value })}
                  className={`border w-full   text-xs p-3 rounded-lg focus:outline-none transition-colors ${getHighlightClass(prepSheet.mainEducationalGoals)}`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">Top Priority Actions (Max 3 items)</label>
                <div className="space-y-2">
                  {prepSheet.topThreePriorities.map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <span className="text-xs font-mono font-bold text-slate-600">#{idx + 1}</span>
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => {
                          const updated = [...prepSheet.topThreePriorities];
                          updated[idx] = e.target.value;
                          setPrepSheet({ ...prepSheet, topThreePriorities: updated });
                        }}
                        className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(item)}`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">Tactical Grounding Strategy (Stress management)</label>
                  <textarea
                    value={prepSheet.mentalGroundingPlan}
                    rows={3}
                    onChange={(e) => setPrepSheet({ ...prepSheet, mentalGroundingPlan: e.target.value })}
                    className={`border w-full   text-xs p-3 rounded-lg focus:outline-none transition-colors ${getHighlightClass(prepSheet.mentalGroundingPlan)}`}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">Designated Note-taker (Family backup inside courtroom)</label>
                  <input
                    type="text"
                    value={prepSheet.whoIsTakingNotes}
                    onChange={(e) => setPrepSheet({ ...prepSheet, whoIsTakingNotes: e.target.value })}
                    className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(prepSheet.whoIsTakingNotes)}`}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 6. FORM 33B ANSWER (CHILD PROTECTION) */}
        {activeBuilderTab === "answer-33b" && (
          <div className="space-y-6 animate-fade-in" id="answer-33b-workspace">
            <div className="border-b border-gray-150 pb-4">
              <span className="text-[10px] font-mono font-black tracking-widest text-brand-600 block uppercase">FORM 33B • ONTARIO COURT RULES</span>
              <h3 className="font-display text-xl font-bold text-slate-950 mt-1">Answer (Child Protection)</h3>
              <p className="text-xs text-slate-600 mt-1 font-sans">
                Respond paragraph-by-paragraph to the Children's Aid Society's protection assertions, record agreed facts, and state your legal claim/counter-proposals.
              </p>
            </div>

            {/* Part 1: Parties and Metadata */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">Court Registry Location</label>
                <input
                  type="text"
                  value={form33b.courtRegistryName}
                  onChange={(e) => setForm33b({ ...form33b, courtRegistryName: e.target.value })}
                  placeholder="e.g. Ontario Court of Justice (Toronto)"
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(form33b.courtRegistryName)}`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">Court File Number (Case #)</label>
                <input
                  type="text"
                  value={form33b.caseNumber}
                  onChange={(e) => setForm33b({ ...form33b, caseNumber: e.target.value })}
                  placeholder="e.g. CP-1234-26"
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(form33b.caseNumber)}`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">Applicant Name (Society)</label>
                <input
                  type="text"
                  value={form33b.applicantName}
                  onChange={(e) => setForm33b({ ...form33b, applicantName: e.target.value })}
                  placeholder="e.g. Children's Aid Society of Toronto"
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(form33b.applicantName)}`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">Respondent Name (Parent/Guardian)</label>
                <input
                  type="text"
                  value={form33b.respondentName}
                  onChange={(e) => setForm33b({ ...form33b, respondentName: e.target.value })}
                  placeholder="e.g. Jane Doe"
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(form33b.respondentName)}`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">Child(ren) Names & Birthdates</label>
                <input
                  type="text"
                  value={form33b.childNames}
                  onChange={(e) => setForm33b({ ...form33b, childNames: e.target.value })}
                  placeholder="e.g. Lucas Doe (DOB: June 12, 2018)"
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(form33b.childNames)}`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">Date of Society's Protection Application</label>
                <input
                  type="date"
                  value={form33b.applicationDate}
                  onChange={(e) => setForm33b({ ...form33b, applicationDate: e.target.value })}
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(form33b.applicationDate)}`}
                />
              </div>
            </div>

            {/* Part 2: Respondent Claim & Agreed Facts */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">Respondent's Custody/Care Claim Details</label>
                  <span className="text-[8px] bg-brand-50 text-brand-700 px-1.5 py-0.5 rounded font-mono font-bold">Rule 17 / Section 94 CYFSA</span>
                </div>
                <textarea
                  value={form33b.claimDetails}
                  onChange={(e) => setForm33b({ ...form33b, claimDetails: e.target.value })}
                  rows={3}
                  className={`border w-full   text-xs p-3 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(form33b.claimDetails)}`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">Agreed Statements of Fact (Paragraphs agreed with in CAS App)</label>
                <textarea
                  value={form33b.agreedFacts}
                  onChange={(e) => setForm33b({ ...form33b, agreedFacts: e.target.value })}
                  placeholder="Respondent agrees with paragraphs 1, 2, and 4 regarding children's placement, school enrollment, and immunization history."
                  rows={2.5}
                  className={`border w-full   text-xs p-3 rounded-lg focus:outline-none transition-colors ${getHighlightClass(form33b.agreedFacts)}`}
                />
              </div>
            </div>

            {/* Part 3: Interactive Disagreements List with Auto-Load capability */}
            <div className="space-y-4 border-t border-dashed pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Disagreed Society Assertions & Counter-Evidence</h4>
                  <p className="text-[10px] text-slate-600 font-sans">List and debunk specific paragraphs of the CAS application using direct evidence audits.</p>
                </div>
                <button
                  onClick={() => {
                    // Try to auto-populate from Document Analyzer flagged issues!
                    try {
                      const docProg = localStorage.getItem("OPA_DOC_ANALYZER_PROGRESS");
                      if (docProg) {
                        const parsed = JSON.parse(docProg);
                        const report = parsed?.selectedReport;
                        if (report && report.redFlags && report.redFlags.length > 0) {
                          const newDisagreements = report.redFlags.map((flag: any, idx: number) => ({
                            id: "df-" + Date.now() + "-" + idx,
                            societyStatement: `[CAS Claim] "${flag.phraseDetected}"`,
                            parentResponse: `This is unsupported/hearsay. The correct context is: [Insert your explanation here]`,
                            supportingEvidence: flag.verifyRequirement || flag.legalReference || "Witnesses and medical/school logs."
                          }));
                          setForm33b(prev => ({
                            ...prev,
                            disagreedFacts: [...prev.disagreedFacts, ...newDisagreements]
                          }));
                          alert(`Success: Automatically populated ${report.redFlags.length} flagged objections into Form 33B reply paragraphs!`);
                        } else {
                          alert("No audited document report with red flags was found. Audit a document in the Document Analyzer first.");
                        }
                      } else {
                        alert("No document analyzer progress found. Please audit a document first.");
                      }
                    } catch (e) {
                      console.error("Error auto-loading disagreements:", e);
                    }
                  }}
                  className="flex items-center gap-1 text-[10px] bg-brand-50 hover:bg-brand-100 text-brand-700 px-2.5 py-1.5 rounded-lg border border-brand-200 font-bold transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-brand-600 animate-pulse" />
                  <span>Auto-load Flagged Objections</span>
                </button>
              </div>

              <div className="space-y-3">
                {form33b.disagreedFacts.map((item, idx) => (
                  <div key={item.id} className="p-4 border border-gray-200 bg-slate-50/20 rounded-xl space-y-3 relative">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-mono font-bold text-slate-500">Disagreement Item #{idx + 1}</span>
                      <button
                        onClick={() => {
                          const filtered = form33b.disagreedFacts.filter(df => df.id !== item.id);
                          setForm33b({ ...form33b, disagreedFacts: filtered });
                        }}
                        className="text-[10px] text-rose-600 font-bold hover:underline cursor-pointer"
                      >
                        Delete assertion reply
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-mono uppercase tracking-wider text-slate-400 font-semibold block">CAS Allegation Paragraph / Statement</label>
                        <textarea
                          value={item.societyStatement}
                          onChange={(e) => {
                            const updated = [...form33b.disagreedFacts];
                            updated[idx] = { ...updated[idx], societyStatement: e.target.value };
                            setForm33b({ ...form33b, disagreedFacts: updated });
                          }}
                          rows={2}
                          placeholder="e.g. Society alleges paragraph 12 that parent refused pediatric medical exam..."
                          className={`border w-full   text-xs p-2 rounded-lg focus:outline-none transition-colors ${getHighlightClass(item.societyStatement)}`}
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[9px] font-mono uppercase tracking-wider text-slate-400 font-semibold block">Parent Counter-Explanation (The Truth)</label>
                        <textarea
                          value={item.parentResponse}
                          onChange={(e) => {
                            const updated = [...form33b.disagreedFacts];
                            updated[idx] = { ...updated[idx], parentResponse: e.target.value };
                            setForm33b({ ...form33b, disagreedFacts: updated });
                          }}
                          rows={2}
                          placeholder="e.g. Parent scheduled exam with pediatrician but pediatrician rescheduled due to clinic emergency..."
                          className={`border w-full   text-xs p-2 rounded-lg focus:outline-none transition-colors ${getHighlightClass(item.parentResponse)}`}
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[9px] font-mono uppercase tracking-wider text-slate-400 font-semibold block">Factual Direct Proof / Evidentiary Logs</label>
                        <textarea
                          value={item.supportingEvidence}
                          onChange={(e) => {
                            const updated = [...form33b.disagreedFacts];
                            updated[idx] = { ...updated[idx], supportingEvidence: e.target.value };
                            setForm33b({ ...form33b, disagreedFacts: updated });
                          }}
                          rows={2}
                          placeholder="e.g. Email confirmation from clinic manager Dr. White dated March 4, 2026."
                          className={`border w-full   text-xs p-2 rounded-lg focus:outline-none transition-colors ${getHighlightClass(item.supportingEvidence)}`}
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => {
                    const newItem = {
                      id: "df-" + Date.now(),
                      societyStatement: "",
                      parentResponse: "",
                      supportingEvidence: ""
                    };
                    setForm33b({ ...form33b, disagreedFacts: [...form33b.disagreedFacts, newItem] });
                  }}
                  className="flex items-center gap-1 text-xs text-brand-650 hover:text-brand-850 font-bold pt-1 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Custom Disagreement Reply Paragraph</span>
                </button>
              </div>
            </div>

            {/* Part 4: Parent's Own Facts statement */}
            <div className="space-y-1.5 pt-2 border-t border-dashed">
              <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">Respondent Parent's Statement of Factual Circumstances (Omitted by Society)</label>
              <textarea
                value={form33b.parentStatementOfFacts}
                onChange={(e) => setForm33b({ ...form33b, parentStatementOfFacts: e.target.value })}
                placeholder="List important facts about your parenting, safety efforts, counseling completions, and clean drug screenings that the CAS caseworkers failed to put in their application."
                rows={3}
                className={`border w-full   text-xs p-3 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(form33b.parentStatementOfFacts)}`}
              />
            </div>
          </div>
        )}

        {/* 7. PERSONALIZED PLAN OF CARE */}
        {activeBuilderTab === "plan-of-care" && (
          <div className="space-y-6 animate-fade-in" id="plan-of-care-workspace">
            <div className="border-b border-gray-150 pb-4">
              <span className="text-[10px] font-mono font-black tracking-widest text-rose-600 block uppercase">SEC. 94 COMPLIANCE • S.O. 2017, C. 14</span>
              <h3 className="font-display text-xl font-bold text-slate-950 mt-1">Personalized Parent Plan of Care</h3>
              <p className="text-xs text-slate-600 mt-1 font-sans">
                Establish an proactive child placement, safety, supervision, cultural education, healthcare, and parental counseling plan to demonstrate a secure home ecosystem.
              </p>
            </div>

            {/* Header Columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-rose-50/10 p-4 rounded-xl border border-rose-100/50">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-rose-800 font-bold block">Child's Name(s)</label>
                <input
                  type="text"
                  value={planOfCare.childName}
                  onChange={(e) => setPlanOfCare({ ...planOfCare, childName: e.target.value })}
                  placeholder="e.g. Lucas Doe"
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(planOfCare.childName)}`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-wider text-rose-800 font-bold block">Child Birthdate(s) / Age</label>
                <input
                  type="text"
                  value={planOfCare.birthdate}
                  onChange={(e) => setPlanOfCare({ ...planOfCare, birthdate: e.target.value })}
                  placeholder="e.g. June 12, 2018 (Age 7)"
                  className={`border w-full   text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors ${getHighlightClass(planOfCare.birthdate)}`}
                />
              </div>
            </div>

            {/* Core Plan Details */}
            <div className="space-y-4">
              {/* 1. Living arrangements */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">1. Proposed Living Arrangements (Placement & Housing Security)</label>
                  <span className="text-[8px] bg-gray-150 text-gray-700 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Housing Plan</span>
                </div>
                <textarea
                  value={planOfCare.livingArrangements}
                  onChange={(e) => setPlanOfCare({ ...planOfCare, livingArrangements: e.target.value })}
                  rows={2.5}
                  className={`border w-full   text-xs p-3 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(planOfCare.livingArrangements)}`}
                />
              </div>

              {/* 2. Safety and Supervision */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">2. Safety Protocols & Supervision Support (Approved Kinship Contacts)</label>
                  <span className="text-[8px] bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Safety & Supervision</span>
                </div>
                <textarea
                  value={planOfCare.safetySupervision}
                  onChange={(e) => setPlanOfCare({ ...planOfCare, safetySupervision: e.target.value })}
                  rows={2.5}
                  className={`border w-full   text-xs p-3 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(planOfCare.safetySupervision)}`}
                />
              </div>

              {/* 3. Education Needs */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">3. Educational Goals, School Stability & After-School Routines</label>
                  <span className="text-[8px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Education</span>
                </div>
                <textarea
                  value={planOfCare.educationNeeds}
                  onChange={(e) => setPlanOfCare({ ...planOfCare, educationNeeds: e.target.value })}
                  rows={2.5}
                  className={`border w-full   text-xs p-3 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(planOfCare.educationNeeds)}`}
                />
              </div>

              {/* 4. Healthcare and Physical/Mental Development */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">4. Medical, Dental, Pediatric & Developmental Counseling Schedules</label>
                  <span className="text-[8px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Medical & Therapy</span>
                </div>
                <textarea
                  value={planOfCare.healthcareDevelopment}
                  onChange={(e) => setPlanOfCare({ ...planOfCare, healthcareDevelopment: e.target.value })}
                  rows={2.5}
                  className={`border w-full   text-xs p-3 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(planOfCare.healthcareDevelopment)}`}
                />
              </div>

              {/* 5. Cultural Connection, Heritage & Religious Upbringing */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">5. Cultural Preservation, Indigenous Identity, or Religious Heritage Connection</label>
                  <span className="text-[8px] bg-amber-100 text-amber-850 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Culture & Identity</span>
                </div>
                <textarea
                  value={planOfCare.cultureReligion}
                  onChange={(e) => setPlanOfCare({ ...planOfCare, cultureReligion: e.target.value })}
                  rows={2.5}
                  className={`border w-full   text-xs p-3 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(planOfCare.cultureReligion)}`}
                />
              </div>

              {/* 6. Contact and Access Arrangements */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">6. Parent-Child Bonding Access & Kinship Relative Contact Schedules</label>
                  <span className="text-[8px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Access visits</span>
                </div>
                <textarea
                  value={planOfCare.contactAccessArrangements}
                  onChange={(e) => setPlanOfCare({ ...planOfCare, contactAccessArrangements: e.target.value })}
                  rows={2.5}
                  className={`border w-full   text-xs p-3 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(planOfCare.contactAccessArrangements)}`}
                />
              </div>

              {/* 7. Parent Support Services */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">7. Active Parent Rehabilitation, Parenting Programs (Triple P) & Support Services</label>
                  <span className="text-[8px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Programs Completed</span>
                </div>
                <textarea
                  value={planOfCare.parentSupportServices}
                  onChange={(e) => setPlanOfCare({ ...planOfCare, parentSupportServices: e.target.value })}
                  rows={2.5}
                  className={`border w-full   text-xs p-3 rounded-lg focus:outline-none leading-relaxed transition-colors ${getHighlightClass(planOfCare.parentSupportServices)}`}
                />
              </div>
            </div>
          </div>
        )}

        {/* Formatted printed watermark signature details */}
        <div className="hidden print-only pt-8 border-t border-dashed text-[10px] text-slate-500 flex justify-between">
          <span>Printed via CYFSA Ontario Parent Portal</span>
          <span>Educational draft purposes only • Consult a Lawyer</span>
          <span>Time: May 25, 2026</span>
        </div>
      </div>
    </div>
  );
}
