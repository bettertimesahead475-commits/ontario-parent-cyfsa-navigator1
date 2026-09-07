import React, { useEffect } from "react";
import { Link } from "wouter";
import { ArrowRight, BookOpen, CalendarDays, FileSearch, Heart, Scale, ShieldCheck, Users, Search, Shield } from "lucide-react";
import { CYFSA_TOPICS } from "../data";
import { ROADMAP_STAGES } from "../data-transferred";
import { printBrandedDocument } from "../utils/printExport";

// Same key CYFSAGuideTab.tsx reads on mount — set it right before navigating there so the
// parent lands on the exact topic they clicked, not the guide's unrelated default.
const GUIDE_JUMP_KEY = "OPA_GUIDE_JUMP_TOPIC";
function jumpToGuideTopic(topicId: string) {
  try {
    sessionStorage.setItem(GUIDE_JUMP_KEY, topicId);
  } catch {
    /* best-effort — worst case the guide just opens on its default topic */
  }
}

// BUG FOUND: "Family rights" and "CAS procedure" — the first two steps of the guided
// journey, and the two most-clicked entry points from the homepage — were each three
// one-sentence summary cards with no real statutory content, while the actual verified
// CYFSA_TOPICS content (citations, statutory text, watchpoints) only lived under a
// separately-named "Detailed CYFSA Guide" nav item a parent would have no reason to
// associate with "rights" or "procedure." Pulling the real topics in by category here so
// the content a parent actually needs is on the step that promises it, with a direct link
// into the full statutory writeup for whoever wants the complete citation-backed version.
const RIGHTS_TOPIC_IDS = [
  "parent-child-rights",
  "right-to-counsel-legal-representation",
  "plan-of-care-requirements",
  "access-visitation-rights",
  "kinship-family-placement-preference",
  "appeal-rights",
];
const PROCEDURE_TOPIC_IDS = [
  "protection-grounds",
  "emergency-removal",
  "worker-authority-limits",
];

