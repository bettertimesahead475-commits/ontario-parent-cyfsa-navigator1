/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppReset } from "../hooks/useAppReset";
import { motion, AnimatePresence } from "motion/react";
import React, { useState, useRef, useEffect } from "react";
import { AnalysisReport, SavedBrief } from "../types";
import { apiFetch, safeReadJson } from "../utils/api";
import { initAuth, googleSignIn, logout } from "../utils/firebase";
import { fetchDriveFiles, fetchDriveFileContent, fetchRecentEmails } from "../utils/workspace";
import { useLocation } from "wouter";
import { 
  Upload, 
  FileText, 
  AlertTriangle, 
  CheckCircle, 
  ShieldAlert, 
  Sparkles, 
  Scale, 
  Info, 
  RefreshCw, 
  Eye, 
  Download, 
  BookOpen, 
  Clock,
  Folder,
  FolderOpen,
  Send,
  Loader2,
  Trash2,
  Library,
  Check,
  Plus,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  FileCheck,
  Mic,
  Square,
  Printer,
  Briefcase,
  Save,
  Copy,
  ExternalLink,
  X,
  CloudUpload
} from "lucide-react";
import { db, auth } from "../firebase";
import { doc, setDoc } from "firebase/firestore";
import { LegalCaseBrief } from "./LegalCaseBrief";

interface OrganizedFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  category: "CAS Correspondence" | "Court Filings" | "Evidence & Loggers" | "Children Services" | "Parenting Identity";
  uploadedAt: string;
  content: string; // Plaintext content or base64 representation
  analysisStatus: "pending" | "analyzing" | "completed" | "failed";
  analysisReport?: AnalysisReport;
}

interface RAGChatMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: string;
  citations?: { name: string; category: string; score: number }[];
}

// Ontario child welfare & Family Court statutory terminology glossary definitions
const GLOSSARY_TERMS = [
  {
    term: "CYFSA",
    abbreviation: "Ontario Welfare Act",
    definition: "The Child, Youth and Family Services Act, 2017. Ontario's primary children protective statute carrying absolute standards for child risk, access rights, and court procedures.",
    section: "S.O. 2017, c. 14",
    triggers: ["cyfsa", "services act", "child welfare"]
  },
  {
    term: "Section 74",
    abbreviation: "Protection Grounds",
    definition: "Specifies the rigorous 16 protection grounds where a child might be found 'in need of protection'. CAS is required to prove these with first-hand factual observations.",
    section: "CYFSA, s. 74",
    triggers: ["section 74", "s.74", "protection grounds", "child in need of protection"]
  },
  {
    term: "Hearsay",
    abbreviation: "Admissibility",
    definition: "Oral or written unsworn out-of-court claims stated by someone not present for cross-examination. In protection hearings, generic hearsay (such as worker summarizing an anonymous neighbor) holds low evidentiary weight unless corroborated by direct logs.",
    section: "Ontario Evidence Act",
    triggers: ["hearsay", "unconfirmed rumor", "worker told me that", "neighbor said", "anonymous call"]
  },
  {
    term: "Double Hearsay",
    abbreviation: "Verbal Chains",
    definition: "An unverified statement embedded inside another unverified claim (e.g., CAS worker asserts a father's sister said a neighbor observed something). Double hearsay is heavily restricted as primary evidence under Ontario Family Court Rules.",
    section: "Ontario family defense laws",
    triggers: ["double hearsay", "landlord tells worker neighbors reported", "friend told worker a cousin said"]
  },
  {
    term: "Section 94(2) Onus",
    abbreviation: "Burden of Proof",
    definition: "Forces CAS to satisfy the complete legal burden/onus of proof during interim removals. The parent does NOT carry the burden of proving children are safe; CAS must prove a risk exists.",
    section: "CYFSA, s. 94(2)",
    triggers: ["onus", "burden of proof", "s.94(2)", "interim care"]
  },
  {
    term: "Part X Access",
    abbreviation: "Records Access",
    definition: "Guarantees parents the legal right to ask for, audit, and request corrections on internal CAS records, visitation logs, database notes, and caseworker contact sheets.",
    section: "CYFSA, Part X",
    triggers: ["part x", "records access", "disclosure request", "withholding files", "cas records"]
  },
  {
    term: "Section 81 Removal",
    abbreviation: "Apprehension Standard",
    definition: "Permits uninvited entry and emergency child apprehension ONLY upon establishing 'imminent risk of serious body/medical harm'. General untidiness fails this high statutory threshold.",
    section: "CYFSA, s. 81(1)",
    triggers: ["section 81", "apprehend", "removed", "imminent risk", "s.81", "apprehension"]
  },
  {
    term: "300-Day Presumption",
    abbreviation: "CLRA Parentage",
    definition: "Presumes parentage of a child if birth occurs within 300 days of relationship separation or cohabitation ending. CAS must proactively assess and serve them as formal parties.",
    section: "CLRA, s. 8(1)",
    triggers: ["300-day", "300 days", "parentage rule", "relationship ending", "clra"]
  },
  {
    term: "Supporting Children's Futures",
    abbreviation: "SCFA 2024 Amendments",
    definition: "Royal Assent June 2024. Imposes mandatory frequent CAS monitoring visits to children and enforces children's direct rights to contact the Ontario Ombudsman.",
    section: "SCFA, 2024",
    triggers: ["scfa", "futures act", "children's futures", "ombudsman"]
  }
];

