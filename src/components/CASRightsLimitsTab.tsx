import React, { useMemo, useState } from "react";
import { Link } from "wouter";

type Topic = { slug:string; title:string; concern:string; rights:string; limits:string; evidence:string };
const topics: Topic[] = [
  {slug:"mental-health",title:"Mental health",concern:"Current symptoms may affect supervision or the child's wellbeing.",rights:"A diagnosis is not itself a protection finding. Show current functioning, supports and accommodations.",limits:"CAS must connect the child's circumstances to a statutory ground; psychiatric history alone does not establish one.",evidence:"Caregiving observations, child impact, clinical records lawfully obtained, safety supports."},
  {slug:"substance-use",title:"Drug and alcohol use",concern:"Impairment, unsafe storage or substance-related neglect can create a safety concern.",rights:"Present evidence of safe care, treatment and reliable sober caregivers where appropriate.",limits:"Past use or a positive test alone does not resolve whether a child meets a statutory protection ground.",evidence:"Dated incidents, child exposure, supervision, treatment and protective arrangements."},
  {slug:"physical-abuse",title:"Physical abuse",concern:"Actual or likely physical harm can trigger protection proceedings.",rights:"Seek counsel, obtain records and respond to specific allegations without pressuring witnesses.",limits:"CAS must distinguish a report or suspicion from a judicial finding; urgent statutory powers may still apply.",evidence:"Injury records, medical opinions, photographs, witnesses, chronology and competing accounts."},
  {slug:"sexual-abuse",title:"Sexual abuse & exploitation",concern:"Actual or likely sexual abuse or exploitation requires careful protective assessment.",rights:"An accused parent retains procedural protections; a non-offending parent can document protective measures.",limits:"Avoid treating allegations as proven guilt, but do not minimize risk or interfere with a child's disclosure.",evidence:"Specialist interviews, disclosures, medical records when relevant, protective steps and independent evidence."},
  {slug:"domestic-violence",title:"Domestic violence",concern:"Violence, coercion or child exposure may raise protection concerns.",rights:"A survivor can present realistic protective actions, support arrangements and evidence of the perpetrator's conduct.",limits:"Being victimized is not equivalent to perpetrating abuse; CAS must examine child impact and feasible safeguards.",evidence:"Incidents, orders, police records, child exposure and safety planning."},
  {slug:"neglect",title:"Neglect & supervision",concern:"Unmet essential needs, unsafe supervision or patterns of neglect may prompt assessment.",rights:"Explain actual caregiving arrangements and access to community and family supports.",limits:"Poverty, a messy home or an imperfect choice alone is not automatically a statutory finding.",evidence:"Supervision records, child wellbeing, living conditions, referrals and alternatives."},
  {slug:"housing",title:"Housing & poverty",concern:"Housing instability may raise a concern if it creates actual danger or unmet needs.",rights:"Show safe temporary arrangements and requests for housing or financial assistance.",limits:"Financial hardship alone is not the same as neglect; analyze the child's actual circumstances.",evidence:"Housing records, child safety, available services, practical alternatives."},
  {slug:"disability",title:"Disability & accommodations",concern:"CAS may ask whether disability-related needs affect the child's care.",rights:"Request an individualized assessment and appropriate accessible communication or support.",limits:"A disability label alone does not establish parenting incapacity; accommodation duties may apply.",evidence:"Functional evidence, accommodations, support people and actual parenting observations."},
  {slug:"emotional-harm",title:"Emotional harm",concern:"Serious emotional harm or a legally specified risk may be alleged.",rights:"Ask for the precise statutory ground, observed child impact and evidence supporting causation.",limits:"A disagreement, diagnosis or generalized concern is not a substitute for the required statutory elements.",evidence:"Child assessments, reported symptoms, dates, causation and alternative explanations."},
  {slug:"medical-care",title:"Medical care",concern:"A child's unmet medical needs may raise a protection concern.",rights:"Provide care records, second opinions, referrals and reasons for any treatment disagreement.",limits:"A disagreement with a professional does not automatically satisfy a protection ground.",evidence:"Medical records, urgency, treatment access, recommendations and actual child impact."},
  {slug:"education",title:"Education & development",concern:"Serious unmet developmental or educational needs may require assessment.",rights:"Present school communications, service plans, referrals and barriers to obtaining services.",limits:"School concerns must be connected to an applicable statutory ground; attendance issues are not automatically protection findings.",evidence:"Attendance, assessments, accommodation plans and service availability."},
  {slug:"kinship",title:"Kinship & alternative care",concern:"CAS may consider family or community placements when a child cannot safely remain at home.",rights:"Identify suitable relatives and request consideration of less disruptive lawful arrangements.",limits:"Placement decisions are governed by statutory criteria and child safety, not a blanket right to a preferred relative.",evidence:"Relative availability, home suitability, child relationships and safety assessments."},
  {slug:"investigation",title:"Investigations & interviews",concern:"Reports of suspected protection concerns may lead to assessment and interviews.",rights:"Ask for the nature of concerns, seek legal advice and document requests and responses.",limits:"Investigation and entry powers are not unlimited; applicable legal authority and exceptions matter.",evidence:"Referral details, assessment records, consent, notices and interviews."},
  {slug:"safety-plans",title:"Safety plans & consent",concern:"A society may propose a voluntary arrangement to address an identified safety risk.",rights:"Request a written explanation, understand the terms and obtain advice before agreeing where possible.",limits:"A voluntary agreement and a court order have different legal consequences; assess whether consent was informed.",evidence:"Written plan, signatures, duration, safety basis and alternative arrangements."},
  {slug:"removal",title:"Emergency removal",concern:"Urgent danger can trigger warrant or warrantless statutory powers.",rights:"Seek immediate legal advice, obtain the removal documents and record dates and notices.",limits:"Different statutory removal pathways have distinct prerequisites; urgency cannot be presumed in every case.",evidence:"Warrant or statutory authority, facts of urgency, placement, notices and records."},
  {slug:"deadlines",title:"Court deadlines & hearings",concern:"Court applications and protection hearings follow prescribed procedures.",rights:"Track the removal date, application, service, first hearing and orders with counsel.",limits:"Do not treat the filing date as the first hearing or assume every case follows the same deadline.",evidence:"Filed application, endorsements, court notices, orders, service and chronology."},
  {slug:"disclosure",title:"Disclosure & evidence",concern:"CAS may rely on reports, records and sworn evidence in proceedings.",rights:"Ask counsel about disclosure, correcting factual errors and presenting contrary evidence.",limits:"Missing records in an uploaded file do not prove they do not exist in the court record.",evidence:"Affidavits, exhibits, disclosure logs, dates, contradictions and missing documents."},
  {slug:"complaints",title:"Complaints & oversight",concern:"Parents may have concerns about conduct, fairness, privacy or service decisions.",rights:"Identify the appropriate complaint, oversight or court process for the particular issue.",limits:"An administrative complaint does not automatically overturn a court order or suspend deadlines.",evidence:"Correspondence, complaint records, orders, dates and requested remedy."},
  {slug:"other",title:"Other protection grounds",concern:"Other specific statutory grounds may apply to the child's circumstances.",rights:"Ask CAS to identify the exact provision and factual basis for each allegation.",limits:"A general risk label does not replace the applicable legal test.",evidence:"The alleged ground, child impact, dates and corroboration."},
];

