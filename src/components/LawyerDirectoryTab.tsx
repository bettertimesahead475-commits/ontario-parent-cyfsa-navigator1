/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { LAWYERS } from "../data";
import { LawyerProfile } from "../types";
import { Search, MapPin, Scale, ChevronRight, CheckCircle, ShieldCheck, Mail, Phone, Info, AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import { apiFetch, safeReadJson } from "../utils/api";

export default function LawyerDirectoryTab() {
  const [selectedCity, setSelectedCity] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedLawyer, setSelectedLawyer] = useState<LawyerProfile | null>(null);
  
  // Intake Form states
  const [parentName, setParentName] = useState<string>("");
  const [parentEmail, setParentEmail] = useState<string>("");
  const [briefDetails, setBriefDetails] = useState<string>("");
  const [consentApproved, setConsentApproved] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [intakeSuccessMessage, setIntakeSuccessMessage] = useState<string>("");
  const [intakeSuccessRef, setIntakeSuccessRef] = useState<string>("");

  const loadFlaggedIssues = (): string => {
    try {
      const savedDocProgress = localStorage.getItem("OPA_DOC_ANALYZER_PROGRESS");
      if (savedDocProgress) {
        const parsed = JSON.parse(savedDocProgress);
        const report = parsed?.selectedReport;
        if (report) {
          let issuesText = `Case Brief Data Imported from Document Admissibility Audit (${report.documentTitle || "Analyzed Document"}):\n\n`;
          
          if (report.lawyerCaseBrief && report.lawyerCaseBrief.length > 0) {
            issuesText += `=== LAWYER DETAILED CASE BRIEF ===\n`;
            report.lawyerCaseBrief.forEach((bullet: string, idx: number) => {
              issuesText += `• ${bullet.replace(/\*\*/g, "")}\n`;
            });
            issuesText += `\n`;
          }

          if (report.redFlags && report.redFlags.length > 0) {
            issuesText += `=== FLAGGED EVIDENCE & OBJECTIONS (${report.redFlags.length}) ===\n`;
            report.redFlags.forEach((flag: any, idx: number) => {
              issuesText += `[Issue #${idx + 1}] (${flag.category} - ${flag.severity})\n`;
              issuesText += `  • Text: "${flag.phraseDetected}"\n`;
              issuesText += `  • Concern: ${flag.explanation}\n`;
              if (flag.legalReference) issuesText += `  • Cite: ${flag.legalReference}\n`;
              issuesText += `\n`;
            });
          }
          
          if (report.proceduralTimelineViolations && report.proceduralTimelineViolations.length > 0) {
            issuesText += `=== FLAGGED PROCEDURAL TIMELINE RULES VIOLATIONS (${report.proceduralTimelineViolations.length}) ===\n`;
            report.proceduralTimelineViolations.forEach((vi: any, idx: number) => {
              issuesText += `[Timeline Violation #${idx + 1}]\n`;
              issuesText += `  • Rule Checked: ${vi.timelineRule}\n`;
              issuesText += `  • Evaluation: ${vi.evaluation}\n`;
              if (vi.citation) issuesText += `  • Citation: ${vi.citation}\n`;
              issuesText += `\n`;
            });
          }
          
          return issuesText;
        }
      }
    } catch (e) {
      console.error("Failed to load flagged issues from localStorage:", e);
    }
    return "";
  };

  const cities = ["All", "Toronto", "Ottawa", "Mississauga", "Hamilton", "Sudbury"];

  const filteredLawyers = LAWYERS.filter((lawyer) => {
    const matchCity = selectedCity === "All" || lawyer.city === selectedCity;
    const matchSearch = lawyer.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        lawyer.firm.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        lawyer.educationNotes.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCity && matchSearch;
  });

  const getSlotPillClass = (slot: LawyerProfile["subscriptionSlot"]) => {
    switch(slot) {
      case "Exclusive": return "bg-purple-100 text-purple-800 border-purple-200";
      case "Priority": return "bg-brand-100 text-brand-800 border-brand-200";
      default: return "bg-slate-100 text-gray-700 border-gray-200";
    }
  };

  const handleIntakeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLawyer) return;

    if (!parentName || !parentEmail || !consentApproved) {
      alert("Missing required fields. Please supply your name, email, and authorize the opt-in educational consent.");
      return;
    }

    setIsSubmitting(true);
    setIntakeSuccessMessage("");
    setIntakeSuccessRef("");

    try {
      const response = await apiFetch("/api/lawyer-intake", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          parentName,
          lawyerId: selectedLawyer.id,
          email: parentEmail,
          city: selectedLawyer.city,
          details: briefDetails,
          consentGiven: consentApproved
        })
      });

      const report = await safeReadJson(response);
      setIntakeSuccessRef(report.referenceNum);
      setIntakeSuccessMessage(report.message);

      // Reset Form fields
      setParentName("");
      setParentEmail("");
      setBriefDetails("");
      setConsentApproved(false);
    } catch(err: any) {
      alert("Error transmitting intake coordinates: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8" id="lawyer-directory-tab">
      {/* Intro block */}
      <div className="text-left max-w-3xl">
        <h2 className="font-display text-2xl font-bold text-gray-900">Ontario Child Welfare Family Lawyer Lead Routing</h2>
        <p className="text-sm text-gray-650 mt-2 leading-relaxed">
          Struggling to secure representation? Locate active family defense practitioners specializing in protecting parents from CAS warrants and overreaches. Use our secure educational intake tunnel to deliver case timeline data directly into their schedules.
        </p>
      </div>

      {/* Lawyer Directory Onboarding Notice */}
      

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="lawyer-registry-layout">
        {/* Left Side: Directory search list */}
        <div className="lg:col-span-7 space-y-4" id="directory-browser">
          {/* Filters Bar */}
          <div className="bg-white p-4 rounded-xl border border-gray-150 space-y-3 shadow-2xs" id="directory-filters">
            <div className="flex flex-wrap gap-1.5" id="lawyer-cities">
              {cities.map((city) => (
                <button
                  key={city}
                  onClick={() => setSelectedCity(city)}
                  className={`px-3 py-1 font-sans text-xs font-medium rounded-lg cursor-pointer transition-all ${
                    selectedCity === city
                      ? "bg-brand-900 text-white shadow-xs"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  }`}
                >
                  {city}
                </button>
              ))}
            </div>

            <div className="relative" id="lawyer-search">
              <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search by advocate name, firm, languages, or specialized court experience..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-gray-200 focus:bg-white focus:ring-1 focus:ring-brand-500 rounded-lg pl-9 pr-4 py-2 text-xs focus:outline-none transition-all font-sans"
              />
            </div>
          </div>

          {/* Map lawyers lists */}
          <div className="space-y-3" id="lawyer-cards">
            {filteredLawyers.map((lawyer) => (
              <div
                key={lawyer.id}
                id={`lawyer-card-${lawyer.id}`}
                className={`p-5 rounded-2xl border transition-all text-left relative overflow-hidden flex flex-col justify-between gap-4 bg-white hover:shadow-xs cursor-pointer ${
                  selectedLawyer?.id === lawyer.id 
                    ? "ring-2 ring-brand-500 border-brand-500 bg-brand-50/15" 
                    : "border-gray-200"
                }`}
                onClick={() => {
                  setSelectedLawyer(lawyer);
                  setIntakeSuccessMessage("");
                  setIntakeSuccessRef("");
                }}
              >
                <div>
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-brand-600" />
                      <span className="text-xs font-semibold text-slate-500 font-mono uppercase">{lawyer.city}, Ontario</span>
                    </div>

                      <div className="flex items-center gap-1.5"><span className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold border uppercase ${getSlotPillClass(lawyer.subscriptionSlot)}`}>
                        {lawyer.subscriptionSlot} Placement
                      </span>
                    </div>
                  </div>

                  <h3 className="font-display font-bold text-gray-950 text-base mt-2 flex items-center justify-between">
                    <span>{lawyer.name}</span>
                    <ChevronRight className="w-5 h-5 text-brand-500 shrink-0" />
                  </h3>
                  <p className="text-xs text-slate-600 font-semibold mt-0.5">{lawyer.firm}</p>
                  
                  <p className="text-xs text-slate-600 mt-2.5 leading-relaxed bg-slate-50/40 p-3 rounded-xl border border-gray-150">
                    {lawyer.educationNotes}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 border-gray-100 text-xs">
                  <div className="flex gap-1.5 text-slate-600">
                    <span className="font-semibold text-gray-700">Languages:</span>
                    <span>{lawyer.languages.join(", ")}</span>
                  </div>

                  <span className="text-brand-700 font-semibold hover:underline">
                    Initiate Case Intake brief
                  </span>
                </div>
              </div>
            ))}

            {filteredLawyers.length === 0 && (
              <div className="text-center py-16 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                <Search className="mx-auto text-slate-400 w-12 h-12 mb-3" />
                <h4 className="font-display font-semibold text-gray-700">No Attorneys Found</h4>
                <p className="text-xs text-slate-600 mt-1">Try broadening your city selection filters.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Secure Intake Form Tunnel */}
        <div className="lg:col-span-12 xl:col-span-5" id="secure-funnel-intake">
          {selectedLawyer ? (
            <div className="bg-white rounded-2xl border border-gray-150 p-6 space-y-6 text-left" id="lawyer-form-wrapper">
              <div className="border-b pb-4">
                <span className="text-[10px] font-mono tracking-widest text-brand-600 font-bold uppercase block">
                  Secure Family Intake Portal
                </span>
                <h3 className="font-display font-bold text-gray-900 text-base mt-1">
                  Intake for: {selectedLawyer.name}
                </h3>
                <span className="text-xs text-gray-550 block mt-0.5">{selectedLawyer.firm}</span>
              </div>

              {intakeSuccessMessage ? (
                <div className="p-5 bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-xl space-y-3" id="intake-success">
                  <CheckCircle className="w-8 h-8 text-emerald-600 animate-pulse" />
                  <h4 className="font-display font-bold text-sm">Case Brief Routed Successfully!</h4>
                  <p className="text-xs leading-relaxed text-emerald-900">
                    {intakeSuccessMessage}
                  </p>
                  <div className="p-2.5 bg-white border border-emerald-100 rounded-lg text-xs font-mono font-bold block select-all">
                    Reference Code: {intakeSuccessRef}
                  </div>
                  <button
                    onClick={() => {
                      setIntakeSuccessMessage("");
                      setIntakeSuccessRef("");
                    }}
                    className="w-full py-2 bg-slate-900 hover:bg-slate-700 font-semibold text-xs text-white rounded-lg transition-colors cursor-pointer"
                  >
                    Close & Seek Another Advocate
                  </button>
                </div>
              ) : (
                <form onSubmit={handleIntakeSubmit} className="space-y-4" id="intake-submission-form">
                  {/* Parent name */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 block">Parent Full Name *</label>
                    <input
                      type="text"
                      required
                      value={parentName}
                      onChange={(e) => setParentName(e.target.value)}
                      placeholder="Jane Doe"
                      className="w-full bg-slate-50 border border-gray-200 text-xs px-3 py-2 rounded-lg font-sans focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </div>

                  {/* Parent Email */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 block">Contact Email Address *</label>
                    <input
                      type="email"
                      required
                      value={parentEmail}
                      onChange={(e) => setParentEmail(e.target.value)}
                      placeholder="jane.doe@example.ca"
                      className="w-full bg-slate-50 border border-gray-200 text-xs px-3 py-2 rounded-lg font-sans focus:outline-none"
                    />
                  </div>

                  {/* Incident Brief details */}
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 block">Factual Case Summary & Target Hearing Dates</label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const issues = loadFlaggedIssues();
                            if (issues) {
                              setBriefDetails(prev => {
                                const separator = prev ? "\n\n" : "";
                                return prev + separator + issues;
                              });
                              alert("Success: Extracted evidentiary objections and timeline defects imported from Document Admissibility Audit!");
                            } else {
                              alert("No analyzed document reports with flagged issues were found in local storage. Run an audit in the Document Analyzer tab first.");
                            }
                          }}
                          className="text-[9px] text-brand-650 hover:text-brand-800 font-bold flex items-center gap-1 cursor-pointer transition-all hover:underline"
                          title="Load flagged hearsay and procedural defects from your audited documents directly into the lawyer case brief summary"
                        >
                          <Sparkles className="w-3 h-3 text-brand-600 animate-pulse" />
                          <span>Auto-load Flagged Issues</span>
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={briefDetails}
                      onChange={(e) => setBriefDetails(e.target.value)}
                      placeholder="My child Lucas was removed on Tuesday May 18. First court date is scheduled on Monday May 25..."
                      rows={6}
                      className="w-full bg-slate-50 border border-gray-200 text-xs p-3 rounded-lg focus:outline-none font-sans leading-relaxed"
                    />
                  </div>

                  {/* Compliance warning disclaimer block & checkbox optin */}
                  <div className="p-4 bg-amber-50/50 border border-amber-100 rounded-xl space-y-3">
                    <span className="text-[10px] font-mono font-bold text-amber-900 block uppercase tracking-wider">
                      Opt-In Compliance & Privacy Notice
                    </span>
                    <p className="text-[11px] text-amber-800 leading-relaxed font-normal">
                      The user acknowledges that this portal transmits information voluntarily. This does not create an immediate solicitor-client relationship. All notes gathered are stored securely under privacy regulations.
                    </p>
                    <label className="flex items-start gap-2.5 text-xs text-amber-950 font-medium select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={consentApproved}
                        required
                        onChange={(e) => setConsentApproved(e.target.checked)}
                        className="mt-0.5 rounded cursor-pointer"
                      />
                      <span>I consent and request to share my educational log brief securely with {selectedLawyer.name}. *</span>
                    </label>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3 bg-brand-650 hover:bg-brand-700 font-bold text-white text-xs rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Transmitting secure bytes...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>Authorize Routing Message</span>
                      </>
                    )}
                  </button>
                </form>
              )}

              {/* Informational icons */}
              <div className="pt-2 flex flex-col gap-2">
                <div className="flex gap-2 text-[11px] text-slate-600">
                  <Mail className="w-4 h-4 text-brand-400 shrink-0" />
                  <span>Direct Intake: {selectedLawyer.email}</span>
                </div>
                <div className="flex gap-2 text-[11px] text-slate-600">
                  <Phone className="w-4 h-4 text-brand-400 shrink-0" />
                  <span>Defense Hotline: {selectedLawyer.phone}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-dashed border-gray-200 rounded-2xl p-10 text-center h-full flex flex-col items-center justify-center space-y-4" id="select-lawyer-prompt">
              <Scale className="w-12 h-12 text-slate-400 mx-auto" />
              <div>
                <h4 className="font-display font-semibold text-gray-700 text-sm">Select an Ontario Lawyer</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                  Choose a counsel profile from the list to populate the secure educational intake routing system.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
