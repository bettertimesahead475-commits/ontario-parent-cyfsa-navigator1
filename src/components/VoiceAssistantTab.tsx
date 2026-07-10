/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Mic, MicOff, Volume2, Square, Play, Pause, AlertCircle, RefreshCw, VolumeX, Headphones, Check } from "lucide-react";

export default function VoiceAssistantTab() {
  // TTS State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [speechRate, setSpeechRate] = useState<number>(1);
  const [selectedNarrativeText, setSelectedNarrativeText] = useState<string>(
    "Welcome to the CYFSA Ontario Parent Voice Assistant. This accessible section provides clear, spoken read-aloud summaries of the child welfare act, emergency removals, and family court rule structures in Ontario. Click play to begin narration."
  );
  
  // STT Dictation State
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [spokenTranscript, setSpokenTranscript] = useState<string>("");
  const [sttSupported, setSttSupported] = useState<boolean>(false);
  const [recognitionObj, setRecognitionObj] = useState<any>(null);

  const preloadedSummaries = [
    {
      title: "Introduction",
      text: "Welcome to the CYFSA Ontario Parent Voice Assistant. This accessible section provides clear, spoken read-aloud summaries of the child welfare act, emergency removals, and family court rule structures in Ontario. Click play to begin narration."
    },
    {
      title: "1. The Emergency Removal Summary",
      text: "Statutory summary on removals. Under Section 81 of the Child, Youth and Family Services Act, CAS can apprehend a child without a warrant only in cases of imminent and immediate risk of serious physical harm. By Section 94, they must schedule a judicial review before a family court judge within five court days. If they fail to meet this timeline, they commit a critical procedural violation. Parents possess the right to seek kinship placement alternatives and request immediate Legal Aid assistance."
    },
    {
      title: "2. Family Court Rule 17 Briefs",
      text: "Under Ontario Family Court Rule 17, case conferences are strictly informal sessions chaired by a judge. All conference briefs and discussion briefs are destroyed by the court registry upon conclusion, ensuring confidentiality. What is detailed inside conferences cannot be used as trial evidence. This mechanism exists solely to promote settlements and secure visitation rights or kinship services early on."
    },
    {
      title: "3. Hearsay Evidence Thresholds",
      text: "The Ontario Evidence Act regulates admissibility. Out-of-court claims, such as anonymous telephone reports with no observed physical facts, constitute hearsay. CAS frequently relies on hearsay inside initial worker affidavits. While allowed temporarily in urgency motions, CAS must produce direct eyewitnesses to rely on these allegations during final protection trials."
    },
    {
      title: "4. The 300-Day Rule of Parentage",
      text: "Under Section 8 of the Ontario Children's Law Reform Act, shorthand CLRA, legal parenthood is legally presumed if a child is born during a marriage or within 300 days of the marriage being dissolved by divorce, annulment, or death. A similar presumption applies to cohabitation relationships of some permanence if the birth occurs during cohabitation or within 300 days after separation. CAS must notify and incorporate both legal other-parents in all custody assessments. Ignoring this 300-day window represents a severe statutory violation."
    }
  ];

  // Initialize SpeechSynthesis and SpeechRecognition on mount
  useEffect(() => {
    // Check Speech Recognition support
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRec) {
      setSttSupported(true);
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-CA"; // Canadian English

      rec.onresult = (event: any) => {
        let finalTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript + " ";
          }
        }
        if (finalTranscript) {
          setSpokenTranscript(prev => prev + finalTranscript);
        }
      };

      rec.onerror = (e: any) => {
        console.error("Speech Recognition Error:", e);
        setIsRecording(false);
      };

      rec.onend = () => {
        setIsRecording(false);
      };

      setRecognitionObj(rec);
    }

    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // Play narration (TTS)
  const handlePlayNarrator = () => {
    window.speechSynthesis.cancel(); // cancel any active utterance

    if (isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(true);
      setIsPlaying(true);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(selectedNarrativeText);
    utterance.rate = speechRate;
    
    // Attempt to procure a high-quality local English voice if available
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang.includes("en")) || voices[0];
    if (voice) {
      utterance.voice = voice;
    }

    utterance.onend = () => {
      setIsPlaying(false);
      setIsPaused(false);
    };

    utterance.onerror = () => {
      setIsPlaying(false);
      setIsPaused(false);
    };

    setIsPlaying(true);
    window.speechSynthesis.speak(utterance);
  };

  const handlePauseNarrator = () => {
    if (isPlaying) {
      window.speechSynthesis.pause();
      setIsPaused(true);
      setIsPlaying(false);
    }
  };

  const handleStopNarrator = () => {
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    setIsPaused(false);
  };

  // Recording dictation (STT)
  const toggleRecording = () => {
    if (!sttSupported || !recognitionObj) {
      alert("Speech-to-Text dictation is not natively supported in this browser version. We recommend Google Chrome or Safari.");
      return;
    }

    if (isRecording) {
      recognitionObj.stop();
      setIsRecording(false);
    } else {
      setIsRecording(true);
      recognitionObj.start();
    }
  };

  return (
    <div className="space-y-8" id="voice-assistant-tab">
      {/* Intro Block */}
      <div className="text-left max-w-3xl">
        <h2 className="font-display text-2xl font-bold text-gray-900">Auditory Summaries & Voice Dictation Assistant</h2>
        <p className="text-xs md:text-sm text-gray-600 mt-2 leading-relaxed">
          This accessibility dashboard helps parents with reading deficits, anxiety, or writing constraints. Listen to human-sounding summaries of complex Ontario statutes or verbally dictate your child welfare logs to preserve fresh observations.
        </p>
      </div>

      {/* Main Grid: Left side Narrator, Right side STT Dictation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="voice-grid">
        {/* Left Side: Speech Synthesizer Narrator */}
        <div className="lg:col-span-7 space-y-4" id="speech-synthesizer">
          <div className="bg-black rounded-xl border border-gray-150 p-6 space-y-5 text-left shadow-2xs">
            <div className="flex justify-between items-center pb-2 border-b">
              <span className="text-[10px] font-mono tracking-widest text-brand-600 font-bold uppercase flex items-center gap-1">
                <Headphones className="w-3.5 h-3.5" /> Interactive Text-to-Speech Narrator
              </span>
              <span className="text-[10px] bg-slate-100 text-slate-500 font-mono px-2 py-0.5 rounded font-bold uppercase">
                Human Voicing
              </span>
            </div>

            {/* Read Aloud Text Area */}
            <div className="space-y-2">
              <label className="text-[11px] font-mono tracking-wider font-semibold text-gray-400 uppercase">
                Active Speech Narrator Block
              </label>
              <textarea
                value={selectedNarrativeText}
                onChange={(e) => setSelectedNarrativeText(e.target.value)}
                rows={6}
                className="w-full bg-slate-50 border border-gray-200 focus:bg-black text-xs md:text-sm leading-relaxed p-4 rounded-xl focus:outline-none"
              />
            </div>

            {/* Controls Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50 p-4 rounded-xl border">
              {/* Speed Slider */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 font-semibold uppercase font-mono">Speed rate</span>
                <input
                  type="range"
                  min="0.5"
                  max="1.8"
                  step="0.1"
                  value={speechRate}
                  onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                  className="w-24 cursor-pointer"
                  />
                <span className="text-xs font-semibold text-gray-600 font-mono">{speechRate}x</span>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                {isPlaying ? (
                  <button
                    onClick={handlePauseNarrator}
                    className="p-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-full cursor-pointer transition-colors"
                    title="Pause Narration"
                  >
                    <Pause className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={handlePlayNarrator}
                    className="p-2.5 bg-brand-650 hover:bg-brand-700 text-white rounded-full cursor-pointer transition-all shadow-md hover:scale-105"
                    title="Play Narration Description"
                  >
                    <Play className="w-4 h-4 fill-white" />
                  </button>
                )}

                <button
                  onClick={handleStopNarrator}
                  className="p-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-full cursor-pointer transition-colors"
                  title="Stop Narration"
                >
                  <Square className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Preloaded Statutory Narratives triggers */}
            <div className="space-y-2">
              <label className="text-[11px] font-mono text-gray-400 uppercase tracking-wider font-semibold block">
                Select Preloaded Statutory Narratives
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {preloadedSummaries.map((sum, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setSelectedNarrativeText(sum.text);
                      if (isPlaying) {
                        window.speechSynthesis.cancel();
                        setIsPlaying(false);
                      }
                    }}
                    className={`p-3 border rounded-xl text-left text-xs transition-colors flex items-start gap-2 cursor-pointer ${
                      selectedNarrativeText === sum.text
                        ? "border-brand-500 bg-brand-50/50 text-brand-900"
                        : "border-gray-200 hover:bg-slate-50 text-gray-700 bg-black"
                    }`}
                  >
                    <Volume2 className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold block">{sum.title}</span>
                      <span className="text-[10px] text-gray-550 block truncate max-w-[150px]">{sum.text}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Speech-to-Text Recorder dictation */}
        <div className="lg:col-span-5 space-y-4" id="speech-recognition-stt">
          <div className="bg-black rounded-xl border border-gray-150 p-6 space-y-5 text-left shadow-2xs">
            <div className="flex justify-between items-center pb-2 border-b">
              <span className="text-[10px] font-mono tracking-widest text-[var(--color-brand-600)] font-bold uppercase flex items-center gap-1">
                <Mic className="w-3.5 h-3.5" /> Voice Dictation Note-taker
              </span>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase ${
                sttSupported ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
              }`}>
                {sttSupported ? "Web STT Active" : "Unsupported"}
              </span>
            </div>

            <p className="text-xs text-gray-500 leading-normal">
              Dictate your notes hands-free. Speak into your microphone, and we will translate your spoken syllables into structured written paragraphs for your diary.
            </p>

            {/* Live Visual Speech Pulser */}
            <div className="flex flex-col items-center justify-center p-6 bg-slate-50 rounded-xl border border-dashed border-gray-250 relative overflow-hidden">
              {isRecording && (
                <div className="absolute inset-0 bg-brand-200/10 flex items-center justify-center pointer-events-none">
                  <span className="w-16 h-16 rounded-full bg-brand-500/15 animate-ping" />
                  <span className="w-24 h-24 rounded-full bg-brand-500/10 absolute animate-pulse" />
                </div>
              )}

              <button
                type="button"
                onClick={toggleRecording}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                  isRecording 
                    ? "bg-rose-600 text-white animate-pulse shadow-md relative z-10" 
                    : "bg-brand-600 hover:bg-brand-750 text-white shadow-xs cursor-pointer hover:scale-105"
                }`}
              >
                {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5 animate-bounce" />}
              </button>

              <span className="text-[11px] font-mono uppercase tracking-wider text-gray-400 mt-3 block font-semibold relative z-10">
                {isRecording ? "Recording vocal notes..." : "Click mic to start speaking"}
              </span>
            </div>

            {/* Spoken Text Result Box */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-mono tracking-wider font-semibold text-gray-400 uppercase">
                  Spoken Written Output
                </label>
                {spokenTranscript && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(spokenTranscript);
                      alert("Transcript copyable! Paste it straight into your evidentiary logs draft.");
                    }}
                    className="text-[10px] font-semibold text-brand-600 hover:underline"
                  >
                    Copy transcript
                  </button>
                )}
              </div>
              <div className="w-full bg-slate-50 border border-gray-200 rounded-xl p-3 min-h-[140px] text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                {spokenTranscript || "Your translated sentences will stream here in real-time as you speak..."}
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setSpokenTranscript("")}
                className="text-[11px] text-gray-500 font-semibold hover:underline cursor-pointer"
              >
                Reset Dictation
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