// Statutory grounds checked against Ontario e-Laws, CYFSA consolidation current July 1, 2026.
// These are issue-specific entry points, not findings about an individual parent.
type LegalSource = { label: string; url: string; note: string };
const statuteUrl = "https://www.ontario.ca/laws/statute/17c14";
const legalSources: Record<string, LegalSource[]> = {
 "mental-health": [
  {label:"CYFSA s. 74(2)(a), (b), (f)–(i)",url:statuteUrl,note:"Official Ontario e-Laws statute; locate s. 74(2) on the page"},
  {label:"2023 ONCJ 213 — Children's Aid Society of Toronto v. I.L.",url:"https://www.minicounsel.ca/oncj/2023/213",note:"Published judgment reproduction; mental-health concerns were considered alongside evidence of parenting and child needs"}
 ],
 "substance-use": [
  {label:"CYFSA s. 74(2)(a), (b), (f)–(i)",url:statuteUrl,note:"Official Ontario e-Laws statute; applicable grounds depend on the evidence"},
  {label:"2019 ONCJ 916 — Dilico Anishinabek Family Care v. E.J.",url:"https://www.minicounsel.ca/ocj/2019/916",note:"Published judgment reproduction; discusses evidence and the likely-harm test under s. 74(2)(b)(i), not a rule that drug use alone proves harm"}
 ],
 "sexual-abuse": [
  {label:"CYFSA s. 74(2)(c)–(d.2) — sexual abuse, exploitation and trafficking",url:statuteUrl,note:"Official Ontario e-Laws; see each distinct statutory ground"},
  {label:"Windsor-Essex CAS v. E.W., 2020 ONCA 682, paras. 5–7",url:"https://www.minicounsel.ca/oca/2020/682",note:"Published Ontario Court of Appeal judgment; discusses s. 74(2)(c) and the separate best-interests inquiry"}
 ],
 "domestic-violence": [
  {label:"CYFSA s. 74(2)(a)–(b), (f)–(i) — harm and risk",url:statuteUrl,note:"Official Ontario e-Laws; domestic violence is not itself a separately named ground"},
  {label:"Windsor-Essex CAS v. E.W., 2020 ONCA 682, paras. 5–7",url:"https://www.minicounsel.ca/oca/2020/682",note:"Published Ontario Court of Appeal judgment; identifies emotional harm from exposure to domestic violence as potentially relevant"}
 ],
 "neglect": [
  {label:"CYFSA s. 74(2)(a)(i)–(ii), (b)(i)–(ii)",url:statuteUrl,note:"Official Ontario e-Laws; actual physical harm and likely physical harm have different tests"},
  {label:"Windsor-Essex CAS v. E.W., 2020 ONCA 682, paras. 5–7",url:"https://www.minicounsel.ca/oca/2020/682",note:"Published Ontario Court of Appeal judgment; discusses likely harm from inadequate care or patterns of neglect"}
 ],
 "physical-abuse": [
  {label:"CYFSA s. 74(2)(a) — physical harm",url:statuteUrl,note:"Official Ontario e-Laws statute"},
  {label:"CYFSA s. 74(2)(b) — likely physical harm",url:statuteUrl,note:"Official Ontario e-Laws statute"},
  {label:"2019 ONCJ 916 — Dilico Anishinabek Family Care v. E.J.",url:"https://www.minicounsel.ca/ocj/2019/916",note:"Published judgment reproduction; discusses physical harm and likely risk, with citations to other Ontario decisions"}
 ]
};
const reviewedGrounds: Record<string, {grounds: string; procedure: string; review: string}> = {
 "mental-health": {
  grounds:"A parent's mental-health diagnosis is not itself listed as a standalone protection ground. Where evidence supports it, the relevant grounds may concern physical harm or likely physical harm (s. 74(2)(a)–(b)), or specified serious emotional harm or risk (s. 74(2)(f)–(i)). Section 74(2)(j) concerns a condition of the CHILD and access to treatment, not merely a parent's diagnosis.",
  procedure:"Identify the particular pleaded paragraph and evidence of the child's actual harm or legally specified risk. Compare parenting observations, support arrangements and available services. Do not infer incapacity from treatment history alone.",
  review:"Statutory mapping reviewed against Ontario e-Laws (2026-11-08). Published judgment link checked; pinpoint paragraphs and precedential treatment not yet verified."
 },
 "substance-use": {
  grounds:"Substance use is not a standalone paragraph in s. 74(2). Depending on the facts, physical harm or likely harm through inadequate care, supervision or neglect may engage s. 74(2)(a)–(b); serious emotional harm or risk may engage s. 74(2)(f)–(i). These provisions require their own factual elements.",
  procedure:"Check whether there is evidence of impairment affecting supervision, unsafe exposure or unmet needs, and whether sober caregivers or other safeguards address the alleged risk. A test result is evidence to evaluate, not itself a protection order.",
  review:"Statutory mapping reviewed against Ontario e-Laws (2026-11-08). Published judgment link checked; pinpoint paragraphs and precedential treatment not yet verified."
 },
 "sexual-abuse": {
  grounds:"Section 74(2)(c) concerns sexual abuse or exploitation by a person having charge of the child, or by another person when the caregiver knows or should know of the possibility and fails to protect the child. Section 74(2)(d) addresses the corresponding likelihood of future abuse or exploitation. Sections 74(2)(d.1)–(d.2) separately address child sex trafficking and its risk.",
  procedure:"Determine which specific paragraph is alleged and whether the concern involves an alleged perpetrator, a caregiver's failure to protect, or trafficking. Protect the child and preserve independent evidence; do not coach or repeatedly question the child. Seek counsel about disclosure and protective orders.",
  review:"Statutory text and Ontario Court of Appeal reference checked (2026-11-08); judgment linked to published reproduction, not an official court-hosted copy."
 },
 "domestic-violence": {
  grounds:"Domestic violence is not a separately enumerated s. 74(2) ground. Depending on the evidence, physical harm or likely harm may engage s. 74(2)(a)–(b), and serious emotional harm or risk may engage s. 74(2)(f)–(i). The legal test concerns the child's circumstances, not a presumption that a victimized parent caused harm.",
  procedure:"Identify the alleged acts, child's exposure or impact, protective actions and feasible supports. Distinguish the alleged perpetrator from a survivor. Ask which specific protection ground is pleaded and whether the statutory elements are supported.",
  review:"Statutory text and Ontario Court of Appeal reference checked (2026-11-08); case link is a published reproduction."
 },
 "neglect": {
  grounds:"Sections 74(2)(a)(i)–(ii) concern physical harm from inadequate care, provision, supervision or protection, or a pattern of neglect. Sections 74(2)(b)(i)–(ii) address a risk of likely physical harm under corresponding circumstances. Other grounds can apply where their separate elements are established.",
  procedure:"Compare actual child needs, supervision, health, living conditions and dated incidents against the precise allegation. Document available supports and reasonable alternatives. Do not treat poverty alone as proof of neglect.",
  review:"Statutory text and Ontario Court of Appeal reference checked (2026-11-08); case link is a published reproduction."
 },
 "physical-abuse": {
  grounds:"Section 74(2)(a) addresses physical harm inflicted by a person having charge or caused by that person's inadequate care, supervision, protection or pattern of neglect. Section 74(2)(b) addresses likely future physical harm under corresponding circumstances. The statute distinguishes harm already suffered from risk of likely harm.",
  procedure:"Identify the alleged injury, responsible conduct, chronology and supporting evidence. Compare medical findings, witness accounts and alternative explanations. An investigation or allegation is not the same as a court finding; statutory emergency powers may apply when their tests are met.",
  review:"Statutory grounds checked against Ontario e-Laws (2026-11-08). Published judgment link checked; pinpoint paragraphs and precedential treatment not yet verified."
 }
};

