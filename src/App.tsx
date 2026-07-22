/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect } from "react";
import { Link, Route, Switch, useLocation, Redirect } from "wouter";
import ParentJourney from "./components/ParentJourney";
import { useGlobalResetListener, useAppReset } from "./hooks/useAppReset";

// Import Modular Subcomponents direct statically for ultra-fast instantaneous view switching with no skeleton flickers
import CYFSAGuideTab from "./components/CYFSAGuideTab";
import FamilyCourtTab from "./components/FamilyCourtTab";
import ChildDevelopmentTab from "./components/ChildDevelopmentTab";
import DocumentAnalyzerTab from "./components/DocumentAnalyzerTab";
import TemplatesTab from "./components/TemplatesTab";
import VoiceAssistantTab from "./components/VoiceAssistantTab";
import LawyerDirectoryTab from "./components/LawyerDirectoryTab";
import SignUpTab from "./components/SignUpTab";
import SavedDocumentsTab from "./components/SavedDocumentsTab";
import StatutoryBookmarkSidebar from "./components/StatutoryBookmarkSidebar";
import FloatingTTS from "./components/FloatingTTS";
import LegalTerminologyDrawer from "./components/LegalTerminologyDrawer";
import ConnectorSearchBot from "./components/ConnectorSearchBot";

// Core icons represent core section identity
import { Scale, BookOpen, Clock, Heart, Sparkles, FileSpreadsheet, Headphones, Users, ChevronRight, Menu, X, AlertCircle, Settings, Smartphone, Check, Printer, Shield, User, FolderHeart } from "lucide-react";

