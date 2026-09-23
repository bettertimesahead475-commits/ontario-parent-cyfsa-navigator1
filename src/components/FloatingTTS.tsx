import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Square, Volume2, VolumeX } from "lucide-react";
import { apiFetch, safeReadJson } from "../utils/api";

const READABLE_SELECTOR = [
  "[data-tts-read]",
  "article",
  "section",
  "blockquote",
  "li",
  "p",
  "h1",
  "h2",
  "h3",
  "h4"
].join(",");

const IGNORE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "nav",
  "header",
  "footer",
  ".no-print",
  "#floating-tts-container"
].join(",");

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function findReadableTarget(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof HTMLElement)) return null;
  if (start.closest(IGNORE_SELECTOR)) return null;

  const candidate = start.closest(READABLE_SELECTOR) as HTMLElement | null;
  if (!candidate || !candidate.closest("#main-frame-area")) return null;

  // A section/article is useful when the parent taps its background, but when they tap
  // a paragraph/list item/heading, prefer that tighter block so the reader never starts
  // narrating half the page unexpectedly.
  const directBlock = start.closest("p, li, blockquote, h1, h2, h3, h4, [data-tts-read]") as HTMLElement | null;
  const target = directBlock && directBlock.closest("#main-frame-area") ? directBlock : candidate;
  const text = cleanText(target.innerText || "");
  return text.length >= 2 ? target : null;
}

export default function FloatingTTS() {
  const [location] = useLocation();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);
  const requestIdRef = useRef(0);

  const clearHighlight = () => {
    if (activeRef.current) {
      activeRef.current.style.outline = "";
      activeRef.current.style.outlineOffset = "";
      activeRef.current.style.backgroundColor = "";
      activeRef.current = null;
    }
  };

  const stop = () => {
    requestIdRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    }
    setLoading(false);
    setSpeaking(false);
    clearHighlight();
  };

  const readElement = async (el: HTMLElement) => {
    const text = cleanText(el.innerText || "");
    if (!text) return;

    stop();
    const requestId = requestIdRef.current;
    setError("");
    setLoading(true);
    activeRef.current = el;
    el.style.outline = "3px solid rgba(37, 99, 235, 0.55)";
    el.style.outlineOffset = "4px";
    el.style.backgroundColor = "rgba(219, 234, 254, 0.35)";

    try {
      const response = await apiFetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await safeReadJson(response);
      if (!response.ok || !data?.audioContent) {
        throw new Error(data?.error || "Natural voice is unavailable right now.");
      }
      if (requestId !== requestIdRef.current) return;

      const audio = new Audio(`data:${data.mimeType || "audio/mpeg"};base64,${data.audioContent}`);
      audioRef.current = audio;
      audio.onplay = () => {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setSpeaking(true);
        }
      };
      audio.onended = () => {
        if (requestId === requestIdRef.current) {
          setSpeaking(false);
          clearHighlight();
          audioRef.current = null;
        }
      };
      audio.onerror = () => {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setSpeaking(false);
          setError("The voice audio could not be played on this device.");
          clearHighlight();
        }
      };
      await audio.play();
    } catch (err: any) {
      if (requestId !== requestIdRef.current) return;
      setLoading(false);
      setSpeaking(false);
      clearHighlight();
      setError(err?.message || "Natural voice is unavailable right now.");
    }
  };

  useEffect(() => {
    if (!enabled) return;
    const onClick = (event: MouseEvent) => {
      const target = findReadableTarget(event.target);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      void readElement(target);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled]);

  useEffect(() => {
    stop();
  }, [location]);

  useEffect(() => () => stop(), []);

  const toggle = () => {
    if (enabled) {
      stop();
      setEnabled(false);
      setError("");
    } else {
      setEnabled(true);
      setError("");
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[99] no-print font-sans" id="floating-tts-container">
      {enabled && (
        <div className="mb-2 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 shadow-lg" role="status" aria-live="polite">
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> : speaking ? <Volume2 className="h-4 w-4 text-emerald-600" /> : <Volume2 className="h-4 w-4 text-brand-600" />}
          <span className="text-xs font-bold text-slate-700">
            {loading ? "Preparing natural voice…" : speaking ? "Reading — tap another section to switch" : "Tap any text to read it"}
          </span>
          {(loading || speaking) && (
            <button onClick={(e) => { e.stopPropagation(); stop(); }} className="ml-1 rounded-full p-1 text-slate-500 hover:bg-slate-100" aria-label="Stop reading" title="Stop reading">
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          )}
        </div>
      )}
      {error && enabled && <div className="mb-2 max-w-xs rounded-xl border border-rose-200 bg-white p-3 text-xs text-rose-700 shadow-lg">{error}</div>}
      <button
        onClick={toggle}
        title={enabled ? "Turn off Read Aloud" : "Turn on Read Aloud"}
        aria-pressed={enabled}
        aria-label={enabled ? "Turn off Read Aloud" : "Turn on Read Aloud"}
        className={`ml-auto flex h-14 w-14 items-center justify-center rounded-full border shadow-xl transition ${enabled ? "border-brand-500 bg-brand-600 text-white" : "border-slate-800 bg-slate-900 text-white hover:bg-slate-800"}`}
        id="tts-floating-trigger-btn"
      >
        {enabled ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
      </button>
    </div>
  );
}