const tabs = ["CAS concern", "Parent rights", "CAS powers & limits", "Evidence", "Court & next steps"] as const;
type Tab = typeof tabs[number];
const resources = [
 {label:"Ontario CYFSA — official statute",url:"https://www.ontario.ca/laws/statute/17c14"},
 {label:"Ontario Court of Justice — child protection",url:"https://www.ontariocourts.ca/ocj/family-court/child-protection/"},
 {label:"Ontario family court forms",url:"https://ontariocourtforms.on.ca/en/family-law-rules-forms/"}
];
export default function CASRightsLimitsTab() {
 const [search,setSearch]=useState("");
 const [selected,setSelected]=useState("mental-health");
 const [tab,setTab]=useState<Tab>("Parent rights");
 const filtered=useMemo(()=>topics.filter(t=>t.title.toLowerCase().includes(search.trim().toLowerCase())),[search]);
 const topic=topics.find(t=>t.slug===selected) ?? topics[0];
 const reviewed=reviewedGrounds[topic.slug];
 const text=tab==="CAS concern"?topic.concern:tab==="Parent rights"?topic.rights:tab==="CAS powers & limits"?topic.limits:tab==="Evidence"?topic.evidence:reviewed?reviewed.procedure:"Identify the exact allegation, statutory ground, court stage and relevant documents. Seek legal advice about deadlines, disclosure and the appropriate response. No case-specific court decision has yet been verified for this topic.";
 return <main id="main-content" className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-4">
  <header className="space-y-1"><h1 className="text-2xl font-bold text-slate-900">CAS Powers, Limits & Parents' Rights</h1><p className="text-sm text-slate-600">Explore common child-protection concerns. These are general explanations, not findings about your case or legal advice.</p></header>
  <div className="space-y-1"><label htmlFor="cas-topic-search" className="block text-sm font-semibold text-slate-700">Find a topic</label><input id="cas-topic-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search topics" className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-700" /></div>
  <nav aria-label="CAS concern topics" className="flex flex-wrap gap-2">{filtered.map(t=><button key={t.slug} type="button" aria-pressed={selected===t.slug} onClick={()=>{setSelected(t.slug);setTab("Parent rights")}} className={`rounded-full border px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${selected===t.slug?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-700 border-slate-300 hover:bg-slate-100"}`}>{t.title}</button>)}{filtered.length===0&&<span className="text-sm text-slate-600">No matching topics.</span>}</nav>
  <section aria-labelledby="cas-selected-heading" className="rounded-xl border border-slate-200 p-4 space-y-4">
   <h2 id="cas-selected-heading" className="text-lg font-bold">{topic.title}</h2>
   <div aria-label="Topic sections" className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">{tabs.map(t=><button key={t} type="button" aria-pressed={tab===t} onClick={()=>setTab(t)} className={`rounded-md px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-700 ${tab===t?"bg-blue-100 text-blue-900 font-semibold":"text-slate-700 hover:bg-slate-100"}`}>{t}</button>)}</div>
   <p className="min-h-16 text-sm leading-6 text-slate-800" aria-live="polite">{text}</p>
   {reviewed&&<div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2 text-sm"><h3 className="font-semibold">Applicable statutory grounds</h3><p>{reviewed.grounds}</p><ul className="space-y-2">{(legalSources[topic.slug]??[]).map(source=><li key={source.label}><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline font-medium focus-visible:outline-2 focus-visible:outline-blue-700">{source.label} (opens new tab)</a><p className="text-xs text-slate-600">{source.note}</p></li>)}</ul><p className="text-xs text-slate-600">{reviewed.review} Case examples are fact-specific and do not establish an outcome in another case.</p></div>}
   <div className="text-xs text-slate-600 border-t border-slate-200 pt-3"><strong>Legal source status:</strong> {reviewed?"Statutory grounds linked; example published judgments are linked for context, but paragraph-level holdings and subsequent treatment require further review.":"Topic-specific subsections and case-law holdings are pending legal verification."} These sources do not establish that a particular ground applies to your case.</div>
   <details className="border-t border-slate-200 pt-3 text-sm"><summary className="cursor-pointer font-semibold">Official law, court procedure and forms</summary><ul className="mt-2 space-y-2">{resources.map(r=><li key={r.url}><a className="text-blue-700 underline focus-visible:outline-2 focus-visible:outline-blue-700" href={r.url} target="_blank" rel="noopener noreferrer">{r.label} (opens new tab)</a></li>)}</ul></details>
  </section>
  <p className="text-xs text-slate-600">An allegation, an investigation and a court finding are different. Urgent safety concerns require prompt professional assistance.</p>
  <Link href="/cyfsa-guide" className="text-sm font-semibold text-blue-700 underline">Detailed CYFSA guide</Link>
 </main>;
}
