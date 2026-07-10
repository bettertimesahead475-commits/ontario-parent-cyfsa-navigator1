import { useAppReset } from "../hooks/useAppReset";
import React, { useState, useEffect, useRef } from "react";
import { apiFetch, safeReadJson } from "../utils/api";
import { 
  MessageSquare, X, Send, Sparkles, FolderOpen, BookOpen, 
  Trash2, Scale, HelpCircle, ChevronUp, ChevronDown, Check, Zap 
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface LocalFile {
  name: string;
  category: string;
  content: string;
}

interface ChatMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: string;
  modelUsed?: string;
  citations?: string[];
}

export default function ParentChatBot() {
  const { resetAll } = useAppReset();
  const [resetConfirm, setResetConfirm] = useState(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem("OPA_COACH_CHAT_MESSAGES");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Failed to load coach chat history:", e);
    }
    return [
      {
        id: "coach-welcome",
        sender: "ai",
        text: "Hello! I am your **CYFSA ParentShield Advisor**. I'm here to support you with expert, educational advice from a parent's perspective.\n\n" +
              "Whenever you upload documents (like CAS letters, reports, or logs) to the **Document Analyzer Tab**, I will automatically synchronize and read them as context to answer your questions with extreme relevance! 📂\n\n" +
              "How can I help you understand your rights or analyze your case files today?",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
  });
  
  const [input, setInput] = useState<string>("");
  const [isQuerying, setIsQuerying] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>("claude-3-5-sonnet-20241022");
  const [showFilesList, setShowFilesList] = useState<boolean>(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load files from localStorage and subscribe to updates
  const syncFilesFromCabinet = () => {
    try {
      const progress = localStorage.getItem("OPA_DOC_ANALYZER_PROGRESS");
      if (progress) {
        const parsed = JSON.parse(progress);
        if (parsed?.organizedFiles && Array.isArray(parsed.organizedFiles)) {
          const mapped = parsed.organizedFiles.map((f: any) => ({
            name: f.name || "Untitled File",
            category: f.category || "General Context",
            content: f.content || ""
          }));
          setFiles(mapped);
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to sync cabinet files to chatbot:", e);
    }
    setFiles([]);
  };

  useEffect(() => {
    syncFilesFromCabinet();

    // Listen to custom updates from DocumentAnalyzerTab
    window.addEventListener("opa-doc-analyzer-progress-updated", syncFilesFromCabinet);
    return () => {
      window.removeEventListener("opa-doc-analyzer-progress-updated", syncFilesFromCabinet);
    };
  }, []);

  // Persist messages
  useEffect(() => {
    try {
      localStorage.setItem("OPA_COACH_CHAT_MESSAGES", JSON.stringify(messages));
    } catch (e) {
      console.warn("Failed to persist coach chat messages:", e);
    }
    // Scroll to bottom
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (customQuery?: string) => {
    const queryText = (customQuery || input).trim();
    if (!queryText || isQuerying) return;

    const userMsg: ChatMessage = {
      id: "user-" + Date.now(),
      sender: "user",
      text: queryText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    if (!customQuery) setInput("");
    setIsQuerying(true);

    try {
      // Prepare standard files context payload
      const filesContext = files.map(f => ({
        name: f.name,
        category: f.category,
        content: f.content
      }));

      // Call our robust backend RAG endpoint with "family-advocate" focus for educational guidance
      const res = await apiFetch("/api/rag-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: queryText,
          files: filesContext,
          model: selectedModel,
          focus: "family-advocate" // Highly supportive, calm, educational parent-coaching focus
        })
      });

      const data = await safeReadJson(res);

      const aiMsg: ChatMessage = {
        id: "ai-" + Date.now(),
        sender: "ai",
        text: data.answer || "I parsed the context but am having trouble summarizing an answer. Please verify if the API secret keys are correctly set.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: selectedModel,
        citations: data.citations || []
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      console.error("Chatbot query error:", err);
      const errMsg: ChatMessage = {
        id: "ai-err-" + Date.now(),
        sender: "ai",
        text: `**RAG Connection Issue:** ${err.message || "Unable to retrieve advisor feedback from the server."} Let's double check if your \`ANTHROPIC_API_KEY\` or \`GEMINI_API_KEY\` is active inside the environment settings.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errMsg]);
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
  };

  // Helper chips for quick educational questions
  const educationalChips = [
    { label: "🛡️ What are my rights on home visits?", query: "What are my legal rights when a CAS worker shows up at my door or requests a home inspection?" },
    { label: "🗣️ How do I fight hearsay reports?", query: "How under Ontario evidence rules can I challenge hearsay statements or anonymous neighbor reports in child welfare court?" },
    { label: "⚖️ What 12 things must CAS prove?", query: "What are the 12 strict statutory things CAS is required to prove to a judge under s.74 of the CYFSA before they can declare a child in need of protection?" },
    { label: "📝 Help me create a kinship safety plan", query: "How do I draft an effective kinship safety plan with approved family backups to rebut CAS claims that the child must be removed?" }
  ];

  // Quick markdown-like parser for bolding (**text**) and clean paragraph rendering
  const parseMessageText = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, lineIdx) => {
      // Check for bullet lines
      const isBullet = line.trim().startsWith("- ") || line.trim().startsWith("* ");
      const displayLine = isBullet ? line.trim().replace(/^[-*]\s+/, "") : line;

      // Handle bold tags **bold**
      const parts = displayLine.split(/\*\*([\s\S]*?)\*\*/g);
      const parsedElements = parts.map((part, partIdx) => {
        if (partIdx % 2 === 1) {
          return <strong key={partIdx} className="font-extrabold text-slate-900 bg-brand-50/60 px-0.5 rounded-sm">{part}</strong>;
        }
        return part;
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

  return (
    <>
      {/* Floating Action Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Open Educational Case Advisor Chat"
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 select-none cursor-pointer border bg-brand-950 border-brand-900 text-white hover:bg-slate-900 z-[98] no-print group hover:scale-105"
        id="parent-coaching-floating-btn"
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
              className="relative"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <MessageSquare className="w-6 h-6 text-amber-300 group-hover:scale-110 transition-transform" />
              {files.length > 0 && (
                <span className="absolute -top-2.5 -right-2.5 bg-emerald-500 text-white font-mono text-[9px] font-extrabold px-1.5 py-0.5 rounded-full border border-brand-950 shadow-sm animate-bounce">
                  {files.length}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      {/* Persistent Coaching Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="fixed bottom-24 right-6 w-[360px] md:w-[410px] h-[580px] bg-black border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden z-[98] no-print"
            id="parent-coaching-sidebar"
          >
            {/* Header section with brand and educational badges */}
            <div className="bg-brand-950 text-white p-4 shrink-0 space-y-2.5 relative">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-brand-900 rounded-lg text-amber-300 border border-brand-800">
                    <Scale className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-display font-extrabold tracking-wide uppercase flex items-center gap-1.5 text-slate-100">
                      ParentShield Advisor
                    </h3>
                    <p className="text-[10px] text-brand-300 font-medium">Empathetic CYFSA Educational Coach</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleClearChat}
                    title="Clear Conversation History"
                    className="p-1.5 rounded-md hover:bg-brand-900 text-brand-300 hover:text-white transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button 
                    onClick={() => setIsOpen(false)}
                    className="p-1.5 rounded-md hover:bg-brand-900 text-brand-300 hover:text-white transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Real-time Case Cabinet files attachment sync bar */}
              <div className="flex items-center justify-between bg-brand-900/60 border border-brand-900 rounded-lg p-2 text-[10.5px]">
                <button
                  onClick={() => setShowFilesList(!showFilesList)}
                  className="flex items-center gap-1.5 font-semibold text-amber-200 hover:text-amber-100 outline-none transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Cabinet: {files.length} File{files.length !== 1 ? "s" : ""} Linked
                  </span>
                  {showFilesList ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                </button>
                <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded font-mono font-bold uppercase tracking-wider">
                  Live Sync Active
                </span>
              </div>

              {/* Show attached files dropdown details */}
              {showFilesList && (
                <div className="bg-brand-900 border border-brand-800/80 rounded-lg p-2 max-h-[100px] overflow-y-auto space-y-1 text-[10px] text-brand-100">
                  {files.length === 0 ? (
                    <p className="text-brand-300 italic text-center py-1">No files in cabinet. Upload your paperwork in the Document Analyzer Tab!</p>
                  ) : (
                    files.map((file, i) => (
                      <div key={i} className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-brand-950/40 rounded">
                        <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="truncate font-mono font-medium">{file.name}</span>
                        <span className="text-[8px] text-brand-300 ml-auto bg-brand-950/80 px-1 py-0.2 rounded shrink-0">{file.category}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Model selection bar */}
              <div className="flex items-center gap-1.5 justify-between pt-0.5 border-t border-brand-900">
                <span className="text-[9px] text-brand-300 font-mono font-bold tracking-wider uppercase">AI INTELLIGENCE LEVEL:</span>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="bg-brand-900 border border-brand-850 text-[10px] font-semibold text-amber-200 rounded px-1.5 py-0.5 outline-none cursor-pointer focus:border-amber-300 transition-colors"
                >
                  <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet (High Intelligence) 🧠</option>
                  <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku (Fast reasoning) ⚡</option>
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Low Latency) ⚡</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash 🚀</option>
                </select>
              </div>
            </div>

            {/* Messages container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
              {messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
                >
                  <div className={`max-w-[85%] rounded-2xl p-3 shadow-xs ${
                    msg.sender === "user" 
                      ? "bg-brand-900 text-white rounded-tr-none" 
                      : "bg-black border border-slate-200 text-slate-800 rounded-tl-none"
                  }`}>
                    {msg.sender === "ai" ? (
                      <div className="space-y-1.5">
                        <div className="prose prose-sm">
                          {parseMessageText(msg.text)}
                        </div>
                        {msg.modelUsed && (
                          <div className="flex items-center gap-1 text-[8px] text-slate-400 font-mono mt-2 border-t border-slate-100 pt-1.5">
                            <Zap className="w-2.5 h-2.5 text-amber-500" />
                            <span>COACH ENGINE: {msg.modelUsed.toUpperCase()}</span>
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
                  <div className="bg-black border border-slate-200 rounded-2xl rounded-tl-none p-3.5 flex items-center gap-2 max-w-[85%] shadow-xs">
                    <span className="w-2 h-2 bg-brand-600 rounded-full animate-bounce delay-100"></span>
                    <span className="w-2 h-2 bg-brand-600 rounded-full animate-bounce delay-200"></span>
                    <span className="w-2 h-2 bg-brand-600 rounded-full animate-bounce delay-300"></span>
                    <span className="text-[11px] font-mono text-slate-400 ml-1">Advisor reasoning...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Educational Prompt Chips & Helper Menu */}
            <div className="px-3 py-2 bg-black border-t border-slate-150 shrink-0 space-y-1.5">
              <div className="flex items-center gap-1 text-[9px] text-brand-950 font-bold tracking-wider uppercase font-sans">
                <HelpCircle className="w-3.5 h-3.5 text-brand-700" />
                <span>Parent Case-Prep Quick Guide:</span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar scroll-smooth">
                {educationalChips.map((chip, idx) => (
                  <button
                    key={idx}
                    disabled={isQuerying}
                    onClick={() => handleSendMessage(chip.query)}
                    className="shrink-0 px-2.5 py-1 text-[10px] font-semibold text-slate-700 bg-slate-100 hover:bg-brand-50 hover:text-brand-900 border border-slate-200 hover:border-brand-200 rounded-full cursor-pointer transition-all duration-200 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Input Footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-150 shrink-0">
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
                  placeholder={files.length > 0 ? "Ask about your files..." : "Ask a CYFSA / rights question..."}
                  className="flex-1 bg-black border border-slate-200/90 rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 disabled:opacity-75"
                />
                <button
                  type="submit"
                  disabled={isQuerying || !input.trim()}
                  className="p-2 bg-brand-950 hover:bg-slate-900 disabled:bg-slate-200 text-white disabled:text-slate-400 rounded-xl transition duration-200 flex items-center justify-center cursor-pointer shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
              <div className="flex items-center justify-between mt-1.5 text-[8.5px] text-slate-400 font-medium font-sans">
                <span>📚 Purely educational guidance portal</span>
                <span>Jurisdiction: Ontario Compliant</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
