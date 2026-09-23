import React from "react";
import { Link } from "wouter";
import { ArrowRight, FileText, Info, Scale, ShieldCheck } from "lucide-react";

const flags = [
  {severity:"High",category:"Source attribution",phrase:"The Society received information that the parent was impaired while caring for the child.",explanation:"The affidavit states an allegation but the example paragraph does not identify the original observer, when the observation was made, or the record containing the original account.",verify:"Locate the intake record, worker notes, witness statement, police occurrence or other source identified in disclosure. Compare the wording and date with the affidavit.",law:"Evidence/source verification — discuss admissibility and weight with counsel.",location:"Example affidavit — Allegation 1",action:"Mark the allegation as unverified until the cited source is located. Ask counsel what source material should be requested or compared."},
  {severity:"High",category:"Supporting record",phrase:"Police attended the residence on multiple occasions.",explanation:"The statement does not, by itself, establish why police attended, what officers observed, whether charges resulted, or whether the attendance concerned child safety.",verify:"Match each claimed attendance to an occurrence number, date, report or disclosed police record. Separate confirmed facts from the affidavit writer's characterization.",law:"CYFSA protection findings are fact-specific; the legal significance of police contact depends on the evidence.",location:"Example affidavit — Allegation 2",action:"Build a dated table of each claimed police attendance and the document that supports it. Leave unsupported rows clearly marked."},
  {severity:"Medium",category:"Chronology",phrase:"Concerns continued throughout the following months.",explanation:"This is a broad time statement. Without dates and events, it is difficult to test sequence, duration or whether later information changed the concern.",verify:"Identify every dated event relied on for the claimed continuing concern and compare it with contact notes, service records and later updates.",law:"Chronology is an evidence-organization issue; counsel can advise which dates are legally material.",location:"Example affidavit — History section",action:"Convert the narrative into a dated chronology and attach a source to every entry."},
  {severity:"Medium",category:"Missing context",phrase:"The parent did not cooperate with the Society's plan.",explanation:"The statement does not identify the requested step, when it was requested, the parent's response, or whether there was a disagreement about the plan rather than a refusal.",verify:"Review emails, service plans, meeting notes and contact logs for the actual request and response.",law:"Do not treat a disputed characterization as an established fact without checking the underlying record.",location:"Example affidavit — Service history",action:"Record the exact request, date, response and source document. Bring any material disagreement to counsel."}
];
const thresholds=[
 ["Protection ground identified","Inconclusive","The sample excerpt refers generally to safety concerns but does not reproduce a complete pleaded protection ground or enough facts to decide whether a statutory ground is established.","CYFSA s. 74 — verify the current statutory text and pleaded ground."],
 ["Warrantless apprehension timing/standard","Inconclusive","The sample does not establish whether the child was brought to a place of safety under s. 81, whether a warrant was used, or the exact time sequence. Those facts are required before applying the five-day timing rule.","CYFSA ss. 81 and 88 — application depends on the actual apprehension facts."],
 ["Temporary placement on adjournment","Inconclusive","No adjournment order is included in this sample document, so the analyzer cannot determine which temporary-care option was ordered or why.","CYFSA s. 94 — review the actual order and endorsement."]
];

