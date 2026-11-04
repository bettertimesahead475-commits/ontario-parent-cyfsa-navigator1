import { useAppReset } from "../hooks/useAppReset";
import React, { useState, useEffect, useRef } from "react";
import { apiFetch, safeReadJson } from "../utils/api";
import { 
  MessageSquare, X, Send, Sparkles, FolderOpen, BookOpen, 
  Trash2, Scale, HelpCircle, ChevronUp, ChevronDown, Check, Zap,
  Shield, FileText, Compass, ExternalLink, RotateCcw, AlertCircle, Bot
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getUserKey } from "../utils/storage";

export type KaceChatMode = "rights" | "report" | "forms" | "cas_process";

interface LocalFile {
  name: string;
  category: string;
  content: string;
}

interface ChatCitation {
  title: string;
  reference: string;
  url?: string;
}

interface ChatMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: string;
  mode?: KaceChatMode;
  modelUsed?: string;
  citations?: ChatCitation[];
}

interface ActiveReportSnapshot {
  fileName?: string;
  esiScore?: number;
  evidenceQuality?: string;
  factualCompleteness?: number;
  analyticalConfidence?: number;
  summary?: string;
  redFlags?: Array<{ category?: string; flag?: string; quote?: string; analysis?: string }>;
  chronology?: Array<{ date?: string; event?: string; source?: string }>;
  contradictions?: Array<{ issue?: string; sourceA?: string; sourceB?: string }>;
  complianceIssues?: Array<{ standard?: string; description?: string }>;
  fullTextExcerpt?: string;
}

const OFFICIAL_COURT_FORMS_URL = "https://ontariocourtforms.on.ca/en/family-law-rules-forms/";

const MODE_DEFINITIONS: Record<
  KaceChatMode,
  { title: string; subtitle: string; icon: React.ComponentType<{ className?: string }>; promptChips: Array<{ label: string; query: string }> }
> = {
  rights: {
    title: "Explain My Rights",
    subtitle: "CYFSA statutory rights, home visits & warrants",
    icon: Shield,
    promptChips: [
      { label: "🛡️ What are my rights on home visits?", query: "What are my legal rights when a CAS worker comes to my door or requests entry into my home under CYFSA s. 81?" },
      { label: "⚠️ When can CAS enter without a warrant?", query: "Under what specific emergency conditions does CYFSA s. 81(7) permit warrantless apprehension, and what is the legal threshold?" },
      { label: "⏱️ What is the 5-day hearing rule?", query: "What does CYFSA s. 94 require regarding bringing an apprehended child before court within 5 days?" },
      { label: "🤝 Are voluntary agreements binding?", query: "What are my rights regarding Voluntary Family Services Agreements (VSA) under CYFSA s. 75, and can I cancel one?" },
    ],
  },
  report: {
    title: "Understand My Report",
    subtitle: "Evidence Strength Index (ESI) & findings",
    icon: Sparkles,
    promptChips: [
      { label: "📊 Explain my ESI score", query: "Can you explain how my Evidence Strength Index (ESI) score was calculated, and what does evidence neutrality mean?" },
      { label: "🚩 What do the red flags mean?", query: "Review the red flags identified in my forensic analysis and explain how they impact the Society's case." },
      { label: "🗣️ How to address hearsay in reports?", query: "Which statements in the report appear to be hearsay or secondary reporting, and how does the court treat them?" },
      { label: "⚖️ What does the compliance matrix show?", query: "Did the Society comply with required Ontario Child Protection Standards according to my compliance analysis?" },
    ],
  },
  forms: {
    title: "Help With Court Forms",
    subtitle: "Prescribed Ontario Family Law Rules forms",
    icon: FileText,
    promptChips: [
      { label: "📝 How do I fill out Form 10 Answer?", query: "How do I draft an effective Form 10 Answer to contest CAS's Form 8B child protection application?" },
      { label: "📑 What goes into a Form 14A Affidavit?", query: "What are the essential rules for drafting a Form 14A Affidavit, and how should I organize exhibits?" },
      { label: "🔍 What is the difference between Form 33B and 33B.1?", query: "What is the difference between Form 33B Society Plan of Care and Form 33B.1 Society Answer & Plan of Care?" },
      { label: "🌐 Link to Official Ontario Court Forms", query: "Where do I download official Ontario Family Law Rules forms, and what is Form 6B Affidavit of Service?" },
    ],
  },
  cas_process: {
    title: "CAS Procedures & Investigation",
    subtitle: "Standards 1–7, timelines & complaint pathways",
    icon: Compass,
    promptChips: [
      { label: "⏳ What is the 30-day investigation rule?", query: "What are CAS's mandatory timelines under Ontario Child Protection Standard 2 to complete an investigation?" },
      { label: "📋 What does Standard 6 require from supervisors?", query: "What supervisory approvals and review timelines are required under Standard 6 before CAS takes action?" },
      { label: "📮 How do I file an O. Reg. 155/18 complaint?", query: "What is the process to file an internal complaint under CYFSA s. 119 and request an Internal Complaint Review Panel (ICRP)?" },
      { label: "🏛️ When can I apply to CFSRB or Ombudsman?", query: "When can a parent apply to the Child and Family Services Review Board (CFSRB) under s. 120 or the Ontario Ombudsman?" },
    ],
  },
};

