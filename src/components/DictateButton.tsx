import { useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

interface DictateButtonProps {
  onTranscript: (text: string) => void;
  compact?: boolean;
}

// Reusable voice-dictation button for any textarea/field across the Templates workspace.
// Mirrors the Web Speech API pattern already used by the Evidence Log's voice recorder in
// TemplatesTab.tsx, but as a drop-in button next to any label instead of a whole recording panel.
export default function DictateButton({ onTranscript, compact }: DictateButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  };

  const startRecording = () => {
    setError(null);
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice dictation isn't supported in this browser — please type directly instead.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-CA";

      recognition.onstart = () => setIsRecording(true);

      recognition.onresult = (event: any) => {
        let finalTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript + " ";
          }
        }
        if (finalTranscript.trim()) {
          onTranscript(finalTranscript.trim());
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Dictation error:", event.error);
        setError(
          event.error === "not-allowed"
            ? "Microphone permission was denied — grant mic access or type manually."
            : `Dictation error: ${event.error}`
        );
        setIsRecording(false);
      };

      recognition.onend = () => setIsRecording(false);

      recognition.start();
      recognitionRef.current = recognition;
    } catch (e: any) {
      setError(e.message || "Failed to start dictation.");
    }
  };

  const toggle = () => (isRecording ? stopRecording() : startRecording());

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={toggle}
        title={isRecording ? "Stop dictation" : "Dictate this field"}
        className={
          compact
            ? `inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0 ${
                isRecording ? "bg-red-500 text-white animate-pulse" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`
            : `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase shrink-0 ${
                isRecording ? "bg-red-500 text-white animate-pulse" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`
        }
      >
        {isRecording ? (
          <Square className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} />
        ) : (
          <Mic className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} />
        )}
        {!compact && <span>{isRecording ? "Stop" : "Dictate"}</span>}
      </button>
      {error && (
        <span className="absolute top-full right-0 mt-1 z-10 w-48 text-[9px] leading-tight text-rose-700 bg-rose-50 border border-rose-200 rounded p-1.5">
          {error}
        </span>
      )}
    </div>
  );
}