function StatutoryTopicList({ topicIds }: { topicIds: string[] }) {
  const topics = topicIds
    .map(id => CYFSA_TOPICS.find(t => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  return (
    <div className="space-y-4">
      {topics.map(topic => (
        <article key={topic.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          {topic.badge && <span className="text-[11px] font-bold uppercase tracking-wide text-brand-600">{topic.badge}</span>}
          <h3 className="mt-1 font-display text-lg font-bold text-slate-900">{topic.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{topic.summary}</p>

          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-700">{topic.fullBody}</p>

          {topic.guidelines.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Recommended action steps</p>
              <ul className="mt-2 space-y-2">
                {topic.guidelines.map((g, i) => (
                  <li key={i} className="flex gap-2 rounded-lg border border-emerald-100 bg-emerald-50/40 p-2.5 text-xs leading-relaxed text-slate-700">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-800">{i + 1}</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {topic.checklistItems.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Watch-for checklist</p>
              <div className="mt-2 space-y-2">
                {topic.checklistItems.map((item, i) => (
                  <div key={i} className="rounded-lg border border-amber-100 bg-amber-50/40 p-3 text-xs">
                    <p className="font-bold text-slate-800">{item.label}</p>
                    <p className="mt-0.5 leading-relaxed text-slate-600">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {topic.factVersusFiction.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-rose-700">Fact vs. fiction</p>
              <div className="mt-2 space-y-2">
                {topic.factVersusFiction.map((fvf, i) => (
                  <div key={i} className="overflow-hidden rounded-lg border border-slate-100">
                    <p className="bg-rose-50 p-2.5 text-xs italic text-rose-900">"{fvf.fiction}"</p>
                    <p className="bg-emerald-50 p-2.5 text-xs text-emerald-900">{fvf.fact}</p>
                    <p className="bg-slate-50 p-2 text-[11px] text-slate-500">{fvf.sourceExplanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {topic.primarySources.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {topic.primarySources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600 hover:border-brand-300 hover:text-brand-700">
                  {s.label}{s.citation ? ` — ${s.citation}` : ""}
                </a>
              ))}
            </div>
          )}

          <Link href="/cyfsa-guide">
            <span
              onClick={() => jumpToGuideTopic(topic.id)}
              className="mt-4 inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-brand-700"
            >
              Open in the searchable Detailed Guide <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        </article>
      ))}
    </div>
  );
}

type JourneyPage = "home" | "rights" | "procedure" | "five-day" | "roadmap";

const links = [
  { path: "/", label: "Start" },
  { path: "/rights", label: "Family rights" },
  { path: "/cyfsa-procedure", label: "CAS procedure" },
  { path: "/five-day-rule", label: "First 5 days" },
  { path: "/45-day-roadmap", label: "45-day plan" },
];

const pageCopy: Record<Exclude<JourneyPage, "home">, { eyebrow: string; title: string; lead: string; cards: { title: string; body: string }[]; next: string; nextLabel: string }> = {
  rights: {
    eyebrow: "Step 1 · Prepare your family",
    title: "Understand the rights, responsibilities, and family impact.",
    lead: "Start with a calmer, organized view of what is happening. This guide is educational, not legal advice; use it to prepare questions for a lawyer or Legal Aid Ontario.",
    cards: [
      { title: "Your role as a parent", body: "Keep a dated record, preserve messages and documents, attend court, and ask for clear written information. Ask for legal help early rather than relying on memory during a stressful moment." },
      { title: "Your child and family connection", body: "A separation can affect a child’s routines, sense of safety, relationships, and the wider family unit. Record the child’s routines, supports, school and health needs, and safe kinship connections." },
      { title: "Important questions to raise", body: "Ask what concern is alleged, what information supports it, what immediate safety plan is proposed, how contact is being addressed, and what documents or dates you need to track." },
    ],
    next: "/cyfsa-procedure",
    nextLabel: "Next: CAS procedure",
  },
  procedure: {
    eyebrow: "Step 2 · Know the process",
    title: "See the procedure CAS must follow and the issue they must establish.",
    lead: "The detailed CYFSA guide remains available for source material. This page gives parents a focused checklist before they review documents or speak with counsel.",
    cards: [
      { title: "Protection concerns", body: "A protection application should identify the legal ground and factual concern being relied on. Preserve the exact wording, dates, names, and source of each allegation for your lawyer to review." },
      { title: "Emergency removal without a warrant", body: "Emergency action is a high-stakes, fact-specific power. Record what was said about urgency, what happened immediately before removal, who was present, and every document you were given." },
      { title: "Evidence and alternatives", body: "Organize direct records that speak to the allegation: messages, medical or school records, safety planning, service participation, and safe family or community placement options." },
    ],
    next: "/five-day-rule",
    nextLabel: "Next: the first 5 days",
  },
  "five-day": {
    eyebrow: "Step 3 · Protect the deadline",
    title: "The first five court days are a critical record-building window.",
    lead: "Write down the removal date and time, every service date, and the date of the first court appearance. Confirm deadlines with the court, your lawyer, or Legal Aid Ontario because rules and facts vary.",
    cards: [
      { title: "What to watch for", body: "Keep copies of the notice, application, affidavits, endorsements, and hearing information. Make a simple timeline of each contact with CAS, police, counsel, and the court." },
      { title: "Forms and filing preparation", body: "Use the form workspace to prepare factual notes, a chronology, evidence log, and draft response material. Do not file educational drafts without legal review." },
      { title: "Why this matters", body: "Early records are easier to verify. A clear timeline helps counsel assess scheduling, service, evidence, contact arrangements, and the next practical question to raise." },
    ],
    next: "/45-day-roadmap",
    nextLabel: "Next: build a 45-day plan",
  },
  roadmap: {
    eyebrow: "Step 4 · Build the case file",
    title: "Turn scattered papers into a 45-day parent action plan.",
    lead: "The roadmap helps you move from intake to a lawyer-ready package: a dated timeline, an organized document audit, questions for counsel, and carefully reviewed form drafts.",
    cards: [
      { title: "Days 1–5 · Stabilize", body: "Preserve notices and messages, write the timeline, identify immediate supports and kinship contacts, and seek legal advice." },
      { title: "Days 6–21 · Audit the record", body: "Upload letters, applications, reports, notes, photos, and logs. The analyzer extracts text from PDFs and images, then produces an educational evidence audit with items to verify." },
      { title: "Days 22–45 · Prepare the brief", body: "Use the templates to turn verified facts into a chronology, evidence log, response worksheets, and a lawyer-ready case brief for counsel to review." },
    ],
    next: "/document-analyzer",
    nextLabel: "Open the document analyzer",
  },
};

function RoadmapStageList() {
  return (
    <div className="space-y-3">
      {ROADMAP_STAGES.map(stage => (
        <article key={stage.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-brand-600">{stage.code.replace("_", " ")}</span>
            <span className="text-[11px] font-semibold text-slate-500">· {stage.timeline}</span>
          </div>
          <h3 className="mt-1 font-display text-base font-bold text-slate-900">{stage.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{stage.description}</p>
          {stage.unverifiedNote && (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <strong>Note: </strong>{stage.unverifiedNote}
            </p>
          )}
          {stage.keyDeadlines.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-bold text-slate-700">Key deadlines</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-600">
                {stage.keyDeadlines.map(d => <li key={d}>{d}</li>)}
              </ul>
            </div>
          )}
          <div className="mt-3">
            <p className="text-xs font-bold text-slate-700">Your action plan</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-600">
              {stage.yourActionPlan.map(a => <li key={a}>{a}</li>)}
            </ul>
          </div>
          <div className="mt-3">
            <p className="text-xs font-bold text-slate-700">Common traps</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-600">
              {stage.commonTraps.map(t => <li key={t}>{t}</li>)}
            </ul>
          </div>
        </article>
      ))}
    </div>
  );
}

function JourneyNav() {
  return <nav className="flex gap-2 overflow-x-auto pb-2">{links.map((item) => <Link key={item.path} href={item.path}><span className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-700">{item.label}</span></Link>)}</nav>;
}

export default function ParentJourney({ page }: { page: JourneyPage }) {
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail?.type !== "journey") return;
      let title = "Ontario Parent Assist — Preparation Guide";
      let body = "";
      const renderTopicFull = (t: NonNullable<ReturnType<typeof CYFSA_TOPICS.find>>) => `
        <div class="section-card">
          <div class="section-title">${t.title}</div>
          <p class="body-text">${t.summary}</p>
          <p class="body-text">${t.fullBody.replace(/\n/g, "<br/>")}</p>
          ${t.guidelines.length ? `<p class="body-text"><strong>Recommended action steps:</strong></p><ul class="body-text">${t.guidelines.map(g => `<li>${g}</li>`).join("")}</ul>` : ""}
          ${t.checklistItems.length ? `<p class="body-text"><strong>Watch-for checklist:</strong></p>${t.checklistItems.map(c => `<div class="watch-item"><span class="watch-title">${c.label}</span><span class="watch-desc">${c.description}</span></div>`).join("")}` : ""}
          ${t.factVersusFiction.length ? `<p class="body-text"><strong>Fact vs. fiction:</strong></p><ul class="body-text">${t.factVersusFiction.map(f => `<li><em>"${f.fiction}"</em> — ${f.fact} (${f.sourceExplanation})</li>`).join("")}</ul>` : ""}
        </div>`;
      if (page === "rights") {
        title = "Understanding Your Family Rights";
        const topics = RIGHTS_TOPIC_IDS.map(id => CYFSA_TOPICS.find(t => t.id === id)).filter(Boolean) as NonNullable<ReturnType<typeof CYFSA_TOPICS.find>>[];
        body = topics.map(renderTopicFull).join("");
      } else if (page === "procedure") {
        title = "The Process and Legal Thresholds CAS Must Meet";
        const topics = PROCEDURE_TOPIC_IDS.map(id => CYFSA_TOPICS.find(t => t.id === id)).filter(Boolean) as NonNullable<ReturnType<typeof CYFSA_TOPICS.find>>[];
        body = topics.map(renderTopicFull).join("");
      } else if (page === "roadmap") {
        title = "The 7-Stage Case Roadmap";
        body = ROADMAP_STAGES.map(s => `
          <div class="section-card">
            <div class="section-title">${s.code.replace("_", " ")} — ${s.title} (${s.timeline})</div>
            <p class="body-text">${s.description}</p>
            ${s.unverifiedNote ? `<div class="watch-item"><span class="watch-title">Note</span><span class="watch-desc">${s.unverifiedNote}</span></div>` : ""}
            <p class="body-text"><strong>Your action plan:</strong></p>
            <ul class="body-text">${s.yourActionPlan.map(a => `<li>${a}</li>`).join("")}</ul>
            <p class="body-text"><strong>Common traps:</strong></p>
            <ul class="body-text">${s.commonTraps.map(t => `<li>${t}</li>`).join("")}</ul>
          </div>`).join("");
      } else {
        const content = pageCopy[page as Exclude<JourneyPage, "home">];
        title = content.title;
        body = content.cards.map(c => `<div class="section-card"><div class="section-title">${c.title}</div><p class="body-text">${c.body}</p></div>`).join("");
      }
      printBrandedDocument(title, body);
    };
    window.addEventListener("trigger-print-pdf", handler);
    return () => window.removeEventListener("trigger-print-pdf", handler);
  }, [page]);

// NEW HOMEPAGE CONVERSION FUNNEL — Analyzer-first with social proof
// Replace the entire `if (page === "home")` section with this

  if (page === "home") return <div className="space-y-0">
    <JourneyNav />
    
    {/* HERO: Problem-focused, curiosity-driven */}
    <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-brand-950 to-brand-800 px-6 py-12 text-white shadow-xl sm:px-10 md:py-20">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-200">REAL ANALYSIS • REAL RESULTS</p>
        <h1 className="mt-4 font-display text-4xl font-black leading-tight md:text-5xl">What your CAS affidavits really say — and what they don't.</h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-200">
          Upload the court documents from your case and see what a professional document audit finds: contradictions, unsupported claims, missing evidence, and the questions worth discussing with your lawyer.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/document-analyzer">
            <span className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-base font-bold text-brand-900 transition hover:bg-slate-100">
              ANALYZE A DOCUMENT <ArrowRight className="h-5 w-5" />
            </span>
          </Link>
          <button className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-6 py-3 text-base font-bold text-white transition hover:bg-white/10">
            See what we found
          </button>
        </div>
      </div>
    </section>

    {/* DEMO: Real results from real case */}
    <section className="space-y-8 px-6 py-16 sm:px-10 md:py-24 bg-white">
      <div className="mx-auto max-w-5xl">
        <p className="text-center text-xs font-bold uppercase tracking-widest text-brand-600">REAL CASE ANALYSIS</p>
        <h2 className="mt-3 text-center font-display text-3xl font-bold text-slate-900 md:text-4xl">Here's what we found in an actual CAS affidavit</h2>
        <p className="mt-4 text-center text-base text-slate-600">A parent from Ontario received a CAS affidavit in a child protection case. We analyzed it. Here's what emerged.</p>
      </div>

      <div className="mx-auto max-w-5xl grid gap-8 md:grid-cols-3">
        {/* ORIGINAL DOCUMENT */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-600">STEP 1: ORIGINAL DOCUMENT</p>
          <h3 className="mt-3 font-display text-lg font-bold text-slate-900">Form 14A Affidavit</h3>
          <p className="mt-2 text-xs text-slate-500">Court document filed by CAS manager</p>
          <div className="mt-4 space-y-3 rounded-lg bg-white p-4 border border-slate-200 text-xs leading-relaxed text-slate-700">
            <p className="font-semibold text-slate-900">"On September 30, 2025, [Respondent] attended the Agency and advised me of the following..."</p>
            <p>"[REDACTED] viewed [REDACTED]'s bank account and saw transfers to a gambling site."</p>
            <p>"Immediate removal necessary due to risk. History of non-compliance documented."</p>
            <p className="italic text-slate-500">+ 15 pages of additional narrative, police exhibits, historical claims</p>
          </div>
        </div>

        {/* ANALYSIS OUTPUT */}
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-6">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">STEP 2: ANALYSIS FINDINGS</p>
          <h3 className="mt-3 font-display text-lg font-bold text-slate-900">Evidence Audit Results</h3>
          <p className="mt-2 text-xs text-slate-500">What the document really contains</p>
          
          <div className="mt-4 space-y-3">
            <div className="rounded-lg bg-white p-3 border border-emerald-200">
              <p className="text-xs font-bold text-emerald-900">SCORE: 46/100</p>
              <p className="mt-1 text-xs text-slate-600">Evidence strength assessment</p>
            </div>
            
            <div className="rounded-lg bg-white p-3 border border-amber-200 bg-amber-50">
              <p className="text-xs font-bold text-amber-900">⚠️ HEARSAY</p>
              <p className="mt-1 text-xs text-slate-600">Paragraphs 7–28 report secondhand accounts. Weight depends on corroboration and cross-examination availability.</p>
            </div>

            <div className="rounded-lg bg-white p-3 border border-rose-200 bg-rose-50">
              <p className="text-xs font-bold text-rose-900">⚠️ UNSUPPORTED</p>
              <p className="mt-1 text-xs text-slate-600">Gambling claim has no bank statements, screenshots, or exhibits attached.</p>
            </div>

            <div className="rounded-lg bg-white p-3 border border-blue-200 bg-blue-50">
              <p className="text-xs font-bold text-blue-900">⚠️ CONTRADICTION</p>
              <p className="mt-1 text-xs text-slate-600">Police exhibit states "full custody with [other parent]" — affidavit claims otherwise.</p>
            </div>
          </div>
        </div>

        {/* RESPONSE DRAFT */}
        <div className="rounded-2xl border border-slate-300 bg-white p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-600">STEP 3: YOUR RESPONSE</p>
          <h3 className="mt-3 font-display text-lg font-bold text-slate-900">Form 33B Answer Draft</h3>
          <p className="mt-2 text-xs text-slate-500">Counter-narrative for your lawyer</p>
          <div className="mt-4 space-y-2 text-xs leading-relaxed text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <p className="font-semibold text-slate-900">CAS CLAIM:</p>
            <p className="italic text-slate-600">"Bank records show transfers to gambling site."</p>
            <p className="mt-2 font-semibold text-slate-900">YOUR COUNTER:</p>
            <p>"This claim lacks documentary support — no bank statements attached. Request CAS produce the actual records they reference."</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl rounded-2xl border border-blue-200 bg-blue-50 p-6">
        <p className="text-sm text-blue-900">
          <strong>What this shows:</strong> The analyzer identifies specific evidentiary weaknesses in the CAS case. Your lawyer uses these findings to prepare responses, cross-examination questions, and discovery requests. The better you understand the document's actual strengths and gaps, the better counsel you can instruct.
        </p>
      </div>
    </section>

    {/* PROOF POINTS: Why parents trust this */}
    <section className="space-y-8 px-6 py-16 sm:px-10 md:py-20 bg-slate-50">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center font-display text-3xl font-bold text-slate-900">Why this matters</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <BookOpen className="h-6 w-6 text-brand-600" />
            <p className="mt-3 font-bold text-slate-900">Educational</p>
            <p className="mt-1 text-xs text-slate-600">Teaches you what to look for in legal documents — hearsay, corroboration, contradictions.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <FileSearch className="h-6 w-6 text-brand-600" />
            <p className="mt-3 font-bold text-slate-900">Evidence-focused</p>
            <p className="mt-1 text-xs text-slate-600">Analyzes what's actually in your documents, not assumptions.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <Scale className="h-6 w-6 text-brand-600" />
            <p className="mt-3 font-bold text-slate-900">Not legal advice</p>
            <p className="mt-1 text-xs text-slate-600">Doesn't predict outcomes — gives you better questions for counsel.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <Heart className="h-6 w-6 text-brand-600" />
            <p className="mt-3 font-bold text-slate-900">Your documents</p>
            <p className="mt-1 text-xs text-slate-600">Stay private to your account. You control who sees them.</p>
          </div>
        </div>
      </div>
    </section>

    {/* PROCESS: Three simple steps */}
    <section className="space-y-8 px-6 py-16 sm:px-10 md:py-20 bg-white">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center font-display text-3xl font-bold text-slate-900">How it works</h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-display font-bold text-lg">1</div>
            <p className="mt-4 font-display text-lg font-bold text-slate-900">Upload your document</p>
            <p className="mt-2 text-sm text-slate-600">Court documents, CAS correspondence, affidavits, reports — any evidence from your case.</p>
          </div>
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-display font-bold text-lg">2</div>
            <p className="mt-4 font-display text-lg font-bold text-slate-900">We analyze it</p>
            <p className="mt-2 text-sm text-slate-600">Evidence strength audit, citation check, corroboration assessment, contradiction detection.</p>
          </div>
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-display font-bold text-lg">3</div>
            <p className="mt-4 font-display text-lg font-bold text-slate-900">Review findings</p>
            <p className="mt-2 text-sm text-slate-600">Understand what's strong, what's weak, and what questions to ask your lawyer.</p>
          </div>
        </div>
        <div className="mt-10 text-center">
          <Link href="/document-analyzer">
            <span className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-brand-700">
              ANALYZE YOUR CASE <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </div>
      </div>
    </section>

    {/* WHAT WE CHECK FOR */}
    <section className="space-y-8 px-6 py-16 sm:px-10 md:py-20 bg-slate-50">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center font-display text-3xl font-bold text-slate-900">What the analyzer checks</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            ["📊 Evidence strength", "Overall quality and weight of the evidence presented"],
            ["🔗 Corroboration", "Which claims are backed by attached documents vs. hearsay"],
            ["⚖️ Contradictions", "Conflicts between different parts of the same document"],
            ["📄 Source attribution", "Whether claims are directly witnessed or secondhand"],
            ["❓ Unsupported claims", "Assertions made without documentary evidence"],
            ["🔍 Procedural issues", "Questions about how evidence was gathered"],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="font-bold text-slate-900">{title}</p>
              <p className="mt-1 text-sm text-slate-600">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* WHAT YOU CAN UPLOAD */}
    <section className="space-y-8 px-6 py-16 sm:px-10 md:py-20 bg-white">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center font-display text-3xl font-bold text-slate-900">Documents we analyze</h2>
        <div className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {[
            "📄 Affidavits",
            "📄 CAS correspondence",
            "📄 Court documents",
            "📄 Case notes",
            "📄 Police reports",
            "📄 Assessment documents",
            "📄 Letters & notices",
            "📄 All court records",
          ].map(doc => (
            <div key={doc} className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-700 text-center">
              {doc}
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* EDUCATION: Learning resources */}
    <section className="space-y-8 px-6 py-16 sm:px-10 md:py-20 bg-brand-50">
      <div className="mx-auto max-w-5xl text-center">
        <h2 className="font-display text-3xl font-bold text-slate-900">Want to understand the law?</h2>
        <p className="mt-4 text-base text-slate-700">After you've analyzed your documents, dive deeper into the legal framework with these educational resources.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/rights">
            <span className="inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-white px-5 py-2 text-sm font-bold text-brand-800 transition hover:bg-brand-100">
              Family Rights <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
          <Link href="/cyfsa-guide">
            <span className="inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-white px-5 py-2 text-sm font-bold text-brand-800 transition hover:bg-brand-100">
              CYFSA Guide <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
          <Link href="/45-day-roadmap">
            <span className="inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-white px-5 py-2 text-sm font-bold text-brand-800 transition hover:bg-brand-100">
              Case Roadmap <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </div>
      </div>
    </section>

    {/* FINAL CTA */}
    <section className="space-y-6 px-6 py-16 text-center sm:px-10 md:py-24 bg-gradient-to-br from-brand-600 to-brand-700">
      <div className="mx-auto max-w-3xl text-white">
        <h2 className="font-display text-3xl font-black md:text-4xl">Don't read your paperwork alone.</h2>
        <p className="mt-4 text-lg text-brand-100">Upload your documents and get a professional evidence audit. Better preparation. Better questions for your lawyer. Better outcome.</p>
        <Link href="/document-analyzer">
          <span className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-lg font-bold text-brand-700 transition hover:bg-slate-100">
            ANALYZE MY DOCUMENTS <ArrowRight className="h-6 w-6" />
          </span>
        </Link>
      </div>
    </section>

    {/* DISCLAIMER */}
    <section className="border-t border-slate-200 px-6 py-8 sm:px-10 bg-amber-50">
      <div className="mx-auto max-w-5xl rounded-lg border border-amber-200 bg-white p-4 text-sm leading-relaxed text-amber-950">
        <ShieldCheck className="mb-2 h-5 w-5 text-amber-700" />
        <strong>Use this as a preparation tool, not a replacement for legal advice.</strong> If there is an urgent removal, court date, or safety concern, contact a lawyer or Legal Aid Ontario promptly.
      </div>
    </section>
  </div>;

  const content = pageCopy[page];
  return <div className="mx-auto max-w-4xl space-y-8">
    <JourneyNav />
    <header><p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700">{content.eyebrow}</p><h1 className="mt-3 font-display text-4xl font-black leading-tight text-slate-950 md:text-5xl">{content.title}</h1><p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-600">{content.lead}</p></header>
    <div className="grid gap-4 md:grid-cols-3">{content.cards.map((card, index) => <article key={card.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span className="text-xs font-bold text-brand-600">0{index + 1}</span><h2 className="mt-3 font-display text-lg font-bold text-slate-900">{card.title}</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">{card.body}</p></article>)}</div>
    {page === "rights" && <section className="space-y-4">
      <h2 className="font-display text-xl font-bold text-slate-900">Your rights under the CYFSA, in detail</h2>
      <StatutoryTopicList topicIds={RIGHTS_TOPIC_IDS} />
    </section>}
    {page === "procedure" && <section className="space-y-4">
      <h2 className="font-display text-xl font-bold text-slate-900">The process and legal thresholds CAS must meet</h2>
      <StatutoryTopicList topicIds={PROCEDURE_TOPIC_IDS} />
    </section>}
    {page === "five-day" && <Link href="/45-day-roadmap"><span className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-5 py-3 text-sm font-bold text-brand-800">See the day-by-day apprehension & court-hearing breakdown <ArrowRight className="h-4 w-4" /></span></Link>}
    {page === "five-day" && <Link href="/templates"><span className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-5 py-3 text-sm font-bold text-brand-800">Open forms and preparation templates <BookOpen className="h-4 w-4" /></span></Link>}
    {page === "roadmap" && <section className="space-y-4">
      <h2 className="font-display text-xl font-bold text-slate-900">The 7-stage case roadmap, stage by stage</h2>
      <RoadmapStageList />
    </section>}
    {page === "roadmap" && <div className="flex flex-wrap gap-3"><Link href="/document-analyzer"><span className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white">Upload and audit documents <FileSearch className="h-4 w-4" /></span></Link><Link href="/templates"><span className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800">Open forms and lawyer brief <Users className="h-4 w-4" /></span></Link></div>}
    <Link href={content.next}><span className="inline-flex items-center gap-2 text-sm font-bold text-brand-700">{content.nextLabel} <ArrowRight className="h-4 w-4" /></span></Link>
  </div>;
}