export default function ParentChatBot() {
  const { resetAll } = useAppReset();
  const [resetConfirm, setResetConfirm] = useState(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activeMode, setActiveMode] = useState<KaceChatMode>("rights");
  const [selectedModel, setSelectedModel] = useState<"gemini" | "claude">("gemini");
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [activeReport, setActiveReport] = useState<ActiveReportSnapshot | null>(null);
  const [selectedForm, setSelectedForm] = useState<string>("");
  const [showFilesList, setShowFilesList] = useState<boolean>(false);
  const [input, setInput] = useState<string>("");
  const [isQuerying, setIsQuerying] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // Load files and active report context from localStorage
  const syncCabinetAndReport = () => {
    try {
      const progressStr = localStorage.getItem(getUserKey("OPA_DOC_ANALYZER_PROGRESS") || "OPA_DOC_ANALYZER_PROGRESS");
      if (progressStr) {
        const parsed = JSON.parse(progressStr);
        if (parsed?.organizedFiles && Array.isArray(parsed.organizedFiles)) {
          const mapped = parsed.organizedFiles.map((f: any) => ({
            name: f.name || "Untitled File",
            category: f.category || "General Context",
            content: f.content || "",
          }));
          setFiles(mapped);
        }

        const report = parsed?.activeReport || parsed?.report;
        if (report) {
          setActiveReport({
            fileName: parsed?.activeFileName || report?.overview?.documentType || "Uploaded Case Record",
            esiScore: report?.overview?.evidenceStrengthIndex ?? report?.overview?.esiScore,
            evidenceQuality: report?.overview?.evidenceQuality,
            factualCompleteness: report?.overview?.factualCompleteness,
            analyticalConfidence: report?.overview?.analyticalConfidence,
            summary: report?.overview?.summary || report?.executiveSummary,
            redFlags: report?.redFlags || [],
            chronology: report?.chronology || [],
            contradictions: report?.contradictions || [],
            complianceIssues: report?.casAccountability?.complianceIssues || [],
            fullTextExcerpt: report?.fullTextExcerpt || "",
          });
        }
      }
    } catch (e) {
      console.warn("Failed to sync cabinet/report into Kace:", e);
    }
  };

  useEffect(() => {
    syncCabinetAndReport();
    window.addEventListener("opa-doc-analyzer-progress-updated", syncCabinetAndReport);
    return () => window.removeEventListener("opa-doc-analyzer-progress-updated", syncCabinetAndReport);
  }, []);

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem("OPA_KACE_CHAT_MESSAGES");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Failed to load Kace chat history:", e);
    }
    return [
      {
        id: "kace-welcome",
        sender: "ai",
        mode: "rights",
        text: "Hello! I am **Kace**, your interactive CYFSA case assistant.\n\n" +
              "I provide context-aware, source-grounded guidance across four specialized modes:\n" +
              "• **Explain My Rights**: Plain-language CYFSA protections, home visit rules, and court hearing deadlines.\n" +
              "• **Understand My Report**: Direct Q&A over your Evidence Strength Index (ESI), red flags, and contradictions.\n" +
              "• **Help With Court Forms**: Field instructions, exhibit organizing, and links to official Ontario Family Law Rules forms.\n" +
              "• **CAS Procedures & Investigation**: Child Protection Standards 1–7, 30-day timelines, and formal complaint pathways.\n\n" +
              "Select a mode above or ask any question below to begin!",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        citations: [
          { title: "CYFSA (2017)", reference: "S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14" },
          { title: "Official Court Forms", reference: "Family Law Rules", url: OFFICIAL_COURT_FORMS_URL },
        ],
      },
    ];
  });

  // Persist messages & scroll
  useEffect(() => {
    try {
      localStorage.setItem("OPA_KACE_CHAT_MESSAGES", JSON.stringify(messages));
    } catch (e) {
      console.warn("Failed to persist Kace chat messages:", e);
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (customQuery?: string) => {
    const queryText = (customQuery || input).trim();
    if (!queryText || isQuerying) return;

    const userMsg: ChatMessage = {
      id: "user-" + Date.now(),
      sender: "user",
      text: queryText,
      mode: activeMode,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customQuery) setInput("");
    setIsQuerying(true);

    try {
      const conversationHistory = messages
        .filter((m) => m.text && m.text.trim())
        .map((m) => ({
          role: (m.sender === "user" ? "user" : "assistant") as "user" | "assistant",
          content: m.text,
        }));

      const payload: Record<string, unknown> = {
        mode: activeMode,
        query: queryText,
        history: conversationHistory,
        model: selectedModel,
        formNumber: selectedForm || undefined,
        reportContext: activeMode === "report" && activeReport ? activeReport : undefined,
        files: files.map((f) => ({ name: f.name, category: f.category, content: f.content })),
        focus: activeMode === "report" ? "evidentiary-auditor" : "family-advocate",
      };

      // Call /api/chat with fallback to /api/rag-query
      let res = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok && res.status === 404) {
        // Fallback to /api/rag-query
        res = await apiFetch("/api/rag-query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const data = await safeReadJson(res);

      const aiMsg: ChatMessage = {
        id: "ai-" + Date.now(),
        sender: "ai",
        mode: activeMode,
        text: data.answer || "I processed your request, but received an empty response. Please verify your connection.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        modelUsed: data.modelUsed || selectedModel,
        citations: data.citations || [],
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      console.error("Kace query error:", err);
      const errMsg: ChatMessage = {
        id: "ai-err-" + Date.now(),
        sender: "ai",
        mode: activeMode,
        text: `**Connection Note:** ${err?.message || "Unable to reach Kace service."}\n\n` +
              `Please ensure the server API is active. You can still consult the [Official Ontario Court Forms](${OFFICIAL_COURT_FORMS_URL}) directly.`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsQuerying(false);
    }
  };

  const handleClearChat = () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      setTimeout(() => setResetConfirm(false), 3000);
      return;
    }
    setResetConfirm(false);
    resetAll();
    setMessages([
      {
        id: "kace-reset-" + Date.now(),
        sender: "ai",
        mode: activeMode,
        text: `Conversation reset. You are in **${MODE_DEFINITIONS[activeMode].title}** mode. What would you like to explore?`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  };

  const handleSwitchMode = (newMode: KaceChatMode) => {
    setActiveMode(newMode);
    const modeInfo = MODE_DEFINITIONS[newMode];
    const systemNotice: ChatMessage = {
      id: "mode-switch-" + Date.now(),
      sender: "ai",
      mode: newMode,
      text: `Switched to **${modeInfo.title}** mode.\n\n*${modeInfo.subtitle}*\n\nAsk any question below or click one of the suggested prompts to get started.`,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, systemNotice]);
  };

  // Markdown parser with clickable link support
  const parseMessageText = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, lineIdx) => {
      const isBullet = line.trim().startsWith("- ") || line.trim().startsWith("• ") || line.trim().startsWith("* ");
      const displayLine = isBullet ? line.trim().replace(/^[-•*]\s+/, "") : line;

      // Parse markdown links [text](url)
      const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
      const renderWithLinks = (rawStr: string) => {
        const parts: React.ReactNode[] = [];
        let lastIdx = 0;
        let match;
        while ((match = linkRegex.exec(rawStr)) !== null) {
          if (match.index > lastIdx) {
            parts.push(rawStr.substring(lastIdx, match.index));
          }
          parts.push(
            <a
              key={match.index}
              href={match[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-600 hover:text-amber-700 underline font-semibold inline-flex items-center gap-0.5"
            >
              {match[1]}
              <ExternalLink className="w-2.5 h-2.5 inline" />
            </a>
          );
          lastIdx = match.index + match[0].length;
        }
        if (lastIdx < rawStr.length) {
          parts.push(rawStr.substring(lastIdx));
        }
        return parts;
      };

      // Handle bold tags **bold**
      const boldParts = displayLine.split(/\*\*([\s\S]*?)\*\*/g);
      const parsedElements = boldParts.map((part, partIdx) => {
        if (partIdx % 2 === 1) {
          return (
            <strong key={partIdx} className="font-extrabold text-slate-900 bg-amber-50/70 px-0.5 rounded-sm">
              {part}
            </strong>
          );
        }
        return <React.Fragment key={partIdx}>{renderWithLinks(part)}</React.Fragment>;
      });

      if (isBullet) {
        return (
          <li key={lineIdx} className="ml-4 list-disc pl-1 text-[11.5px] leading-relaxed text-slate-700 mt-1">
            {parsedElements}
          </li>
        );
      }

      return (
        <p key={lineIdx} className="text-[11.5px] leading-relaxed text-slate-700 mb-1.5 min-h-[4px]">
          {parsedElements}
        </p>
      );
    });
  };

  const activeModeDetails = MODE_DEFINITIONS[activeMode];

  return (
    <>
      {/* Floating Action Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Open Kace Interactive AI Assistant"
        className="fixed bottom-24 right-6 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 select-none cursor-pointer border bg-brand-950 border-brand-900 text-white hover:bg-slate-900 z-[100] no-print group hover:scale-105"
        id="kace-chat-floating-btn"
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div
              key="close-icon"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <X className="w-6 h-6 text-brand-200" />
            </motion.div>
          ) : (
            <motion.div
              key="chat-icon"
              className="relative flex items-center justify-center"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Bot className="w-6 h-6 text-amber-300 group-hover:scale-110 transition-transform" />
              {activeReport?.esiScore !== undefined && (
                <span className="absolute -top-2.5 -right-2.5 bg-emerald-500 text-white font-mono text-[9px] font-extrabold px-1.5 py-0.5 rounded-full border border-brand-950 shadow-sm animate-pulse">
                  ESI {activeReport.esiScore}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      {/* Main Kace Interactive AI Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="fixed bottom-24 right-4 left-4 sm:left-auto sm:right-6 sm:w-[420px] md:w-[460px] h-[72vh] max-h-[640px] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden z-[99] no-print"
            id="kace-chat-window"
          >
            {/* Header: Assistant branding & model toggle */}
            <div className="bg-brand-950 text-white p-3.5 shrink-0 space-y-2 relative border-b border-brand-900">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-brand-900 rounded-lg text-amber-300 border border-brand-800">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-display font-extrabold tracking-wide uppercase flex items-center gap-1.5 text-slate-100">
                      Kace Interactive Assistant
                    </h3>
                    <p className="text-[10px] text-brand-300 font-medium">Context-Aware CYFSA Guidance</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleClearChat}
                    title={resetConfirm ? "Click again to confirm reset" : "Reset conversation"}
                    className={`p-1.5 rounded-md transition-colors ${
                      resetConfirm ? "bg-red-500 text-white" : "hover:bg-brand-900 text-brand-300 hover:text-white"
                    }`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1.5 rounded-md hover:bg-brand-900 text-brand-300 hover:text-white transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* 4 Mode Navigation Tabs */}
              <div className="grid grid-cols-4 gap-1 pt-1">
                {(Object.keys(MODE_DEFINITIONS) as KaceChatMode[]).map((modeKey) => {
                  const mode = MODE_DEFINITIONS[modeKey];
                  const Icon = mode.icon;
                  const isActive = activeMode === modeKey;
                  return (
                    <button
                      key={modeKey}
                      onClick={() => handleSwitchMode(modeKey)}
                      className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-lg text-center transition-all cursor-pointer ${
                        isActive
                          ? "bg-amber-400 text-brand-950 font-bold shadow-xs scale-102"
                          : "bg-brand-900/60 text-brand-200 hover:bg-brand-900 hover:text-white font-medium"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 mb-0.5" />
                      <span className="text-[9px] leading-tight line-clamp-1">{mode.title.split(" ")[0]}</span>
                    </button>
                  );
                })}
              </div>

              {/* Context sub-bar */}
              <div className="flex items-center justify-between text-[10px] pt-0.5 text-brand-300 font-sans">
                <span className="font-medium text-amber-200 truncate flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  Mode: {activeModeDetails.title}
                </span>

                {/* Model toggle */}
                <div className="flex items-center gap-1 bg-brand-900/90 rounded px-1.5 py-0.5 border border-brand-800">
                  <span className="text-[8.5px] font-mono text-slate-300 uppercase">AI:</span>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value as "gemini" | "claude")}
                    className="bg-transparent text-[9px] font-bold text-amber-300 outline-none cursor-pointer"
                  >
                    <option value="gemini" className="bg-brand-950 text-white">⚡ Gemini 3.6 Flash (Default)</option>
                    <option value="claude" className="bg-brand-950 text-white">🧠 Claude 3.5 Sonnet</option>
                  </select>
                </div>
              </div>

              {/* Active report indicator in Report mode */}
              {activeMode === "report" && activeReport && (
                <div className="bg-emerald-950/70 border border-emerald-700/60 rounded-md p-1.5 flex items-center justify-between text-[9.5px]">
                  <span className="text-emerald-200 truncate max-w-[240px]">
                    📄 Report: {activeReport.fileName}
                  </span>
                  {activeReport.esiScore !== undefined && (
                    <span className="bg-emerald-500/20 text-emerald-300 font-mono font-bold px-1.5 py-0.2 rounded border border-emerald-500/30">
                      ESI {activeReport.esiScore}/100
                    </span>
                  )}
                </div>
              )}

              {/* Official forms shortcut in Forms mode */}
              {activeMode === "forms" && (
                <div className="bg-brand-900/80 border border-brand-800 rounded-md p-1.5 flex items-center justify-between text-[9.5px]">
                  <span className="text-amber-200">Official Ontario Court Forms</span>
                  <a
                    href={OFFICIAL_COURT_FORMS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-300 hover:text-amber-100 underline flex items-center gap-0.5 font-bold"
                  >
                    Forms Library <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              )}
            </div>

            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/60">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl p-3 shadow-xs ${
                      msg.sender === "user"
                        ? "bg-brand-950 text-white rounded-tr-none"
                        : "bg-white border border-slate-200 text-slate-800 rounded-tl-none"
                    }`}
                  >
                    {msg.sender === "ai" ? (
                      <div className="space-y-2">
                        <div className="prose prose-sm max-w-none">
                          {parseMessageText(msg.text)}
                        </div>

                        {/* Citations Pill Bar */}
                        {Array.isArray(msg.citations) && msg.citations.length > 0 && (
                          <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap gap-1">
                            {msg.citations.map((c, ci) => (
                              <span
                                key={ci}
                                className="inline-flex items-center gap-1 text-[9px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200 font-medium"
                              >
                                <Scale className="w-2.5 h-2.5 text-brand-700" />
                                {c.url ? (
                                  <a
                                    href={c.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:underline text-amber-700 font-semibold inline-flex items-center gap-0.5"
                                  >
                                    {c.title}
                                    <ExternalLink className="w-2 h-2" />
                                  </a>
                                ) : (
                                  <span>{c.title}</span>
                                )}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Model & Timestamp */}
                        {msg.modelUsed && (
                          <div className="flex items-center gap-1 text-[8px] text-slate-400 font-mono pt-1">
                            <Zap className="w-2.5 h-2.5 text-amber-500" />
                            <span>ENGINE: {msg.modelUsed}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-[11.5px] leading-relaxed">{msg.text}</p>
                    )}
                  </div>
                  <span className="text-[8.5px] text-slate-400 mt-1 font-mono px-1">
                    {msg.timestamp}
                  </span>
                </div>
              ))}

              {isQuerying && (
                <div className="flex flex-col items-start animate-pulse">
                  <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none p-3 flex items-center gap-2 max-w-[85%] shadow-xs">
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce delay-100"></span>
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce delay-200"></span>
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce delay-300"></span>
                    <span className="text-[11px] font-mono text-slate-500 ml-1">Kace analyzing verified legal context...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Dynamic Prompt Chips for Active Mode */}
            <div className="px-3 py-2 bg-white border-t border-slate-100 shrink-0 space-y-1">
              <div className="flex items-center gap-1 text-[9px] text-slate-500 font-bold uppercase tracking-wider font-sans">
                <HelpCircle className="w-3 h-3 text-brand-700" />
                <span>Suggested Questions ({activeModeDetails.title}):</span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar scroll-smooth">
                {activeModeDetails.promptChips.map((chip, idx) => (
                  <button
                    key={idx}
                    disabled={isQuerying}
                    onClick={() => handleSendMessage(chip.query)}
                    className="shrink-0 px-2.5 py-1 text-[10px] font-medium text-slate-700 bg-slate-100 hover:bg-amber-50 hover:text-brand-950 border border-slate-200 hover:border-amber-300 rounded-full cursor-pointer transition-all duration-150 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat Input & Legal Notice */}
            <div className="p-3 bg-slate-50 border-t border-slate-100 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isQuerying}
                  placeholder={`Ask Kace in ${activeModeDetails.title} mode...`}
                  className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-75"
                />
                <button
                  type="submit"
                  disabled={isQuerying || !input.trim()}
                  className="p-2 bg-brand-950 hover:bg-slate-900 disabled:bg-slate-200 text-white disabled:text-slate-400 rounded-xl transition duration-200 flex items-center justify-center cursor-pointer shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
              <p className="mt-1.5 text-[8px] text-slate-400 font-medium font-sans leading-snug">
                <strong className="text-slate-500">LEGAL INFORMATION NOTICE:</strong> Kace provides educational procedural guidance under the CYFSA and Family Law Rules. This does not constitute legal representation or legal advice. Consult a lawyer licensed by the Law Society of Ontario or contact Legal Aid Ontario.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
