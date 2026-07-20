import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { 
  Volume2, 
  VolumeX, 
  Play, 
  Pause, 
  Square, 
  ChevronDown, 
  ChevronUp, 
  Sparkles, 
  FileText, 
  CornerDownRight,
  Gauge,
  User,
  Info,
  X
} from "lucide-react";

export default function FloatingTTS() {
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [selectedText, setSelectedText] = useState<string>("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>("");
  const [currentlySpeakingText, setCurrentlySpeakingText] = useState<string>("");
  const [hasSelection, setHasSelection] = useState(false);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Load voices on mount
  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const loadVoices = () => {
        const availableVoices = window.speechSynthesis.getVoices();
        // Filter mainly for English voices as CYFSA is an Ontario legislation portal
        const englishVoices = availableVoices.filter(v => v.lang.startsWith("en") || v.lang.startsWith("fr"));
        const finalVoices = englishVoices.length > 0 ? englishVoices : availableVoices;
        setVoices(finalVoices);

        // Auto-select a high-quality voice default if available
        const defaultVoice = finalVoices.find(v => v.lang.includes("en") && v.default) || finalVoices.find(v => v.lang.includes("en")) || finalVoices[0];
        if (defaultVoice) {
          setSelectedVoiceName(defaultVoice.name);
        }
      };

      loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    }

    // Monitor highlight/selection events globally
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : "";
      if (text.length > 3 && text.length < 1500) {
        setSelectedText(text);
        setHasSelection(true);
      } else {
        setHasSelection(false);
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Stop narration immediately if route/tab location changes to preserve context
  useEffect(() => {
    stopSpeaking();
  }, [location]);

  const stopSpeaking = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentlySpeakingText("");
  };

  const pauseSpeaking = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.pause();
      setIsPaused(true);
      setIsPlaying(false);
    }
  };

  const resumeSpeaking = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      setIsPlaying(true);
    }
  };

  // Helper to scrape clean paragraphs, headings, lists from the active main area
  const extractPageNarrative = (): string => {
    const mainEl = document.getElementById("main-frame-area");
    if (!mainEl) return "";

    // Query headings, paragraphs, bullet elements which carry core legal info
    const contentNodes = mainEl.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, [data-tts-read]");
    const cleanSegments: string[] = [];

    contentNodes.forEach(node => {
      // Filter out non-readable interface controls and widgets
      if (
        node.closest("button") || 
        node.closest("select") || 
        node.closest("input") || 
        node.closest("textarea") ||
        node.closest(".no-print") || 
        node.closest("nav") || 
        node.closest("#etransfer-activator") || 
        node.closest("#checkout-sheet-modal") ||
        node.closest("#android-build-modal") ||
        node.closest("#lawyer-demo-onboarding-banner")
      ) {
        return;
      }

      const txt = node.textContent?.trim();
      // Ensure we skip tiny text fragments or icon markers
      if (txt && txt.length > 10) {
        cleanSegments.push(txt);
      }
    });

    return cleanSegments.slice(0, 15).join(". "); // Limiting to first 15 cohesive segments to avoid overflowing synthesis
  };

  const startSpeaking = (targetText: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      alert("TTS not supported in this browser.");
      return;
    }

    window.speechSynthesis.cancel();

    if (!targetText) {
      alert("No active text found to read aloud. Highlight text or click on statutory guide segments first!");
      return;
    }

    // clean extra spaces and symbols
    const polishedText = targetText.replace(/\s+/g, " ").trim();
    setCurrentlySpeakingText(polishedText);

    const utterance = new SpeechSynthesisUtterance(polishedText);
    utteranceRef.current = utterance;
    utterance.rate = speechRate;

    // Apply selected voice
    if (selectedVoiceName) {
      const voice = voices.find(v => v.name === selectedVoiceName);
      if (voice) {
        utterance.voice = voice;
      }
    }

    utterance.onend = () => {
      setIsPlaying(false);
      setIsPaused(false);
      setCurrentlySpeakingText("");
    };

    utterance.onerror = (e) => {
      console.warn("TTS Utterance Error:", e);
      setIsPlaying(false);
      setIsPaused(false);
      setCurrentlySpeakingText("");
    };

    setIsPlaying(true);
    setIsPaused(false);
    window.speechSynthesis.speak(utterance);
  };

  const handleReadSelection = () => {
    if (selectedText) {
      startSpeaking(selectedText);
    }
  };

  const handleReadFullPage = () => {
    const scrapedText = extractPageNarrative();
    if (scrapedText) {
      startSpeaking(scrapedText);
    } else {
      startSpeaking("No readable page content could be isolated. Try selecting any legal text to read aloud.");
    }
  };

  const handleTogglePlayPause = () => {
    if (isPaused) {
      resumeSpeaking();
    } else if (isPlaying) {
      pauseSpeaking();
    } else {
      // Default to reading selected text first, then full page
      if (selectedText) {
        handleReadSelection();
      } else {
        handleReadFullPage();
      }
    }
  };

  const updateSpeechRate = (newRate: number) => {
    setSpeechRate(newRate);
    if (isPlaying && utteranceRef.current) {
      // Synthesis engines require a restart to pick up rate updates
      const textToResume = currentlySpeakingText;
      stopSpeaking();
      setTimeout(() => {
        startSpeaking(textToResume);
      }, 100);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[99] no-print font-sans" id="floating-tts-container">
      
      {/* Expanded Control Box */}
      {isOpen && (
        <div className="absolute bottom-16 right-0 w-[340px] max-w-[calc(100vw-2rem)] bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-800 p-5 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-200" id="tts-panel-card">
          
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-brand-500/10 text-brand-400 flex items-center justify-center border border-brand-500/20">
                <Volume2 className="w-4 h-4 animate-pulse text-brand-400" />
              </div>
              <div>
                <h4 className="text-xs font-display font-extrabold uppercase tracking-wider text-slate-100">CYFSA Navigator Narrator</h4>
                <p className="text-[9px] font-mono text-slate-450 uppercase">Ontario S.O. 2017 Ch. 14 Access</p>
              </div>
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white p-1 hover:bg-slate-800/60 rounded-lg transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Selection Status or Guide text */}
          {hasSelection ? (
            <div className="bg-brand-950/45 border border-brand-800/40 rounded-xl p-3 text-xs space-y-1.5 text-left animate-pulse">
              <span className="text-[9px] font-mono font-bold text-brand-300 uppercase tracking-widest block">Text Highlight Detected</span>
              <p className="text-slate-200 leading-normal text-[11px] line-clamp-2 italic">
                "{selectedText}"
              </p>
              <button
                onClick={handleReadSelection}
                className="w-full py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition flex items-center justify-center gap-1 cursor-pointer"
              >
                <Play className="w-3 h-3 fill-white" />
                <span>Read Selected Paragraph</span>
              </button>
            </div>
          ) : (
            <div className="bg-slate-950 border border-slate-800/40 rounded-xl p-3 text-xs flex gap-2.5 items-start text-left">
              <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold text-slate-200 block text-[11px]">Accessibility Assist</span>
                <p className="text-slate-400 leading-normal text-[10px]">
                  Highlight any legal text with your cursor, or click below to read the active guide view.
                </p>
              </div>
            </div>
          )}

          {/* Speaking Text Preview Bar (if active) */}
          {isPlaying && currentlySpeakingText && (
            <div className="bg-slate-950/80 border border-emerald-500/20 p-2.5 rounded-xl space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[8px] font-mono font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                  <span>Currently Reading</span>
                </span>
                
                {/* Simulated Audio Soundbars */}
                <div className="flex items-end gap-0.5 h-3">
                  <div className="w-0.5 bg-emerald-400 h-2 animate-bounce rounded-full" style={{ animationDelay: "0.1s" }}></div>
                  <div className="w-0.5 bg-emerald-400 h-3 animate-bounce rounded-full" style={{ animationDelay: "0.3s" }}></div>
                  <div className="w-0.5 bg-emerald-400 h-1 animate-bounce rounded-full" style={{ animationDelay: "0.2s" }}></div>
                  <div className="w-0.5 bg-emerald-400 h-2 animate-bounce rounded-full" style={{ animationDelay: "0.4s" }}></div>
                </div>
              </div>
              <p className="text-[10px] text-slate-300 leading-tight text-left line-clamp-2 italic">
                "{currentlySpeakingText}"
              </p>
            </div>
          )}

          {/* Main Controls Deck */}
          <div className="grid grid-cols-3 gap-2">
            {/* Play/Pause Button */}
            <button
              onClick={handleTogglePlayPause}
              className={`col-span-2 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5 cursor-pointer select-none ${
                isPlaying 
                  ? "bg-amber-600 hover:bg-amber-500 text-white" 
                  : isPaused 
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white" 
                  : "bg-brand-600 hover:bg-brand-500 text-white"
              }`}
            >
              {isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5 fill-white" />
                  <span>Pause Voice</span>
                </>
              ) : isPaused ? (
                <>
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>Resume</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>Narrate Selection</span>
                </>
              )}
            </button>

            {/* Stop Button */}
            <button
              onClick={stopSpeaking}
              disabled={!isPlaying && !isPaused}
              className={`py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5 border select-none ${
                isPlaying || isPaused
                  ? "bg-slate-800 border-slate-750 text-slate-200 hover:bg-slate-750 cursor-pointer"
                  : "bg-slate-950/20 border-slate-800 text-slate-600 cursor-not-allowed"
              }`}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop</span>
            </button>
          </div>

          {/* Full view button */}
          {!hasSelection && (
            <button
              onClick={handleReadFullPage}
              disabled={isPlaying}
              className={`w-full py-2 border rounded-xl text-[10.5px] font-bold uppercase tracking-wide transition flex items-center justify-center gap-1.5 ${
                isPlaying 
                  ? "bg-slate-950/30 border-slate-800 text-slate-500 cursor-not-allowed" 
                  : "bg-slate-900 hover:bg-slate-800 border-slate-750 text-slate-200 cursor-pointer"
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-brand-400" />
              <span>Narrate Active View</span>
            </button>
          )}

          {/* Configuration Grid */}
          <div className="space-y-3 pt-3 border-t border-slate-800 text-left">
            
            {/* Voice Dropdown */}
            <div className="space-y-1">
              <label className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <User className="w-3 h-3 text-slate-500" />
                <span>Narrator voice profile</span>
              </label>
              <div className="relative">
                <select
                  value={selectedVoiceName}
                  onChange={(e) => setSelectedVoiceName(e.target.value)}
                  className="w-full text-xs bg-slate-950 border border-slate-800 text-slate-200 p-2 pr-8 rounded-lg outline-none focus:border-brand-500 appearance-none font-medium cursor-pointer"
                >
                  {voices.length === 0 ? (
                    <option value="">Default System Voice</option>
                  ) : (
                    voices.map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
              </div>
            </div>

            {/* Speed Rate controls */}
            <div className="space-y-1">
              <label className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Gauge className="w-3 h-3 text-slate-500" />
                <span>Pacing Speed multiplier</span>
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {[0.8, 1.0, 1.25, 1.5].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => updateSpeechRate(rate)}
                    className={`py-1.5 rounded-lg font-mono text-[10px] font-bold border transition cursor-pointer select-none ${
                      speechRate === rate
                        ? "bg-brand-500/10 text-brand-300 border-brand-500/50"
                        : "bg-slate-950 text-slate-400 border-slate-800 hover:text-white"
                    }`}
                  >
                    {rate.toFixed(2)}x
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* Bottom Footnote */}
          <div className="text-[8.5px] text-slate-500 leading-normal text-center select-none pt-1">
            Browser Speech Synthesis • Supports select-to-read gestures offline.
          </div>

        </div>
      )}

      {/* Primary Floating Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        title={isOpen ? "Close Narrator Options" : "Open Accessibility Voice Narrator"}
        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 select-none cursor-pointer border ${
          isPlaying 
            ? "bg-emerald-600 border-emerald-500 text-white animate-pulse" 
            : isOpen 
            ? "bg-slate-900 border-slate-850 text-brand-400 hover:bg-slate-800" 
            : "bg-slate-900 border-slate-850 text-white hover:bg-slate-800"
        }`}
        id="tts-floating-trigger-btn"
      >
        {isPlaying ? (
          <div className="relative">
            <Volume2 className="w-6 h-6 animate-pulse" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-white rounded-full animate-ping"></span>
          </div>
        ) : (
          <Volume2 className="w-6 h-6" />
        )}
      </button>

    </div>
  );
}