export default function AnalysisExample(){
 return <div className="mx-auto max-w-5xl space-y-8">
  <header className="rounded-3xl bg-gradient-to-br from-slate-950 via-brand-950 to-brand-800 p-7 text-white md:p-10">
   <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-200">CYFSA Document Analyzer &amp; Parent Educator</p>
   <h1 className="mt-3 font-display text-4xl font-black">Complete Form 14A analysis example</h1>
   <p className="mt-4 max-w-3xl leading-relaxed text-slate-200">This is a <strong>synthetic, fully fictional demonstration</strong> built to show the depth and structure of the analyzer without publishing a real family's confidential child-protection material. It is intentionally not shortened.</p>
   <div className="mt-5 rounded-xl border border-white/20 bg-white/10 p-4 text-sm"><strong>Important:</strong> This example is educational, not legal advice. Findings identify questions to verify; they do not prove that an allegation is false, that a procedural breach occurred, or how a court would decide.</div>
  </header>

  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
   <div className="flex gap-3"><FileText className="mt-1 h-5 w-5 text-brand-600"/><div><h2 className="font-display text-2xl font-bold">Document overview</h2><p className="mt-2 text-sm text-slate-600"><strong>Document:</strong> Fictional Form 14A Affidavit • <strong>Type:</strong> Court affidavit • <strong>Names:</strong> removed / fictional • <strong>Purpose:</strong> demonstration only</p></div></div>
   <p className="mt-5 leading-relaxed text-slate-700">The fictional affidavit presents a sequence of child-safety allegations, references third-party information and police contact, describes service history, and asks the reader to accept several broad characterizations. The analysis below separates what the document actually states from what would need source records, dates, or additional context to verify.</p>
  </section>

  <section><h2 className="font-display text-2xl font-black">1. Claim-by-claim flags and verification</h2><div className="mt-4 space-y-4">{flags.map((f,i)=><article key={i} className="rounded-2xl border border-slate-200 bg-white p-6">
   <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-800">{f.severity}</span><span className="text-xs font-bold uppercase tracking-wide text-slate-500">{f.category}</span></div>
   <h3 className="mt-4 font-bold text-slate-900">Document language being checked</h3><blockquote className="mt-2 border-l-4 border-slate-300 pl-4 text-sm italic text-slate-700">“{f.phrase}”</blockquote>
   <h3 className="mt-4 font-bold">Why the analyzer flagged it</h3><p className="mt-1 text-sm leading-relaxed text-slate-700">{f.explanation}</p>
   <h3 className="mt-4 font-bold">What to verify</h3><p className="mt-1 text-sm leading-relaxed text-slate-700">{f.verify}</p>
   <h3 className="mt-4 font-bold">Reference / limitation</h3><p className="mt-1 text-sm leading-relaxed text-slate-700">{f.law}</p>
   <h3 className="mt-4 font-bold">Location in document</h3><p className="mt-1 text-sm text-slate-700">{f.location}</p>
   <h3 className="mt-4 font-bold">Preparation step</h3><p className="mt-1 text-sm leading-relaxed text-slate-700">{f.action}</p>
  </article>)}</div></section>

  <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-display text-2xl font-black">2. Chronology reconstructed from the document</h2>
   <div className="mt-4 space-y-3 text-sm">{[
    ["Day 1 — fictional date","Society records an intake concern.","Source named in sample: affidavit summary only.","Needs original intake/contact record."],
    ["Day 3","Worker contact with parent is described.","Source named in sample: worker narrative.","Verify worker note, time, participants and exact wording."],
    ["Week 2","Police attendance is referenced.","No occurrence number in the fictional excerpt.","Match to police record before drawing conclusions."],
    ["Following months","Affidavit says concerns continued.","No event-by-event dates in the broad statement.","Break into individual dated events and sources."],
    ["Court filing","Affidavit consolidates earlier allegations.","Court filing establishes what was sworn, not automatically the truth of every underlying third-party assertion.","Compare each material assertion with its underlying source."]
   ].map((r,i)=><div key={i} className="grid gap-2 rounded-xl bg-slate-50 p-4 md:grid-cols-4"><strong>{r[0]}</strong><span>{r[1]}</span><span>{r[2]}</span><span className="text-amber-800">{r[3]}</span></div>)}</div>
  </section>

  <section><h2 className="font-display text-2xl font-black">3. Statutory threshold checks</h2><div className="mt-4 space-y-3">{thresholds.map((r,i)=><div key={i} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap justify-between gap-2"><strong>{r[0]}</strong><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">{r[1]}</span></div><p className="mt-3 text-sm leading-relaxed text-slate-700">{r[2]}</p><p className="mt-3 text-xs font-semibold text-brand-800">{r[3]}</p></div>)}</div></section>

  <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-display text-2xl font-black">4. What is missing or not established by this document alone</h2>
   <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-relaxed text-slate-700">
    <li>The original source for each third-party allegation and whether the affidavit accurately reproduces that source.</li><li>Complete dates for generalized statements such as “continued concerns” or “multiple occasions.”</li><li>The police occurrence numbers and records underlying references to police attendance.</li><li>The exact service-plan requests and the parent's recorded responses.</li><li>The complete application, endorsements, orders and disclosure needed to understand the procedural posture.</li><li>Any records that contradict, qualify, update or resolve an earlier allegation.</li>
   </ul>
  </section>

  <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-display text-2xl font-black">5. Source-verification checklist</h2>
   <div className="mt-4 grid gap-3 md:grid-cols-2">{["Intake / referral record for each reported concern","Contemporaneous worker notes and contact logs","Police occurrence records actually referenced","Emails, texts and letters showing requests and responses","Service plans and revisions","Medical, school or service-provider records only where actually relied upon","Court application, affidavits, endorsements and orders","Later records that confirm, contradict or update earlier information"].map((x,i)=><div key={i} className="rounded-xl bg-slate-50 p-4 text-sm"><strong>{String(i+1).padStart(2,"0")}.</strong> {x}</div>)}</div>
  </section>

  <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-display text-2xl font-black">6. Questions to take to a lawyer or duty counsel</h2>
   <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-slate-700">
    <li>Which pleaded protection ground or grounds does the Society rely on, and which specific facts are said to support each ground?</li><li>Which allegations are based on direct observations and which depend on information from another person?</li><li>What disclosure should contain the original source for each material allegation?</li><li>How should the references to police attendance be treated if the underlying occurrence records say something different or provide additional context?</li><li>Are there material chronology gaps that should be clarified before the next appearance?</li><li>If an apprehension occurred, which statutory route was used and what dates matter for the applicable hearing requirements?</li><li>Which disputed statements actually matter to the legal issues before the court, rather than merely being background?</li><li>What documents should be organized now for the next court date, and what should not be filed without legal advice?</li>
   </ol>
  </section>

  <section className="rounded-2xl border border-brand-200 bg-brand-50 p-6"><div className="flex gap-3"><Scale className="mt-1 h-5 w-5 text-brand-700"/><div><h2 className="font-display text-2xl font-black">7. Parent education: how to read findings like these</h2>
   <p className="mt-3 text-sm leading-relaxed text-slate-700">A flag is a prompt to verify, not a verdict. “Missing” means the item is not present in the analyzed material; it does not establish that the record does not exist elsewhere. “Inconclusive” means the available document is insufficient for the check. A contradiction should be recorded with both source passages and dates before deciding whether it is material.</p>
   <p className="mt-3 text-sm leading-relaxed text-slate-700">The purpose is to turn a dense court document into an organized set of source questions, chronology checks and discussion points so the parent can have a more informed conversation with counsel.</p></div></div>
  </section>

  <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-display text-2xl font-black">8. Lawyer case-brief preparation points</h2>
   <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700">{[
    "Identify the exact pleaded statutory ground and map each supporting factual allegation to its source.",
    "Separate direct worker observations from third-party reports and later summaries.",
    "Obtain or compare the underlying records for police references before relying on the affidavit's characterization.",
    "Build a dated chronology for broad narrative periods and mark unsupported dates as unknown rather than estimating them.",
    "Record material inconsistencies with both passages side by side and preserve the source documents.",
    "Confirm the procedural history from filed documents and court endorsements rather than from narrative descriptions alone.",
    "Prepare a short list of the highest-impact unresolved source questions for counsel."
   ].map((x,i)=><li key={i} className="rounded-xl bg-slate-50 p-4"><strong>{i+1}.</strong> {x}</li>)}</ul>
  </section>

  <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6"><div className="flex gap-3"><Info className="mt-1 h-5 w-5 text-amber-800"/><div><h2 className="font-display text-xl font-black">Why this public example is fictional</h2><p className="mt-2 text-sm leading-relaxed text-amber-950">Child-protection records can contain highly sensitive information about children and families. This public demonstration therefore uses invented facts and no real names, case number, addresses, dates, allegations or identifying details. A real redacted example should only replace it after confidentiality and consent issues have been resolved.</p></div></div></section>

  <section className="rounded-3xl bg-slate-950 p-7 text-white md:p-10"><ShieldCheck className="h-7 w-7 text-brand-300"/><h2 className="mt-3 font-display text-3xl font-black">Ready to analyze your own document?</h2><p className="mt-3 max-w-2xl text-slate-300">Use the CYFSA Document Analyzer &amp; Parent Educator to organize what the document says, identify what needs verification, and prepare questions for counsel.</p><Link href="/document-analyzer"><span className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 font-bold text-brand-900">TRY OUR ANALYZER &amp; EDUCATOR <ArrowRight className="h-5 w-5"/></span></Link></section>
 </div>;
}
