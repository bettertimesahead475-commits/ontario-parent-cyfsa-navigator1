import React, { useState } from "react";
import { Bot, Send, Loader2, Sparkles, X, FileText, Mail, DownloadCloud } from "lucide-react";
import { fetchDriveFiles, fetchRecentEmails } from "../utils/workspace";
import { useLocation } from "wouter";

export default function ConnectorSearchBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string; files?: any[]; emails?: any[] }[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [, setLocation] = useLocation();

  const sendMessage = async () => {
    if (!input.trim()) return;
    
    const userMsg = { role: 'user' as const, text: input };
    setMessages(prev => [...prev, userMsg]);
    const query = input;
    setInput("");
    setIsLoading(true);

    try {
      // If it looks like a workspace search query
      if (query.toLowerCase().includes("find") || query.toLowerCase().includes("search") || query.toLowerCase().includes("drive") || query.toLowerCase().includes("email")) {
        const searchTerm = query.replace(/(find|search|my|google|drive|files|emails|email|for)/gi, "").trim() || undefined;
        
        let authError = false;
        const [driveFiles, emails] = await Promise.all([
          fetchDriveFiles(searchTerm).catch((e) => { if (e.message === 'Not authenticated') authError = true; return []; }),
          fetchRecentEmails(searchTerm).catch((e) => { if (e.message === 'Not authenticated') authError = true; return []; })
        ]);

        if (authError) {
          setMessages(prev => [...prev, { role: 'assistant', text: "You need to connect your Google Workspace account first to search your Drive and Gmail. Please connect it in the Document Analyzer." }]);
          setIsLoading(false);
          return;
        }

        if (driveFiles.length === 0 && emails.length === 0) {
          setMessages(prev => [...prev, { role: 'assistant', text: "I couldn't find any matching files in your Google Drive or Gmail." }]);
        } else {
          setMessages(prev => [...prev, { 
            role: 'assistant', 
            text: `Found ${driveFiles.length} files and ${emails.length} emails matching your request.`,
            files: driveFiles,
            emails: emails
          }]);
        }
      } else {
        const response = await fetch("/api/search-connectors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        const data = await response.json();
        setMessages(prev => [...prev, { role: 'assistant', text: data.response }]);
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', text: "Sorry, I encountered an error connecting to the service: " + error.message }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportDrive = (file: any) => {
    window.dispatchEvent(new CustomEvent('opa-import-workspace', { detail: { type: 'drive', file } }));
    setLocation("/document-analyzer");
    setIsOpen(false);
  };

  const handleImportEmail = (email: any) => {
    window.dispatchEvent(new CustomEvent('opa-import-workspace', { detail: { type: 'email', email } }));
    setLocation("/document-analyzer");
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 left-6 z-[99] p-4 bg-brand-600 text-white rounded-full shadow-2xl hover:scale-105 transition-transform"
      >
        <Bot className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 left-6 z-[99] w-96 bg-black rounded-2xl shadow-2xl border border-gray-200 flex flex-col h-[550px]">
      <div className="p-4 bg-brand-600 text-white rounded-t-2xl flex justify-between items-center">
        <div className="flex items-center gap-2 font-bold">
          <Bot className="w-5 h-5" /> Legal Connector Chat
        </div>
        <button onClick={() => setIsOpen(false)} className="hover:bg-brand-700 p-1 rounded transition-colors"><X className="w-5 h-5" /></button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-gray-500 text-center py-4 space-y-2">
            <p>I can search your connected Google Drive and Gmail for evidence files.</p>
            <p className="font-semibold">Try asking: "Search my emails for school report"</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`p-3 rounded-lg text-sm ${m.role === 'user' ? 'bg-brand-100 ml-auto max-w-[85%]' : 'bg-gray-100 max-w-[95%]'}`}>
            <div>{m.text}</div>
            
            {m.files && m.files.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="font-semibold text-xs text-slate-500 uppercase">Drive Files</div>
                {m.files.map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between bg-black p-2 rounded border border-gray-200">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <FileText className="w-4 h-4 text-brand-500 shrink-0" />
                      <span className="truncate text-xs">{f.name}</span>
                    </div>
                    <button onClick={() => handleImportDrive(f)} className="ml-2 shrink-0 bg-brand-50 text-brand-700 p-1.5 rounded hover:bg-brand-100">
                      <DownloadCloud className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {m.emails && m.emails.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="font-semibold text-xs text-slate-500 uppercase">Emails</div>
                {m.emails.map((email: any) => (
                  <div key={email.id} className="flex items-center justify-between bg-black p-2 rounded border border-gray-200">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <Mail className="w-4 h-4 text-amber-500 shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate text-xs font-medium">{email.subject}</span>
                        <span className="truncate text-[10px] text-gray-500">{email.snippet.substring(0, 40)}...</span>
                      </div>
                    </div>
                    <button onClick={() => handleImportEmail(email)} className="ml-2 shrink-0 bg-amber-50 text-amber-700 p-1.5 rounded hover:bg-amber-100">
                      <DownloadCloud className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {isLoading && <Loader2 className="w-5 h-5 animate-spin mx-auto text-brand-500 mt-2" />}
      </div>
      <div className="p-4 border-t flex gap-2">
        <input 
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Ask a legal question or search files..."
          className="flex-1 border border-gray-300 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button onClick={sendMessage} className="p-2 bg-brand-600 hover:bg-brand-700 transition-colors text-white rounded-lg flex items-center justify-center">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
