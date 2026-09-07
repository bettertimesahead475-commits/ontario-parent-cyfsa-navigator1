/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from "react";
import { LAWYERS } from "../data";
import { MapPin, Phone, Search } from "lucide-react";

export default function LawyerDirectoryTab() {
  const [selectedCity, setSelectedCity] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const cities = useMemo(() => ["All", ...Array.from(new Set(LAWYERS.map(({ city }) => city))).sort()], []);
  const filteredLawyers = LAWYERS.filter(({ name, address, city }) =>
    (selectedCity === "All" || city === selectedCity) &&
    `${name} ${address} ${city}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8" id="lawyer-directory-tab">
      <div className="text-left max-w-3xl">
        <h2 className="font-display text-2xl font-bold text-gray-900">Ontario Child Welfare Family Lawyer Directory</h2>
        <p className="text-sm text-gray-600 mt-2 leading-relaxed">
          Browse these Ontario lawyer listings and contact a lawyer directly to discuss representation.
        </p>
      </div>

      <div className="bg-white p-4 rounded-xl border border-gray-100 space-y-3 shadow-2xs" id="directory-filters">
        <div className="flex flex-wrap gap-1.5" id="lawyer-cities">
          {cities.map((city) => <button key={city} onClick={() => setSelectedCity(city)} className={`px-3 py-1 font-sans text-xs font-medium rounded-lg cursor-pointer transition-all ${selectedCity === city ? "bg-brand-900 text-white shadow-xs" : "bg-slate-100 hover:bg-slate-200 text-slate-700"}`}>{city}</button>)}
        </div>
        <div className="relative" id="lawyer-search">
          <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
          <input type="search" placeholder="Search by lawyer name, city, or address..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="w-full bg-slate-50 border border-gray-200 focus:bg-white focus:ring-1 focus:ring-brand-500 rounded-lg pl-9 pr-4 py-2 text-xs focus:outline-none transition-all font-sans" />
        </div>
      </div>

      <div className="space-y-3" id="lawyer-cards">
        {filteredLawyers.map((lawyer) => <article key={lawyer.id} id={`lawyer-card-${lawyer.id}`} className="p-5 rounded-2xl border border-gray-200 bg-white text-left">
          <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-brand-600" /><span className="text-xs font-semibold text-slate-500 font-mono uppercase">{lawyer.city}, Ontario</span></div>
          <h3 className="font-display font-bold text-gray-950 text-base mt-2">{lawyer.name}</h3>
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">{lawyer.address}</p>
          <a href={`tel:${lawyer.phone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-2 mt-4 text-sm text-brand-700 font-semibold hover:underline"><Phone className="w-4 h-4" />{lawyer.phone}</a>
        </article>)}
        {filteredLawyers.length === 0 && <div className="text-center py-16 bg-gray-50 rounded-2xl border border-dashed border-gray-200"><Search className="mx-auto text-slate-400 w-12 h-12 mb-3" /><h4 className="font-display font-semibold text-gray-700">No Lawyers Found</h4><p className="text-xs text-slate-600 mt-1">Try broadening your search or city selection.</p></div>}
      </div>

      <div className="w-full p-4 bg-slate-100 rounded-lg border border-slate-200 text-center">
        <p className="text-xs text-slate-500">Additional Ontario municipalities and panel listings are coming soon.</p>
      </div>
    </div>
  );
}
