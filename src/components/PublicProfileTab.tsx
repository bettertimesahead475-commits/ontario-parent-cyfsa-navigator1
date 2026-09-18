import React, { useState, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { ArrowLeft, MapPin, Phone, Mail, Globe, Shield, Video, Users, Building, Briefcase } from "lucide-react";
import { PublicDirectoryProfile } from "../../api/services/lawyerDirectory";
import { isSafeWebsiteUrl } from "../utils/urlValidator";

export default function PublicProfileTab() {
  const [, params] = useRoute<{ id: string }>("/lawyers/:id");
  const profileId = params?.id;

  const [profile, setProfile] = useState<PublicDirectoryProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profileId) return;
    setIsLoading(true);
    fetch(`/api/directory/profiles/${profileId}`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error("Profile not found.");
          throw new Error("Failed to load profile.");
        }
        return res.json();
      })
      .then((data) => setProfile(data))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [profileId]);

  if (isLoading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-slate-500">Loading professional profile...</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="py-20 text-center max-w-lg mx-auto">
        <Shield className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Profile Not Found</h2>
        <p className="text-sm text-slate-600 mb-6">{error || "The requested profile could not be found."}</p>
        <Link href="/lawyers">
          <button className="px-6 py-2 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 transition-colors">
            Return to Directory
          </button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      <div className="flex items-center gap-2">
        <Link href="/lawyers">
          <button className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to Directory
          </button>
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-8 sm:p-10 border-b border-slate-100 bg-slate-50/50">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
            <div>
              <h1 className="font-display text-3xl font-bold text-slate-900">{profile.displayName}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <span className="text-sm font-semibold px-3 py-1 bg-white border border-slate-200 text-slate-700 rounded-full">
                  {profile.professionalType}
                </span>
                {profile.lifecycleState === 'VERIFIED_LAWYER' && (
                  <span className="text-sm font-semibold px-3 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full flex items-center gap-1.5">
                    <Shield className="w-4 h-4" />
                    Verified Lawyer
                  </span>
                )}
                {profile.lifecycleState === 'PARTICIPATING_PROFESSIONAL' && (
                  <span className="text-sm font-semibold px-3 py-1 bg-brand-50 text-brand-700 border border-brand-200 rounded-full flex items-center gap-1.5">
                    <Users className="w-4 h-4" />
                    Participating Professional
                  </span>
                )}
                {profile.lifecycleState === 'PUBLIC_LISTING' && (
                  <span className="text-sm font-semibold px-3 py-1 bg-slate-100 text-slate-600 border border-slate-200 rounded-full">
                    Public Listing
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 sm:p-10 grid grid-cols-1 md:grid-cols-2 gap-10">
          <div className="space-y-8">
            <section>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Contact Information
              </h3>
              <div className="space-y-3">
                {profile.publicPhone ? (
                  <a href={`tel:${profile.publicPhone.replace(/[^+\d]/g, "")}`} className="flex items-center gap-3 text-slate-700 hover:text-brand-600">
                    <Phone className="w-5 h-5 text-slate-400" />
                    <span>{profile.publicPhone}</span>
                  </a>
                ) : null}
                {profile.publicEmail ? (
                  <a href={`mailto:${profile.publicEmail}`} className="flex items-center gap-3 text-slate-700 hover:text-brand-600">
                    <Mail className="w-5 h-5 text-slate-400" />
                    <span>{profile.publicEmail}</span>
                  </a>
                ) : null}
                {profile.publicWebsite && isSafeWebsiteUrl(profile.publicWebsite) ? (
                  <a href={profile.publicWebsite} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-slate-700 hover:text-brand-600">
                    <Globe className="w-5 h-5 text-slate-400" />
                    <span>{profile.publicWebsite}</span>
                  </a>
                ) : null}
                {!profile.publicPhone && !profile.publicEmail && !profile.publicWebsite && (
                  <p className="text-sm text-slate-500 italic">No public contact information available.</p>
                )}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-2">
                <Building className="w-4 h-4" />
                Office Locations
              </h3>
              {profile.officeLocations && profile.officeLocations.length > 0 ? (
                <div className="space-y-3">
                  {profile.officeLocations.map((loc: any, idx: number) => (
                    <div key={idx} className="flex gap-3 text-slate-700">
                      <MapPin className="w-5 h-5 text-slate-400 shrink-0" />
                      <div className="text-sm">
                        {loc.address && <div className="font-medium">{loc.address}</div>}
                        <div>{loc.locality}{loc.province ? `, ${loc.province}` : ''} {loc.postal_code}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 italic">No office locations listed.</p>
              )}
            </section>
          </div>

          <div className="space-y-8">
            <section>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-2">
                <Briefcase className="w-4 h-4" />
                Practice Areas
              </h3>
              {profile.practiceAreas && profile.practiceAreas.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {profile.practiceAreas.map((pa: any, idx: number) => {
                    const isCyfsa = pa.practice_area === 'CYFSA' || pa.practice_area === 'Child Protection';
                    return (
                      <span key={idx} className={`text-sm px-3 py-1.5 rounded-lg border ${
                        isCyfsa ? 'bg-indigo-50 border-indigo-100 text-indigo-700 font-medium' : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}>
                        {pa.practice_area} {isCyfsa && <span className="text-xs ml-1 opacity-75">(practice listed)</span>}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-500 italic">No specific practice areas listed.</p>
              )}
            </section>

            <section>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Service Areas
              </h3>
              {profile.serviceAreas && profile.serviceAreas.length > 0 ? (
                <div className="space-y-2">
                  {profile.serviceAreas.map((sa: any, idx: number) => {
                    if (sa.coverage_type === 'ONTARIO_WIDE') {
                      return (
                        <div key={idx} className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                          <Globe className="w-4 h-4 text-brand-500" />
                          Serves clients across Ontario
                        </div>
                      );
                    }
                    if (sa.coverage_type === 'VIRTUAL') {
                      return (
                        <div key={idx} className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                          <Video className="w-4 h-4 text-blue-500" />
                          Virtual service available
                        </div>
                      );
                    }
                    if (sa.coverage_type === 'LOCALITY') {
                      return (
                        <div key={idx} className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                          <MapPin className="w-4 h-4 text-slate-400" />
                          Serves {sa.locality_name}
                        </div>
                      );
                    }
                    if (sa.coverage_type === 'REGIONAL') {
                      return (
                        <div key={idx} className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                          <MapPin className="w-4 h-4 text-slate-400" />
                          Serves {sa.region_name} region
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-500 italic">No additional service areas listed.</p>
              )}
            </section>
          </div>
        </div>
      </div>

      <div className="w-full p-6 bg-slate-50 rounded-xl border border-slate-200 text-sm text-slate-600 space-y-3">
        <p className="font-semibold text-slate-800">Directory Disclaimer</p>
        <p>
          Listings are provided for informational purposes. CYFSA Navigator does not rank or recommend lawyers. 
          A public listing does not necessarily mean the professional participates in CYFSA Navigator.
        </p>
        <p>
          "Child-protection/CYFSA practice listed" indicates the professional has listed this as a practice area; it does not constitute an independent verification of specialization.
        </p>
      </div>
    </div>
  );
}
