import React, { useEffect } from "react";
import { Link } from "wouter";
import { ArrowRight, BookOpen, CalendarDays, FileSearch, Heart, Scale, ShieldCheck, Users } from "lucide-react";
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
    <div className="space-y-3">
      {topics.map(topic => (
        <article key={topic.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {topic.badge && <span className="text-[11px] font-bold uppercase tracking-wide text-brand-600">{topic.badge}</span>}
          <h3 className="mt-1 font-display text-base font-bold text-slate-900">{topic.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{topic.summary}</p>
          <Link href="/cyfsa-guide">
            <span
              onClick={() => jumpToGuideTopic(topic.id)}
              className="mt-3 inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-brand-700"
            >
              Read the full statutory guide, with citations <ArrowRight className="h-3.5 w-3.5" />
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
      if (page === "rights") {
        title = "Understanding Your Family Rights";
        const topics = RIGHTS_TOPIC_IDS.map(id => CYFSA_TOPICS.find(t => t.id === id)).filter(Boolean) as typeof CYFSA_TOPICS;
        body = topics.map(t => `<div class="section-card"><div class="section-title">${t!.title}</div><p class="body-text">${t!.summary}</p></div>`).join("");
      } else if (page === "procedure") {
        title = "The Process and Legal Thresholds CAS Must Meet";
        const topics = PROCEDURE_TOPIC_IDS.map(id => CYFSA_TOPICS.find(t => t.id === id)).filter(Boolean) as typeof CYFSA_TOPICS;
        body = topics.map(t => `<div class="section-card"><div class="section-title">${t!.title}</div><p class="body-text">${t!.summary}</p></div>`).join("");
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

  if (page === "home") return <div className="space-y-10">
    <JourneyNav />
    <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-brand-950 to-brand-800 px-6 py-12 text-white shadow-xl sm:px-10 md:py-16">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-200">Ontario Parent Assist</p>
      <h1 className="mt-4 max-w-3xl font-display text-4xl font-black leading-tight md:text-6xl">A calmer place to understand the child protection process.</h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-200">Learn what to track, understand the stages ahead, audit documents for questions to raise with counsel, and build an organized, lawyer-ready case file.</p>
      <div className="mt-8 flex flex-wrap gap-3"><Link href="/rights"><span className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-brand-900">Begin with family rights <ArrowRight className="h-4 w-4" /></span></Link><Link href="/document-analyzer"><span className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-5 py-3 text-sm font-bold text-white">Audit a document <FileSearch className="h-4 w-4" /></span></Link></div>
    </section>
    <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {[
        [Heart, "1. Family rights", "Parent responsibilities, the child’s wellbeing, and preserving family connections.", "/rights"],
        [Scale, "2. CAS procedure", "What to document about concerns, evidence, emergency action, and alternatives.", "/cyfsa-procedure"],
        [CalendarDays, "3. First 5 days", "Track removal, service, court dates, and documents while preparing questions.", "/five-day-rule"],
        [FileSearch, "4. 45-day roadmap", "Analyze files, organize verified facts, and prepare a brief for counsel.", "/45-day-roadmap"],
      ].map(([Icon, title, body, path]: any) => <Link key={path} href={path}><article className="h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"><Icon className="h-6 w-6 text-brand-600" /><h2 className="mt-4 font-display text-lg font-bold text-slate-900">{title}</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p><span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-brand-700">Open <ArrowRight className="h-3.5 w-3.5" /></span></article></Link>)}
      </section>
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-950"><ShieldCheck className="mb-2 h-5 w-5 text-amber-700" /><strong>Use this as a preparation tool, not a replacement for legal advice.</strong> If there is an urgent removal, court date, or safety concern, contact a lawyer or Legal Aid Ontario promptly.</section>
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
