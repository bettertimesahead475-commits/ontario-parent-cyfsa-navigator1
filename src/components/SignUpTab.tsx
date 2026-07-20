import React, { useState, useEffect, useRef } from "react";
import { 
  UserPlus, CheckCircle, Shield, Award, MapPin, 
  Building, Lock, Eye, EyeOff, RefreshCw, Smartphone, 
  Calendar, FileText, Send, Download, Printer, LogIn, LogOut,
  Mic, MicOff, Trash2, Edit3, Save, Search, Plus, Sparkles, Check, ChevronRight, X, Copy, Square
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useLocation } from "wouter";
import { jsPDF } from "jspdf";

interface UserProfile {
  fullName: string;
  email: string;
  role: string;
  region: string;
  involvedAgency: string;
  passcode: string;
  memberSince: string;
  advocateId: string;
}

interface PassportNote {
  id: string;
  title: string;
  text: string;
  timestamp: string;
  isSpoken: boolean;
  audioDuration?: number;
}

export default function SignUpTab() {
  const [, setLocation] = useLocation();
  const [currentTier, setCurrentTier] = useState<string>(() => {
    return localStorage.getItem("OPA_MEMBERSHIP_TIER") || "Basic";
  });

  const [profile, setProfile] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem("OPA_USER_PROFILE");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Failed to load user profile:", e);
    }
    return null;
  });

  // Form states
  const [fullName, setFullName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<string>("Biological Parent");
  const [region, setRegion] = useState<string>("Greater Toronto Area (GTA)");
  const [involvedAgency, setInvolvedAgency] = useState<string>("Toronto Children's Aid Society (CAS)");
  const [passcode, setPasscode] = useState<string>("");
  const [showPasscode, setShowPasscode] = useState<boolean>(false);
  
  // Login/Verify state
  const [isRegistering, setIsRegistering] = useState<boolean>(false);
  const [registrationSuccess, setRegistrationSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Quick Memo & Notes states
  const [notes, setNotes] = useState<PassportNote[]>(() => {
    try {
      const saved = localStorage.getItem("OPA_PASSPORT_NOTES");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn("Failed to load local notes:", e);
      return [];
    }
  });

  const [activeSubTab, setActiveSubTab] = useState<"memos" | "credentials">("memos");
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [liveTranscription, setLiveTranscription] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState<string>("");
  const [micError, setMicError] = useState<string>("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<any>(null);

  // Clean up recording listeners on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
    };
  }, []);

  const startRecording = async () => {
    setMicError("");
    setLiveTranscription("");
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
        await handleAudioUpload(audioBlob);
      };

      // Start SpeechRecognition (Web Speech API) for real-time local text feedback
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-CA";

        recognition.onresult = (event: any) => {
          let interimTranscript = "";
          let finalTranscript = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }

          setLiveTranscription(finalTranscript || interimTranscript);
        };

        recognition.onerror = (e: any) => {
          console.warn("Speech recognition error:", e);
        };

        recognition.start();
        recognitionRef.current = recognition;
      }

      mediaRecorder.start();
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err: any) {
      console.error("Microphone permission denied or error:", err);
      setMicError(err.message || "Microphone permission denied. Please allow microphone access in your browser to record spoken thought memos.");
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.warn(e);
      }
      recognitionRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    
    setIsRecording(false);
  };

  const handleAudioUpload = async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        const base64payload = base64data.split(",")[1];

        // Send to secure server transcription
        const response = await fetch("/api/transcribe-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioData: base64payload,
            mimeType: blob.type || "audio/webm"
          })
        });

        const data = await response.json();
        if (data.success) {
          const textResult = data.text || liveTranscription || "Spoken memo recorded successfully.";
          saveNewNote(textResult);
        } else {
          saveNewNote(liveTranscription || "Speech memo recorded but transcribing failed.");
        }
        setIsTranscribing(false);
      };
    } catch (err) {
      console.error("Transcription error:", err);
      saveNewNote(liveTranscription || "Spoken thought saved without online formatting.");
      setIsTranscribing(false);
    }
  };

  const downloadNoteAsPDF = (note: PassportNote) => {
    if (currentTier === "Basic") {
      alert("🔒 Premium Feature Locked\n\nConverting and downloading transcripts or case notes as court-admissible PDFs is a premium feature. Please upgrade to Pro Advocate to download or print formatted documents.");
      setLocation("/upgrade");
      return;
    }

    try {
      const doc = new jsPDF();
      
      doc.setFont("courier", "bold");
      doc.setFontSize(14);
      doc.text("IN THE ONTARIO FAMILY COURT OF JUSTICE", 105, 20, { align: "center" });
      doc.setFontSize(11);
      doc.text("CONFIDENTIAL CASE RECORD & VERBATIM TRANSCRIPT DIARY", 105, 26, { align: "center" });
      
      doc.setLineWidth(0.5);
      doc.line(15, 30, 195, 30);
      
      doc.setFont("courier", "normal");
      doc.setFontSize(10);
      doc.text(`Document Title : ${note.title}`, 15, 40);
      doc.text(`Recorded Date  : ${note.timestamp}`, 15, 46);
      doc.text(`Input Origin   : ${note.isSpoken ? "Microphone Voice Recording (AI Transcribed)" : "Written Diary Log Entry"}`, 15, 52);
      if (note.audioDuration) {
        doc.text(`Duration       : ${note.audioDuration} seconds`, 15, 58);
      }
      
      doc.line(15, 62, 195, 62);
      
      const splitText = doc.splitTextToSize(note.text, 175);
      let y = 72;
      for (const line of splitText) {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.text(line, 15, y);
        y += 6;
      }
      
      if (y > 260) {
        doc.addPage();
        y = 20;
      }
      
      doc.line(15, y + 5, 195, y + 5);
      doc.setFont("courier", "italic");
      doc.setFontSize(8);
      doc.text("PREPARED AND CERTIFIED BY PARENTSHIELD ONTARIO CASE COMPLIANCE ENGINE", 105, y + 12, { align: "center" });
      doc.text("RESTRICTED DIRECT EVIDENCE RECORD - SUBJECT TO SECTION 94(2) BURDEN STANDARDS", 105, y + 17, { align: "center" });
      
      doc.save(`${note.title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.pdf`);
    } catch (error) {
      console.error("PDF generation failed:", error);
      alert("Failed to compile PDF. Please copy the text manually.");
    }
  };

  const saveNewNote = (text: string) => {
    const formattedDate = new Date().toLocaleString("en-CA", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true
    });

    const newNote: PassportNote = {
      id: "note-" + Date.now(),
      title: `Voice Memo - ${new Date().toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`,
      text: text,
      timestamp: formattedDate,
      isSpoken: true,
      audioDuration: recordingTime > 0 ? recordingTime : undefined
    };

    const updatedNotes = [newNote, ...notes];
    setNotes(updatedNotes);
    localStorage.setItem("OPA_PASSPORT_NOTES", JSON.stringify(updatedNotes));
  };

  const deleteNote = (id: string) => {
    if (confirm("Are you sure you want to permanently delete this memo note from your private local database?")) {
      const updated = notes.filter(n => n.id !== id);
      setNotes(updated);
      localStorage.setItem("OPA_PASSPORT_NOTES", JSON.stringify(updated));
    }
  };

  const startEditing = (note: PassportNote) => {
    setEditingNoteId(note.id);
    setEditingNoteText(note.text);
  };

  const saveEditedNote = (id: string) => {
    const updated = notes.map(n => {
      if (n.id === id) {
        return { ...n, text: editingNoteText };
      }
      return n;
    });
    setNotes(updated);
    localStorage.setItem("OPA_PASSPORT_NOTES", JSON.stringify(updated));
    setEditingNoteId(null);
  };

  const ontarioAgencies = [
    "Toronto Children's Aid Society (CAS)",
    "Catholic Children's Aid Society of Toronto",
    "Children's Aid Society of York Region",
    "Peel Children's Aid Society",
    "Durham Children's Aid Society",
    "Halton Children's Aid Society",
    "Native Child and Family Services of Toronto",
    "Hamilton Children's Aid Society",
    "Ottawa Children's Aid Society",
    "Other Children's Aid Society (Ontario)",
    "None / Self-Guided Education"
  ];

  const caseRoles = [
    "Biological Parent",
    "Custodial Parent",
    "Kinship Carer / Relative Backup",
    "Advocate / Parent Representative",
    "Family Court Litigant",
    "Independent Legal Counsel"
  ];

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!fullName.trim()) {
      setError("Please provide your full legal or preferred name.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Please provide a valid contact email address.");
      return;
    }
    if (passcode.length < 4) {
      setError("Please set a secure 4-digit passcode PIN to protect your local worksheets.");
      return;
    }

    setIsRegistering(true);

    // Simulate creation delays
    setTimeout(() => {
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const newProfile: UserProfile = {
        fullName: fullName.trim(),
        email: email.trim(),
        role,
        region,
        involvedAgency,
        passcode,
        memberSince: new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }),
        advocateId: `PSA-2026-${randomSuffix}`
      };

      try {
        localStorage.setItem("OPA_USER_PROFILE", JSON.stringify(newProfile));
        setProfile(newProfile);
        setRegistrationSuccess(true);
        // Custom event to notify headers and assistants
        window.dispatchEvent(new CustomEvent("opa-user-profile-updated"));
      } catch (err) {
        setError("Unable to write your secure profile keys to the local browser sandbox.");
      } finally {
        setIsRegistering(false);
      }
    }, 900);
  };

  const handleLogout = () => {
    if (confirm("Are you sure you want to log out of your Advocate Passport? Your stored worksheets will remain locally encrypted but locked until you re-authenticate.")) {
      try {
      localStorage.removeItem("OPA_USER_PROFILE");
      setProfile(null);
      setRegistrationSuccess(false);
      // Reset form
      setFullName("");
      setEmail("");
      setPasscode("");
      window.dispatchEvent(new CustomEvent("opa-user-profile-updated"));
      } catch (e) {
        console.warn(e);
      }
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn" id="signup-tab-container">
      
      {/* Header Segment */}
      <div className="text-left space-y-2 border-b border-gray-150 pb-5">
        <div className="flex items-center gap-2 text-brand-900 font-bold tracking-wider uppercase text-[10px] md:text-xs">
          <Shield className="w-4 h-4 text-brand-650" />
          <span>ParentShield Security Portal</span>
        </div>
        <h2 className="font-display font-bold text-gray-900 text-2xl md:text-3xl tracking-tight">
          Parent Advocate Passport
        </h2>
        <p className="text-slate-600 text-xs md:text-sm max-w-3xl leading-relaxed">
          Create your free private local advocate identity to secure your statutory worksheets, unlock personalized court timelines, and generate your printable ParentShield self-advocacy credentials.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Side: Form or Active Passport Status */}
        <div className="lg:col-span-7 bg-white border border-gray-200 rounded-2xl shadow-xs p-6 md:p-8 space-y-6">
          
          <AnimatePresence mode="wait">
            {!profile ? (
              <motion.div
                key="signup-form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <div className="space-y-1.5 mb-6">
                  <h3 className="font-display font-bold text-lg text-slate-900 flex items-center gap-2">
                    <UserPlus className="w-5 h-5 text-brand-900" />
                    <span>Register Your Private Passport</span>
                  </h3>
                  <p className="text-slate-500 text-xs leading-normal">
                    To maintain absolute confidentiality, all profile details are held entirely in your browser's private local state. No data is saved to a central cloud server.
                  </p>
                </div>

                {error && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs p-3.5 rounded-xl flex items-start gap-2.5 mb-5 font-medium">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0"></div>
                    <span>{error}</span>
                  </div>
                )}

                <form onSubmit={handleRegister} className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    
                    {/* Full Name */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                        Full Name or Preferred Initials
                      </label>
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="e.g. Jane Doe"
                        className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 focus:bg-white focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none transition"
                      />
                    </div>

                    {/* Email */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                        Contact Email Address
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="jane.doe@example.com"
                        className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 focus:bg-white focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none transition"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    
                    {/* Case Role */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                        Your Relationship Role
                      </label>
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800 focus:bg-white focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none cursor-pointer"
                      >
                        {caseRoles.map((r, idx) => (
                          <option key={idx} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>

                    {/* Region */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                        Ontario Judicial Region
                      </label>
                      <select
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                        className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800 focus:bg-white focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none cursor-pointer"
                      >
                        <option value="Greater Toronto Area (GTA)">Greater Toronto Area (GTA)</option>
                        <option value="Western Ontario (London, Windsor, etc.)">Western Ontario</option>
                        <option value="Eastern Ontario (Ottawa, Kingston, etc.)">Eastern Ontario</option>
                        <option value="Northern Ontario (Sudbury, Thunder Bay, etc.)">Northern Ontario</option>
                      </select>
                    </div>
                  </div>

                  {/* Involved CAS Agency */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                      Involved Children's Aid Society (Agency)
                    </label>
                    <select
                      value={involvedAgency}
                      onChange={(e) => setInvolvedAgency(e.target.value)}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-800 focus:bg-white focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none cursor-pointer"
                    >
                      {ontarioAgencies.map((agency, idx) => (
                        <option key={idx} value={agency}>{agency}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-400">Selecting your CAS agency helps personalize statutory timeline alerts and caseworker authority thresholds.</p>
                  </div>

                  {/* Passcode Secure PIN */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                      Set Secure Access Passcode (4-digit numeric PIN)
                    </label>
                    <div className="relative">
                      <input
                        type={showPasscode ? "text" : "password"}
                        maxLength={4}
                        required
                        pattern="[0-9]{4}"
                        value={passcode}
                        onChange={(e) => setPasscode(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="XXXX"
                        className="w-full bg-slate-50/50 border border-slate-200 rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-slate-800 focus:bg-white focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none font-mono tracking-widest transition"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasscode(!showPasscode)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                      >
                        {showPasscode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400">Used strictly to lock/unlock your draft court forms locally.</p>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={isRegistering}
                    className="w-full bg-brand-950 hover:bg-slate-900 disabled:bg-brand-900/60 text-white font-display font-extrabold uppercase tracking-wider text-xs py-3 rounded-xl transition shadow-sm hover:shadow flex items-center justify-center gap-2 cursor-pointer disabled:cursor-wait"
                  >
                    {isRegistering ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Generating Secure Keys...</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4 text-amber-300" />
                        <span>Activate Advocate Passport</span>
                      </>
                    )}
                  </button>
                </form>
              </motion.div>
             ) : (
              <motion.div
                key="signup-success"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-150 p-4 rounded-xl text-emerald-950">
                  <CheckCircle className="w-6 h-6 text-emerald-600 shrink-0" />
                  <div>
                    <h4 className="font-display font-extrabold text-sm uppercase tracking-wide text-emerald-900">
                      Advocate Passport Verified & Active!
                    </h4>
                    <p className="text-[11px] leading-normal mt-0.5 text-emerald-800">
                      Welcome, {profile.fullName}. Your local browser profile has been activated under temporary ID <span className="font-mono font-bold">{profile.advocateId}</span>. All workbook backups are encrypted locally.
                    </p>
                  </div>
                </div>

                {/* Sub-tab navigation selector */}
                <div className="flex border-b border-slate-100 pb-2 mb-4 gap-4">
                  <button
                    type="button"
                    onClick={() => setActiveSubTab("memos")}
                    className={`pb-1 text-xs font-display font-extrabold uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                      activeSubTab === "memos" 
                        ? "border-brand-950 text-brand-950 font-black" 
                        : "border-transparent text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    <Mic className="w-3.5 h-3.5" />
                    <span>Quick Memos & Notes</span>
                    {notes.length > 0 && (
                      <span className="bg-brand-100 text-brand-900 font-mono text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                        {notes.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSubTab("credentials")}
                    className={`pb-1 text-xs font-display font-extrabold uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                      activeSubTab === "credentials" 
                        ? "border-brand-950 text-brand-950 font-black" 
                        : "border-transparent text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Passport Credentials</span>
                  </button>
                </div>

                <AnimatePresence mode="wait">
                  {activeSubTab === "memos" ? (
                    <motion.div
                      key="subtab-memos"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      transition={{ duration: 0.15 }}
                      className="space-y-6"
                    >
                      {/* Microphone Recorder Core Block */}
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-5 relative overflow-hidden shadow-2xs">
                        {isRecording && (
                          <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-red-50 text-red-700 border border-red-200/50 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold animate-pulse">
                            <span className="w-2 h-2 rounded-full bg-red-600"></span>
                            <span>LIVE REC</span>
                          </div>
                        )}

                        <div className="space-y-4">
                          <div className="space-y-1">
                            <h4 className="font-display font-extrabold text-slate-900 text-sm flex items-center gap-2">
                              <Mic className={`w-4 h-4 ${isRecording ? 'text-red-600 animate-pulse' : 'text-brand-950'}`} />
                              <span>Quick Spoken Memo</span>
                            </h4>
                            <p className="text-slate-500 text-[11px] leading-relaxed">
                              Record instant spoken thoughts or CAS review memos using your microphone permission. Dictations are safely converted into compliance-ready logs.
                            </p>
                          </div>

                          {micError && (
                            <div className="bg-rose-50 border border-rose-200 text-rose-800 text-[11px] p-3 rounded-lg font-medium">
                              {micError}
                            </div>
                          )}

                          {/* Recording Interaction Section */}
                          <div className="flex flex-col items-center justify-center py-4 space-y-4">
                            {isRecording ? (
                              <div className="flex flex-col items-center space-y-3 w-full">
                                {/* Visual pulsing audio waveform simulator */}
                                <div className="flex items-end justify-center gap-1 h-8 px-4" id="audio-wave-bars">
                                  <span className="w-1 bg-red-600 rounded-full animate-bounce h-5" style={{ animationDelay: '0.1s', animationDuration: '0.6s' }}></span>
                                  <span className="w-1 bg-red-600 rounded-full animate-bounce h-3" style={{ animationDelay: '0.3s', animationDuration: '0.8s' }}></span>
                                  <span className="w-1 bg-red-600 rounded-full animate-bounce h-7" style={{ animationDelay: '0s', animationDuration: '0.5s' }}></span>
                                  <span className="w-1 bg-red-600 rounded-full animate-bounce h-4" style={{ animationDelay: '0.4s', animationDuration: '0.7s' }}></span>
                                  <span className="w-1 bg-red-600 rounded-full animate-bounce h-6" style={{ animationDelay: '0.2s', animationDuration: '0.9s' }}></span>
                                  <span className="w-1 bg-red-600 rounded-full animate-bounce h-3" style={{ animationDelay: '0.5s', animationDuration: '0.4s' }}></span>
                                </div>

                                <div className="text-xs font-mono font-bold text-red-700">
                                  Recording: {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
                                </div>

                                <button
                                  type="button"
                                  onClick={stopRecording}
                                  className="bg-red-600 hover:bg-red-700 text-white font-display font-extrabold uppercase tracking-wider text-[11px] px-6 py-2.5 rounded-full transition shadow-md hover:shadow flex items-center gap-1.5 cursor-pointer"
                                >
                                  <Square className="w-3.5 h-3.5 fill-white text-white" />
                                  <span>Stop & Save Note</span>
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={startRecording}
                                disabled={isTranscribing}
                                className="bg-brand-950 hover:bg-slate-900 disabled:bg-slate-400 text-white font-display font-extrabold uppercase tracking-wider text-[11px] px-6 py-3 rounded-full transition shadow-md hover:shadow flex items-center gap-2 cursor-pointer disabled:cursor-wait"
                              >
                                <Mic className="w-4 h-4 text-amber-300" />
                                <span>Record Spoken Thought</span>
                              </button>
                            )}

                            {/* Transcription loader */}
                            {isTranscribing && (
                              <div className="flex flex-col items-center justify-center space-y-2 py-2">
                                <RefreshCw className="w-5 h-5 text-brand-900 animate-spin" />
                                <span className="text-xs font-medium text-slate-600 animate-pulse text-center">
                                  AI Transcribing & auditing compliance markers...
                                </span>
                              </div>
                            )}

                            {/* Live Interim Speech Preview */}
                            {isRecording && liveTranscription && (
                              <div className="w-full bg-white border border-slate-200/80 p-3 rounded-lg text-slate-700 text-xs italic leading-relaxed text-center max-w-md shadow-3xs" id="live-transcription-preview">
                                <span className="font-bold text-[10px] text-brand-900 not-italic uppercase tracking-wide block mb-1">Live Dictation Transcript Preview:</span>
                                "{liveTranscription}"
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Notes Search & Directory List */}
                      <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                          <h4 className="font-display font-bold text-slate-900 text-sm flex items-center gap-1.5">
                            <FileText className="w-4 h-4 text-slate-500" />
                            <span>Passport Notes Journal</span>
                          </h4>

                          {/* Quick Search */}
                          {notes.length > 0 && (
                            <div className="relative">
                              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                placeholder="Search memo content..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:bg-white outline-none w-full sm:w-48 transition"
                              />
                            </div>
                          )}
                        </div>

                        {/* Note Cards Container */}
                        <div className="space-y-3.5">
                          {notes.length === 0 ? (
                            <div className="text-center py-8 px-4 border border-dashed border-slate-200 rounded-xl bg-slate-50/30">
                              <Mic className="w-8 h-8 text-slate-350 mx-auto mb-2" />
                              <span className="font-display font-bold text-xs text-slate-700 uppercase tracking-wide block">No notes or memos recorded</span>
                              <p className="text-[11px] text-slate-400 max-w-xs mx-auto mt-1 leading-normal">
                                Tap the record button above to capture statutory meeting thoughts, caseworker review memories, or home notes securely.
                              </p>
                            </div>
                          ) : (
                            (() => {
                              const filtered = notes.filter(n => 
                                n.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                n.title.toLowerCase().includes(searchQuery.toLowerCase())
                              );

                              if (filtered.length === 0) {
                                return (
                                  <p className="text-center text-xs text-slate-400 py-4 italic">No matching notes found.</p>
                                );
                              }

                              return filtered.map((note) => (
                                <div key={note.id} className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-4 shadow-3xs hover:shadow-2xs transition-all space-y-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="space-y-0.5">
                                      <div className="flex items-center gap-2">
                                        <h5 className="font-display font-bold text-xs text-slate-900">{note.title}</h5>
                                        {note.audioDuration && (
                                          <span className="bg-slate-100 text-slate-600 font-mono text-[9px] px-1.5 py-0.5 rounded-full font-semibold">
                                            {note.audioDuration}s
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-[9px] text-slate-400 block font-medium">{note.timestamp}</span>
                                    </div>

                                    {/* Action items */}
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => downloadNoteAsPDF(note)}
                                        className="p-1 hover:bg-brand-50 text-brand-600 hover:text-brand-800 rounded transition cursor-pointer"
                                        title="Download Note as Certified PDF"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                      </button>
                                      {editingNoteId !== note.id && (
                                        <button
                                          type="button"
                                          onClick={() => startEditing(note)}
                                          className="p-1 hover:bg-slate-50 text-slate-500 hover:text-slate-800 rounded transition cursor-pointer"
                                          title="Edit transcribed note"
                                        >
                                          <Edit3 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          navigator.clipboard.writeText(note.text);
                                          alert("Transcribed note content copied to clipboard!");
                                        }}
                                        className="p-1 hover:bg-slate-50 text-slate-500 hover:text-slate-800 rounded transition cursor-pointer"
                                        title="Copy text content"
                                      >
                                        <Copy className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => deleteNote(note.id)}
                                        className="p-1 hover:bg-slate-50 text-rose-500 hover:text-rose-700 rounded transition cursor-pointer"
                                        title="Delete note"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Note Content Block */}
                                  {editingNoteId === note.id ? (
                                    <div className="space-y-2">
                                      <textarea
                                        value={editingNoteText}
                                        onChange={(e) => setEditingNoteText(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 focus:bg-white outline-none resize-none h-24"
                                      />
                                      <div className="flex justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => setEditingNoteId(null)}
                                          className="px-2.5 py-1 text-[10px] font-bold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition cursor-pointer"
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => saveEditedNote(note.id)}
                                          className="px-2.5 py-1 text-[10px] font-bold text-white bg-brand-950 rounded-lg hover:bg-slate-900 transition flex items-center gap-1 cursor-pointer"
                                        >
                                          <Check className="w-3 h-3" />
                                          <span>Save Change</span>
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="bg-slate-50/50 border border-slate-100 p-3 rounded-lg text-slate-700 text-xs leading-relaxed whitespace-pre-line" id={`note-text-${note.id}`}>
                                      {note.text}
                                    </div>
                                  )}
                                </div>
                              ));
                            })()
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="subtab-credentials"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      transition={{ duration: 0.15 }}
                      className="space-y-4"
                    >
                      <h3 className="font-display font-bold text-slate-900 text-base">Your Profile Credentials:</h3>
                      
                      <div className="grid grid-cols-2 gap-4 text-xs font-medium text-slate-700 bg-slate-50/50 p-4 rounded-xl border border-slate-150">
                        <div className="space-y-1">
                          <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">Full Name:</span>
                          <span className="text-slate-900 font-semibold">{profile.fullName}</span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">Email:</span>
                          <span className="text-slate-900 font-semibold truncate block">{profile.email}</span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">Advocate Role:</span>
                          <span className="text-brand-900 font-semibold">{profile.role}</span>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">Ontario Region:</span>
                          <span className="text-slate-900 font-semibold">{profile.region}</span>
                        </div>
                        <div className="space-y-1 col-span-2 border-t border-slate-150 pt-2.5 mt-1.5">
                          <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider block">Involved CAS Agency:</span>
                          <span className="text-slate-950 font-bold block">{profile.involvedAgency}</span>
                        </div>
                      </div>

                      <div className="flex gap-3 pt-4">
                        <button
                          onClick={handleLogout}
                          className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-display font-extrabold uppercase tracking-wider text-[10.5px] py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Lock & Log Out</span>
                        </button>
                        <button
                          onClick={() => window.print()}
                          className="flex-1 bg-brand-950 hover:bg-slate-950 text-white font-display font-extrabold uppercase tracking-wider text-[10.5px] py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Print Credentials</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

        </div>

        {/* Right Side: Virtual ID Card Display */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Real Identity Card mockup */}
          <div className="bg-gradient-to-br from-brand-950 via-slate-900 to-slate-950 border border-brand-900/60 rounded-2xl p-6 text-white shadow-2xl space-y-8 relative overflow-hidden" id="virtual-id-card">
            
            {/* Holographic glowing orb background element */}
            <div className="absolute top-0 right-0 w-48 h-48 bg-brand-500/10 rounded-full blur-3xl pointer-events-none"></div>
            <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-amber-500/5 rounded-full blur-3xl pointer-events-none"></div>

            <div className="flex justify-between items-start relative z-10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-brand-900/80 border border-brand-700/50 flex items-center justify-center text-amber-300">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-display font-black text-[11px] tracking-widest text-slate-100 uppercase">
                    ParentShield
                  </h4>
                  <p className="text-[8px] text-brand-300 font-mono tracking-wider font-bold">ONTARIO CYFSA ADVOCACY PASS</p>
                </div>
              </div>
              
              <div className="px-2 py-0.5 border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-mono font-bold text-[8px] uppercase tracking-wider rounded">
                VERIFIED LOCAL
              </div>
            </div>

            {/* Profile info section */}
            <div className="space-y-4 relative z-10 pt-2">
              <div className="space-y-0.5">
                <span className="text-[7.5px] text-brand-300 font-mono font-bold tracking-wider uppercase">ADVOCATE HOLDER NAME:</span>
                <p className="text-sm font-display font-extrabold tracking-wide text-slate-50 truncate">
                  {profile ? profile.fullName : "AUTHORIZED ADHERENT"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-0.5">
                  <span className="text-[7.5px] text-brand-300 font-mono font-bold tracking-wider uppercase">RELATIONSHIP ROLE:</span>
                  <p className="text-[10px] font-bold text-amber-200">
                    {profile ? profile.role : "Parent Defender"}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[7.5px] text-brand-300 font-mono font-bold tracking-wider uppercase">UNIQUE ACCREDITATION:</span>
                  <p className="text-[10px] font-mono font-semibold text-brand-100">
                    {profile ? profile.advocateId : "PSA-2026-PENDING"}
                  </p>
                </div>
              </div>

              <div className="space-y-0.5 border-t border-brand-900/60 pt-3">
                <span className="text-[7.5px] text-brand-300 font-mono font-bold tracking-wider uppercase">CAS WATCHDOG SCOPE:</span>
                <p className="text-[10px] font-medium text-slate-300 truncate">
                  {profile ? profile.involvedAgency : "Ontario Child Welfare Statutory Rules"}
                </p>
              </div>
            </div>

            {/* Footer with barcode mockup */}
            <div className="flex justify-between items-end border-t border-brand-900/40 pt-4 relative z-10">
              <div className="space-y-0.5">
                <span className="text-[6.5px] text-slate-400 block font-sans">JURISDICTION: PROVINCE OF ONTARIO</span>
                <span className="text-[6.5px] text-slate-400 block font-sans">MEMBER SINCE: {profile ? profile.memberSince : "JULY 2026"}</span>
              </div>
              
              {/* Virtual clean aesthetic barcode bar */}
              <div className="flex items-center gap-0.5 bg-white/10 p-1.5 rounded border border-white/5">
                <div className="w-0.5 h-4 bg-slate-300"></div>
                <div className="w-1 h-4 bg-slate-300"></div>
                <div className="w-0.5 h-4 bg-slate-300"></div>
                <div className="w-1.5 h-4 bg-slate-300"></div>
                <div className="w-0.5 h-4 bg-slate-300"></div>
                <div className="w-1 h-4 bg-slate-300"></div>
                <div className="w-2 h-4 bg-slate-300"></div>
                <div className="w-0.5 h-4 bg-slate-300"></div>
              </div>
            </div>
          </div>

          {/* Educational benefit descriptors */}
          <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl space-y-3.5">
            <h4 className="font-display font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
              <Award className="w-4 h-4 text-brand-800" />
              <span>Advocate Passport Benefits</span>
            </h4>
            
            <div className="space-y-3 text-xs text-slate-600 font-medium">
              <div className="flex gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-950 mt-1.5 shrink-0"></div>
                <p className="leading-relaxed">
                  <span className="text-slate-900 font-extrabold">CAS Casework Compliance Tracking:</span> Customizing your dashboard automatically highlights potential statutory timeline alerts for child service plans in Ontario.
                </p>
              </div>
              <div className="flex gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-950 mt-1.5 shrink-0"></div>
                <p className="leading-relaxed">
                  <span className="text-slate-900 font-extrabold">Form PIN Lockout:</span> Keep your draft child care chronologies, affidavit workbook, and lawyer case briefs protected from unauthorized local device inspections.
                </p>
              </div>
              <div className="flex gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-950 mt-1.5 shrink-0"></div>
                <p className="leading-relaxed">
                  <span className="text-slate-900 font-extrabold">Printable Advocacy ID:</span> Displaying your digital CYFSA Self-Advocate Passport conveys to family workers that you are educated and fully prepared on your legal rights.
                </p>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
