import React, { useEffect } from "react";
import { Link } from "wouter";
import { ArrowRight, BookOpen, CalendarDays, FileSearch, Heart, Lock, Phone, Scale, ShieldCheck, Users, Search, Shield, Upload } from "lucide-react";
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
    title: "The first five days are crucial. Be prepared for the first hearing — and what comes next.",
    lead: "The first five days can move quickly. Use that time to understand what CAS is alleging, become educated about the process, and know which documents you need to prepare or have ready for court. CYFSA Navigator is designed to help you organize and understand the record from those first critical days through the rest of the case.",
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
      let title = "CYFSA Navigator — Preparation Guide";
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

  if (page === "home") return <div className="space-y-0">
    {/* HERO — Rebuilt to closely match approved reference monitor */}
    <section
      className="relative isolate overflow-hidden rounded-[2rem] sm:rounded-[2.5rem] border border-blue-900/40 text-white shadow-2xl shadow-blue-950/40"
      style={{
        background: "radial-gradient(ellipse at 80% 35%, rgba(29, 78, 216, 0.45) 0%, rgba(14, 165, 233, 0.12) 35%, transparent 70%), linear-gradient(125deg, #05132f 0%, #071a44 42%, #0a245a 78%, #0d2e6e 100%)",
      }}
      aria-labelledby="hero-title"
    >
      {/* Integrated Lady Justice composition on the right side */}
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-full sm:w-[68%] md:w-[59%] lg:w-[53%] xl:w-[50%] flex items-end justify-end overflow-hidden"
        aria-hidden="true"
      >
        <img
          src="/assets/lady-justice-hero.webp"
          alt=""
          className="h-[108%] w-auto max-w-none object-contain object-right-bottom opacity-35 sm:opacity-65 md:opacity-85 lg:opacity-100 select-none translate-x-[3%] sm:translate-x-[4%] lg:translate-x-[1%] scale-[1.06] origin-bottom-right"
          loading="eager"
          decoding="async"
        />
        {/* Soft edge gradient to ensure seamless merge with navy hero */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#05132f] via-[#05132f]/60 to-transparent sm:via-[#05132f]/20 lg:via-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#05132f]/80 via-transparent to-transparent sm:from-transparent" />
      </div>

      {/* Hero Content Left Column */}
      <div className="relative z-10 px-6 py-12 sm:px-10 sm:py-16 md:py-20 lg:px-14 lg:py-24">
        <div className="max-w-2xl lg:max-w-xl xl:max-w-2xl">
          {/* Eyebrow */}
          <div className="flex items-center gap-2 text-xs sm:text-[13px] font-bold uppercase tracking-[0.18em] text-blue-400">
            <span>REAL ANALYSIS</span>
            <span className="text-blue-400/80">•</span>
            <span>REAL RESULTS</span>
          </div>

          {/* Primary Headline */}
          <h1
            id="hero-title"
            className="mt-4 sm:mt-5 font-display text-3xl sm:text-4xl md:text-5xl lg:text-[3.25rem] xl:text-[3.6rem] font-extrabold leading-[1.12] tracking-tight text-white"
          >
            What your CAS affidavits really say — and what they don't.
          </h1>

          {/* Supporting Copy */}
          <p className="mt-5 sm:mt-6 text-base sm:text-lg leading-relaxed text-blue-100/90 font-normal max-w-xl">
            Upload the court documents from your case and see what a professional document audit finds — including contradictions, unsupported claims, missing evidence, and the questions you can discuss with your lawyer.
          </p>

          {/* Action Row */}
          <div className="mt-8 sm:mt-10 flex flex-wrap items-center gap-4 sm:gap-6">
            <Link href="/document-analyzer">
              <span className="inline-flex items-center justify-center gap-2.5 px-6 sm:px-7 py-3.5 sm:py-4 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-500 active:bg-blue-700 shadow-lg shadow-blue-950/40 transition-all duration-200 cursor-pointer text-sm sm:text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                <Upload className="w-5 h-5 stroke-[2.5]" aria-hidden="true" />
                <span>Upload Your Documents</span>
              </span>
            </Link>

            <Link href="/pricing">
              <span className="inline-flex items-center justify-center gap-2 px-5 sm:px-6 py-3.5 sm:py-4 rounded-xl font-bold text-white bg-white/10 hover:bg-white/20 border border-white/20 shadow-md backdrop-blur-xs transition-all duration-200 cursor-pointer text-sm sm:text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" id="hero-view-membership-plans-btn">
                <Shield className="w-4 h-4 text-blue-300" aria-hidden="true" />
                <span>View Membership Plans</span>
              </span>
            </Link>

            <Link href="/analysis-example">
              <span className="inline-flex items-center gap-2 text-white hover:text-blue-200 font-semibold text-sm sm:text-base transition-colors duration-150 cursor-pointer group py-2">
                <span>See an Example Analysis</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </span>
            </Link>
          </div>
        </div>
      </div>
    </section>

    {/* FIRST FIVE DAYS — urgency that opens into the whole journey */}
    <section className="px-6 py-14 sm:px-10 md:py-20 bg-amber-50 border-y border-amber-200">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-800">The first five days are crucial. Your journey doesn't end there.</p>
        <h2 className="mt-3 max-w-4xl font-display text-3xl font-black leading-tight text-slate-950 md:text-4xl">Be prepared for the first hearing — and for what comes next.</h2>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-slate-700">
          The first five days can move quickly. There may be very little time to find legal help, understand what CAS is alleging, become educated about the process, and know which documents you need to prepare or have ready for court.
        </p>
        <p className="mt-4 max-w-3xl text-base font-semibold leading-relaxed text-slate-900">
          CYFSA Navigator is built to help you from those first critical days through the rest of your journey.
        </p>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-700">
          Understand your documents. Follow allegations and supporting information as your case develops. Keep your record organized. Learn about the process and prepare focused questions for your lawyer or duty counsel.
        </p>
        <div className="mt-7 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-amber-200 bg-white p-5"><p className="font-bold text-slate-900">Prepare for the first hearing</p><p className="mt-2 text-sm text-slate-600">Preserve the application, affidavits, notices and messages. Record important dates and start one clear chronology.</p></div>
          <div className="rounded-xl border border-amber-200 bg-white p-5"><p className="font-bold text-slate-900">Understand the documents</p><p className="mt-2 text-sm text-slate-600">See what is alleged, where information came from, what records are referenced, and what questions the documents raise.</p></div>
          <div className="rounded-xl border border-amber-200 bg-white p-5"><p className="font-bold text-slate-900">Stay prepared as the case develops</p><p className="mt-2 text-sm text-slate-600">Use the same organized record for new documents, later court dates and conversations with counsel instead of starting over each time.</p></div>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/document-analyzer"><span className="inline-flex items-center gap-2 rounded-xl bg-amber-800 px-6 py-3 text-sm font-bold text-white">TRY OUR CYFSA DOCUMENT ANALYZER &amp; PARENT EDUCATOR <FileSearch className="h-4 w-4" /></span></Link>
          <Link href="/five-day-rule"><span className="inline-flex items-center gap-2 rounded-xl border border-amber-700 bg-white px-6 py-3 text-sm font-bold text-amber-900">UNDERSTAND THE FIRST 5 DAYS <ArrowRight className="h-4 w-4" /></span></Link>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-slate-600">The statutory timing is fact-specific. Confirm how the CYFSA's timing requirements apply to your circumstances with a lawyer or duty counsel.</p>
      </div>
    </section>

    {/* ANALYZER DEPTH TEASER */}
    <section className="px-6 py-16 sm:px-10 md:py-20 bg-white">
      <div className="mx-auto max-w-5xl rounded-2xl border border-brand-200 bg-brand-50 p-6 md:p-8">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-700">CYFSA Document Analyzer &amp; Parent Educator</p>
        <h2 className="mt-3 font-display text-3xl font-black text-slate-950">Understand the documents. Understand the allegations. Understand the process. Be prepared.</h2>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-700">Whether you're facing your first hearing, responding to new documents, preparing for another court date, or trying to understand where your case stands, the tool is designed to help you understand and organize the record as it develops.</p>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600">See the depth of the analysis without crowding the homepage: chronology, allegations, source attribution, supporting records, gaps, inconsistencies, legal references, procedural questions and questions to discuss with counsel.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/document-analyzer"><span className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-6 py-3 text-sm font-bold text-white">TRY OUR ANALYZER &amp; EDUCATOR <ArrowRight className="h-4 w-4" /></span></Link>
          <Link href="/pricing"><span className="inline-flex items-center gap-2 rounded-xl border border-brand-400 bg-white px-6 py-3 text-sm font-bold text-brand-900">VIEW MEMBERSHIP PLANS <Shield className="h-4 w-4" /></span></Link>
          <Link href="/analysis-example"><span className="inline-flex items-center gap-2 rounded-xl border border-brand-400 bg-white px-6 py-3 text-sm font-bold text-brand-900">SEE A COMPLETE ANALYSIS EXAMPLE <FileSearch className="h-4 w-4" /></span></Link>
          <Link href="/45-day-roadmap"><span className="inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-white px-6 py-3 text-sm font-bold text-brand-800">FOLLOW THE CASE ROADMAP <CalendarDays className="h-4 w-4" /></span></Link>
        </div>
      </div>
    </section>

    {/* WHAT THIS IS / ISN'T */}
    <section className="space-y-8 px-6 py-16 sm:px-10 md:py-20 bg-slate-50">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center font-display text-3xl font-bold text-slate-900">Straight answers about what this is</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-white p-6">
            <p className="font-display text-lg font-bold text-emerald-900">What it does</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li>Explains the CYFSA and your rights in plain language.</li>
              <li>Reads a document you upload and points out what it says, what it relies on, and what it leaves out.</li>
              <li>Gives you a list of questions to bring to your lawyer or duty counsel.</li>
            </ul>
          </div>
          <div className="rounded-xl border border-amber-200 bg-white p-6">
            <p className="font-display text-lg font-bold text-amber-900">What it does not do</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li>It does not give legal advice or tell you what to do in your case.</li>
              <li>It does not predict how a judge will decide, and it does not score your case.</li>
              <li>It can make mistakes. Always check its findings against the original document and with a lawyer.</li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    {/* PRIVACY */}
    <section className="space-y-8 px-6 py-16 sm:px-10 md:py-20 bg-white">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-center gap-3">
          <Lock className="h-6 w-6 text-brand-600" />
          <h2 className="font-display text-3xl font-bold text-slate-900">How your documents are handled</h2>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <p className="font-bold text-slate-900">Your progress saves on your device</p>
            <p className="mt-2 text-sm text-slate-600">Your analyzer progress and saved reports are kept in your own browser.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <p className="font-bold text-slate-900">AI analysis uses an outside service</p>
            <p className="mt-2 text-sm text-slate-600">To read a document, its text is sent to Google's Gemini AI. Do not upload anything you are not comfortable sending to an AI service.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <p className="font-bold text-slate-900">Protect names before you upload</p>
            <p className="mt-2 text-sm text-slate-600">Remove or cover names of children and other people where you can. Child protection files are confidential under the CYFSA.</p>
          </div>
        </div>
      </div>
    </section>

    {/* PROCESS */}
    <section className="space-y-8 px-6 py-16 sm:px-10 md:py-20 bg-slate-50">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center font-display text-3xl font-bold text-slate-900">How it works</h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {[
            ["1", "Learn your rights first", "Short guides on the CYFSA, the court process, and what CAS must show, so the paperwork makes sense."],
            ["2", "Upload a document", "Affidavits, CAS letters, notices, reports. The analyzer reads it and lists what it finds."],
            ["3", "Take questions to your lawyer", "Use the findings to prepare. Your lawyer decides what matters in your case."],
          ].map(([n, t, d]) => (
            <div key={n} className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-display font-bold text-lg">{n}</div>
              <p className="mt-4 font-display text-lg font-bold text-slate-900">{t}</p>
              <p className="mt-2 text-sm text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* WHAT WE CHECK FOR */}
    <section className="space-y-8 px-6 py-16 sm:px-10 md:py-20 bg-white">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center font-display text-3xl font-bold text-slate-900">What the analyzer looks at</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            ["🔗 Supporting documents", "Which statements have an attached document behind them, and which do not"],
            ["📄 Where information came from", "Whether the writer saw it directly or heard it from someone else"],
            ["⚖️ Inconsistencies", "Places where different parts of the same document do not line up"],
            ["❓ Unsupported statements", "Claims made without any document or detail to back them"],
            ["🔍 Procedure", "Questions about timing, notice, and how steps were taken"],
            ["📋 Legal references", "Whether a CYFSA section is cited for an action, so you can check it"],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="font-bold text-slate-900">{title}</p>
              <p className="mt-1 text-sm text-slate-600">{desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-slate-600">A gap in a document is a question to ask, not proof that anyone did something wrong.</p>
      </div>
    </section>

    {/* REAL HELP */}
    <section className="space-y-6 px-6 py-16 sm:px-10 md:py-20 bg-brand-50">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="font-display text-3xl font-bold text-slate-900">Need a lawyer?</h2>
        <p className="mt-4 text-base text-slate-700">If CAS has contacted you or there is a court date, speak to a lawyer as soon as you can. Legal Aid Ontario can tell you if you qualify for a certificate, and duty counsel is available at family court.</p>
        <a href="tel:18006688258" className="mt-6 inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-white px-5 py-3 text-sm font-bold text-brand-800 transition hover:bg-brand-100">
          <Phone className="h-4 w-4" /> Legal Aid Ontario: 1-800-668-8258
        </a>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/cyfsa-guide"><span className="inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-white px-5 py-2 text-sm font-bold text-brand-800 transition hover:bg-brand-100">CYFSA Guide <ArrowRight className="h-4 w-4" /></span></Link>
          <Link href="/45-day-roadmap"><span className="inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-white px-5 py-2 text-sm font-bold text-brand-800 transition hover:bg-brand-100">Case Roadmap <ArrowRight className="h-4 w-4" /></span></Link>
          <Link href="/lawyers"><span className="inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-white px-5 py-2 text-sm font-bold text-brand-800 transition hover:bg-brand-100">Find a lawyer <ArrowRight className="h-4 w-4" /></span></Link>
        </div>
      </div>
    </section>

    {/* FINAL CTA */}
    <section className="space-y-6 px-6 py-16 text-center sm:px-10 md:py-20 bg-gradient-to-br from-brand-600 to-brand-700">
      <div className="mx-auto max-w-3xl text-white">
        <h2 className="font-display text-3xl font-black md:text-4xl">Don't read your paperwork alone.</h2>
        <p className="mt-4 text-lg text-brand-100">Go into your next meeting with your lawyer knowing what your documents say and what to ask.</p>
        <Link href="/document-analyzer">
          <span className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-lg font-bold text-brand-700 transition hover:bg-slate-100">
            ANALYZE A DOCUMENT <ArrowRight className="h-6 w-6" />
          </span>
        </Link>
      </div>
    </section>

    {/* DISCLAIMER */}
    <section className="border-t border-slate-200 px-6 py-8 sm:px-10 bg-amber-50">
      <div className="mx-auto max-w-5xl rounded-lg border border-amber-200 bg-white p-4 text-sm leading-relaxed text-amber-950">
        <ShieldCheck className="mb-2 h-5 w-5 text-amber-700" />
        <strong>This is a preparation tool, not legal advice.</strong> It does not create a lawyer-client relationship. If there is an urgent removal, court date, or safety concern, contact a lawyer or Legal Aid Ontario right away.
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