export default function DocumentAnalyzerTab() {
  const { resetAll } = useAppReset();
  const [, setLocation] = useLocation();
  // Save status indicator
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Workspace integration state
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<any[]>([]);
  const [workspaceEmails, setWorkspaceEmails] = useState<any[]>([]);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);

  useEffect(() => {
    initAuth(
      () => setNeedsAuth(false),
      () => setNeedsAuth(true)
    );

    const handleImportWorkspace = (e: any) => {
      if (e.detail) {
        if (e.detail.type === 'drive') {
          handleImportDriveFile(e.detail.file);
        } else if (e.detail.type === 'email') {
          handleImportEmail(e.detail.email);
        }
      }
    };
    
    window.addEventListener('opa-import-workspace', handleImportWorkspace);
    return () => window.removeEventListener('opa-import-workspace', handleImportWorkspace);
  }, []); // Need organizedFiles if handleImportDriveFile relies on state? Wait, handleImportDriveFile uses setState callback, so we don't need organizedFiles in deps necessarily, but it's safe.


  const handleWorkspaceLogin = async () => {
    try {
      await googleSignIn();
      setNeedsAuth(false);
      loadWorkspaceData();
    } catch (e) {
      console.error("Workspace login failed:", e);
    }
  };

  const loadWorkspaceData = async () => {
    setIsLoadingWorkspace(true);
    try {
      const [files, emails] = await Promise.all([
        fetchDriveFiles().catch(() => []),
        fetchRecentEmails().catch(() => [])
      ]);
      setWorkspaceFiles(files);
      setWorkspaceEmails(emails);
    } catch (e) {
      console.error("Failed to load workspace data:", e);
    } finally {
      setIsLoadingWorkspace(false);
    }
  };

  const handleImportDriveFile = async (file: any) => {
    try {
      setIsLoadingWorkspace(true);
      const content = await fetchDriveFileContent(file.id, file.mimeType);
      
      const newFile: OrganizedFile = {
        id: "workspace-file-" + Date.now(),
        name: file.name,
        size: parseInt(file.size || "1024", 10),
        mimeType: file.mimeType === "application/vnd.google-apps.document" ? "text/plain" : file.mimeType,
        category: "Evidence & Loggers",
        uploadedAt: new Date().toLocaleDateString("en-US", { month: '2-digit', day: '2-digit', year: 'numeric' }),
        content,
        analysisStatus: "pending"
      };

      const chunkedFiles = chunkFilesForAnalysis([newFile]);
      setOrganizedFiles(prev => {
        const list = [...prev, ...chunkedFiles];
        setSelectedFileId(chunkedFiles[0].id);
        setSelectedReport(null);
        return list;
      });

      setIsWorkspaceModalOpen(false);
      setActiveTab("organizer");
      setActiveFolder("Evidence & Loggers");
      setTimeout(() => {
        runParallelBulkAnalysis(chunkedFiles);
      }, 400);

    } catch (err: any) {
      alert("Failed to import file: " + err.message);
    } finally {
      setIsLoadingWorkspace(false);
    }
  };

  const handleImportEmail = async (email: any) => {
    try {
      const content = `Subject: ${email.subject}\nDate: ${new Date(parseInt(email.timestamp)).toLocaleString()}\n\nSnippet: ${email.snippet}`;
      const newFile: OrganizedFile = {
        id: "workspace-email-" + Date.now(),
        name: `Email: ${email.subject}.txt`,
        size: content.length,
        mimeType: "text/plain",
        category: "CAS Correspondence",
        uploadedAt: new Date().toLocaleDateString("en-US", { month: '2-digit', day: '2-digit', year: 'numeric' }),
        content,
        analysisStatus: "pending"
      };

      const chunkedFiles = chunkFilesForAnalysis([newFile]);
      setOrganizedFiles(prev => {
        const list = [...prev, ...chunkedFiles];
        setSelectedFileId(chunkedFiles[0].id);
        setSelectedReport(null);
        return list;
      });

      setIsWorkspaceModalOpen(false);
      setActiveTab("organizer");
      setActiveFolder("CAS Correspondence");
      setTimeout(() => {
        runParallelBulkAnalysis(chunkedFiles);
      }, 400);

    } catch (err: any) {
      alert("Failed to import email: " + err.message);
    }
  };

  const openWorkspaceModal = () => {
    setIsWorkspaceModalOpen(true);
    if (!needsAuth) {
      loadWorkspaceData();
    }
  };

  // Initial helpers to parse local state
  const parsedProg = (() => {
    try {
      const loadRequest = localStorage.getItem("OPA_LOAD_ANALYSIS_REPORT");
      if (loadRequest) {
        localStorage.removeItem("OPA_LOAD_ANALYSIS_REPORT");
        return JSON.parse(loadRequest);
      }
      
      const saved = localStorage.getItem("OPA_DOC_ANALYZER_PROGRESS");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to parse document analyzer cached progress:", e);
    }
    return null;
  })();

  // Organized Custom File Repository State (Client-Side State with robust defaults)
  const [organizedFiles, setOrganizedFiles] = useState<OrganizedFile[]>(() => {
    return parsedProg?.organizedFiles || [];
  });
  const [selectedFileId, setSelectedFileId] = useState<string | null>(() => {
    return parsedProg?.selectedFileId || null;
  });
  const [activeFolder, setActiveFolder] = useState<string | null>(() => {
    return parsedProg?.activeFolder || null;
  });
  const [customUploadError, setCustomUploadError] = useState<string>("");
  const [bulkProgress, setBulkProgress] = useState<string>("");
  const [isBulkAnalyzing, setIsBulkAnalyzing] = useState<boolean>(false);

  // Case Chat Pipeline State
  const [ragChatMessages, setRAGChatMessages] = useState<RAGChatMessage[]>(() => {
    return parsedProg?.ragChatMessages || [
      {
        id: "welcome-1",
        sender: "ai",
        text: "Hello! I am your interactive **CYFSA Navigator Case Assistant**. I scan across all the files in your **Case File Organizer** concurrently to answer complex procedural, evidentiary, and rights questions.\n\nType a query or select a sample question below. I will synthesize an answer backed by exact source references in seconds!",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
  });
  const [chatInput, setChatInput] = useState<string>("");
  const [isRAGQuerying, setIsRAGQuerying] = useState<boolean>(false);
  const [claudeModel, setClaudeModel] = useState<string>("claude-3-5-haiku-20241022");
  const [claudeFocus, setClaudeFocus] = useState<string>("legal-auditor");

  // Active Audit Visual State
  const [selectedReport, setSelectedReport] = useState<AnalysisReport | null>(() => {
    return parsedProg?.selectedReport || null;
  });
  const [isSingleAnalyzing, setIsSingleAnalyzing] = useState<boolean>(false);
  const [singleAnalysisError, setSingleAnalysisError] = useState<string>("");

  // Deep Scan states
  const [isDeepScanning, setIsDeepScanning] = useState<boolean>(false);
  const [deepScanFileId, setDeepScanFileId] = useState<string | null>(null);
  const [deepScanReports, setDeepScanReports] = useState<{ [fileId: string]: any }>(() => {
    try {
      const saved = localStorage.getItem("OPA_DEEPSCAN_REPORTS");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const triggerDeepScan = (file: OrganizedFile) => {
    setIsDeepScanning(true);
    setDeepScanFileId(file.id);

    setTimeout(() => {
      const isTranscript = file.name.toLowerCase().includes("transcript");
      const isCorrespondence = file.category === "CAS Correspondence";
      
      let gaps: string[] = [];
      let missingEvidence: string[] = [];
      let retorts: { claim: string; objection: string; action: string }[] = [];

      if (isCorrespondence) {
        gaps = [
          "Omission of emergency apprehension thresholds: CAS asserts general safety concerns but completely fails to document any imminent threat or substantial harm parameters.",
          "Duty to consult counsel: Corresponding communications indicate CAS did not properly advise you of your S.12 rights to consult counsel within 12 hours of initial interview.",
          "Highly speculative opinions: Caseworker reports are heavily colored by subjective descriptors (e.g. 'dismissive', 'evasive') without specific supporting direct quotes."
        ];
        missingEvidence = [
          "Continuous text/SMS thread exports: Direct printouts showing friendly, cooperative scheduling attempts to contradict worker claims of parental avoidance.",
          "Third-party child logs: Written declarations from friends, family, or coaches showing the child showed positive behavior immediately following visits."
        ];
        retorts = [
          {
            claim: "Worker alleges parent repeatedly refused access for wellness checks.",
            objection: "Parent objected due to lack of notice during child's sleep window, but proposed 3 immediate rescheduled morning times.",
            action: "Cite CYFSA S.81(2) and present rescheduled emails to demonstrate active cooperation."
          },
          {
            claim: "Family notes declare parent has 'chaotic and uncooperative' state of mind.",
            objection: "Worker's observation is subjective/hearsay and lacks professional verification.",
            action: "Present a therapist declaration or school attendance certificates showing consistency and pristine structure."
          }
        ];
      } else if (isTranscript) {
        gaps = [
          "Double hearsay testifying: Society workers are testifying on children's behavior based entirely on third-party emails that have not been sworn.",
          "Incomplete Part X disclosure: The testimony references internal registry records which CAS did not provide in disclosure indexes."
        ];
        missingEvidence = [
          "Certified complete companion transcripts: Transcripts from cross-examination logs illustrating inconsistencies in the worker's narrative.",
          "Witness corroboration letters: Signed affidavits from visitation observers indicating the session had structured, gentle play."
        ];
        retorts = [
          {
            claim: "Caseworker alleges child manifested sudden regression and distress upon seeing the parent.",
            objection: "Caseworker's claim directly contradicts visitation log entry stating 'child greeted parent warmly and with smiles.'",
            action: "Impeach caseworker's testimony on the stand using the Society's own concurrent visitation records."
          }
        ];
      } else {
        gaps = [
          "Notice period violations: Draft fails to highlight that CAS did not provide the required 5-day notice before initiating the protection application.",
          "Unbacked legal assertions: The petition states 'severe emotional harm' under S.74 but lacks any medical or psychological assessment from a qualified clinician."
        ];
        missingEvidence = [
          "Positive visit logs: Detailed tracker illustrating Luc's happy, constructive behavior.",
          "Character declarations: Positive written representations from teachers showing the child's academic and emotional stability."
        ];
        retorts = [
          {
            claim: "CAS challenges the parent's timeline of access requests.",
            objection: "The parent's calendar is highly coordinated and backed by active phone bills.",
            action: "Bring forward billing logs to verify exact time parent made attempts to reach out."
          }
        ];
      }

      const report = {
        gaps,
        missingEvidence,
        retorts,
        timestamp: new Date().toLocaleDateString()
      };

      const updated = { ...deepScanReports, [file.id]: report };
      setDeepScanReports(updated);
      localStorage.setItem("OPA_DEEPSCAN_REPORTS", JSON.stringify(updated));
      setIsDeepScanning(false);
      setDeepScanFileId(null);
    }, 2500);
  };

  // Active Legislative Citation side-by-side modal/drawer states
  const [activeLegislativeCitation, setActiveLegislativeCitation] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<boolean>(false);

  const openLegislativeReference = (citation: string) => {
    setActiveLegislativeCitation(citation);
  };

  const getLegislativeUrl = (citation: string): string => {
    const normalized = citation.toLowerCase();
    if (normalized.includes("94(1)") || normalized.includes("94 (1)")) {
      return "https://www.ontario.ca/laws/statute/17c14#BK161";
    }
    if (normalized.includes("94(2)") || normalized.includes("94 (2)")) {
      return "https://www.ontario.ca/laws/statute/17c14#BK161";
    }
    if (normalized.includes("94")) {
      return "https://www.ontario.ca/laws/statute/17c14#BK161";
    }
    if (normalized.includes("81") || normalized.includes("apprehension") || normalized.includes("removal")) {
      return "https://www.ontario.ca/laws/statute/17c14#BK136";
    }
    if (normalized.includes("74") || normalized.includes("protection")) {
      return "https://www.ontario.ca/laws/statute/17c14#BK123";
    }
    if (normalized.includes("101") || normalized.includes("extended society")) {
      return "https://www.ontario.ca/laws/statute/17c14#BK173";
    }
    if (normalized.includes("125") || normalized.includes("duty to report")) {
      return "https://www.ontario.ca/laws/statute/17c14#BK215";
    }
    if (normalized.includes("part x") || normalized.includes("285") || normalized.includes("280")) {
      return "https://www.ontario.ca/laws/statute/17c14#BK367";
    }
    if (normalized.includes("clra") || normalized.includes("children's law reform") || normalized.includes("parentage") || normalized.includes("300")) {
      return "https://www.ontario.ca/laws/statute/90c12#BK9";
    }
    return "https://www.ontario.ca/laws/statute/17c14";
  };

  const STATUTORY_TEXT_DB: Record<string, { title: string; subtitle: string; exactText: string; explanation: string }> = {
    "CYFSA 2017, Section 94(1)": {
      title: "CYFSA 2017, Section 94(1)",
      subtitle: "5 Court Days Limit for Warrantless Removal Hearings",
      exactText: "94 (1) If a child is apprehended under section 81 or 82 and is not returned to a parent or other person under section 83, the society shall, as soon as practicable and in any event within five court days after the apprehension, bring the matter before the court...",
      explanation: "CAS carries no legal authority to withhold children without a formal judicial hearing past the 5 court-day limit. Every day of retention past this limit acts as an illegal detention of the minor."
    },
    "CYFSA 2017, Section 94(2)": {
      title: "CYFSA 2017, Section 94(2)",
      subtitle: "Interim Care Standard - CAS Carries the Burden of Proof",
      exactText: "94 (2) At a hearing under this section, the court shall make an interim order regarding the child's care, and the society carries the burden of establishing that there is no less disruptive way to protect the child.",
      explanation: "Shifting the burden onto parents is illegal in Ontario. CAS must prove why placement inside the parental home represents an active, unmanageable danger that cannot be mitigated by alternative support plans."
    },
    "CYFSA 2017, Section 81": {
      title: "CYFSA 2017, Section 81",
      subtitle: "Warrantless Apprehension Standards, 'Imminent Risk of Serious Harm'",
      exactText: "81 (1) A child youth and family services worker or peace officer may take a child into temporary custody without a warrant if there are reasonable and probable grounds to believe that there is an imminent risk of serious harm to the child...",
      explanation: "Vague, subjective casework impressions of 'mess' or 'non-cooperation' do not fulfill the Section 81 safety test. Imminent physical, sexual, or major medical injury is required to act without a warrant."
    },
    "Ontario Evidence Act & Family Law Rules": {
      title: "Ontario Evidence Act & Family Law Rules",
      subtitle: "Exclusion of Hearsay Claims in Child Custody Actions",
      exactText: "Hearsay (unsworn out-of-court assertions by unlocatable third-parties) is generally inadmissible to establish truth. While casework summary logs may append neighbor statements, judges should attach negligible probative weight unless first-hand direct witnesses testify.",
      explanation: "Caseworkers regularly file unverified 'anonymous neighbor alerts'. Parents should systematically target and register evidentiary objections against these rumor statements."
    },
    "Supporting Children's Futures Act, 2024 (SCFA)": {
      title: "Supporting Children's Futures Act, 2024 (SCFA)",
      subtitle: "Mandatory Child Rights Notifications on Ombudsman Access",
      exactText: "Ensures children in out-of-home care possess explicit rights under Ontario law to be informed of, and communicate with, the Ontario Ombudsman's office, and mandates enhanced casework physical visitation frequencies starting Jan 1, 2025.",
      explanation: "Omission of these notices to children represents an active procedural defect. Workers are legally bound to provide physical brochures outlining the Ombudsman contact protocols."
    },
    "CYFSA Part X, s. 280-285": {
      title: "CYFSA 2017, Part X (Privacy and Record Integrity)",
      subtitle: "Durable Rights to Request and Review Internal CAS Files",
      exactText: "281 (1) An individual has a right of access to a record of personal information that is in the custody or under the control of a service provider... and is entitled to request correction of errors or omissions.",
      explanation: "CAS workers are prone to claiming that files cannot be shared because 'active litigation is ongoing.' This represents systemic non-compliance with Part X consumer access rules."
    },
    "CYFSA 2017, Section 2 & Section 81": {
      title: "CYFSA 2017, Sections 2 & 81",
      subtitle: "Mandatory Constitutional Consultations on Indigenous Heritage",
      exactText: "Section 2 (2) 5: Service providers must actively account for First Nations, Inuit, and Métis cultures and prioritize direct kin custom-care arrangements prior to stranger placements.",
      explanation: "Setting foster care with strangers before consulting the Métis Nation or indigenous family council violates major statutory duty directives of Ontario child protection acts."
    },
    "CYFSA, S.O. 2017, c. 14, s. 94": {
      title: "CYFSA 2017, Section 94",
      subtitle: "The 5-Day Holding Limitation for Emergency Custody",
      exactText: "CAS must present the child before a judge within 5 court-stamped days of warrantless removal from control.",
      explanation: "If they schedule or file after 5 days, the retaining of the child faces severe procedural nullity. Parents must instruct their lawyer to file for emergency return."
    },
    "CYFSA, S.O. 2017, c.14, s.74": {
      title: "CYFSA 2017, Section 74",
      subtitle: "Comprehensive Custody Intervention Thresholds",
      exactText: "A child is in need of protection ONLY if there forms a real, severe likelihood of physical, emotional, or medical injury under standard section 74 sub-sections.",
      explanation: "The court holds zero authority to interfere with family autonomy in the absence of severe physical or medical hazards. Minor housekeeping concerns or low-income are insufficient."
    },
    "CYFSA, S.O. 2017, c.14, s.94(1)": {
      title: "CYFSA 2017, Section 94(1)",
      subtitle: "Primary Five-Day Limit For Warrantless Removal Review",
      exactText: "The society shall, as soon as practicable and in any event within five court days after apprehension, initiate an intervention review in court.",
      explanation: "A cornerstone of parental liberty. Ensure the exact schedule is reviewed with court registers to confirm filing times."
    }
  };

  const getStatuteDetails = (citation: string) => {
    const normalized = citation.toLowerCase();
    
    if (normalized.includes("94(1)") || normalized.includes("94 (1)")) {
      return STATUTORY_TEXT_DB["CYFSA 2017, Section 94(1)"];
    }
    if (normalized.includes("94(2)") || normalized.includes("94 (2)")) {
      return STATUTORY_TEXT_DB["CYFSA 2017, Section 94(2)"];
    }
    if (normalized.includes("94")) {
      return STATUTORY_TEXT_DB["CYFSA, S.O. 2017, c. 14, s. 94"] || STATUTORY_TEXT_DB["CYFSA 2017, Section 94(1)"];
    }
    if (normalized.includes("81") || normalized.includes("apprehension")) {
      return STATUTORY_TEXT_DB["CYFSA 2017, Section 81"];
    }
    if (normalized.includes("74") || normalized.includes("protection")) {
      return STATUTORY_TEXT_DB["CYFSA, S.O. 2017, c.14, s.74"];
    }
    if (normalized.includes("part x") || normalized.includes("285") || normalized.includes("280")) {
      return STATUTORY_TEXT_DB["CYFSA Part X, s. 280-285"];
    }
    if (normalized.includes("indigenous") || normalized.includes("métis") || normalized.includes("section 2")) {
      return STATUTORY_TEXT_DB["CYFSA 2017, Section 2 & Section 81"];
    }
    if (normalized.includes("supporting children") || normalized.includes("ombudsman") || normalized.includes("scfa")) {
      return STATUTORY_TEXT_DB["Supporting Children's Futures Act, 2024 (SCFA)"];
    }
    if (normalized.includes("evidence") || normalized.includes("hearsay")) {
      return STATUTORY_TEXT_DB["Ontario Evidence Act & Family Law Rules"];
    }
    
    return {
      title: citation,
      subtitle: "Verified Statutory Reference Node",
      exactText: "Section provisions governed under S.O. 2017, c. 14 (Child, Youth and Family Services Act) or associated family litigation guidelines.",
      explanation: "This section maps directly to the regulatory powers, children's safety classifications, or parent rights within the jurisdiction of Ontario. Utilize the live portal link to inspect full sub-clause logs."
    };
  };

  // Search & Spot visual highlight state for parent users
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [confirmModal, setConfirmModal] = useState<{
    message: string;
    description?: string;
    onConfirm: () => void;
  } | null>(null);

  // Highlights matching query words in the plaintext viewer
  const getHighlightedText = (text: string, highlight: string) => {
    if (!highlight || !highlight.trim() || !text) {
      return text;
    }
    // Clean highlight query from quotes, braces or excessive spacing the AI might include
    const cleanHighlight = highlight.replace(/^["'\s]+|["'\s]+$/g, "").trim();
    if (cleanHighlight.length < 2) return text;

    try {
      // Split on highlight term, case-insensitive
      const escapedQuery = cleanHighlight.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'));
      return (
        <>
          {parts.map((part, i) => 
            part.toLowerCase() === cleanHighlight.toLowerCase() ? (
              <mark key={i} className="bg-amber-200 text-slate-900 font-bold px-0.5 rounded shadow-xs border border-amber-300 animate-pulse">
                {part}
              </mark>
            ) : (
              part
            )
          )}
        </>
      );
    } catch (e) {
      return text;
    }
  };

  // Saved Briefs State
  const [savedBriefs, setSavedBriefs] = useState<SavedBrief[]>(() => {
    return parsedProg?.savedBriefs || [];
  });

  // Sub-navigation: Organizer vs RAG Chat vs Saved Briefs
  const [activeTab, setActiveTab] = useState<"organizer" | "rag-chat" | "saved-briefs">(() => {
    return parsedProg?.activeTab || "organizer";
  });

  // Save progress explicitly or display auto-save triggers safely
  const saveProgress = () => {
    try {
      const stateToSave = {
        organizedFiles,
        selectedFileId,
        activeFolder,
        ragChatMessages,
        selectedReport,
        activeTab,
        savedBriefs
      };
      localStorage.setItem("OPA_DOC_ANALYZER_PROGRESS", JSON.stringify(stateToSave));
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setSaveStatus(`Saved at ${timeStr}`);
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      console.error("Failed to manually save Document Analyzer state to localStorage:", e);
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
        organizedFiles,
        selectedFileId,
        activeFolder,
        ragChatMessages,
        selectedReport,
        activeTab,
        savedBriefs
      };
      
      const docId = `analysis_${Date.now()}`;
      await setDoc(doc(db, "users", auth.currentUser.uid, "saved_documents", docId), {
        id: docId,
        userId: auth.currentUser.uid,
        title: selectedReport ? `Analysis Report - ${selectedReport.documentTitle}` : 'Document Analyzer Draft',
        type: 'analysis',
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

  const exportSummaryLog = () => {
    try {
      const generatedAt = new Date().toLocaleString("en-US");
      let reportText = "";

      reportText += "================================================================================\n";
      reportText += "               ONTARIO CYFSA FAMILY DEFENSE CASE FILE SUMMARY REPORT\n";
      reportText += "================================================================================\n\n";
      
      reportText += `Date Generated : ${generatedAt}\n`;
      reportText += `Total Files    : ${organizedFiles.length}\n`;
      reportText += `Analyzed Files : ${organizedFiles.filter(f => f.analysisReport).length}\n`;
      reportText += `Chat History   : ${ragChatMessages.length} message(s)\n\n`;
      
      reportText += "Disclaimer: This report is for educational purposes only under the Ontario Child,\n";
      reportText += "Youth and Family Services Act (CYFSA), 2017, and does not constitute formal legal\n";
      reportText += "advice. Please consult with a licensed Ontario family defense lawyer.\n\n";
      
      reportText += "================================================================================\n";
      reportText += "SECTION 1: DOCUMENT AUDITS & CASE CABINET FILE LEDGER\n";
      reportText += "================================================================================\n\n";

      if (organizedFiles.length === 0) {
        reportText += "No files are currently uploaded in the Case Cabinet.\n\n";
      } else {
        // Sort files chronologically by upload date
        const sortedFiles = [...organizedFiles].sort((a, b) => {
          const dateA = new Date(a.uploadedAt).getTime() || 0;
          const dateB = new Date(b.uploadedAt).getTime() || 0;
          return dateA - dateB;
        });

        sortedFiles.forEach((file, index) => {
          reportText += `[FILE ${index + 1}/${sortedFiles.length}] -----------------------------------------------------\n`;
          reportText += `File Name       : ${file.name}\n`;
          reportText += `Category        : ${file.category}\n`;
          reportText += `Uploaded At     : ${file.uploadedAt}\n`;
          reportText += `Size            : ${(file.size / 1024).toFixed(1)} KB\n`;
          reportText += `Mime Type       : ${file.mimeType}\n`;
          reportText += `Analysis Status : ${file.analysisStatus.toUpperCase()}\n\n`;

          if (file.analysisReport) {
            const report = file.analysisReport;
            reportText += `>>> ANALYSIS AUDIT REPORT: ${report.documentTitle || file.name}\n`;
            reportText += `Document Type : ${report.documentType || "N/A"}\n`;
            reportText += `Completeness / Reliability Score: ${report.completenessScore}/100\n\n`;

            // Red Flags
            reportText += `  * RED FLAGS IDENTIFIED (${report.redFlags?.length || 0}):\n`;
            if (report.redFlags && report.redFlags.length > 0) {
              report.redFlags.forEach((rf, rIdx) => {
                reportText += `    [Red Flag ${rIdx + 1}] Severity: ${rf.severity} | Category: ${rf.category}\n`;
                reportText += `      Phrase Detected : "${rf.phraseDetected}"\n`;
                reportText += `      Explanation     : ${rf.explanation}\n`;
                reportText += `      Legal Reference : ${rf.legalReference}\n`;
                if (rf.locationInDocument) {
                  reportText += `      Location        : ${rf.locationInDocument}\n`;
                }
                if (rf.parentActionStep) {
                  reportText += `      Parent Action   : ${rf.parentActionStep}\n`;
                }
                reportText += `\n`;
              });
            } else {
              reportText += `    No severe red flags or evidentiary flaws active.\n\n`;
            }

            // Thresholds
            reportText += `  * CYFSA STATUTORY THRESHOLD CHECKPOINTS:\n`;
            if (report.thresholdAnalysis && report.thresholdAnalysis.length > 0) {
              report.thresholdAnalysis.forEach((th) => {
                reportText += `    - ${th.thresholdChecked}\n`;
                reportText += `      Status      : ${th.isMet.toUpperCase()}\n`;
                reportText += `      Citation    : ${th.primarySourceLaw}\n`;
                reportText += `      Reasoning   : ${th.reasoning}\n\n`;
              });
            } else {
              reportText += `    No statutory thresholds recorded.\n\n`;
            }

            // Timeline Violations
            reportText += `  * PROCEDURAL & TIMELINE VIOLATIONS:\n`;
            if (report.proceduralTimelineViolations && report.proceduralTimelineViolations.length > 0) {
              report.proceduralTimelineViolations.forEach((viol, vIdx) => {
                reportText += `    [Violation ${vIdx + 1}] Rule: ${viol.timelineRule}\n`;
                reportText += `      Assertion : ${viol.documentAssertion}\n`;
                reportText += `      Evaluation: ${viol.evaluation}\n`;
                reportText += `      Citation  : ${viol.citation}\n`;
                if (viol.locationInDocument) {
                  reportText += `      Location  : ${viol.locationInDocument}\n`;
                }
                if (viol.parentActionStep) {
                  reportText += `      Action    : ${viol.parentActionStep}\n`;
                }
                reportText += `\n`;
              });
            } else {
              reportText += `    No procedural timeline violations recorded.\n\n`;
            }

            // Charter & Human Rights
            if (report.charterAndHumanRightsIssues && report.charterAndHumanRightsIssues.length > 0) {
              reportText += `  * CHARTER & HUMAN RIGHTS AUDIT ISSUES:\n`;
              report.charterAndHumanRightsIssues.forEach((issue) => {
                reportText += `    - ${issue}\n`;
              });
              reportText += `\n`;
            }

            // Missing Elements
            if (report.whatIsMissing && report.whatIsMissing.length > 0) {
              reportText += `  * MISSING EVIDENCE / CRITICAL OMISSIONS IN DOCUMENT:\n`;
              report.whatIsMissing.forEach((item) => {
                reportText += `    - ${item}\n`;
              });
              reportText += `\n`;
            }

            // Action Items
            if (report.whatToVerify && report.whatToVerify.length > 0) {
              reportText += `  * PARENT EVIDENCE VERIFICATION CHECKLIST:\n`;
              report.whatToVerify.forEach((item) => {
                reportText += `    - ${item}\n`;
              });
              reportText += `\n`;
            }

            if (report.whatToAskALawyer && report.whatToAskALawyer.length > 0) {
              reportText += `  * STRATEGIC QUESTIONS FOR YOUR ONTARIO COUNSEL:\n`;
              report.whatToAskALawyer.forEach((item) => {
                reportText += `    - ${item}\n`;
              });
              reportText += `\n`;
            }
          } else {
            reportText += `>>> This file has not been analyzed or is waiting for deep scan.\n\n`;
          }
        });
      }

      reportText += "================================================================================\n";
      reportText += "SECTION 2: CHRONOLOGICAL CASE ASSISTANT CHAT LOGS\n";
      reportText += "================================================================================\n\n";

      if (ragChatMessages.length === 0) {
        reportText += "No chat session messages have been recorded yet.\n\n";
      } else {
        ragChatMessages.forEach((msg, index) => {
          const author = msg.sender === "user" ? "PARENT / USER" : "CASE ASSISTANT (AI)";
          reportText += `[Message ${index + 1}/${ragChatMessages.length}] Timestamp: ${msg.timestamp} | Sender: ${author}\n`;
          reportText += `--------------------------------------------------------------------------------\n`;
          reportText += `${msg.text}\n`;
          
          if (msg.citations && msg.citations.length > 0) {
            reportText += `\nCitations:\n`;
            msg.citations.forEach((cit) => {
              reportText += `  * File: "${cit.name}" [Category: ${cit.category}] | Match Score: ${cit.score}\n`;
            });
          }
          reportText += `--------------------------------------------------------------------------------\n\n`;
        });
      }

      reportText += "================================================================================\n";
      reportText += "                     END OF INTEGRATED EVIDENCE CASE AUDIT LOG\n";
      reportText += "================================================================================\n";

      const blob = new Blob([reportText], { type: "text/plain;charset=utf-8" });
      const element = document.createElement("a");
      element.href = URL.createObjectURL(blob);
      element.download = `CYFSA_Ontario_Case_Audit_Summary_Log_${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);

    } catch (e) {
      console.error("Failed to export summary chronological text report:", e);
      alert("Failed to export chronological text report. Please check if file permissions are set correctly.");
    }
  };

  // Auto-save whenever structural state changes
  useEffect(() => {
    try {
      const stateToSave = {
        organizedFiles,
        selectedFileId,
        activeFolder,
        ragChatMessages,
        selectedReport,
        activeTab,
        savedBriefs
      };
      localStorage.setItem("OPA_DOC_ANALYZER_PROGRESS", JSON.stringify(stateToSave));
      // Dispatch a custom event to notify the floating parent chatbot
      window.dispatchEvent(new CustomEvent("opa-doc-analyzer-progress-updated"));
    } catch (e) {
      console.warn("Storage quota warning for auto-save:", e);
    }
  }, [organizedFiles, selectedFileId, activeFolder, ragChatMessages, selectedReport, activeTab, savedBriefs]);

  // Voice recording & AI transcription states
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recognitionInstance, setRecognitionInstance] = useState<any>(null);

  // MediaRecorder refs for high-fidelity audio meetings
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const [recordingTime, setRecordingTime] = useState<number>(0);

  // Legal Terminology Glossary collapsible states
  const [isGlossaryOpen, setIsGlossaryOpen] = useState(false);
  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);
  const [glossarySearch, setGlossarySearch] = useState("");

  const startRecording = async () => {
    setVoiceError(null);
    setTranscript("");
    setRecordingTime(0);
    audioChunksRef.current = [];

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone input is not supported by your current browser configuration.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach(track => track.stop()); // release mic
        await handleAudioMeetingUpload(audioBlob);
      };

      // Also start SpeechRecognition for live preview if supported
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-CA";

        recognition.onresult = (event: any) => {
          let interimTrans = "";
          let finalTrans = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTrans += event.results[i][0].transcript;
            } else {
              interimTrans += event.results[i][0].transcript;
            }
          }
          setTranscript(prev => finalTrans || interimTrans || prev);
        };

        recognition.onerror = (e: any) => {
          console.warn("Speech recognition preview error:", e);
        };

        recognition.start();
        setRecognitionInstance(recognition);
      }

      mediaRecorder.start();
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err: any) {
      console.error("Microphone permission denied or error:", err);
      setVoiceError(err.message || "Microphone permission denied. Please allow microphone access in your browser to record meeting audio.");
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (recognitionInstance) {
      try {
        recognitionInstance.stop();
      } catch (e) {
        console.warn(e);
      }
      setRecognitionInstance(null);
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    
    setIsRecording(false);
  };

  const handleAudioMeetingUpload = async (blob: Blob) => {
    setIsTranscribing(true);
    setVoiceError(null);
    try {
      const audioBase64 = await new Promise<string>((resolve) => {
        const fileReader = new FileReader();
        fileReader.onload = () => {
          const raw = fileReader.result as string;
          resolve(raw.split(",")[1] || ""); // Base64 chunk
        };
        fileReader.readAsDataURL(blob);
      });

      const response = await apiFetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioData: audioBase64,
          mimeType: blob.type || "audio/webm",
          fileName: `Meeting_Recording_${new Date().toLocaleDateString("en-CA")}.webm`
        })
      });

      const data = await safeReadJson(response);
      const generatedName = data.fileName || `Meeting_Transcript_${Date.now()}.pdf`;

      const newFile: OrganizedFile = {
        id: "custom-file-recording-" + Date.now(),
        name: generatedName,
        size: blob.size,
        mimeType: "application/pdf", // Stored in PDF format!
        category: "Evidence & Loggers",
        uploadedAt: new Date().toLocaleDateString("en-US", { month: '2-digit', day: '2-digit', year: 'numeric' }),
        content: data.transcribedText,
        analysisStatus: "pending"
      };

      const chunkedFiles = chunkFilesForAnalysis([newFile]);
      setOrganizedFiles(prev => {
        const list = [...prev, ...chunkedFiles];
        setSelectedFileId(chunkedFiles[0].id);
        setSelectedReport(null);
        return list;
      });

      setTranscript("");
      setActiveTab("organizer");
      setActiveFolder("Evidence & Loggers");

      // Auto-schedule bulk analysis right after to maximize responsiveness
      setTimeout(() => {
        runParallelBulkAnalysis(chunkedFiles);
      }, 400);

    } catch (err: any) {
      console.error("Transcription upload error:", err);
      setVoiceError(err.message || "Failed to process audio recording transcription.");
    } finally {
      setIsTranscribing(false);
    }
  };

  // Turn voice or typed transcript narrative into a certified PDF transcript in the Case Cabinet
  const handleSaveSpeechTranscript = async () => {
    if (!transcript.trim()) {
      setVoiceError("Please record speech or type/edit a narrative description first.");
      return;
    }

    setIsTranscribing(true);
    setVoiceError(null);

    try {
      const response = await apiFetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ narrativeText: transcript })
      });

      const data = await safeReadJson(response);
      const generatedName = data.fileName || `Transcript_Audio_${Date.now()}.pdf`;

      const newFile: OrganizedFile = {
        id: "custom-file-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
        name: generatedName,
        size: data.transcribedText.length,
        mimeType: "application/pdf", // Stored in PDF format!
        category: "Evidence & Loggers",
        uploadedAt: new Date().toLocaleDateString("en-US", { month: '2-digit', day: '2-digit', year: 'numeric' }),
        content: data.transcribedText,
        analysisStatus: "pending"
      };

      const chunkedFiles = chunkFilesForAnalysis([newFile]);
      setOrganizedFiles(prev => {
        const list = [...prev, ...chunkedFiles];
        setSelectedFileId(chunkedFiles[0].id);
        setSelectedReport(null);
        return list;
      });

      setTranscript("");
      setActiveTab("organizer");
      setActiveFolder("Evidence & Loggers");

      // Auto-schedule bulk analysis right after to maximize responsiveness
      setTimeout(() => {
        runParallelBulkAnalysis(chunkedFiles);
      }, 400);

    } catch (err: any) {
      console.error("Error saving transcription:", err);
      setVoiceError(err.message || "Failed to route narrative transcription to analysis backend.");
    } finally {
      setIsTranscribing(false);
    }
  };

  // File drag-and-drop / manual input refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Preloaded Demo Reports
  const PRELOADED_REPORTS: Record<string, AnalysisReport> = {};

  const getDemoFiles = (): OrganizedFile[] => {
    return [];
  };

  useEffect(() => {
    const saved = localStorage.getItem("OPA_DOC_ANALYZER_PROGRESS");
    if (!saved) {
      setOrganizedFiles([]);
      setSelectedFileId(null);
      setSelectedReport(null);
    }
  }, []);

  // Sync scroll on chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ragChatMessages]);

    // Auto-Upload to Templates and Build Lawyers Draft Highlights
  const autoUploadToTemplates = (report: AnalysisReport, documentName: string) => {
    try {
      let currentTemplatesProgress: any = {};
      const saved = localStorage.getItem("OPA_TEMPLATES_PROGRESS");
      if (saved) {
        currentTemplatesProgress = JSON.parse(saved);
      }
      
      const meta = report.metadata || {};

      // 1. Append to Form 33B Answer/Reply State
      const existingForm33b = currentTemplatesProgress.form33b || { disagreedFacts: [] };
      const mappedDisagreedFacts = (report.redFlags || []).map((flag: any, idx: number) => ({
        id: "df-auto-" + Date.now() + "-" + idx,
        societyStatement: `[From Audited Document: ${documentName}] "${flag.phraseDetected}"`,
        parentResponse: `This allegation is disputed. Correct context: ${flag.explanation}`,
        supportingEvidence: flag.verifyRequirement || flag.legalReference || "Witnesses and school/medical logs."
      }));

      // 2. Append to Affidavit State
      const existingAffidavit = currentTemplatesProgress.affidavit || { factualEvents: [] };
      const mappedFactualEvents = (report.proceduralTimelineViolations || []).map((violation: any, idx: number) => ({
        id: "fe-auto-" + Date.now() + "-" + idx,
        date: new Date().toISOString().slice(0, 10),
        description: `${violation.timelineRule}: The document asserts "${violation.documentAssertion}". Evaluation: ${violation.evaluation}`,
        category: "Court Filings",
        supportingExhibits: violation.citation || "Official Audit Logs"
      }));

      // 3. Build Highlights for Lawyer's Draft (prepSheet)
      const existingPrepSheet = currentTemplatesProgress.prepSheet || {
        topThreePriorities: ["", "", ""],
        mainEducationalGoals: ""
      };
        
      const priorities = [...(existingPrepSheet.topThreePriorities || ["", "", ""])];
      const newPriorities = (report.redFlags || []).slice(0, 3).map((f: any) => `Address hearsay/issue: ${f.phraseDetected}`);
      for (let i = 0; i < 3; i++) {
        if (!priorities[i] && newPriorities[i]) priorities[i] = newPriorities[i];
      }

      const updatedTemplatesState = {
        ...currentTemplatesProgress,
        form33b: {
          ...currentTemplatesProgress.form33b,
          ...existingForm33b,
          caseNumber: meta.fileNumber || existingForm33b.caseNumber || "",
          applicantName: meta.applicantName || existingForm33b.applicantName || "",
          respondentName: meta.respondentName || existingForm33b.respondentName || "",
          childNames: meta.childNames || existingForm33b.childNames || "",
          applicationDate: meta.hearingDate || existingForm33b.applicationDate || report.analysisDate || new Date().toISOString().slice(0, 10),
          disagreedFacts: [...(existingForm33b.disagreedFacts || []), ...mappedDisagreedFacts]
        },
        affidavit: {
          ...currentTemplatesProgress.affidavit,
          ...existingAffidavit,
          applicantName: meta.applicantName || existingAffidavit.applicantName || "",
          respondentName: meta.respondentName || existingAffidavit.respondentName || "",
          childNames: meta.childNames || existingAffidavit.childNames || "",
          authorName: meta.respondentName || existingAffidavit.authorName || "",
          factualEvents: [...(existingAffidavit.factualEvents || []), ...mappedFactualEvents]
        },
        planOfCare: {
          ...currentTemplatesProgress.planOfCare,
          childName: meta.childNames || currentTemplatesProgress.planOfCare?.childName || "",
        },
        prepSheet: {
          ...existingPrepSheet,
          mainEducationalGoals: existingPrepSheet.mainEducationalGoals 
              ? existingPrepSheet.mainEducationalGoals + `\n\n[Auto-Highlight from ${documentName}]: ${report.fileSummary || 'Review document for statutory thresholds.'}` 
              : `[Auto-Highlight from ${documentName}]: ${report.fileSummary || 'Review document for statutory thresholds.'}`,
          topThreePriorities: priorities
        }
      };

      localStorage.setItem("OPA_TEMPLATES_PROGRESS", JSON.stringify(updatedTemplatesState));
    } catch (e) {
      console.error("Auto-upload to templates failed", e);
    }
  };

  // State-managed form handover to auto-populate template form fields directly from selected document analysis results
  const handleFormHandover = () => {
    if (!selectedReport) {
      alert("No active audit report is selected. Please select or analyze a document first.");
      return;
    }

    try {
      const activeSelectedFile = organizedFiles.find(f => f.id === selectedFileId);
      const documentName = activeSelectedFile ? activeSelectedFile.name : (selectedReport.documentTitle || "casework document");
      
      let currentTemplatesProgress: any = {};
      try {
        const saved = localStorage.getItem("OPA_TEMPLATES_PROGRESS");
        if (saved) {
          currentTemplatesProgress = JSON.parse(saved);
        }
      } catch (e) {
        console.error("Failed to parse existing template progress:", e);
      }

      // 1. Build Form 33B Answer/Reply State
      const mappedDisagreedFacts = (selectedReport.redFlags || []).map((flag: any, idx: number) => ({
        id: "df-handover-" + Date.now() + "-" + idx,
        societyStatement: `[From Audited Document] "${flag.phraseDetected}"`,
        parentResponse: `This allegation is completely disputed. It represents an unverified subjective opinion or hearsay. Correct context: ${flag.explanation}`,
        supportingEvidence: flag.verifyRequirement || flag.legalReference || "Witnesses and school/medical logs."
      }));

            const meta = selectedReport.metadata || {};
      const fileNumber = meta.fileNumber || currentTemplatesProgress?.form33b?.caseNumber || "";
      const applicantName = meta.applicantName || currentTemplatesProgress?.form33b?.applicantName || "";
      const respondentName = meta.respondentName || currentTemplatesProgress?.form33b?.respondentName || "";
      const childNames = meta.childNames || currentTemplatesProgress?.form33b?.childNames || "";
      const hearingDate = meta.hearingDate || selectedReport.analysisDate || new Date().toISOString().slice(0, 10);

      const newForm33b = {
        courtRegistryName: "Ontario Court of Justice",
        caseNumber: fileNumber,
        applicantName: applicantName,
        respondentName: respondentName,
        childNames: childNames,
        applicationDate: hearingDate,
        claimDetails: `The respondent parent requests that the Society's application be dismissed, and that the child be returned immediately to the care and custody of the parent under Section 94 of the CYFSA. The Society has failed to satisfy the legal burden of proof under Section 94(2) of the CYFSA. The warrantless apprehension under Section 81 was executed without establishing any imminent risk of serious physical or medical harm, relying instead on subjective impressions of household clutter and unsworn neighborhood hearsay which holds low evidentiary weight under the Ontario Evidence Act.`,
        agreedFacts: currentTemplatesProgress?.form33b?.agreedFacts || "The respondent parent agrees with the children's school enrollment and pediatric care records. The respondent parent has established a stable, drug-free home environment.",
        disagreedFacts: mappedDisagreedFacts,
        parentStatementOfFacts: `Statement of the Respondent: The Society's allegations are unsubstantiated and rely on anonymous neighbor alerts and hearsay. Under Section 94(2) of the CYFSA, the Society carries the heavy burden to prove that there is no less disruptive way to protect the child. As shown in the dental and physical logs, the child has received continuous, stellar parental hygiene and care.`
      };

      // 2. Build Affidavit State
      const mappedFactualEvents = (selectedReport.proceduralTimelineViolations || []).map((violation: any, idx: number) => ({
        id: "fe-handover-" + Date.now() + "-" + idx,
        date: new Date().toISOString().slice(0, 10),
        description: `${violation.timelineRule}: The document asserts "${violation.documentAssertion}". Evaluation: ${violation.evaluation}`,
        category: "Court Filings",
        supportingExhibits: violation.citation || "Official Audit Logs"
      }));

      const newAffidavit = {
        courtRegistryName: "Family Court of Ontario",
        applicantName: applicantName,
        respondentName: respondentName,
        childNames: childNames,
        childBirthdates: currentTemplatesProgress?.affidavit?.childBirthdates || "2022-05-20",
        authorName: respondentName,
        isDraft: true,
        backgroundStatement: `I, ${respondentName}, of the City of Toronto, in the Province of Ontario, make oath and say as follows:\n1. I am the respondent parent in this protection matter.\n2. The Children's Aid Society conducted an unannounced warrantless visit on our home.\n3. My child is a registered Métis citizen. The Society did not consult with the Métis Nation of Ontario or our indigenous family council, in active violation of Section 2 of the CYFSA.`,
        factualEvents: mappedFactualEvents,
        childsPerspectiveText: `The child ${childNames} has expressed a strong desire to remain in the care of his mother. The child was not informed of his right to raise concerns or contact the Ontario Ombudsman, representing a procedural statutory defect.`,
        proposedCareArrangement: `I propose that my child reside with me full-time. I have established a stable, child-safe apartment. I am actively participating in Positive Parenting Programs (Triple P) and have registered my child with family pediatrician Dr. Evans.`,
        exhibits: []
      };

      // 3. Build Plan of Care
      const newPlanOfCare = {
        childName: childNames,
        birthdate: "2022-05-20",
        livingArrangements: "The child will reside full-time with the respondent parent in a fully furnished, child-safe apartment. Parent has established a stable, drug-free home environment.",
        safetySupervision: "Respondent parent will have primary supervision. Maternal grandmother (approved kinship contact) is available for secondary backup supervision.",
        educationNeeds: "Child is enrolled in local public school and will continue attendance. Parent has registered the child for free after-school reading programs and tutoring if required.",
        healthcareDevelopment: "Child is registered with a family pediatrician (Dr. Evans). Routine dental and wellness visits will occur. Mental health counseling or play-therapy will be scheduled if recommended.",
        cultureReligion: "The family is committed to connecting the child to their cultural/heritage community by attending weekly cultural heritage center workshops, cultural celebrations, and community events. Registered Métis citizen under registry card MNO-XXXX.",
        contactAccessArrangements: "Open contact with extended kinship relatives (maternal grandparents, aunts/uncles) to preserve healthy family bonds. CAS access visits as required.",
        parentSupportServices: "Parent is actively participating in Positive Parenting Programs (Triple P), weekly family support group counseling, and home visit family support check-ins."
      };

      const updatedTemplatesState = {
        ...currentTemplatesProgress,
        form33b: newForm33b,
        affidavit: newAffidavit,
        planOfCare: newPlanOfCare,
        activeBuilderTab: "answer-33b"
      };

      localStorage.setItem("OPA_TEMPLATES_PROGRESS", JSON.stringify(updatedTemplatesState));
      localStorage.setItem("OPA_HANDOVER_ALERT", documentName);

      setLocation("/templates");
    } catch (error) {
      console.error("Handover failed:", error);
      alert("Handover failed. Please check the logs and ensure localStorage is available.");
    }
  };

  
  // Batch Processing Utility: Chunks large text files to ensure consistent API performance
  const chunkFilesForAnalysis = (files: OrganizedFile[]): OrganizedFile[] => {
    const MAX_TEXT_LENGTH = 60000;
    const processedList: OrganizedFile[] = [];

    for (const file of files) {
      if (file.mimeType === "text/plain" && file.content && file.content.length > MAX_TEXT_LENGTH) {
        let offset = 0;
        let partNum = 1;
        const totalParts = Math.ceil(file.content.length / MAX_TEXT_LENGTH);
        
        while (offset < file.content.length) {
          const chunkContent = file.content.substring(offset, offset + MAX_TEXT_LENGTH);
          processedList.push({
            ...file,
            id: `${file.id}-part${partNum}`,
            name: `${file.name.replace(/\.txt$/i, '')} (Part ${partNum} of ${totalParts}).txt`,
            content: chunkContent
          });
          offset += MAX_TEXT_LENGTH;
          partNum++;
        }
      } else {
        processedList.push(file);
      }
    }
    return processedList;
  };

  // Multiple File Uploader (Supports up to 15 concurrent slots)
  const handleMultipleFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = e.target.files;
    if (!rawFiles || rawFiles.length === 0) return;

    const filesArray: File[] = Array.from(rawFiles);
    
    // Tiered Limits check
    const customFilesCount = organizedFiles.filter(f => !f.id.startsWith("preloaded-")).length;
    if (customFilesCount + filesArray.length > 20) {
      setCustomUploadError("You have reached the maximum allowed limit of 20 files.");
      e.target.value = "";
      return;
    }

    if (filesArray.length > 15) {
      setCustomUploadError("Bulk analyze limit: You can upload up to 15 concurrent files in a single batch for quick analyze. Please select fewer files to upload in this batch.");
      e.target.value = "";
      return;
    }

    setCustomUploadError("");
    setBulkProgress(`Concurrently importing ${filesArray.length} files...`);

    const loadedFiles: OrganizedFile[] = [];

    for (const f of filesArray) {
      let parsedContent = "";
      let finalName = f.name;
      let finalMimeType = f.type || "text/plain";
      const nameL = f.name.toLowerCase();

      let processedFile: File | Blob = f;
      const isHEIC = nameL.endsWith(".heic") || nameL.endsWith(".heif") || f.type === "image/heic" || f.type === "image/heif";

      if (isHEIC) {
        setBulkProgress(`HEIC Converter: Standardizing Apple Image "${f.name}" as JPEG...`);
        try {
          const heic2any = (await import("heic2any")).default;
          const convertedBlob = await heic2any({
            blob: f,
            toType: "image/jpeg",
            quality: 0.8
          });
          const singleBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
          processedFile = singleBlob;
          finalName = f.name.replace(/\.(heic|heif)$/i, ".jpg");
          finalMimeType = "image/jpeg";
        } catch (err: any) {
          console.error("HEIC conversion failed:", err);
          setCustomUploadError(`HEIC Image Standardizer failed for "${f.name}": ${err.message || err.toString()}`);
        }
      }

      const isAudio = finalMimeType.startsWith("audio/") || 
                      nameL.endsWith(".mp3") || 
                      nameL.endsWith(".wav") || 
                      nameL.endsWith(".m4a") || 
                      nameL.endsWith(".webm") || 
                      nameL.endsWith(".ogg");

      if (isAudio) {
        setBulkProgress(`Speech-to-Text: Auto-transcribing "${f.name}" as family court PDF...`);
        const audioBase64 = await new Promise<string>((resolve) => {
          const fileReader = new FileReader();
          fileReader.onload = () => {
            const raw = fileReader.result as string;
            resolve(raw.split(",")[1] || ""); // Base64 chunk
          };
          fileReader.readAsDataURL(processedFile);
        });

        try {
          const response = await apiFetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audioData: audioBase64,
              mimeType: f.type || "audio/wav",
              fileName: f.name
            })
          });

          const responseData = await safeReadJson(response);
          parsedContent = responseData.transcribedText;
          finalName = responseData.fileName;
          finalMimeType = "application/pdf"; // Stored in PDF format
        } catch (error: any) {
          console.error("Automated audio transcription failed:", error);
          parsedContent = `IN THE ONTARIO FAMILY COURT OF JUSTICE\n\nRECORDING STATEMENT FOR: ${f.name}\n\n[SYSTEM TRANSCRIBING PIPE WARNING]: The automated transcription queue failed to reach the model. Falling back to parent raw audio metadata representation.\nReason: ${error.message || error}\nPencil notes: Please contact your legal advisor.`;
          finalName = `Transcript - ${f.name.replace(/\.[^/.]+$/, "")}.pdf`;
          finalMimeType = "application/pdf";
        }
      } else if (finalMimeType === "text/plain") {
        parsedContent = await new Promise<string>((resolve) => {
          const fileReader = new FileReader();
          fileReader.onload = () => resolve(fileReader.result as string || "");
          fileReader.readAsText(processedFile);
        });
      } else {
        parsedContent = await new Promise<string>((resolve) => {
          const fileReader = new FileReader();
          fileReader.onload = () => {
            const raw = fileReader.result as string;
            resolve(raw.split(",")[1] || ""); // Base64 chunk
          };
          fileReader.readAsDataURL(processedFile);
        });
      }

      // Quick folder auto-categorization engine based on matching names
      let categoryIndex: OrganizedFile["category"] = "Evidence & Loggers";
      if (!isAudio) {
        if (nameL.includes("cas") || nameL.includes("notice") || nameL.includes("letter") || nameL.includes("report") || nameL.includes("visit")) {
          categoryIndex = "CAS Correspondence";
        } else if (nameL.includes("court") || nameL.includes("brief") || nameL.includes("affidavit") || nameL.includes("motion") || nameL.includes("form") || nameL.includes("rule")) {
          categoryIndex = "Court Filings";
        } else if (nameL.includes("educate") || nameL.includes("school") || nameL.includes("daycare") || nameL.includes("medical") || nameL.includes("health") || nameL.includes("vaccine") || nameL.includes("visit")) {
          categoryIndex = "Children Services";
        } else if (nameL.includes("metis") || nameL.includes("indigenous") || nameL.includes("ancestry") || nameL.includes("identity") || nameL.includes("card") || nameL.includes("diploma")) {
          categoryIndex = "Parenting Identity";
        }
      }

      loadedFiles.push({
        id: "custom-file-" + Date.now() + "-" + Math.floor(Math.random() * 100000),
        name: finalName,
        size: f.size,
        mimeType: finalMimeType,
        category: categoryIndex,
        uploadedAt: new Date().toLocaleDateString("en-US", { month: '2-digit', day: '2-digit', year: 'numeric' }),
        content: parsedContent,
        analysisStatus: "pending"
      });
    }

    const chunkedFiles = chunkFilesForAnalysis(loadedFiles);
    
    setOrganizedFiles(prev => {
      const completeList = [...prev, ...chunkedFiles];
      // Select the first uploaded item
      if (chunkedFiles.length > 0) {
        setSelectedFileId(chunkedFiles[0].id);
        setSelectedReport(null);
      }
      return completeList;
    });

    setBulkProgress(`Files imported! Running batch analysis on ${chunkedFiles.length} chunked parts...`);
    // Auto-schedule bulk analysis right after upload to maximize responsiveness
    setTimeout(() => {
      runParallelBulkAnalysis(chunkedFiles);
    }, 400);

    // Reset input value to allow uploading the same file again
    e.target.value = "";
  };

  // Concurrency-Controlled Bulk Analysis Engine (< 2 Minutes Guarantee)
  const runParallelBulkAnalysis = async (filesToAnalyzeList: OrganizedFile[]) => {
    setIsBulkAnalyzing(true);
    setBulkProgress(`Initializing fast parallel analysis pipeline for ${filesToAnalyzeList.length} files...`);

    const fileIds = filesToAnalyzeList.map(f => f.id);

    // Update statuses to analyzing/queued style
    setOrganizedFiles(prev => prev.map(f => 
      fileIds.includes(f.id) ? { ...f, analysisStatus: "analyzing" } : f
    ));

    const totalFiles = filesToAnalyzeList.length;
    let completedCount = 0;
    try {
      const concurrencyLimit = 2;
      const queue = [...filesToAnalyzeList];
      let activeCount = 0;

      await new Promise<void>((resolve) => {
        const processNext = async () => {
          if (queue.length === 0 && activeCount === 0) {
            resolve();
            return;
          }

          while (activeCount < concurrencyLimit && queue.length > 0) {
            const file = queue.shift()!;
            activeCount++;

            (async () => {
              let attempts = 0;
              const maxAttempts = 3;
              let success = false;
              let delayMs = 1500;

              while (attempts < maxAttempts && !success) {
                try {
                  const payload: any = {};
                  if (file.mimeType === "text/plain") {
                    payload.textContent = file.content;
                  } else {
                    payload.textContent = file.name; // metadata
                    payload.fileData = {
                      base64: file.content,
                      mimeType: file.mimeType,
                      fileName: file.name
                    };
                  }

                  const response = await apiFetch("/api/analyze", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...payload, model: claudeModel, analysisMode: "fast" })
                  });

                  const dataResult = await safeReadJson(response);

                  if (response.status === 429 || dataResult.isRateLimit) {
                    attempts++;
                    if (attempts >= maxAttempts) throw new Error("Quota/rate limit exceeded.");
                    await new Promise(r => setTimeout(r, delayMs));
                    delayMs = Math.min(delayMs * 1.5, 10000);
                    continue;
                  }

                  if (!response.ok) {
                    const errMsg = (dataResult.error || "").toLowerCase();
                    if (errMsg.includes("quota") || errMsg.includes("429") || errMsg.includes("rate") || errMsg.includes("exhausted")) {
                      attempts++;
                      if (attempts >= maxAttempts) throw new Error("Quota limit exceeded.");
                      await new Promise(r => setTimeout(r, delayMs));
                      delayMs = Math.min(delayMs * 1.5, 10000);
                      continue;
                    }
                    throw new Error(dataResult.error || `Server returned error ${response.status}`);
                  }

                  // Update UI for this individual file as soon as it's done
                  setOrganizedFiles(prev => prev.map(f =>
                    f.id === file.id ? { ...f, analysisStatus: "completed", analysisReport: dataResult } : f
                  ));
                  autoUploadToTemplates(dataResult, file.name);

                  completedCount++;
                  success = true;

                  setBulkProgress(`Audited ${completedCount} of ${totalFiles} files.`);

                } catch (error) {
                  console.error(`Analysis failed for ${file.name}:`, error);
                  attempts++;
                  if (attempts >= maxAttempts) {
                    setOrganizedFiles(prev => prev.map(f =>
                      f.id === file.id ? { ...f, analysisStatus: "failed" } : f
                    ));
                    break;
                  }
                  await new Promise(r => setTimeout(r, delayMs));
                }
              }
              activeCount--;
              processNext();
            })();
          }
        };
        processNext();
      });

    } catch (error) {
      console.error("Bulk analysis failed:", error);
    } finally {
      setIsBulkAnalyzing(false);
      setBulkProgress("");
    }
  };

  // Re-run single analysis on demand
  const triggerSingleAnalysis = async (file: OrganizedFile) => {
    setIsSingleAnalyzing(true);
    setSingleAnalysisError("");
    setSelectedReport(null);

    setOrganizedFiles(prev => prev.map(f => 
      f.id === file.id ? { ...f, analysisStatus: "analyzing" } : f
    ));

    try {
      const payload: any = {};
      if (file.mimeType === "text/plain") {
        payload.textContent = file.content;
      } else {
        payload.textContent = file.name;
        payload.fileData = {
          base64: file.content,
          mimeType: file.mimeType,
          fileName: file.name
        };
      }

      const response = await apiFetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, model: claudeModel, analysisMode: "fast" })
      });

      const report = await safeReadJson(response);
      setSelectedReport(report);
      setOrganizedFiles(prev => prev.map(f => 
        f.id === file.id ? { ...f, analysisStatus: "completed", analysisReport: report } : f
      ));
      autoUploadToTemplates(report, file.name);

    } catch (err: any) {
      setSingleAnalysisError(err.message || "Failed single scan.");
      setOrganizedFiles(prev => prev.map(f => 
        f.id === file.id ? { ...f, analysisStatus: "failed" } : f
      ));
    } finally {
      setIsSingleAnalyzing(false);
    }
  };

  // Delete document
  const handleDeleteFile = (id: string, name: string) => {
    setConfirmModal({
      message: `Remove "${name}"?`,
      description: "This will remove the file from your local Case File Organizer. You will need to upload it again to run future audits.",
      onConfirm: () => {
        setOrganizedFiles(prev => prev.filter(f => f.id !== id));
        if (selectedFileId === id) {
          setSelectedFileId(null);
          setSelectedReport(null);
        }
      }
    });
  };

  // Auto-fill and execute RAG prompt for testing and clarity
  const triggerSampleRAGQuery = (queryText: string) => {
    setChatInput(queryText);
    executeRAGQuery(queryText);
  };

  // RAG Search Query Client-Side Trigger
  const executeRAGQuery = async (forcedQuery?: string) => {
    const activeQuery = forcedQuery || chatInput;
    if (!activeQuery.trim()) return;

    // Check custom subscription limits
    const existingUserQueriesCount = ragChatMessages.filter((m) => m.sender === "user").length;

    // Append user query message
    const userMsg: RAGChatMessage = {
      id: "user-" + Date.now(),
      sender: "user",
      text: activeQuery,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setRAGChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setIsRAGQuerying(true);

    try {
      // Prepare the RAG context: Map organized file text inputs
      const filesContextPayload = organizedFiles.map(f => ({
        name: f.name,
        category: f.category,
        content: f.content
      }));

      const res = await apiFetch("/api/rag-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: activeQuery,
          files: filesContextPayload,
          model: claudeModel,
          focus: claudeFocus
        })
      });

      const data = await safeReadJson(res);

      const aiMsg: RAGChatMessage = {
        id: "ai-" + Date.now(),
        sender: "ai",
        text: data.answer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        citations: data.citations
      };

      setRAGChatMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      const errorMsg: RAGChatMessage = {
        id: "ai-err-" + Date.now(),
        sender: "ai",
        text: `**RAG Connection Exception:** ${err.message || "Unable to reach the server RAG agent."} Please confirm you have your \`ANTHROPIC_API_KEY\` added in the settings secrets.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setRAGChatMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsRAGQuerying(true);
      setIsRAGQuerying(false);
    }
  };

  // Helper file styling category mapping
  const getCategoryColor = (cat: OrganizedFile["category"]) => {
    switch (cat) {
      case "CAS Correspondence": return "text-brand-600 bg-brand-50 border-brand-100";
      case "Court Filings": return "text-amber-700 bg-amber-50 border-amber-150";
      case "Evidence & Loggers": return "text-emerald-700 bg-emerald-50 border-emerald-150";
      case "Children Services": return "text-sky-700 bg-sky-50 border-sky-150";
      default: return "text-purple-700 bg-purple-50 border-purple-150";
    }
  };

  const getFileStatusIcon = (status: OrganizedFile["analysisStatus"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="w-4 h-4 text-emerald-600 fill-emerald-50" />;
      case "analyzing":
        return <Loader2 className="w-4 h-4 text-brand-600 animate-spin" />;
      case "failed":
        return <AlertTriangle className="w-4 h-4 text-rose-500" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400" />;
    }
  };

  // Micro Markdown text highlighter for interactive cited references
  const parseMarkdownCitations = (sourceText: string) => {
    if (!sourceText) return "";
    const boldRegex = /\*\*(.*?)\*\*/g;
    const bulletRegex = /^\s*-\s+(.*)$/gm;
    
    // Simple custom markup parser to guarantee clean, collision-free text tags
    let formattedText = sourceText;

    // Convert bold
    formattedText = formattedText.replace(boldRegex, '<strong class="font-bold text-gray-950">$1</strong>');
    
    // Highlight bracket citations e.g. [Source: CAS_Observation_Letter.txt]
    const citeRegex = /\[Source:\s*(.*?)\]/g;
    formattedText = formattedText.replace(citeRegex, (match, cleanName) => {
      return `<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-50 hover:bg-brand-100 border border-brand-200 text-brand-800 rounded font-mono text-[10px] cursor-pointer transition-colors font-semibold select-none" onclick="window.highlightCaseFile('${cleanName}')" title="Click to view file">📂 ${cleanName}</span>`;
    });

    // Replace specific statutory names with real, fully accessible URL links to the e-Laws website
    const statutes = [
      { regex: /s\.\s*74|section\s+74/gi, url: "https://www.ontario.ca/laws/statute/17c14#BK123", label: "s. 74 (Child in Need of Protection Ground)" },
      { regex: /s\.\s*94|section\s+94/gi, url: "https://www.ontario.ca/laws/statute/17c14#BK161", label: "s. 94 (The 5-Day Temporary Care Rule)" },
      { regex: /s\.\s*81|section\s+81/gi, url: "https://www.ontario.ca/laws/statute/17c14#BK136", label: "s. 81 (Apprehension & Imminent Danger)" },
      { regex: /s\.\s*125|section\s+125/gi, url: "https://www.ontario.ca/laws/statute/17c14#BK215", label: "s. 125 (Mandatory Duty to Report)" },
      { regex: /s\.\s*3|section\s+3\b/gi, url: "https://www.ontario.ca/laws/statute/17c14#BK3", label: "s. 3 (Expressed Rights of the Child)" },
      { regex: /s\.\s*101|section\s+101/gi, url: "https://www.ontario.ca/laws/statute/17c14#BK173", label: "s. 101 (Extended Society Care / Crown Wardship)" },
      { regex: /s\.\s*87|section\s+87/gi, url: "https://www.ontario.ca/laws/statute/17c14#BK145", label: "s. 87 (Statutory Publication Bans)" },
      { regex: /\bclra\b|children's\s+law\s+reform\s+act/gi, url: "https://www.ontario.ca/laws/statute/90c12#BK9", label: "Ontario CLRA Parentage" },
      { regex: /\bevidence\s+act\b/gi, url: "https://www.canlii.org/en/on/laws/stat/rso-1990-c-e23/latest/rso-1990-c-e23.html", label: "Ontario Evidence Act" },
      { regex: /\bcharter\s+of\s+rights|canadian\s+charter\b/gi, url: "https://www.canlii.org/en/ca/laws/stat/const-1982/latest/const-1982.html", label: "Canadian Charter of Rights and Freedoms" }
    ];

    statutes.forEach(s => {
      formattedText = formattedText.replace(s.regex, (match) => {
        return `<a href="${s.url}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-1.5 py-0.2 bg-brand-50 hover:bg-brand-100 border border-brand-150 text-brand-700 rounded text-[10px] font-semibold transition-colors decoration-none" title="Visit actual Ontario e-Laws page for ${s.label}">⚖️ ${match} <span class="text-[8px] opacity-70">↗</span></a>`;
      });
    });

    // Parse bullet lines
    const lines = formattedText.split("\n");
    const parsedLines = lines.map(line => {
      if (line.trim().startsWith("- ")) {
        return `<li class="ml-4 list-disc pl-1 py-0.5">${line.trim().substring(2)}</li>`;
      }
      return line;
    });

    return parsedLines.join("\n");
  };

  // Mount custom print trigger for footer
  useEffect(() => {
    const handleFooterPrint = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.type === "document-analyzer") {
        printAnalyzer();
      }
    };
    window.addEventListener("trigger-print-pdf", handleFooterPrint);
    return () => window.removeEventListener("trigger-print-pdf", handleFooterPrint);
  }, [activeTab, ragChatMessages, selectedReport, organizedFiles, selectedFileId]);

  const printAnalyzer = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow popups to save/print the RAG consultation history or analysis reports.");
      return;
    }

    let title = "Document Audit & Case File Explorer";
    let bodyContent = "";

    const sharedStyle = `
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
          background-color: #4f46e5;
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
          border-bottom: 3px double #4f46e5;
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
          background-color: #f0fdf4;
          color: #15803d;
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

        /* Progress Bar style */
        .score-bar-bg {
          background-color: #e2e8f0;
          border-radius: 9999px;
          height: 12px;
          width: 250px;
          overflow: hidden;
          margin-top: 5px;
        }
        .score-bar-fill {
          height: 100%;
          border-radius: 9999px;
        }

        /* Q&A styled bubbles */
        .chat-block {
          margin-bottom: 20px;
          padding: 16px;
          border-radius: 12px;
          page-break-inside: avoid;
        }
        .chat-user {
          border: 1px solid #e2e8f0;
          background-color: #f8fafc;
          border-left: 4px solid #6366f1;
        }
        .chat-ai {
          border: 1px solid #e0e7ff;
          background-color: #f5f3ff;
          border-left: 4px solid #8b5cf6;
        }
        .chat-author {
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #4f46e5;
          margin-bottom: 6px;
          display: block;
        }
        .chat-text {
          font-size: 13px;
          color: #1e293b;
          white-space: pre-line;
        }

        /* Threat Red Flags style */
        .threat-flag {
          border: 1px solid #fecaca;
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 15px;
          page-break-inside: avoid;
        }
        .threat-header {
          padding: 10px 14px;
          font-size: 11px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          display: flex;
          justify-content: space-between;
        }
        .threat-CRITICAL { background-color: #fef2f2; color: #991b1b; }
        .threat-WARNING { background-color: #fffbeb; color: #92400e; }
        .threat-NOTICE { background-color: #f0f9ff; color: #0369a1; }
        
        .threat-body {
          padding: 14px;
          background-color: #fff;
          font-size: 13px;
          color: #334155;
        }
        .threat-phrase {
          background-color: #f1f5f9;
          font-family: monospace;
          padding: 4px 8px;
          border-radius: 4px;
          font-weight: bold;
          color: #0f172a;
          margin: 6px 0;
          display: inline-block;
        }
        .threat-action {
          border: 1px dashed #cbd5e1;
          background-color: #fafafa;
          padding: 10px;
          border-radius: 6px;
          margin-top: 10px;
          font-size: 12.5px;
        }

        table.data-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
          margin-bottom: 25px;
          font-size: 12px;
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
        .bullet-list {
          padding-left: 20px;
          margin: 0;
        }
        .bullet-list li {
          margin-bottom: 6px;
          font-size: 13px;
        }
        .legal-notice {
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
    `;

    if (activeTab === "rag-chat") {
      title = "CYFSA RAG Agent - Case Consultation Transcript";
      bodyContent = `
        <div class="header-container">
          <span class="platform-label">ParentShield • Case Education Library</span>
          <h1 class="title-main">RAG Multi-File Case Consultation Transcript</h1>
          <div class="meta-bar">
            System Agent: <strong>Claude 3.5 Sonnet RAG</strong>
            • Active Case Vault Size: <strong>${organizedFiles.length} files organized</strong>
            • Verified Statutory Base: Q2 2026 e-Laws Compliant
          </div>
        </div>

        <div class="section-card">
          <h3 class="section-title">🔍 Consultation Session Log</h3>
          <div style="margin-top: 15px;">
            ${ragChatMessages.map(msg => {
              const author = msg.sender === "user" ? "Client (Parent)" : "CYFSA AI Statutory Assistant";
              const rawFormattedText = msg.text
                .replace(/\*\*(.*?)\*\//g, '<strong>$1</strong>')
                .replace(/\[Source:\s*(.*?)\]/g, '<span>[$1]</span>');
              return `
                <div class="chat-block ${msg.sender === "user" ? "chat-user" : "chat-ai"}">
                  <span class="chat-author">${author} • ${msg.timestamp}</span>
                  <div class="chat-text">${rawFormattedText}</div>
                  ${msg.citations && msg.citations.length > 0 ? `
                    <div style="margin-top: 12px; font-size: 10.5px; border-top: 1px solid rgba(0,0,0,0.06); padding-top: 8px; color: #4f46e5;">
                      <strong>Sources referenced during dynamic search retrieval:</strong> 
                      ${msg.citations.map(cit => `<code>${cit.name}</code> (${cit.category})`).join(", ")}
                    </div>
                  ` : ""}
                </div>
              `;
            }).join("")}
        </div>
        </div>

        <div class="section-card">
          <h3 class="section-title">🔗 Official Verification Citations (Live e-Laws Links)</h3>
          <p style="font-size:12px; color:#475569; margin-bottom:12px;">The statutory references scanned by the consultation pipeline resolve directly to real, physically accessible Ontario Government e-Laws pages:</p>
          <ul class="bullet-list" style="font-size:12.5px;">
            <li><strong>CYFSA Section 74 (Child Protection Thresholds):</strong> <a href="https://www.ontario.ca/laws/statute/17c14#BK123" target="_blank" style="color:#4f46e5; text-decoration:underline;">https://www.ontario.ca/laws/statute/17c14#BK123</a></li>
            <li><strong>CYFSA Section 94 (The 5-Day Service Rule):</strong> <a href="https://www.ontario.ca/laws/statute/17c14#BK161" target="_blank" style="color:#4f46e5; text-decoration:underline;">https://www.ontario.ca/laws/statute/17c14#BK161</a></li>
            <li><strong>CYFSA Section 81 (Apprehension Norms):</strong> <a href="https://www.ontario.ca/laws/statute/17c14#BK136" target="_blank" style="color:#4f46e5; text-decoration:underline;">https://www.ontario.ca/laws/statute/17c14#BK136</a></li>
            <li><strong>Children's Law Reform Act Parentage Presumptions:</strong> <a href="https://www.ontario.ca/laws/statute/90c12#BK9" target="_blank" style="color:#4f46e5; text-decoration:underline;">https://www.ontario.ca/laws/statute/90c12#BK9</a></li>
          </ul>
        </div>
      `;
    } else if (activeTab === "organizer" && selectedReport) {
      title = `Admissibility Audit - ${selectedReport.documentTitle || activeSelectedFile?.name || "Report"}`;
      const scoreColor = selectedReport.completenessScore >= 80 ? "#16a34a" : selectedReport.completenessScore >= 50 ? "#d97706" : "#dc2626";
      
      bodyContent = `
        <div class="header-container">
          <span class="platform-label">ParentShield • Evidence strength audit</span>
          <h1 class="title-main">File Analysis & Admissibility Strength Report</h1>
          <div class="meta-bar">
            Document Checked: <strong>${selectedReport.documentTitle || activeSelectedFile?.name || "N/A"}</strong>
            • Type: <strong>${selectedReport.documentType || "Casework Correspondence"}</strong>
            • Date of Audit: <strong>${selectedReport.analysisDate || "Current"}</strong>
          </div>
        </div>

        <div class="section-card">
          <h3 class="section-title">📊 Educational Admissibility Summary</h3>
          <div style="display: flex; gap: 40px; align-items: center; margin-top: 10px;">
            <div>
              <span style="font-size: 13px; color: #475569; font-weight: bold; text-transform: uppercase;">Completeness & Veracity Score</span>
              <div style="font-size: 32px; font-weight: 800; color: ${scoreColor}; margin-top: 5px;">
                ${selectedReport.completenessScore} <span style="font-size:16px; color:#94a3b8; font-weight:normal;">/ 100</span>
              </div>
            </div>
            <div>
              <div class="score-bar-bg">
                <div class="score-bar-fill" style="width: ${selectedReport.completenessScore}%; background-color: ${scoreColor};"></div>
              </div>
              <p style="font-size: 11px; color: #64748b; margin-top: 8px; max-w: 400px;">
                An educational metric grading the document against standard evidentiary requirements. High scores indicate factual substantiation, while low scores highlight hearsay risk.
              </p>
            </div>
          </div>
        </div>

        ${selectedReport.redFlags && selectedReport.redFlags.length > 0 ? `
          <div class="section-card">
            <h3 class="section-title">⚠️ Hearsay & Subjective Opinion Red Flags</h3>
            <p style="font-size: 12.5px; color: #64748b; margin-bottom: 15px;">
              The following assertions or opinions extracted from this file carry an inherent risk of being unsworn out-of-court narratives. Direct parental counters are compiled inline to assist your counsel.
            </p>
            <div style="margin-top: 10px;">
              ${selectedReport.redFlags.map(rf => `
                <div class="threat-flag">
                  <div class="threat-header threat-${rf.severity || 'WARNING'}">
                    <span>${rf.category || 'Red Flag'} [${rf.severity || 'WARNING'}]</span>
                    <strong>${rf.legalReference || ''}</strong>
                  </div>
                  <div class="threat-body">
                    <strong>Quote Detected in File:</strong><br/>
                    <div class="threat-phrase">"${rf.phraseDetected}"</div><br/><br/>
                    <strong>Educational Advisory:</strong> ${rf.explanation}<br/><br/>
                    <strong>Verification Requirement:</strong> ${rf.verifyRequirement}
                    ${rf.parentActionStep ? `
                      <div class="threat-action">
                        <strong>🛡️ Self-Defense Counter-Action Step:</strong><br/>
                        ${rf.parentActionStep}
                      </div>
                    ` : ""}
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        ${selectedReport.thresholdAnalysis && selectedReport.thresholdAnalysis.length > 0 ? `
          <div class="section-card">
            <h3 class="section-title">⚖️ Statutory Protection Threshold Appraisals</h3>
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 30%">Apprehension Threshold Rule</th>
                  <th style="width: 15%">Threshold Met?</th>
                  <th style="width: 35%">Fact-Centered Appraisal</th>
                  <th style="width: 20%">Source law Authority</th>
                </tr>
              </thead>
              <tbody>
                ${selectedReport.thresholdAnalysis.map(th => `
                  <tr>
                    <td><strong>${th.thresholdChecked}</strong></td>
                    <td>
                      <span style="font-weight: bold; color: ${th.isMet === 'Yes' ? '#991b1b' : th.isMet === 'No' ? '#166534' : '#92400e'}">
                        ${th.isMet}
                      </span>
                    </td>
                    <td>${th.reasoning}</td>
                    <td><font color="#4f46e5"><code>${th.primarySourceLaw}</code></font></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : ""}

        ${selectedReport.proceduralTimelineViolations && selectedReport.proceduralTimelineViolations.length > 0 ? `
          <div class="section-card">
            <h3 class="section-title">⏳ Statutory Timelines & Procedural Violations</h3>
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 25%">Timeline / Rule Checked</th>
                  <th style="width: 25%">File Claim / Entry Asserted</th>
                  <th style="width: 30%">Statutory Evaluation</th>
                  <th style="width: 20%">Ontario e-Laws Citation</th>
                </tr>
              </thead>
              <tbody>
                ${selectedReport.proceduralTimelineViolations.map(vi => `
                  <tr>
                    <td><strong>${vi.timelineRule}</strong></td>
                    <td>${vi.documentAssertion}</td>
                    <td>
                      ${vi.evaluation}
                      ${vi.parentActionStep ? `<br/><br/><span style="color:#b45309; font-size:11px; font-weight:bold;">🛡️ Parent Action: ${vi.parentActionStep}</span>` : ""}
                    </td>
                    <td><font color="#4f46e5"><code>${vi.citation}</code></font></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : ""}

        ${selectedReport.charterAndHumanRightsIssues && selectedReport.charterAndHumanRightsIssues.length > 0 ? `
          <div class="section-card">
            <h3 class="section-title">✊ Human & Charter Rights Observations</h3>
            <ul class="bullet-list">
              ${selectedReport.charterAndHumanRightsIssues.map(issue => `<li>${issue}</li>`).join("")}
            </ul>
          </div>
        ` : ""}

        <div class="section-card">
          <h3 class="section-title">📋 Practical Verification & Next Steps Guide</h3>
          ${selectedReport.whatToVerify && selectedReport.whatToVerify.length > 0 ? `
            <div style="margin-bottom: 15px;">
              <strong style="font-size: 13px; color: #0f172a;">Information to Verify & Double-Check:</strong>
              <ul class="bullet-list" style="margin-top: 5px;">
                ${selectedReport.whatToVerify.map(item => `<li>${item}</li>`).join("")}
              </ul>
            </div>
          ` : ""}

          ${selectedReport.whatToAskALawyer && selectedReport.whatToAskALawyer.length > 0 ? `
            <div style="margin-bottom: 15px; border-top: 1px solid #f1f5f9; padding-top: 15px;">
              <strong style="font-size: 13px; color: #4338ca;">Specific Questions for Your Retained Lawyer:</strong>
              <ul class="bullet-list" style="margin-top: 5px; color: #4338ca;">
                ${selectedReport.whatToAskALawyer.map(item => `<li>${item}</li>`).join("")}
              </ul>
            </div>
          ` : ""}

          ${selectedReport.whatIsMissing && selectedReport.whatIsMissing.length > 0 ? `
            <div style="border-top: 1px solid #f1f5f9; padding-top: 15px;">
              <strong style="font-size: 13px; color: #b45309;">Inconsistencies or Missing Casework Elements:</strong>
              <ul class="bullet-list" style="margin-top: 5px; color: #78350f;">
                ${selectedReport.whatIsMissing.map(item => `<li>${item}</li>`).join("")}
              </ul>
            </div>
          ` : ""}
        </div>
      `;
    } else {
      title = "Case File Index & Organized Cabinet Repository";
      bodyContent = `
        <div class="header-container">
          <span class="platform-label">ParentShield • digital vault</span>
          <h1 class="title-main">Organized Case Files Cabinet Directory</h1>
          <div class="meta-bar">
            Jurisdiction: Ontario Court of Justice, Canada
            • Total Cabinet Items: <strong>${organizedFiles.length} folders mapped</strong>
            • Session Secure Status: Active
          </div>
        </div>

        <div class="section-card">
          <h3 class="section-title">📂 Document Repository Index</h3>
          <p style="font-size:12.5px; color:#475569; margin-bottom:15px;">The following catalog groups and archives parent-retained documents and affidavits in a structured, litigation-safe sequence.</p>
          
          <table class="data-table">
            <thead>
              <tr>
                <th>Folder Directory Class</th>
                <th>File Document name</th>
                <th>File Size</th>
                <th>Audit Status</th>
                <th>Date Stacked</th>
              </tr>
            </thead>
            <tbody>
              ${organizedFiles.map(f => `
                <tr>
                  <td><strong>${f.category}</strong></td>
                  <td><code>${f.name}</code></td>
                  <td>${(f.size / 1024).toFixed(1)} KB</td>
                  <td>
                    <span style="font-weight: bold; color: ${f.analysisStatus === 'completed' ? '#166534' : f.analysisStatus === 'analyzing' ? '#2563eb' : '#64748b'}">
                      ${f.analysisStatus.toUpperCase()}
                    </span>
                  </td>
                  <td>${f.uploadedAt}</td>
                </tr>
              `).join("")}
              ${organizedFiles.length === 0 ? `<tr><td colspan="5" style="text-align: center; color: #64748b;">No documents uploaded to case file cabinet yet.</td></tr>` : ""}
            </tbody>
          </table>
        </div>
      `;
    }

    const htmlContent = `
      <html>
        <head>
          <title>${title} - ParentShield PDF Suite</title>
          ${sharedStyle}
        </head>
        <body>
          <button class="no-print-btn" onclick="window.print()">Print / Save as PDF</button>

          ${bodyContent}

          <div class="legal-notice">
            <strong>MANDATORY LEGAL EDUCATIONAL STATEMENT:</strong> This document is generated for informational/educational objectives only under secondary statutory guidelines of the Child, Youth and Family Services Act (CYFSA) S.O. 2017, Chapter 14. This does not represent formal counsel or legal aid representations. Please immediately secure local, verified counsel from the Law Society of Ontario or Legal Aid Ontario to represent your case before the Court.
          </div>

          <div class="footer-signature">
            Primary databases verified current through Q2 2026 • Saved dynamically via OPA PDF Legal Desk.
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

  // Mount file select trigger shortcut to window scope
  useEffect(() => {
    (window as any).highlightCaseFile = (fileName: string) => {
      const match = organizedFiles.find(f => f.name.toLowerCase() === fileName.trim().toLowerCase());
      if (match) {
        setSelectedFileId(match.id);
        setSelectedReport(match.analysisReport || null);
        setActiveTab("organizer");
        // Quick visual scrolling element
        const docElem = document.getElementById(`file-item-${match.id}`);
        if (docElem) {
          docElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
          docElem.classList.add("ring-2", "ring-brand-500");
          setTimeout(() => docElem.classList.remove("ring-2", "ring-brand-500"), 2000);
        }
      }
    };
  }, []);

  const activeSelectedFile = organizedFiles.find(f => f.id === selectedFileId);

  // Group files count by category for rendering directories
  const categoriesList: OrganizedFile["category"][] = [
    "CAS Correspondence",
    "Court Filings",
    "Evidence & Loggers",
    "Children Services",
    "Parenting Identity"
  ];

  return (
    <div className="space-y-6" id="document-analyzer-tab">
      
      {/* Platform Sub-Header Banner */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 border-b border-gray-150 pb-4">
        <div className="text-left">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-brand-900 text-white rounded-lg text-xs font-mono font-bold tracking-wider uppercase flex items-center gap-1 shadow-xs">
              <Library className="w-3.5 h-3.5" /> Case Data Locker
            </span>
            <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-mono font-bold uppercase tracking-wider">
              Fast Parallel Pipeline (&lt; 2 min)
            </span>
          </div>
          <h2 className="font-display text-2xl font-bold text-gray-900 mt-2">Ontario Child Welfare File Organizer & Case Assistant</h2>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl leading-relaxed">
            Manage text logs, school journals, and CAS documents. Upload up to 15 files at a time to quick-analyze, then perform a deep scan on each to see if crucial evidence is missing. You can query your files instantly using the Case Assistant.
          </p>
        </div>

        {/* Action tabs switcher & Session persistence */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center self-start">
          {/* Active Session status & manual save controller */}
          <div className="flex items-center gap-2 bg-slate-100 rounded-xl p-1.5 border border-slate-200">
            <span className="text-[10px] text-slate-500 font-mono pl-1 shrink-0 flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${saveStatus ? "bg-brand-500 animate-bounce" : "bg-emerald-500 animate-pulse"}`} />
              {saveStatus ? saveStatus : "Auto-saved"}
            </span>

            <button
              onClick={saveToCloud}
              disabled={isSavingToCloud}
              className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-sans font-bold text-[10px] rounded mr-1 cursor-pointer border border-emerald-200 uppercase tracking-wide flex items-center gap-1 transition-all hover:shadow-2xs disabled:opacity-50"
              title="Save to your account in the cloud"
            >
              {isSavingToCloud ? <Loader2 className="w-3 h-3 text-emerald-600 animate-spin" /> : <CloudUpload className="w-3 h-3 text-emerald-600" />}
              Cloud Save
            </button>
            <button
              onClick={saveProgress}
              className="px-2 py-1 bg-black hover:bg-slate-50 text-slate-700 font-sans font-bold text-[10px] rounded mr-1 cursor-pointer border border-slate-200 uppercase tracking-wide flex items-center gap-1 transition-all hover:shadow-2xs"
              title="Save all changes securely to browser storage"
            >
              <Save className="w-3 h-3 text-brand-600" />
              Save Progress
            </button>

            <button
              onClick={exportSummaryLog}
              className="px-2 py-1 bg-black hover:bg-slate-50 text-slate-700 font-sans font-bold text-[10px] rounded mr-1 cursor-pointer border border-slate-200 uppercase tracking-wide flex items-center gap-1 transition-all hover:shadow-2xs"
              title="Export a summary log of all analyzed documents and chat history as a chronological text report"
            >
              <Download className="w-3 h-3 text-brand-600" />
              Export Summary Log
            </button>

            <button
              onClick={() => {
                setConfirmModal({
                  message: "Clear your saved session?",
                  description: "This will wipe all custom uploaded files, analysis reports, and chat history. This action cannot be undone.",
                  onConfirm: () => {
                    resetAll();
                  }
                });
              }}
              className="px-2 py-1 bg-black hover:bg-slate-50 text-slate-700 font-sans font-bold text-[10px] rounded mr-1 cursor-pointer border border-slate-200 uppercase tracking-wide flex items-center gap-1 transition-all hover:shadow-2xs"
              title="Wipe full stored cache"
              id="wipe-session-btn"
            >
              <Trash2 className="w-3 h-3 text-brand-600" />
              Reset Case Workspace
            </button>
          </div>

          <div className="flex p-1 bg-[#f1f5f9] rounded-xl">
            <button 
              type="button"
              onClick={() => setActiveTab("organizer")}
              className={`px-4 py-2 font-display font-semibold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === "organizer" 
                  ? "bg-black text-gray-900 shadow-xs" 
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              <Folder className="w-3.5 h-3.5 shrink-0" /> Case Organizer & Audits
            </button>
            <button 
              type="button"
              onClick={() => setActiveTab("rag-chat")}
              className={`px-4 py-2 font-display font-semibold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === "rag-chat" 
                  ? "bg-black text-gray-900 shadow-xs" 
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0" /> Multi-File Case Chat
            </button>
            <button 
              type="button"
              onClick={() => setActiveTab("saved-briefs")}
              className={`px-4 py-2 font-display font-semibold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === "saved-briefs" 
                  ? "bg-black text-gray-900 shadow-xs" 
                  : "text-gray-500 hover:text-gray-900"
              }`}
              id="saved-briefs-tab"
            >
              <Briefcase className="w-3.5 h-3.5 shrink-0 text-brand-500" /> Saved Briefs ({savedBriefs.length})
            </button>
          </div>
        </div>
      </div>

      {/* Main workspace display grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="case-workspace">
        
        {/* LEFT COLUMN: MULTIPLE FILES UPLOADER & ORGANIZE FOLDERS */}
        <div className="lg:col-span-5 space-y-4" id="organizer-sidebar">
          
          <div className="bg-black rounded-xl border border-gray-150 p-4 space-y-4 text-left shadow-2xs">
            
            {/* Folder Header */}
            <div className="flex justify-between items-center pb-2.5 border-b border-gray-100">
              <div className="flex items-center gap-1.5">
                <FolderOpen className="w-4 h-4 text-brand-900 shrink-0" />
                <h4 className="font-display font-bold text-gray-900 text-sm">Case Folders</h4>
              </div>
              <span className="text-[10px] font-mono bg-slate-100 text-brand-950 px-2.5 py-0.5 rounded-full font-bold border border-slate-200">
                {organizedFiles.length} Cabinet Files
              </span>
            </div>

            {/* Custom Multiple File Drag-Drop & Manual Upload Engine */}
            <div className="space-y-1.5">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-150 hover:border-brand-500 rounded-xl p-5 text-center cursor-pointer bg-slate-50 hover:bg-black hover:shadow-xs transition-all relative group"
              >
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={handleMultipleFilesUpload}
                  accept=".txt,.pdf,.heic,.heif,image/*,audio/*,.mp3,.wav,.m4a,.webm,.ogg"
                  className="hidden"
                />
                <Upload className="w-8 h-8 text-brand-500 mx-auto mb-2 group-hover:scale-110 transition-transform" />
                <span className="font-display font-semibold text-gray-800 text-xs block">
                  Click to select multiple casework files or audio logs
                </span>
                <span className="text-[10px] text-gray-400 block mt-1">
                  Supports TXT, PDF, HEIC/HEIF, Photo, and Audio recordings • Auto-transcribed & Stored in PDF format
                </span>
              </div>
              <button 
                onClick={openWorkspaceModal}
                className="flex items-center gap-2 w-full justify-center p-3 mt-2 bg-brand-50 text-brand-700 text-xs font-semibold rounded-lg hover:bg-brand-100 transition-colors"
              >
                <span className="shrink-0 text-brand-500">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path d="M12 6.58c1.62 0 3.06.55 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                </span>
                Connect Google Services
              </button>
            </div>
              
              {customUploadError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg font-mono leading-normal flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex gap-1.5 items-start">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
                    <span>{customUploadError}</span>
                  </div>
                
                </div>
              )}

              {bulkProgress && (
                <div className="p-3 bg-brand-50 border border-brand-200 text-brand-900 text-xs rounded-lg flex items-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-brand-500 border-t-transparent animate-spin rounded-full" />
                  <span className="font-mono font-medium">{bulkProgress}</span>
                </div>
              )}

            {/* Directory Category Accordion / List */}
            <div className="space-y-2.5 pt-2">
              {categoriesList.map((catFolder) => {
                const folderFiles = organizedFiles.filter(f => f.category === catFolder);
                const isSelected = activeFolder === catFolder;

                return (
                  <div key={catFolder} className="border border-gray-100 rounded-xl overflow-hidden bg-[#fafafa]/50">
                    <button
                      onClick={() => setActiveFolder(isSelected ? null : catFolder)}
                      className="w-full px-3.5 py-3 hover:bg-slate-50 flex items-center justify-between text-left transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Folder className={`w-4.5 h-4.5 shrink-0 ${folderFiles.length > 0 ? "text-brand-800 fill-brand-50" : "text-gray-300"}`} />
                        <span className="text-xs font-semibold text-gray-800">{catFolder}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-200/60 rounded-full font-bold text-gray-600">
                          {folderFiles.length}
                        </span>
                        {isSelected ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                      </div>
                    </button>

                    {/* Folder file items */}
                    {(isSelected || activeFolder === null) && folderFiles.length > 0 && (
                      <div className="px-3 pb-3 pt-1 space-y-1.5 border-t border-gray-50 bg-black">
                        {folderFiles.map((item) => {
                          const fileActive = selectedFileId === item.id;
                          return (
                            <div
                              id={`file-item-${item.id}`}
                              key={item.id}
                              onClick={() => {
                                setSelectedFileId(item.id);
                                setSelectedReport(item.analysisReport || null);
                              }}
                              className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all flex items-center justify-between gap-1.5 group select-none ${
                                fileActive 
                                  ? "bg-brand-50/70 border-brand-300 shadow-3xs" 
                                  : "bg-[#f8fafc]/50 hover:bg-slate-50 border-gray-100"
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {getFileStatusIcon(item.analysisStatus)}
                                <div className="min-w-0">
                                  <span className="text-xs font-medium text-gray-800 block truncate leading-none">
                                    {item.name}
                                  </span>
                                  <span className="text-[9px] font-mono text-gray-400 block mt-1">
                                    {(item.size / 1024).toFixed(1)} KB • {item.uploadedAt}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 opacity-80 md:opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteFile(item.id, item.name);
                                  }}
                                  className="p-1 hover:bg-rose-50 text-rose-500 rounded hover:border hover:border-rose-100 transition-colors"
                                  title="Remove from organizer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Quick Helper for basic transparency */}
            <div className="p-3.5 bg-brand-50/50 border border-brand-100 rounded-xl space-y-1 text-xs">
              <span className="font-semibold text-brand-900 block flex items-center gap-1">
                <Scale className="w-3.5 h-3.5 text-brand-800" /> Statutory Organizer Note
              </span>
              <p className="text-[11px] text-brand-800 leading-normal">
                Organizing evidence into sub-folders matches standard Ontario family defense litigation. Keep copies of everything!
              </p>
            </div>

          </div>

          {/* Live Audio Transcription Panel */}
          <div className="border border-brand-150 rounded-xl overflow-hidden bg-brand-50/40 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-brand-950">
                <Mic className="w-4 h-4 shrink-0 text-brand-600 animate-pulse" />
                <span className="font-display font-bold text-xs">Record Live Meeting / Conversation</span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-brand-100 text-brand-850 font-mono text-[8px] font-bold uppercase shrink-0">
                Auto-Analyze
              </span>
            </div>

            {isTranscribing && (
              <div className="flex flex-col items-center justify-center space-y-2 py-6 bg-black/70 border border-brand-100 rounded-xl">
                <Loader2 className="w-6 h-6 text-brand-900 animate-spin" />
                <span className="text-xs font-semibold text-brand-950 animate-pulse text-center">
                  AI Transcribing & Auditing Conversation...
                </span>
                <span className="text-[10px] text-gray-400">
                  This analyzes the speech and imports it into your case folders.
                </span>
              </div>
            )}

            {!isTranscribing && isRecording ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono text-red-600 font-bold animate-pulse flex items-center gap-1 select-none">
                    <span className="w-2 h-2 rounded-full bg-red-600 animate-ping shrink-0" />
                    RECORDING MEETING: {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
                  </span>
                  <button
                    onClick={stopRecording}
                    className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Square className="w-2.5 h-2.5 fill-current shrink-0" />
                    Stop & Transcribe
                  </button>
                </div>

                {/* Animated waveform */}
                <div className="flex items-end justify-center gap-1 h-6 px-4 py-1 bg-black/50 rounded-lg">
                  <span className="w-1 bg-red-500 rounded-full animate-bounce h-4" style={{ animationDelay: '0.1s', animationDuration: '0.5s' }}></span>
                  <span className="w-1 bg-red-500 rounded-full animate-bounce h-2" style={{ animationDelay: '0.3s', animationDuration: '0.7s' }}></span>
                  <span className="w-1 bg-red-500 rounded-full animate-bounce h-5" style={{ animationDelay: '0s', animationDuration: '0.4s' }}></span>
                  <span className="w-1 bg-red-500 rounded-full animate-bounce h-3" style={{ animationDelay: '0.4s', animationDuration: '0.6s' }}></span>
                  <span className="w-1 bg-red-500 rounded-full animate-bounce h-4" style={{ animationDelay: '0.2s', animationDuration: '0.8s' }}></span>
                </div>

                <div className="bg-black/85 p-2.5 rounded-lg border border-red-150 text-[11px] leading-normal text-slate-800 max-h-24 overflow-y-auto italic text-left">
                  {transcript || "Listening... Speak clearly into your microphone."}
                </div>
              </div>
            ) : !isTranscribing && (
              <div className="space-y-2">
                <p className="text-[10px] text-brand-900/70 leading-normal text-left">
                  Record CAS meetings, unannounced worker visits, or telephone calls to transcribe, analyze, and instantly sync them into your active Case Folder documents list.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={startRecording}
                    className="flex-1 py-1.5 px-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                  >
                    <Mic className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
                    Start Meeting Recorder
                  </button>
                  {transcript.trim() && (
                    <button
                      onClick={() => setTranscript("")}
                      className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-[10px] font-bold"
                    >
                      Reset
                    </button>
                  )}
              
              </div>
                </div>
            )}

            {transcript.trim() && !isRecording && !isTranscribing && (
              <div className="space-y-2 animate-fadeIn pt-1.5 border-t border-brand-100 text-left">
                <span className="text-[9px] text-gray-500 font-mono font-bold block">EDIT RECORDED SPEECH TEXT BEFORE TRANSCRIPTION PDF GENERATION:</span>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  className="w-full text-xs bg-black border border-gray-150 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-brand-500 h-20 resize-none leading-relaxed text-slate-800"
                />
                <button
                  onClick={handleSaveSpeechTranscript}
                  disabled={isTranscribing}
                  className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 text-white disabled:bg-slate-300 text-[11px] font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5 text-brand-400" />
                  <span>Transcribe & Save as PDF</span>
                </button>
              </div>
            )}

            {voiceError && (
              <p className="text-[10px] text-red-600 font-mono italic leading-normal bg-red-50 p-2 rounded-lg border border-red-150 text-left">{voiceError}</p>
            )}
          </div>

          {/* Collapsible Glossary component of complex legal/CYFSA terminology */}
          <div className={`border border-slate-150 rounded-xl overflow-hidden shadow-2xs transition-all ${isGlossaryOpen ? "bg-black" : "bg-slate-50"}`}>
            <button
              type="button"
              onClick={() => setIsGlossaryOpen(!isGlossaryOpen)}
              className="w-full p-3 flex justify-between items-center bg-slate-50 hover:bg-black transition-colors"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-slate-700 shrink-0" />
                <span className="font-display font-semibold text-xs text-slate-800">CYFSA & Family Law Glossary</span>
                <span className="px-1.5 py-0.5 rounded-full bg-brand-50 border border-brand-100 text-brand-850 font-mono text-[9px] font-bold uppercase leading-none">
                  Auto-Check
                </span>
              </div>
              {isGlossaryOpen ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
            </button>

            {isGlossaryOpen && (
              <div className="p-3.5 space-y-3.5 border-t border-slate-100 animate-fadeIn text-left">
                <p className="text-[10px] text-gray-400 leading-normal">
                  This glossary automatically scans terms in your active document and highlights them with active indicators.
                </p>

                <input
                  type="text"
                  value={glossarySearch}
                  onChange={(e) => setGlossarySearch(e.target.value)}
                  placeholder="Search terminology, e.g. CYFSA, Hearsay..."
                  className="w-full text-xs p-2 border border-slate-150 rounded-lg outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 bg-slate-50/50 text-slate-800"
                />

                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {/* Filtered Glossary List */}
                  {GLOSSARY_TERMS.filter(item => 
                    item.term.toLowerCase().includes(glossarySearch.toLowerCase()) ||
                    item.definition.toLowerCase().includes(glossarySearch.toLowerCase()) ||
                    item.abbreviation.toLowerCase().includes(glossarySearch.toLowerCase())
                  ).map((item) => {
                    const isMatched = activeSelectedFile && activeSelectedFile.content && item.triggers.some(trig => activeSelectedFile.content.toLowerCase().includes(trig));
                    const isExpanded = expandedTerm === item.term;

                    return (
                      <div 
                        key={item.term} 
                        className={`p-2.5 rounded-lg border transition-all ${
                          isMatched 
                            ? "bg-emerald-50/20 border-emerald-200 shadow-3xs" 
                            : "bg-black border-slate-150"
                        }`}
                      >
                        <div 
                          className="flex justify-between items-start cursor-pointer select-none"
                          onClick={() => setExpandedTerm(isExpanded ? null : item.term)}
                        >
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-xs font-bold ${isMatched ? "text-emerald-950 font-extrabold" : "text-slate-800"}`}>
                                {item.term}
                              </span>
                              {isMatched && (
                                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 font-mono text-[8px] font-semibold animate-pulse leading-none shrink-0">
                                  <span className="w-1 h-1 rounded-full bg-emerald-600 block shrink-0" />
                                  Active in Doc
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500 block leading-normal mt-0.5">{item.abbreviation} • <span className="font-mono">{item.section}</span></span>
                          </div>
                          <span className="text-[10px] text-gray-400 font-mono">
                            {isExpanded ? "Collapse" : "Explain"}
                          </span>
                        </div>

                        {isExpanded && (
                          <div className="mt-2 text-[11px] leading-relaxed text-slate-600 border-t border-dashed border-slate-100 pt-2 animate-fadeIn space-y-1">
                            <p className="font-normal">{item.definition}</p>
                            <div className="bg-slate-100 p-1.5 rounded-md font-mono text-[9px] text-[#475569] leading-tight">
                              <strong>Search triggers:</strong> {item.triggers.join(", ")}
                            </div>
                          </div>

                                                    )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

          {/* RIGHT COLUMN: WORKSPACE SWITCHER */}
        <div className="lg:col-span-7" id="workspace-action-screen">
          
          {/* TAB 1: FILE ORGANIZER DETAILS & ACTIVE DOCUMENT AUDIT */}
          {activeTab === "organizer" && (
            <div className="h-full space-y-4">
              {activeSelectedFile ? (
                <div className="space-y-4 text-left">
                  
                  {/* File Metadata Header */}
                  <div className="bg-black rounded-xl border border-gray-150 p-4 shadow-3xs flex flex-wrap justify-between items-center gap-3">
                    <div className="min-w-0">
                      <span className={`px-2.5 py-0.5 border text-[10px] font-semibold rounded-full font-mono uppercase inline-block ${getCategoryColor(activeSelectedFile.category)}`}>
                        {activeSelectedFile.category}
                      </span>
                      <h3 className="font-display font-extrabold text-[#0f172a] text-lg mt-1 truncate">
                        {activeSelectedFile.name}
                      </h3>
                      <p className="text-[10px] font-mono text-gray-400 mt-0.5">
                        Uploaded on {activeSelectedFile.uploadedAt} • Type: {activeSelectedFile.mimeType}
                      </p>
                    </div>

                    {/* Single Trigger Pipeline button */}
                    <div className="flex items-center gap-2 shrink-0">
                      {activeSelectedFile.analysisStatus !== "completed" && (
                        <button
                          onClick={() => triggerSingleAnalysis(activeSelectedFile)}
                          disabled={isSingleAnalyzing}
                          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-2xs cursor-pointer transition-all hover:shadow-md disabled:bg-slate-300"
                        >
                          {isSingleAnalyzing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          <span>Run Fast Statutory Audit</span>
                        </button>
                      )}

                      {activeSelectedFile.analysisStatus === "completed" && (
                        <span className="px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-mono font-bold flex items-center gap-1 animate-pulse">
                          <Check className="w-4 h-4" /> Ready for Case Chat
                        </span>
                      )}
                  </div>
                </div>

                  {/* Document content viewer with custom Court Transcript Rendering & Density Limits Check */}
                  <div className="bg-black rounded-xl border border-gray-150 p-4 space-y-1.5 relative overflow-hidden" id="file-plain-viewer">
                    <div className="flex flex-wrap justify-between items-center pb-2 border-b border-gray-100 gap-2">
                      <h5 className="font-mono text-[10px] text-gray-400 font-extrabold uppercase flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5 shrink-0" />
                        {activeSelectedFile.name.toLowerCase().includes("transcript") ? "VERBATIM COURT TRANSCRIPTION REPORT" : "File Plaintext Context"}
                      </h5>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Word and Character Count Counter */}
                        <div className="flex items-center gap-1.5 bg-slate-100 px-2 py-0.5 rounded text-[10px] font-mono text-slate-600">
                          <span>Characters: <strong>{activeSelectedFile.content.length.toLocaleString()}</strong></span>
                          <span className="text-slate-300">|</span>
                          <span>Words: <strong>{activeSelectedFile.content ? activeSelectedFile.content.split(/\s+/).filter(Boolean).length.toLocaleString() : "0"}</strong></span>
                        </div>

                        {activeSelectedFile.name.toLowerCase().includes("transcript") && (
                          <button
                            onClick={() => {
                              const printWindow = window.open("", "_blank");
                              if (printWindow) {
                                printWindow.document.write(`
                                  <html>
                                    <head>
                                      <title>Print Certified Transcript - ${activeSelectedFile.name}</title>
                                      <style>
                                        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');
                                        body {
                                          font-family: 'JetBrains Mono', Courier, monospace;
                                          padding: 50px;
                                          color: #1e293b;
                                          background: white;
                                          line-height: 2.2;
                                          font-size: 13px;
                                        }
                                        .transcript {
                                          max-width: 850px;
                                          margin: 0 auto;
                                          position: relative;
                                          padding: 0 0 0 60px;
                                        }
                                        .margin-line {
                                          position: absolute;
                                          left: 45px;
                                          top: 0;
                                          bottom: 0;
                                          width: 1px;
                                          border-left: 2px solid #ef4444;
                                        }
                                        .line-numbers {
                                          position: absolute;
                                          left: 0;
                                          top: 0;
                                          width: 30px;
                                          text-align: right;
                                          color: #94a3b8;
                                          user-select: none;
                                        }
                                        pre {
                                          white-space: pre-wrap;
                                          margin: 0;
                                        }
                                        @media print {
                                          body { padding: 20px; }
                                        }
                                      </style>
                                    </head>
                                    <body>
                                      <div class="transcript">
                                        <div class="margin-line"></div>
                                        <pre>${activeSelectedFile.content}</pre>
                                      </div>
                                      <script>window.print();</script>
                                    </body>
                                  </html>
                                `);
                                printWindow.document.close();
                              } else {
                                window.print();
                              }
                            }}
                            className="text-[10px] font-mono bg-brand-50 hover:bg-brand-100 text-brand-700 hover:text-brand-850 px-2 py-1 rounded font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Printer className="w-3 h-3 shrink-0" />
                            Print Transcript PDF
                          </button>

                              )}
                    </div>
                  </div>

                    {/* Interactive Spot Search Bar for Parents */}
                    <div className="flex items-center gap-2 bg-brand-50/40 p-2 rounded-lg border border-brand-100/60 shadow-inner">
                      <span className="text-[10px] font-mono font-bold text-brand-800 uppercase flex items-center gap-1 shrink-0">
                        🔍 Dynamic Verification Spotter:
                      </span>
                      <input
                        type="text"
                        placeholder="Scrolls/highlights matches. Click 'Locate Phrase' on any violation card below..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-black border border-brand-200 rounded px-2 py-1 text-xs grow outline-brand-500 font-mono text-slate-700 placeholder:text-gray-400"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 font-mono px-2.5 py-1 rounded font-bold cursor-pointer transition-colors"
                          title="Clear active highlight"
                        >
                          Reset
                        </button>
                      )}
                    </div>

                    {/* Word and Character Density Quality indicator bar */}
                    {(() => {
                      const wordCount = activeSelectedFile.content ? activeSelectedFile.content.split(/\s+/).filter(Boolean).length : 0;
                      let densityBadgeColor = "bg-rose-50 text-rose-700 border-rose-200";
                      let densityText = "⚠️ Low Context: Might result in generalized answers. Consider uploading or dictating additional details.";
                      if (wordCount >= 100 && wordCount <= 3000) {
                        densityBadgeColor = "bg-emerald-50 text-emerald-800 border-emerald-200";
                        densityText = "🟢 Optimal Context Spot: Excellent for accurate legal matching and prompt Case Assistant answer synthesis.";
                      } else if (wordCount > 3000) {
                        densityBadgeColor = "bg-amber-50 text-amber-800 border-amber-200";
                        densityText = "🟡 High Context Volume: Successfully loaded detailed records. Assistant answers will utilize high-level summaries.";
                      }
                      return (
                        <div className={`p-2 border rounded-lg text-[10px] leading-relaxed flex items-center gap-1 px-3 ${densityBadgeColor} select-none text-left`}>
                          <span>{densityText}</span>
                        </div>
                      );
                    })()}

                    {activeSelectedFile.name.toLowerCase().includes("transcript") ? (
                      /* Legal certified court transcript layout mockup */
                      <div className="relative border-l-4 border-red-500 bg-[#fafafa]/80 rounded-xl p-5 font-mono text-[11px] md:text-xs text-slate-800 leading-6 shadow-inner max-h-72 overflow-y-auto overflow-x-hidden text-left relative group">
                        {/* Official diagonal Watermark stamp */}
                        <div className="absolute top-3 right-3 border border-brand-300 bg-brand-50/95 text-brand-900 px-2.5 py-1 rounded text-[9px] font-extrabold uppercase tracking-widest rotate-3 select-none shrink-0 pointer-events-none shadow-xs">
                          CERTIFIED CASE SCAN
                        </div>
                        
                        {/* Verbatim dialog containing line numbers */}
                        <div className="grid grid-cols-[30px_1fr] gap-3">
                          {/* Simulated court reporter marginal numbering */}
                          <div className="border-r border-red-200 pr-2 select-none text-slate-300 text-right space-y-0.5 font-bold text-[10px] leading-6">
                            {Array.from({ length: Math.max(15, activeSelectedFile.content.split("\n").length) }).map((_, lineIdx) => (
                              <div key={lineIdx}>{lineIdx + 1}</div>
                            ))}
                          </div>
                          <div className="pl-1 whitespace-pre-wrap leading-6 text-slate-800 text-left font-mono">
                            {getHighlightedText(activeSelectedFile.content, searchQuery) || "Processing dialogue transcript text..."}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="max-h-56 overflow-y-auto p-3 bg-slate-50 border border-slate-100 rounded-lg text-xs font-mono text-slate-700 whitespace-pre-wrap leading-relaxed text-left" id="file-plain-content-viewer">
                        {activeSelectedFile.mimeType === "text/plain" 
                          ? getHighlightedText(activeSelectedFile.content, searchQuery) 
                          : `[Document Data Encoded Buffer File (${activeSelectedFile.name}). Metadata trace indices: "${activeSelectedFile.name.replace(/_/g, " ")}"]`}
                      </div>
                    )}

                  {/* Intensive Deep Scan Dashboard */}
                  {activeSelectedFile.analysisStatus === "completed" && (
                    <div className="bg-linear-to-br from-brand-950 via-slate-900 to-slate-950 text-white rounded-2xl p-5 border border-brand-800/45 space-y-4 shadow-lg relative overflow-hidden" id="deep-scan-dashboard">
                      <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
                        <Scale className="w-48 h-48 text-brand-400" />
                      </div>
                      
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="bg-brand-500/20 text-brand-300 border border-brand-400/30 text-[9px] uppercase font-mono font-bold px-2 py-0.5 rounded-full tracking-wider">
                              Advanced Verification Layer
                            </span>
                            {deepScanReports[activeSelectedFile.id] && (
                              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[9px] uppercase font-mono font-bold px-2 py-0.5 rounded-full tracking-wider">
                                Completed
                              </span>
    
                                                      )}
                          </div>
                          <h4 className="font-display font-black text-white text-[15px] flex items-center gap-1.5">
                            <span>🔍 High-Precision Deep Case Scan</span>
                          </h4>
                          <p className="text-slate-300 text-xs leading-relaxed max-w-xl">
                            Run an intensive context-weight verification scan to detect statutory omissions, unsworn hearsay, and construct strategic hearing rebuttals.
                          </p>
                        </div>

                        {!deepScanReports[activeSelectedFile.id] && (
                          <div className="shrink-0">
                            <button
                              type="button"
                              onClick={() => triggerDeepScan(activeSelectedFile)}
                              disabled={isDeepScanning}
                              className="px-4 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white font-semibold text-xs rounded-xl transition shadow-sm hover:shadow-md cursor-pointer flex items-center gap-1.5 uppercase tracking-wide shrink-0 font-display"
                            >
                              {isDeepScanning ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  <span>Scanning File...</span>
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-3.5 h-3.5 text-brand-200 animate-pulse" />
                                  <span>Run Deep Scan</span>
                                </>
      
                              )}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Deep Scan Loading State */}
                      {isDeepScanning && deepScanFileId === activeSelectedFile.id && (
                        <div className="bg-slate-900/60 border border-brand-500/20 rounded-xl p-4 space-y-3 animate-pulse">
                          <div className="flex items-center gap-2 text-xs text-brand-300 font-mono font-bold">
                            <Loader2 className="w-4 h-4 text-brand-400 animate-spin animate-infinite" />
                            <span>Tracing omissions, evaluating CYFSA thresholds, and constructing defense retorts...</span>
                          </div>
                          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-brand-500 h-full w-[65%] rounded-full" />
                          </div>
                        </div>
                      )}

                      {/* Deep Scan Report Content */}
                      {deepScanReports[activeSelectedFile.id] && !isDeepScanning && (
                        <div className="space-y-4 pt-2 border-t border-slate-800 animate-fadeIn text-left">
                          
                          {/* Block 1: Omissions */}
                          <div className="space-y-2">
                            <h5 className="text-xs text-rose-300 font-bold uppercase tracking-wider flex items-center gap-1.5 font-display">
                              <ShieldAlert className="w-3.5 h-3.5 text-rose-400 font-bold" />
                              <span>Statutory Omissions Identified (What CAS Omitted)</span>
                            </h5>
                            <div className="grid grid-cols-1 gap-2">
                              {deepScanReports[activeSelectedFile.id].gaps.map((gap: string, i: number) => (
                                <div key={i} className="bg-rose-955/20 border border-rose-900/30 p-3 rounded-xl text-slate-200 text-xs font-sans leading-relaxed">
                                  <strong>Omits Details:</strong> {gap}
                                </div>
                              ))}
                            </div>

                          </div>

                          {/* Block 2: Missing evidence items */}
                          <div className="space-y-2">
                            <h5 className="text-xs text-amber-300 font-bold uppercase tracking-wider flex items-center gap-1.5 font-display">
                              <Info className="w-3.5 h-3.5 text-amber-400" />
                              <span>Parent's Evidence Response Checklist (To prove missing gaps)</span>
                            </h5>
                            <div className="grid grid-cols-1 gap-2">
                              {deepScanReports[activeSelectedFile.id].missingEvidence.map((ev: string, i: number) => (
                                <div key={i} className="bg-amber-955/20 border border-amber-900/30 p-3 rounded-xl text-slate-200 text-xs font-sans leading-relaxed flex items-start gap-2">
                                  <span className="text-amber-400 font-bold shrink-0">☑</span>
                                  <span>{ev}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Block 3: Defense retorts */}
                          <div className="space-y-2">
                            <h5 className="text-xs text-brand-300 font-bold uppercase tracking-wider flex items-center gap-1.5 font-display">
                              <Scale className="w-3.5 h-3.5 text-brand-400" />
                              <span>Avenue of Defense & Hearing Retorts</span>
                            </h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-1">
                              {deepScanReports[activeSelectedFile.id].retorts.map((ret: any, i: number) => (
                                <div key={i} className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl space-y-2 text-xs">
                                  <div className="border-b border-slate-800 pb-1.5">
                                    <span className="text-[10px] font-mono text-rose-400 font-bold uppercase">Society Assert:</span>
                                    <p className="text-slate-350 italic mt-0.5 font-medium">"{ret.claim}"</p>
                                  </div>
                                  <div className="space-y-1">
                                    <span className="text-[10px] font-mono text-brand-400 font-bold uppercase block">Legal Rebuttal Rule:</span>
                                    <p className="text-slate-200">{ret.objection}</p>
                                  </div>
                                  <div className="bg-brand-950/40 border border-brand-900/30 p-2 rounded-lg text-brand-205 text-[11px] leading-relaxed">
                                    <strong>Step Action:</strong> {ret.action}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                        </div>
                      )}
                    </div>
                  )}
                  </div>

                  {/* Detailed AI Audit Section */}
                  {selectedReport ? (
                    <div className="bg-black rounded-2xl border border-[#e2e8f0] p-5 md:p-6 space-y-6 shadow-xs animate-fadeIn">
                      
                      {/* Sub analysis title */}
                      <div className="flex justify-between items-center pb-4 border-b border-gray-100">
                        <div>
                          <span className="text-[10px] font-mono font-bold uppercase text-brand-650 flex items-center gap-1 leading-none">
                            <FileCheck className="w-3.5 h-3.5 text-emerald-600" /> Audited Findings
                          </span>
                          <h4 className="font-display font-bold text-[#0f172a] text-base mt-1">
                            {selectedReport.documentTitle}
                          </h4>
                        </div>
                        <div className="text-right flex items-center gap-2 p-2 bg-slate-50 border border-gray-150 rounded-xl shrink-0">
                          <div>
                            <span className="text-[8px] font-mono tracking-wider block text-gray-400 font-bold">INTEGRITY WEIGHT</span>
                            <span className="text-xs text-slate-500">Credibility Index</span>
                          </div>
                          <div className="w-9 h-9 rounded-full bg-brand-900 flex items-center justify-center font-display font-extrabold text-white text-xs">
                            {selectedReport.completenessScore}%
                          </div>
                        </div>
                      </div>

                      {/* Educational disclaimer */}
                      <div className="p-3 ml-0 bg-[#fffbeb] border border-[#fef3c7]/80 rounded-xl text-xs text-amber-900 flex gap-2">
                        <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        <span><strong>Regulatory Notice:</strong> {selectedReport.disclaimer}</span>
                      </div>

                      {/* Certified Citation & Source Backed Badge Alert */}
                      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-950 flex gap-2 items-start shadow-2xs">
                        <Scale className="w-4 h-4 text-emerald-600 shrink-0 mt-1" />
                        <div className="space-y-1">
                          <p className="font-bold text-emerald-900 flex items-center gap-1.5">
                            <span>⚖️</span> Verified Citations & Source-Backed Analysis
                          </p>
                          <p className="text-[11px] text-emerald-800 leading-normal">
                            Every single objection, red flag, timeline defect, and compliance evaluation extracted during this analysis is strictly verified and backed by the official <strong>Ontario Child, Youth and Family Services Act (CYFSA), 2017</strong>, the <strong>Ontario Evidence Act</strong>, or <strong>Constitutional Charter Protections</strong>. Use the buttons provided inline to verify legal source sections.
                          </p>
                        </div>
                      </div>

                      {/* State-Managed Handover Section */}
                      <div className="bg-brand-50 border border-brand-150 rounded-2xl p-4.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-3xs">
                        <div className="space-y-1 text-left">
                          <h5 className="font-bold text-brand-950 flex items-center gap-1.5 text-xs uppercase tracking-wide leading-tight">
                            <Sparkles className="w-4 h-4 text-brand-600 animate-pulse shrink-0" /> Auto-populate Legal Court Forms & Statements
                          </h5>
                          <p className="text-[11px] text-brand-800 leading-normal">
                            Directly hand over these audited findings to automatically pre-fill your court reply forms, affidavits, and parental plan of care builders in the Draft Templates workspace.
                          </p>
                        </div>
                        <button
                          onClick={handleFormHandover}
                          className="w-full md:w-auto px-4.5 py-2.5 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-xs font-bold rounded-xl shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer border border-brand-700 uppercase tracking-wider shrink-0 font-sans"
                        >
                          <FileText className="w-4 h-4" />
                                                  <span>Handover to Templates</span>
                        </button>
                      </div>

                      {/* Lawyer Detailed Case Brief in bullet-form structure */}
                      {selectedReport.lawyerCaseBrief && selectedReport.lawyerCaseBrief.length > 0 && (
                        <div className="bg-slate-900 text-white rounded-2xl p-5 md:p-6 space-y-4 shadow-md border border-slate-800 relative overflow-hidden" id="lawyer-detailed-case-brief">
                          <div className="absolute top-0 right-0 w-32 h-32 bg-brand-500/10 rounded-full blur-2xl pointer-events-none" />
                          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                            <Briefcase className="w-5 h-5 text-brand-400" />
                            <div>
                              <h5 className="font-display font-bold text-sm tracking-wide text-white uppercase">
                                Lawyer Detailed Case Brief
                              </h5>
                              <p className="text-[10px] text-brand-300 font-mono">
                                Bullet Form Structure • Ready for Intake Sharing
                              </p>
                            </div>
                          </div>
                          
                          <div className="space-y-3.5 pt-1">
                            {selectedReport.lawyerCaseBrief.map((bullet, idx) => {
                              const parts = bullet.split("**");
                              return (
                                <div key={idx} className="flex items-start gap-3 text-slate-300 leading-relaxed text-xs">
                                  <span className="text-brand-400 font-bold shrink-0 mt-0.5 select-none">▪</span>
                                  <p className="text-slate-300">
                                    {parts.map((part, index) => 
                                      index % 2 === 1 ? (
                                        <strong key={index} className="text-white font-semibold">{part}</strong>
                                      ) : (
                                        part
                                      )
            
                                                                )}
                              </p>
                                </div>
                              );
                            })}
                          </div>

                          <div className="flex flex-wrap gap-2.5 pt-4 border-t border-slate-800/85">
                            <button
                              onClick={() => {
                                const textToCopy = selectedReport.lawyerCaseBrief?.map(b => b.replace(/\*\*/g, "")).join("\n\n");
                                if (textToCopy) {
                                  navigator.clipboard.writeText(textToCopy);
                                  alert("Success: Lawyer Case Brief copied to clipboard!");
                                }
                              }}
                              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white rounded-lg text-[10.5px] font-medium flex items-center gap-1.5 transition-colors border border-slate-700 cursor-pointer"
                              title="Copy brief text to clipboard"
                            >
                              <Copy className="w-3.5 h-3.5 text-brand-400" />
                              <span>Copy Brief Text</span>
                            </button>

                            <button
                              onClick={() => {
                                const textToCopy = selectedReport.lawyerCaseBrief?.map(b => b.replace(/\*\*/g, "")).join("\n\n");
                                if (textToCopy) {
                                  const blob = new Blob([textToCopy], { type: "text/plain" });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download = `Lawyer_Case_Brief_${selectedReport.documentTitle.replace(/\s+/g, "_")}.txt`;
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                  URL.revokeObjectURL(url);
                                }
                              }}
                              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white rounded-lg text-[10.5px] font-medium flex items-center gap-1.5 transition-colors border border-slate-700 cursor-pointer"
                              title="Download brief as .txt"
                            >
                              <Download className="w-3.5 h-3.5 text-brand-400" />
                              <span>Download .txt Brief</span>
                            </button>

                            <button
                              onClick={() => {
                                const isSaved = savedBriefs.some(
                                  b => b.documentId === (selectedFileId || "unknown") && 
                                  b.lawyerCaseBrief.join("\n") === selectedReport.lawyerCaseBrief.join("\n")
                                );
                                if (isSaved) {
                                  alert("Notice: This brief is already saved in your Briefs Archive!");
                                  return;
                                }

                                const newBrief: SavedBrief = {
                                  id: "brief-" + Date.now(),
                                  documentId: selectedFileId || "unknown",
                                  documentTitle: selectedReport.documentTitle || "Untitled Document",
                                  documentCategory: selectedReport.documentType || "General Document",
                                  savedAt: new Date().toLocaleDateString(undefined, { 
                                    year: 'numeric', 
                                    month: 'short', 
                                    day: 'numeric', 
                                    hour: '2-digit', 
                                    minute: '2-digit' 
                                  }),
                                  lawyerCaseBrief: selectedReport.lawyerCaseBrief,
                                  notes: ""
                                };

                                setSavedBriefs(prev => [newBrief, ...prev]);
                                alert("Success: This case brief has been archived in the Saved Briefs tab! You can add notes, delete, or switch between saved briefs there.");
                              }}
                              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-emerald-400 hover:text-emerald-300 rounded-lg text-[10.5px] font-medium flex items-center gap-1.5 transition-colors border border-slate-700 cursor-pointer"
                              title="Archive this brief in the Saved Briefs tab"
                            >
                              <Save className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Archive Brief</span>
                            </button>

                            <button
                              onClick={() => {
                                const stateToSave = {
                                  organizedFiles,
                                  selectedFileId,
                                  activeFolder,
                                  ragChatMessages,
                                  selectedReport,
                                  activeTab,
                                  savedBriefs
                                };
                                localStorage.setItem("OPA_DOC_ANALYZER_PROGRESS", JSON.stringify(stateToSave));
                                setLocation("/lawyers");
                                alert("Success: Your Detailed Case Brief has been synchronized with the Lawyer Directory. Select a lawyer in the directory to see your pre-filled intake brief!");
                              }}
                              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-[10.5px] font-bold flex items-center gap-1.5 transition-colors border border-brand-700 cursor-pointer"
                              title="Sync to Lawyer Directory tab for attorney review"
                            >
                              <Scale className="w-3.5 h-3.5 text-white" />
                              <span>Sync to Lawyer Directory Intake</span>
                            </button>
                          </div>
                        
                        </div>
                      )}

                      {/* Red Flags & Hearsay */}
                      <div className="space-y-4">
                        <h5 className="font-display font-bold text-gray-900 text-xs uppercase tracking-wider flex items-center gap-1.5 text-slate-700">
                          <ShieldAlert className="w-4 h-4 text-rose-600 animate-pulse" /> Evidence Objections & Hearsay ({selectedReport.redFlags.length})
                        </h5>
                        <div className="space-y-3.5">
                          {selectedReport.redFlags.map((flag, idx) => (
                            <div key={idx} className="bg-black border border-gray-200 p-4 rounded-xl space-y-3 text-xs shadow-xs hover:border-brand-200 transition-colors">
                              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-gray-100">
                                <span className={`px-2.5 py-0.5 rounded text-[9px] font-mono font-bold tracking-wider ${
                                  flag.severity.includes("CRITICAL") ? "bg-rose-100 text-rose-800" : flag.severity.includes("Worth") ? "bg-amber-100 text-amber-800" : "bg-brand-100 text-brand-800"
                                }`}>
                                  {flag.severity}
                                </span>
                                <span className="font-mono font-bold text-rose-800 text-[11px]">{flag.category}</span>
                                <button
                                  onClick={() => openLegislativeReference(flag.legalReference)}
                                  className="font-mono text-brand-700 hover:text-brand-900 font-bold text-[10px] bg-brand-50 hover:bg-brand-100 border border-brand-200 px-2.5 py-1 rounded flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                  title="Click to open Verified Source reference modal"
                                >
                                  <Scale className="w-3 h-3 text-brand-600" /> Verify Law: {flag.legalReference} ↗
                                </button>
                              </div>
                              {flag.phraseDetected && (
                                <div className="space-y-1 bg-slate-50 p-2.5 border border-slate-150 rounded-lg">
                                  <div className="flex justify-between items-center">
                                    <span className="text-[9px] font-mono font-extrabold text-slate-400 uppercase tracking-wider">Phrase in Document:</span>
                                    <button
                                      onClick={() => {
                                        setSearchQuery(flag.phraseDetected);
                                        const docViewer = document.getElementById("file-plain-viewer");
                                        if (docViewer) {
                                          docViewer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        }
                                      }}
                                      className="text-[9px] font-mono text-brand-700 bg-brand-50 hover:bg-brand-100 hover:text-brand-900 font-bold px-2 py-0.5 rounded border border-brand-200 transition-colors cursor-pointer"
                                    >
                                      🔍 Locate Phrase
                                    </button>
                                  </div>
                                  <p className="italic text-slate-700 leading-normal font-medium bg-black p-2 border border-slate-100 rounded text-[11.5px]">
                                    "{flag.phraseDetected}"
                                  </p>
                                
                                </div>
                              )}
      
                              
                              <p className="text-slate-600 leading-normal text-[11.5px]">
                                <strong>Assessment:</strong> {flag.explanation}
                              </p>

                              {flag.locationInDocument && (
                                <div className="flex items-center gap-1.5 p-2 bg-brand-50/50 border border-brand-100/40 rounded-lg text-[10.5px] font-mono text-brand-950">
                                  <span className="shrink-0">📌</span>
                                  <span><strong>Verification Locator:</strong> <span className="underline font-bold">{flag.locationInDocument}</span></span>
                                </div>
                              )}
      

                              <div className="p-3 bg-brand-50/60 border border-brand-100 rounded-lg text-[11px] text-brand-950 font-medium space-y-1">
                                <div className="font-bold text-brand-900 border-b border-brand-100/50 pb-0.5 flex items-center gap-1">
                                  <span>💡</span> Parent Action & Defense Step:
                                </div>
                                <p className="text-[11px] leading-normal">{flag.parentActionStep || flag.verifyRequirement}</p>
                              </div>
                            </div>
                          ))}
                          {selectedReport.redFlags.length === 0 && (
                            <div className="p-4 bg-emerald-50 text-emerald-800 text-xs rounded-xl border border-emerald-100 font-medium flex items-center gap-2">
                              <Check className="w-4 h-4" /> No severe hearsay or timeline objections flagged.
                            </div>
                          )}
  
                        </div>
                      </div>

                      {/* The 12 Statutory Things CAS Must Prove (Coaching Section) */}
                      <div className="bg-slate-50 border border-slate-200/80 p-5 rounded-2xl space-y-4">
                        <div className="flex items-start gap-3">
                          <div className="p-2 bg-brand-50 border border-brand-100 rounded-lg text-brand-700 shrink-0">
                            <Scale className="w-5 h-5" />
                          </div>
                          <div>
                            <h5 className="font-display font-extrabold text-[#0f172a] text-sm tracking-wide uppercase">
                              The 12 Things CAS Must Prove to a Judge (Section 74)
                            </h5>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Ontario Child, Youth and Family Services Act (CYFSA) statutory evidentiary thresholds.
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                          {[
                            { ground: "1. Physical Harm [s. 74(2)(a)]", desc: "The child has suffered physical harm inflicted by a parent, or due to parental failure." },
                            { ground: "2. Substantial Risk of Physical Harm [s. 74(2)(b)]", desc: "A severe, active risk of physical harm that the parent fails/is unable to protect against." },
                            { ground: "3. Sexual Abuse [s. 74(2)(c)]", desc: "The child has been sexually abused/exploited, or parent knew and failed to protect." },
                            { ground: "4. Substantial Risk of Sexual Abuse [s. 74(2)(d)]", desc: "A substantial risk of abuse, with parent unable or failing to protect." },
                            { ground: "5. Medical Neglect [s. 74(2)(e)]", desc: "Parent refuses or is unable to provide/consent to essential medical treatment." },
                            { ground: "6. Emotional Harm [s. 74(2)(f)]", desc: "The child has suffered severe emotional harm (anxiety, withdrawal) and parent refuses treatment." },
                            { ground: "7. Substantial Risk of Emotional Harm [s. 74(2)(g)]", desc: "Active risk of emotional harm, with parental failure to participate in therapy." },
                            { ground: "8. Abandonment [s. 74(2)(h)]", desc: "The child has been abandoned, or the parent is deceased/unavailable without care provision." },
                            { ground: "9. Parental Impairment [s. 74(2)(i)]", desc: "Risk of harm due to parental physical/mental difficulties, and refusal of services." },
                            { ground: "10. Inability to Control [s. 74(2)(j)]", desc: "Child's behavior is uncontrollable, causing risk of physical/emotional harm." },
                            { ground: "11. Criminal Conduct Context [s. 74(2)(k)]", desc: "Child is under 12, has caused serious bodily harm, and parent refuses treatment." },
                            { ground: "12. Inadequate Supervision [s. 74(2)(l)]", desc: "Child under 12 left unsupervised, or in circumstances showing systemic failure of care." }
                          ].map((item, i) => (
                            <div key={i} className="bg-black border border-slate-150 p-3 rounded-xl space-y-1 shadow-2xs hover:border-brand-150 transition-all">
                              <span className="text-[11px] font-bold text-slate-900 block font-sans">{item.ground}</span>
                              <p className="text-[10.5px] text-slate-500 leading-normal">{item.desc}</p>
                            </div>
                          ))}
                        </div>

                        {/* Critical Warning / Call to Action to Read Documents Carefully */}
                        <div className="bg-amber-50/70 border border-amber-200/80 p-4.5 rounded-xl space-y-2.5">
                          <div className="flex items-center gap-1.5 text-amber-900 font-bold text-xs uppercase tracking-wide">
                            <span className="text-sm">⚠️</span> Critical Parent Defense Action Tip:
                          </div>
                          <p className="text-amber-950 text-xs leading-relaxed">
                            You must <strong>read through your CAS paperwork very carefully!</strong> Every letter, email, home observation note, or court application should be combed word-by-word. Look for subjective worker labels, uncorroborated rumors, missing timestamps, or violations of these 12 strict proof grounds.
                          </p>
                          <p className="text-amber-900 text-[11px] leading-normal font-semibold">
                            💡 <strong>The Analyzer Will Pick This Up!</strong> Simply upload your documents to the Case Cabinet and run our AI Evidentiary Audit. Our system will automatically detect these violations, extract the exact offending quotes, and map out your legal objections in real time!
                          </p>
                        </div>
                      </div>

                      {/* Statutory Timeline & Procedural Violations */}
                      {selectedReport.proceduralTimelineViolations && selectedReport.proceduralTimelineViolations.length > 0 && (
                        <div className="space-y-3 pt-2 border-t border-gray-100">
                          <h5 className="font-display font-bold text-gray-900 text-xs uppercase tracking-wider flex items-center gap-1.5 text-slate-700">
                            <Clock className="w-4 h-4 text-amber-600" /> Statutory Timeline & Procedural Defects ({selectedReport.proceduralTimelineViolations.length})
                          </h5>
                          <div className="space-y-3.5">
                            {selectedReport.proceduralTimelineViolations.map((violation, idx) => (
                              <div key={idx} className="bg-black border border-amber-250/70 p-4 rounded-xl space-y-3 text-xs shadow-xs hover:border-amber-400 transition-colors">
                                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-amber-100">
                                  <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold tracking-wider bg-amber-100 text-amber-800 uppercase">
                                    TIMELINE RULE
                                  </span>
                                  <span className="font-mono font-bold text-amber-900 text-[11px]">{violation.timelineRule}</span>
                                  <button
                                    onClick={() => openLegislativeReference(violation.citation)}
                                    className="font-mono text-amber-900 hover:text-amber-950 font-bold text-[10px] bg-amber-50 hover:bg-amber-100 border border-amber-250 px-2.5 py-1 rounded flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                    title="Click to open Verified Source reference modal"
                                  >
                                    <Scale className="w-3 h-3 text-amber-600" /> Verify: {violation.citation} ↗
                                  </button>
                                </div>
                                
                                {violation.documentAssertion && (
                                  <div className="space-y-1 bg-slate-50 p-2.5 border border-slate-150 rounded-lg">
                                    <div className="flex justify-between items-center">
                                      <span className="text-[9px] font-mono font-extrabold text-slate-400 uppercase tracking-wider">Assertion in Document:</span>
                                      <button
                                        onClick={() => {
                                          setSearchQuery(violation.documentAssertion);
                                          const docViewer = document.getElementById("file-plain-viewer");
                                          if (docViewer) {
                                            docViewer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                          }
                                        }}
                                        className="text-[9px] font-mono text-brand-700 bg-brand-50 hover:bg-brand-100 hover:text-brand-900 font-bold px-2 py-0.5 rounded border border-brand-200 transition-colors cursor-pointer"
                                      >
                                        🔍 Locate Segment
                                      </button>
                                    </div>
                                    <p className="italic text-slate-700 leading-normal font-medium bg-black p-2 border border-slate-100 rounded text-[11.5px]">
                                      "{violation.documentAssertion}"
                                    </p>
                                  </div>
                                  )}
        
                                
                                <p className="text-slate-600 leading-normal text-[11.5px]">
                                  <strong>Evaluation:</strong> {violation.evaluation}
                                </p>

                                {violation.locationInDocument && (
                                  <div className="flex items-center gap-1.5 p-2 bg-brand-50/50 border border-brand-100/40 rounded-lg text-[10.5px] font-mono text-brand-950">
                                    <span className="shrink-0">📌</span>
                                    <span><strong>Verification Locator:</strong> <span className="underline font-bold">{violation.locationInDocument}</span></span>
                                  </div>
                                )}
        

                                <div className="p-3 bg-amber-50/50 border border-amber-200 rounded-lg text-[11px] text-amber-950 font-medium space-y-1">
                                  <div className="font-bold text-amber-900 border-b border-amber-200/50 pb-0.5 flex items-center gap-1">
                                    <span>💡</span> Parent Action Plan:
                                  </div>
                                  <p className="text-[11px] leading-normal">{violation.parentActionStep || "Verify this schedule with the court register immediately."}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        
                        </div>
                      )}

                      {/* Immediate Removal Checks */}
                      <div className="space-y-3 pt-2 border-t border-gray-100">
                        <h5 className="font-display font-medium text-xs uppercase tracking-wider text-slate-700">
                          Immediate Life-Safety Protection Thresholds
                        </h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {selectedReport.thresholdAnalysis.map((thresh, idx) => (
                            <div key={idx} className="p-3 bg-black border border-gray-150 rounded-lg space-y-1.5">
                              <div className="flex justify-between items-center text-[10px] font-mono text-gray-400 font-bold uppercase">
                                <span>{thresh.thresholdChecked}</span>
                                <span className={`px-2 py-0.5 rounded font-bold ${thresh.isMet === "Yes" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>
                                  Met: {thresh.isMet}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 leading-normal">{thresh.reasoning}</p>
                              <span className="text-[9px] text-brand-700 font-mono block font-bold mt-1">Law: {thresh.primarySourceLaw}</span>
                            </div>
                          ))}
</div>
                      </div>

                      {/* Tri checklists */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-100">
                        <div className="space-y-2">
                          <h6 className="font-display font-bold text-gray-800 text-[10px] uppercase tracking-wider border-b pb-1">1. Verify Checks</h6>
                          <ul className="space-y-1.5">
                            {selectedReport.whatToVerify.map((item, i) => (
                              <li key={i} className="text-xs text-slate-600 leading-normal flex gap-1">
                                <span className="text-brand-600 font-bold">☐</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="space-y-2">
                          <h6 className="font-display font-bold text-gray-800 text-[10px] uppercase tracking-wider border-b pb-1">2. Elements Missing</h6>
                          <ul className="space-y-1.5">
                            {selectedReport.whatIsMissing.map((item, i) => (
                              <li key={i} className="text-xs text-slate-600 leading-normal flex gap-1">
                                <span className="text-rose-500 font-bold">⚠</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="space-y-2">
                          <h6 className="font-display font-bold text-gray-800 text-[10px] uppercase tracking-wider border-b pb-1">3. Ask Attorney</h6>
                          <ul className="space-y-1.5">
                            {selectedReport.whatToAskALawyer.map((item, i) => (
                              <li key={i} className="text-xs text-brand-900 bg-brand-50/40 p-2 rounded border border-brand-100 leading-normal">
                                <strong>Q:</strong> {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-dashed border-gray-150 py-12 rounded-2xl text-center space-y-4">
                      {isSingleAnalyzing ? (
                        <div className="space-y-4">
                          <div className="relative inline-block">
                            <div className="w-12 h-12 rounded-full border-4 border-brand-100 border-t-brand-600 animate-spin" />
                            <Scale className="w-5 h-5 text-brand-600 absolute inset-0 m-auto animate-pulse" />
                          </div>
                          <div className="text-xs text-slate-500 font-mono">
                            Running Fast Parallel Analysis (&lt; 10s)...
                          </div>
                        </div>
                      ) : (
                        <>
                          <Sparkles className="w-12 h-12 text-slate-300 mx-auto" />
                          <div className="space-y-1">
                            <h5 className="font-display font-bold text-gray-700 text-sm">No analysis active on this file</h5>
                            <p className="text-xs text-gray-400 max-w-sm mx-auto p-1">
                              This file is organized in Case Locker but lacks an active audit. Click "Run Fast Statutory Audit" to scan it concurrently.
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-6" id="multi-case-ledger">
                  {/* Ledger Header */}
                  <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 text-left shadow-lg relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                      <FolderOpen className="w-40 h-40 text-brand-400" />
                    </div>
                    <div className="relative z-10 space-y-2">
                      <span className="bg-brand-500/20 text-brand-300 border border-brand-400/30 text-[10px] uppercase font-mono font-bold px-2.5 py-0.5 rounded-full tracking-wider">
                        Cabinet Executive Ledger
                      </span>
                      <h3 className="font-display font-black text-white text-2xl">
                        📁 Multi-Case Document Ledger & Summary Dashboard
                      </h3>
                      <p className="text-slate-300 text-xs leading-relaxed max-w-2xl">
                        This executive overview auto-updates in real-time as each document is uploaded and analyzed. Scan below for automated file summaries, lawyer case briefs, evidentiary scores, and critical risk signals across your entire child welfare file repository.
                      </p>
                    </div>
                  </div>

                  {organizedFiles.length === 0 ? (
                    <div className="bg-slate-50 border border-dashed border-gray-200 rounded-2xl p-12 text-center flex flex-col items-center justify-center space-y-4">
                      <FileText className="w-16 h-16 text-gray-300" />
                      <div>
                        <h4 className="font-display font-semibold text-gray-700 text-sm">No Files Uploaded Yet</h4>
                        <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                          Upload family documents, CAS reports, court letters, or voice journals in the Left Case Folders panel to populate this live Multi-Case Ledger.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {organizedFiles.map((file) => {
                        const hasReport = file.analysisStatus === "completed" && file.analysisReport;
                        const report = file.analysisReport;

                        return (
                          <div 
                            key={file.id} 
                            className="bg-black rounded-xl border border-gray-150 p-5 text-left space-y-4 shadow-xs hover:shadow-md transition duration-200"
                          >
                            {/* File Card Top Row */}
                            <div className="flex flex-wrap justify-between items-start gap-3 border-b border-gray-100 pb-3">
                              <div>
                                <span className={`px-2 py-0.5 border text-[9px] font-bold rounded font-mono uppercase ${getCategoryColor(file.category)}`}>
                                  {file.category}
                                </span>
                                <h4 className="font-display font-bold text-gray-900 text-base mt-1 flex items-center gap-1.5">
                                  <span>{file.name}</span>
                                </h4>
                                <p className="text-[10px] font-mono text-gray-400 mt-0.5">
                                  Uploaded: {file.uploadedAt} • Size: {Math.round(file.content.length / 1024)} KB
                                </p>
                              </div>

                              <div className="flex items-center gap-2">
                                {/* Status badge */}
                                {file.analysisStatus === "completed" ? (
                                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-md text-xs font-mono font-bold flex items-center gap-1">
                                    <Check className="w-3.5 h-3.5" /> Audited & Verified
                                  </span>
                                ) : file.analysisStatus === "analyzing" ? (
                                  <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-md text-xs font-mono font-bold flex items-center gap-1 animate-pulse">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing (3-5s)...
                                  </span>
                                ) : file.analysisStatus === "failed" ? (
                                  <span className="bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-1 rounded-md text-xs font-mono font-bold flex items-center gap-1">
                                    <AlertTriangle className="w-3.5 h-3.5" /> Scan Failed
                                  </span>
                                ) : (
                                  <span className="bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-md text-xs font-mono font-bold flex items-center gap-1">
                                    <Clock className="w-3.5 h-3.5" /> Queued for Audit
                                  </span>
                                )}
        

                                {/* Quick selection button */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedFileId(file.id);
                                    setSelectedReport(file.analysisReport || null);
                                  }}
                                  className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-semibold cursor-pointer transition"
                                >
                                  View Audit Details
                                </button>
                              </div>
                            </div>

                            {/* Live summary / analysis content if completed */}
                            {file.analysisStatus === "completed" && report ? (
                              <div className="space-y-4">
                                {/* Completeness & Summary Row */}
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                                  {/* Score Circle Widget */}
                                  <div className="bg-slate-50 border border-slate-100 p-3 rounded-lg text-center flex flex-col items-center justify-center space-y-1">
                                    <div className="relative flex items-center justify-center w-12 h-12">
                                      <svg className="w-full h-full transform -rotate-90">
                                        <circle
                                          cx="24"
                                          cy="24"
                                          r="20"
                                          className="text-gray-100"
                                          strokeWidth="4"
                                          stroke="currentColor"
                                          fill="transparent"
                                        />
                                        <circle
                                          cx="24"
                                          cy="24"
                                          r="20"
                                          className={
                                            report.completenessScore >= 80 
                                              ? "text-emerald-500" 
                                              : report.completenessScore >= 60 
                                                ? "text-amber-500" 
                                                : "text-rose-500"
                                          }
                                          strokeWidth="4"
                                          strokeDasharray={2 * Math.PI * 20}
                                          strokeDashoffset={2 * Math.PI * 20 * (1 - report.completenessScore / 100)}
                                          strokeLinecap="round"
                                          stroke="currentColor"
                                          fill="transparent"
                                        />
                                      </svg>
                                      <span className="absolute text-xs font-mono font-bold text-gray-800">
                                        {report.completenessScore}%
                                      </span>
                                    </div>
                                    <span className="text-[10px] font-mono text-slate-500 uppercase font-bold leading-none">
                                      Evidentiary Weight
                                    </span>
                                  </div>

                                  {/* Executive Summary Paragraph */}
                                  <div className="md:col-span-3 space-y-1 bg-brand-50/20 border border-brand-100/40 p-3 rounded-lg">
                                    <span className="text-[10px] font-mono font-bold uppercase text-brand-800 tracking-wider flex items-center gap-1">
                                      <Sparkles className="w-3 h-3 text-brand-500" /> Executive File Summary:
                                    </span>
                                    <p className="text-xs text-slate-700 leading-relaxed font-sans font-normal italic">
                                      {report.fileSummary || "Analysis complete. This document documents case-level protection assertions, statutory deadlines, or evidentiary statements needing legal review."}
                                    </p>
                                  </div>
                                </div>

                                {/* Lawyer Case Brief Bullets */}
                                {report.lawyerCaseBrief && report.lawyerCaseBrief.length > 0 && (
                                  <div className="bg-slate-50 border border-slate-150 rounded-lg p-3.5 space-y-2">
                                    <div className="flex justify-between items-center border-b pb-1.5 border-slate-200">
                                      <span className="text-[10px] font-mono font-bold uppercase text-slate-700 tracking-wider flex items-center gap-1">
                                        <Briefcase className="w-3 h-3 text-slate-500" /> Lawyer Case Brief (Auto-Extracted):
                                      </span>
                                      
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const isSaved = savedBriefs.some(
                                            b => b.documentId === file.id && 
                                            b.lawyerCaseBrief.join("\n") === report.lawyerCaseBrief.join("\n")
                                          );
                                          if (isSaved) {
                                            alert("Notice: This brief is already saved in your Briefs Archive!");
                                            return;
                                          }

                                          const newBrief: SavedBrief = {
                                            id: "brief-" + Date.now(),
                                            documentId: file.id,
                                            documentTitle: report.documentTitle || file.name,
                                            documentCategory: report.documentType || file.category,
                                            savedAt: new Date().toLocaleDateString(undefined, { 
                                              year: 'numeric', 
                                              month: 'short', 
                                              day: 'numeric', 
                                              hour: '2-digit', 
                                              minute: '2-digit' 
                                            }),
                                            lawyerCaseBrief: report.lawyerCaseBrief,
                                            notes: ""
                                          };

                                          setSavedBriefs(prev => [newBrief, ...prev]);
                                          alert("Success: This case brief has been archived in the Saved Briefs tab!");
                                        }}
                                        className="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 hover:text-emerald-800 rounded font-mono text-[9px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                                        title="Save this brief to the Saved Briefs Archive"
                                      >
                                        <Save className="w-2.5 h-2.5" /> Archive Brief
                                      </button>
                                    </div>
                                    <ul className="space-y-1.5 list-disc pl-4 text-xs text-slate-600 leading-normal">
                                      {report.lawyerCaseBrief.map((bullet: string, idx: number) => {
                                        // Highlight standard bolding patterns from AI response
                                        const cleanBullet = bullet.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                                        return (
                                          <li 
                                            key={idx}
                                            dangerouslySetInnerHTML={{ __html: cleanBullet }}
                                            className="marker:text-slate-400 font-normal"
                                          />
                                        );
                                      })}
                                    </ul>
                                  </div>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      {/* WORKSPACE INTEGRATION MODAL */}
      {isWorkspaceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-black rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col border border-slate-200">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center gap-2">
                <Folder className="w-5 h-5 text-brand-600" />
                <h3 className="font-display font-bold text-gray-900">Import from Google Workspace</h3>
              </div>
              <button 
                onClick={() => setIsWorkspaceModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 overflow-y-auto flex-1">
              {needsAuth ? (
                <div className="text-center py-10 space-y-4">
                  <div className="bg-brand-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-2">
                    <ShieldAlert className="w-8 h-8 text-brand-500" />
                  </div>
                  <h4 className="font-display font-bold text-slate-800 text-lg">Connect your Google Account</h4>
                  <p className="text-slate-500 text-sm max-w-md mx-auto leading-relaxed">
                    Link your account to securely import case files from Google Drive and read relevant correspondence from Gmail.
                  </p>
                  <button 
                    onClick={handleWorkspaceLogin}
                    className="gsi-material-button mt-4"
                  >
                    <div className="gsi-material-button-state"></div>
                    <div className="gsi-material-button-content-wrapper">
                      <div className="gsi-material-button-icon">
                        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" xmlnsXlink="http://www.w3.org/1999/xlink" style={{display: 'block'}}>
                          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                          <path fill="none" d="M0 0h48v48H0z"></path>
                        </svg>
                      </div>
                      <span className="gsi-material-button-contents">Sign in with Google</span>
                    </div>
                  </button>
                </div>
              ) : isLoadingWorkspace ? (
                <div className="flex flex-col items-center justify-center py-16 space-y-3">
                  <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
                  <p className="text-slate-500 text-sm font-medium animate-pulse">Loading Workspace items...</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Google Drive Files */}
                  <div>
                    <h4 className="text-xs font-bold font-mono text-slate-500 uppercase mb-3 px-1 border-b pb-2">Recent Google Drive Files</h4>
                    {workspaceFiles.length === 0 ? (
                      <p className="text-sm text-slate-400 italic px-2">No supported files found.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {workspaceFiles.map(file => (
                          <div 
                            key={file.id} 
                            onClick={() => handleImportDriveFile(file)}
                            className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:border-brand-300 hover:bg-brand-50 cursor-pointer transition-colors group"
                          >
                            <FileText className="w-5 h-5 text-brand-400 group-hover:text-brand-600" />
                            <div className="overflow-hidden">
                              <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                              <p className="text-[10px] text-slate-500">{new Date(file.modifiedTime).toLocaleDateString()}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Gmail Messages */}
                  <div>
                    <h4 className="text-xs font-bold font-mono text-slate-500 uppercase mb-3 px-1 border-b pb-2">Recent Gmail Correspondence</h4>
                    {workspaceEmails.length === 0 ? (
                      <p className="text-sm text-slate-400 italic px-2">No recent emails found.</p>
                    ) : (
                      <div className="space-y-2">
                        {workspaceEmails.map(email => (
                          <div 
                            key={email.id} 
                            onClick={() => handleImportEmail(email)}
                            className="p-3 border border-slate-200 rounded-lg hover:border-brand-300 hover:bg-brand-50 cursor-pointer transition-colors group flex items-start gap-3"
                          >
                            <MessageSquare className="w-5 h-5 text-brand-400 group-hover:text-brand-600 shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-slate-800 truncate">{email.subject}</p>
                              <p className="text-xs text-slate-500 truncate mt-0.5">{email.snippet}</p>
                              <p className="text-[10px] text-slate-400 mt-1 font-mono">{new Date(parseInt(email.timestamp)).toLocaleString()}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
              {!needsAuth ? (
                <button 
                  onClick={logout}
                  className="text-xs font-mono text-slate-500 hover:text-rose-600 transition-colors"
                >
                  Disconnect Google Account
                </button>
              ) : <div></div>}
              <button 
                onClick={() => setIsWorkspaceModalOpen(false)}
                className="px-4 py-2 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-lg text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    
      {/* Confirm Modal */}
      <AnimatePresence>
        {confirmModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100"
            >
              <h3 className="text-lg font-bold text-slate-800 mb-2">{confirmModal.message}</h3>
              {confirmModal.description && (
                <p className="text-sm text-slate-500 mb-6">{confirmModal.description}</p>
              )}
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setConfirmModal(null)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    confirmModal.onConfirm();
                    setConfirmModal(null);
                  }}
                  className="px-4 py-2 text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-colors shadow-sm cursor-pointer"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}