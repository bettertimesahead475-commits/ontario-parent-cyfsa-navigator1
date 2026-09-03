/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from "react";
import { CHARTER_RIGHTS, EMERGENCY_CONTACTS } from "../data-transferred";
import { Scale, Phone, Globe, ShieldCheck } from "lucide-react";
import { printBrandedDocument } from "../utils/printExport";

export default function CharterRightsTab() {
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail?.type !== "charter-rights") return;
      const body = `
        ${CHARTER_RIGHTS.map(r => `
          <div class="section-card">
            <div class="section-title">${r.section} — ${r.title}</div>
            <p class="body-text" style="font-style: italic; color: #64748b;">"${r.legalText}"</p>
            <p class="body-text">${r.meaning}</p>
            <ul class="body-text">${r.casConstraint.map(c => `<li>${c}</li>`).join("")}</ul>
            <p class="body-text"><strong>Something you could say:</strong> "${r.script}"</p>
          </div>`).join("")}
        <div class="section-card">
          <div class="section-title">Emergency Contacts</div>
          <ul class="body-text">${EMERGENCY_CONTACTS.map(c => `<li><strong>${c.name}</strong> — ${c.phone} (${c.hours}). ${c.description}</li>`).join("")}</ul>
        </div>`;
      printBrandedDocument("Charter Rights During a CAS Interaction", body);
    };
    window.addEventListener("trigger-print-pdf", handler);
    return () => window.removeEventListener("trigger-print-pdf", handler);
  }, []);

  return (
    <div className="space-y-8" id="charter-rights-tab">
      <div className="max-w-3xl">
        <h2 className="font-display text-2xl font-bold text-gray-900">Your Charter Rights During a CAS Interaction</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          These are constitutional rights under the Canadian Charter of Rights and Freedoms — they apply
          regardless of what any specific CYFSA section says. This is educational, not legal advice; use it
          to prepare questions for a lawyer or Legal Aid Ontario, not as a substitute for one.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {CHARTER_RIGHTS.map(right => (
          <article key={right.section} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-brand-600" />
              <span className="text-xs font-bold uppercase tracking-wide text-brand-600">{right.section}</span>
            </div>
            <h3 className="mt-2 font-display text-base font-bold text-slate-900">{right.title}</h3>
            <p className="mt-2 text-xs italic leading-relaxed text-slate-500">"{right.legalText}"</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">{right.meaning}</p>
            <ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-600">
              {right.casConstraint.map(c => <li key={c}>{c}</li>)}
            </ul>
            <div className="mt-3 rounded-xl bg-brand-50 p-3 text-xs leading-relaxed text-brand-900">
              <strong>Something you could say: </strong>"{right.script}"
            </div>
          </article>
        ))}
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-950">
        <ShieldCheck className="mb-2 h-5 w-5 text-amber-700" />
        <strong>These are starting points for a conversation with a lawyer, not scripts guaranteed to work in every situation.</strong> Every case is fact-specific — confirm with counsel or Legal Aid Ontario how these apply to your circumstances.
      </div>

      <div>
        <h2 className="font-display text-xl font-bold text-slate-900">Emergency Contacts</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {EMERGENCY_CONTACTS.map(contact => (
            <article key={contact.name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="font-display text-base font-bold text-slate-900">{contact.name}</h3>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                <Phone className="h-3.5 w-3.5" /> {contact.phone}
              </p>
              <p className="mt-1 text-xs text-slate-500">{contact.hours}</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{contact.description}</p>
              <a href={contact.website} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand-700">
                <Globe className="h-3.5 w-3.5" /> {contact.website.replace("https://", "")}
              </a>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
