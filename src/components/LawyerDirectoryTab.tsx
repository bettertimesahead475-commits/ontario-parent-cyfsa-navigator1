import React, { useState, useEffect } from "react";
import { Link } from "wouter";
import { MapPin, Phone, Search, Globe, Shield, Video, Users, ExternalLink } from "lucide-react";
import { PublicDirectoryProfile } from "../../api/services/lawyerDirectory";
import { isSafeWebsiteUrl } from "../utils/urlValidator";

const MATCH_REASON_LABELS: Record<string, string> = {
  OFFICE_NEARBY: "Office in this location",
  SERVES_AREA: "Serves this area",
  ONTARIO_WIDE: "Serves clients across Ontario",
  VIRTUAL: "Virtual service available",
  CHILD_PROTECTION_PRACTICE: "Child-protection/CYFSA practice listed",
  VERIFIED_LAWYER: "Lawyer verification completed",
  PARTICIPATING_PROFESSIONAL: "Participating CYFSA Navigator professional",
};

export default function LawyerDirectoryTab() {
  const [locality, setLocality] = useState("");
  const [requiresCyfsa, setRequiresCyfsa] = useState(false);
  const [isVirtual, setIsVirtual] = useState(false);
  const [isOntarioWide, setIsOntarioWide] = useState(false);

  const [results, setResults] = useState<PublicDirectoryProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const response = await fetch("/api/directory/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locality: locality.trim() || undefined,
          requiresCyfsa,
          isVirtual,
          isOntarioWide,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to search directory.");
      }
      const data = await response.json();
      setResults(data);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    handleSearch();
  }, []);

  return (
    <div className="space-y-8" id="lawyer-directory-tab">
      <div className="text-left max-w-3xl">
        <h2 className="font-display text-2xl font-bold text-slate-900">Ontario Child Welfare Lawyer Directory</h2>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          Browse Ontario lawyer listings and find legal representation.
        </p>
      </div>

      <form onSubmit={handleSearch} className="bg-white p-5 rounded-xl border border-slate-200 space-y-4 shadow-sm" id="directory-filters">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <label htmlFor="locality" className="block text-xs font-semibold text-slate-700 mb-1">City or Locality</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                id="locality"
                type="text"
                placeholder="e.g. Toronto, Sudbury, Kenora..."
                value={locality}
                onChange={(e) => setLocality(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:ring-2 focus:ring-brand-500 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none transition-all font-sans"
              />
            </div>
          </div>
          
          <div className="flex items-end">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full md:w-auto px-6 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Search Directory
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 pt-2 border-t border-slate-100">
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer group">
            <input
              type="checkbox"
              checked={requiresCyfsa}
              onChange={(e) => setRequiresCyfsa(e.target.checked)}
              className="rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
            <span className="group-hover:text-slate-900 transition-colors">Child Protection (CYFSA) Practice</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer group">
            <input
              type="checkbox"
              checked={isVirtual}
              onChange={(e) => setIsVirtual(e.target.checked)}
              className="rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
            <span className="group-hover:text-slate-900 transition-colors">Virtual Service Available</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer group">
            <input
              type="checkbox"
              checked={isOntarioWide}
              onChange={(e) => setIsOntarioWide(e.target.checked)}
              className="rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
            <span className="group-hover:text-slate-900 transition-colors">Ontario-Wide Service</span>
          </label>
        </div>
      </form>

      <div className="space-y-4" id="lawyer-cards">
        {error ? (
          <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 text-sm">
            {error}
          </div>
        ) : isLoading && !hasSearched ? (
          <div className="text-center py-16">
            <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-slate-500">Loading directory listings...</p>
          </div>
        ) : results.length > 0 ? (
          results.map((profile) => (
            <article key={profile.id} className="p-5 rounded-2xl border border-slate-200 bg-white text-left hover:shadow-md transition-shadow">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div>
                  <h3 className="font-display font-bold text-slate-900 text-lg">
                    <Link href={`/lawyers/${profile.id}`} className="hover:text-brand-600 hover:underline">
                      {profile.displayName}
                    </Link>
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full">
                      {profile.professionalType}
                    </span>
                    {profile.lifecycleState === 'VERIFIED_LAWYER' && (
                      <span className="text-xs font-semibold px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded-full flex items-center gap-1">
                        <Shield className="w-3 h-3" />
                        Verified Lawyer
                      </span>
                    )}
                    {profile.lifecycleState === 'PARTICIPATING_PROFESSIONAL' && (
                      <span className="text-xs font-semibold px-2 py-0.5 bg-brand-50 text-brand-700 border border-brand-200 rounded-full flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        Participating Professional
                      </span>
                    )}
                  </div>
                  
                  {/* Office Locations */}
                  {profile.officeLocations && profile.officeLocations.length > 0 && (
                    <div className="flex items-center gap-2 mt-3 text-sm text-slate-600">
                      <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>{profile.officeLocations.map((loc: any) => loc.locality).filter(Boolean).join(', ')}</span>
                    </div>
                  )}

                  {/* Public Contact */}
                  <div className="flex flex-wrap gap-4 mt-3">
                    {profile.publicPhone && (
                      <a href={`tel:${profile.publicPhone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline">
                        <Phone className="w-4 h-4" />
                        {profile.publicPhone}
                      </a>
                    )}
                    {profile.publicWebsite && isSafeWebsiteUrl(profile.publicWebsite) && (
                      <a href={profile.publicWebsite} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline">
                        <Globe className="w-4 h-4" />
                        Website
                      </a>
                    )}
                  </div>
                </div>

                <div className="sm:text-right shrink-0">
                  <Link href={`/lawyers/${profile.id}`}>
                    <button className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 w-full sm:w-auto justify-center">
                      View Profile
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </Link>
                </div>
              </div>

              {profile.matchReasons && profile.matchReasons.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-2">
                  {profile.matchReasons.map(reason => (
                    <span key={reason} className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-100">
                      {reason === 'CHILD_PROTECTION_PRACTICE' ? <Shield className="w-3 h-3 text-indigo-400" /> :
                       reason === 'VIRTUAL' ? <Video className="w-3 h-3 text-blue-400" /> :
                       <MapPin className="w-3 h-3 text-slate-400" />}
                      {MATCH_REASON_LABELS[reason] || reason}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))
        ) : (
          <div className="text-center py-16 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <Search className="mx-auto text-slate-400 w-12 h-12 mb-3" />
            <h4 className="font-display font-semibold text-slate-700 text-lg">No matching directory listings were found with these filters.</h4>
            <p className="text-sm text-slate-500 mt-1">Try broadening your search or modifying your filters.</p>
            <button
              onClick={() => {
                setLocality("");
                setRequiresCyfsa(false);
                setIsVirtual(false);
                setIsOntarioWide(false);
                setTimeout(() => handleSearch(), 0);
              }}
              className="mt-4 px-4 py-2 text-sm text-brand-600 hover:bg-brand-50 rounded-lg font-semibold transition-colors"
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>

      <div className="w-full p-4 bg-slate-50 rounded-xl border border-slate-200 text-center text-xs text-slate-500 space-y-2">
        <p className="font-semibold text-slate-600">Disclaimer</p>
        <p>
          Listings are provided for informational purposes. CYFSA Navigator does not rank or recommend lawyers. 
          A public listing does not necessarily mean the professional participates in CYFSA Navigator.
        </p>
      </div>
    </div>
  );
}