export default function App() {
  useGlobalResetListener();
  const { resetAll } = useAppReset();
  const [location, setLocation] = useLocation();

  const [userProfile, setUserProfile] = useState<any>(() => {
    try {
      const saved = localStorage.getItem("OPA_USER_PROFILE");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Failed to load user profile in header:", e);
    }
    return null;
  });

  useEffect(() => {
    const handleProfileUpdate = () => {
      try {
        const saved = localStorage.getItem("OPA_USER_PROFILE");
        setUserProfile(saved ? JSON.parse(saved) : null);
      } catch (e) {
        console.warn(e);
      }
    };
    window.addEventListener("opa-user-profile-updated", handleProfileUpdate);
    return () => {
      window.removeEventListener("opa-user-profile-updated", handleProfileUpdate);
    };
  }, []);

  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [terminologyOpen, setTerminologyOpen] = useState<boolean>(false);

  // Global listener to easily toggle Glossary from any custom event
  useEffect(() => {
    const handleOpenGlossary = () => {
      setTerminologyOpen(true);
    };
    window.addEventListener("open-terminology-glossary", handleOpenGlossary);
    return () => {
      window.removeEventListener("open-terminology-glossary", handleOpenGlossary);
    };
  }, []);

  const navItems = [
    { name: "Start Here", path: "/", icon: <Heart className="w-4 h-4" /> },
    { name: "Family Rights", path: "/rights", icon: <Heart className="w-4 h-4" /> },
    { name: "CAS Procedure", path: "/cyfsa-procedure", icon: <Scale className="w-4 h-4" /> },
    { name: "First 5 Days", path: "/five-day-rule", icon: <Clock className="w-4 h-4" /> },
    { name: "45-Day Plan", path: "/45-day-roadmap", icon: <ChevronRight className="w-4 h-4" /> },
    { name: "Document Analyzer", path: "/document-analyzer", icon: <Sparkles className="w-4 h-4" /> },
    { name: "Forms & Case Brief", path: "/templates", icon: <FileSpreadsheet className="w-4 h-4" /> },
    { name: "Detailed CYFSA Guide", path: "/cyfsa-guide", icon: <BookOpen className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between font-sans selection:bg-brand-100 selection:text-brand-900" id="root-viewport">
      
      {/* Top Professional Header Bar */}
      <header className="bg-white/90 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-50 no-print shadow-xs" id="app-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            
            {/* Left Brand Area */}
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand-400 via-brand-600 to-brand-800 p-[1.5px] shadow-sm">
                <div className="w-full h-full rounded-[14px] bg-white flex items-center justify-center">
                  <Shield className="w-5 h-5 text-brand-600 fill-brand-50" />
                </div>
              </div>
              <div className="text-left">
                <div className="font-display font-black text-slate-900 leading-none text-base md:text-lg tracking-tight uppercase">
                  ONTARIO <span className="text-brand-600">PARENT ASSIST</span>
                </div>
                <div className="text-[9px] text-slate-500 font-semibold font-mono tracking-widest uppercase mt-1 block">
                  KNOWLEDGE IS POWER
                </div>
              </div>
            </div>

            {/* Middle Quick Active-Membership indicator */}
            <div className="hidden md:flex items-center gap-3">
              {userProfile ? (
                <Link href="/signup">
                  <div className="px-3 py-1.5 text-[10px] font-mono font-bold tracking-wider border border-slate-200 text-slate-700 bg-slate-50 hover:bg-slate-100 uppercase rounded-full flex items-center gap-1.5 shadow-xs cursor-pointer transition-all">
                    <User className="w-3 h-3 text-slate-500" />
                    <span>Passport: {userProfile.fullName.split(" ")[0]} 🛡️</span>
                  </div>
                </Link>
              ) : (
                <Link href="/signup">
                  <div className="px-3 py-1.5 text-[10px] font-mono font-bold tracking-wider border border-dashed border-slate-200 text-slate-500 hover:bg-slate-50 uppercase rounded-full flex items-center gap-1.5 shadow-xs cursor-pointer transition-all">
                    <User className="w-3 h-3 text-slate-400" />
                    <span>Get Passport (Sign Up)</span>
                  </div>
                </Link>
              )}
              <button
                onClick={() => setTerminologyOpen(true)}
                className="px-3 py-1.5 text-[10px] font-mono font-bold tracking-wider border border-slate-200 text-brand-600 bg-brand-50/50 hover:bg-brand-50 uppercase rounded-full flex items-center gap-1.5 shadow-xs cursor-pointer transition-all"
                id="legal-terminology-header-btn"
              >
                <BookOpen className="w-3 h-3 text-brand-600 shrink-0" />
                <span>CYFSA Glossary</span>
              </button>
            </div>

            {/* Right Helpline Widget */}
            <div className="hidden lg:flex items-center gap-4">
              <div className="text-right">
                <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Free Help Center</span>
                <a
                  href="https://www.ontario.ca/page/legal-aid-ontario"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-mono font-semibold text-slate-600 hover:text-brand-600 transition-colors block mt-0.5"
                >
                  Legal Aid Ontario Hotline: 1-800-668-8258
                </a>
              </div>
            </div>

            {/* Mobile Hamburger menu */}
            <div className="md:hidden flex items-center">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors focus:outline-none"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>

          </div>
        </div>

        {/* Mobile Navigation Drawer Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-slate-200 py-3 px-4 space-y-1.5 shadow-md" id="mobile-nav-panel">
            {navItems.map((item) => {
              const isActive = location === item.path;
              return (
                <Link key={item.path} href={item.path}>
                  <div
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-xs font-semibold ${
                      isActive 
                        ? "bg-brand-600 text-white" 
                        : "text-slate-600 hover:bg-slate-50 bg-white border border-slate-100"
                    }`}
                  >
                    {item.icon}
                    <span>{item.name}</span>
                  </div>
                </Link>
              );
            })}

            {/* Legal Glossary option */}
            <div
              onClick={() => {
                setMobileMenuOpen(false);
                setTerminologyOpen(true);
              }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-100"
              id="legal-glossary-mobile-menu-btn"
            >
              <BookOpen className="w-4 h-4 text-brand-600 shrink-0" />
              <span>📚 CYFSA Legal Glossary</span>
            </div>
          </div>
        )}
      </header>

      {/* Main Secondary Sub-header: Navigation Rail (Desktop) */}
      <nav className="bg-white border-b border-slate-200/80 no-print py-1.5 hidden md:block" id="desktop-routing-rail">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-2 overflow-x-auto py-1">
            {navItems.map((item) => {
              const isActive = location === item.path;
              return (
                <Link key={item.path} href={item.path}>
                  <div
                    className={`group px-4 py-2.5 font-display rounded-xl transition-all text-xs font-semibold uppercase tracking-wider cursor-pointer flex items-center gap-2 ${
                      isActive
                        ? "bg-brand-600 text-white shadow-sm shadow-brand-600/10"
                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-100/80"
                    }`}
                  >
                    <span>{item.name}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Primary Main Content Area container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-10" id="main-frame-area">
        <Switch>
          <Route path="/"><ParentJourney page="home" /></Route>
          <Route path="/rights"><ParentJourney page="rights" /></Route>
          <Route path="/cyfsa-procedure"><ParentJourney page="procedure" /></Route>
          <Route path="/five-day-rule"><ParentJourney page="five-day" /></Route>
          <Route path="/45-day-roadmap"><ParentJourney page="roadmap" /></Route>
          <Route path="/cyfsa-guide">
            <CYFSAGuideTab />
          </Route>

          <Route path="/family-court">
            <FamilyCourtTab />
          </Route>

          <Route path="/child-development">
            <ChildDevelopmentTab />
          </Route>

          <Route path="/document-analyzer">
            <DocumentAnalyzerTab />
          </Route>

          <Route path="/templates">
            <TemplatesTab />
          </Route>

          <Route path="/saved-documents">
            <SavedDocumentsTab />
          </Route>

          <Route path="/voice-assistant">
            <VoiceAssistantTab />
          </Route>

          <Route path="/lawyers">
            <LawyerDirectoryTab />
          </Route>

          <Route path="/signup">
            <SignUpTab />
          </Route>

          {/* Fallback route */}
          <Route><Redirect to="/" /></Route>

        </Switch>
      </main>

      {/* Professional Legal Footnote footer */}
      <footer className="bg-white border-t border-slate-200 py-6 md:py-8 mt-12 no-print" id="app-footer">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          
          {/* Real-time PDF / Printexport contextual launcher block */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 bg-slate-50 border border-slate-200 rounded-2xl" id="footer-print-actions">
            <div>
              <h4 className="font-display font-bold text-slate-900 text-sm flex items-center gap-2">
                <Printer className="w-4 h-4 text-brand-600 shrink-0" />
                <span>Parent Document Export Desk</span>
              </h4>
              <p className="text-xs text-slate-500 mt-1">
                {location === "/cyfsa-guide"
                  ? "Export the active statutory guide segment, watchpoint checklists, and verified citations as a clean, professionally formatted PDF."
                  : location === "/templates"
                  ? "Save your current court workbook draft (Affidavit, Factual Chronology, Interaction Diary, or Rebuttals) as a formal PDF."
                  : location === "/document-analyzer"
                  ? "Save your current Multi-File RAG Chat consultation transcript or active Document Verification Report as a structured PDF."
                  : "Save a clean, formatted educational draft copy of the active ParentShield views."}
              </p>
            </div>
            <div className="shrink-0">
              {location === "/cyfsa-guide" ? (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent("trigger-print-pdf", { detail: { type: "guide" } }))}
                  className="w-full sm:w-auto px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  id="footer-print-guide-btn"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Statutory Guide segment</span>
                </button>
              ) : location === "/templates" ? (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent("trigger-print-pdf", { detail: { type: "template" } }))}
                  className="w-full sm:w-auto px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  id="footer-print-template-btn"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Save active draft workbook</span>
                </button>
              ) : location === "/document-analyzer" ? (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent("trigger-print-pdf", { detail: { type: "document-analyzer" } }))}
                  className="w-full sm:w-auto px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  id="footer-print-analyzer-btn"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Export Chat or Analysis Report</span>
                </button>
              ) : (
                <button
                  onClick={() => window.print()}
                  className="w-full sm:w-auto px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  id="footer-print-general-btn"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-500" />
                  <span>Print active view</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs text-slate-500 gap-4 pt-4 border-t border-slate-100 pb-2">
            <div className="space-y-1">
              <span className="font-semibold text-slate-900 block">Ontario Parent CYFSA Navigator • Assistance & Document Analysis System</span>
              <span className="block text-slate-500">Educational Portal only. Designed strictly for parental confidence and information sharing. S.O. 2017 Chapter 14 compliant.</span>
            </div>

            <div className="space-y-1 text-center sm:text-right font-mono text-[10px]">
              <span className="block text-slate-600 font-bold">Jurisdiction: Ontario Court of Justice, Canada</span>
              <span className="block text-slate-500 mt-0.5">Primary sources updated: Q2 2026</span>
              <button 
                onClick={() => {
                  if (confirm("Are you sure you want to perform a Global System Reset? This will wipe ALL cached data, templates, notes, and profiles across all tabs.")) {
                    resetAll();
                  }
                }}
                className="block text-red-500 hover:text-red-700 font-bold mt-2 cursor-pointer transition-colors"
                title="Wipe all application data globally"
              >
                Global System Reset
              </button>
            </div>
          </div>

        </div>
      </footer>

      <ConnectorSearchBot />
      <StatutoryBookmarkSidebar />
      <FloatingTTS />
      
      {/* Symmetrical Floating Glossary Access (Bottom Left) */}
      <button
        onClick={() => setTerminologyOpen(true)}
        title="Open CYFSA Legal Terminology Glossary"
        className="fixed bottom-6 left-6 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 select-none cursor-pointer border bg-white border-slate-200 text-brand-600 hover:bg-brand-50 hover:text-brand-700 z-[98] no-print group hover:scale-105"
        id="legal-terminology-floating-btn"
      >
        <BookOpen className="w-5 h-5 group-hover:scale-110 transition-transform" />
      </button>

      <LegalTerminologyDrawer 
        isOpen={terminologyOpen} 
        onClose={() => setTerminologyOpen(false)} 
      />

    </div>
  );
}
