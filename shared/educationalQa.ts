/**
 * Deterministic educational questions and answers about a report.
 *
 * An answer is built only from: the report's own findings (with their source locations), the plain
 * glossary, and the statute quotations already in the report. If none of these answers a question, the
 * answer says so. No AI model is used, so nothing is invented, and no deadline is calculated.
 */
import type { ReportContract, ReportFinding } from "./reportContract";
import { buildSectionedReport } from "./reportSections";
import { GLOSSARY } from "./reportSectionLabels";
import { buildChronology } from "./courtPrep";

export type AnswerBasis = "YOUR_RECORDS" | "GLOSSARY" | "NOT_IN_YOUR_RECORDS";

export interface QaAnswer {
  basis: AnswerBasis;
  answer: string;
  /** Source locations the answer relies on. Empty when the answer is "not in your records". */
  sources: string[];
}

export const BASIS_LABEL: Record<AnswerBasis, string> = {
  YOUR_RECORDS: "From your records and this report",
  GLOSSARY: "Plain-language meaning (general information)",
  NOT_IN_YOUR_RECORDS: "Not answered by your records",
};

const NOT_ANSWERED =
  "This report does not answer that question. You can ask about: missing records, dates, court orders, your rights, where a point comes from, evidence types, or questions for counsel.";

const locs = (f: ReportFinding) => f.sources.map((s) => s.locator);
const bySection = (c: ReportContract, id: ReportFinding["sectionId"]) => c.findings.filter((f) => f.sectionId === id);

function listFindings(findings: ReportFinding[], empty: string): { text: string; sources: string[] } {
  if (findings.length === 0) return { text: empty, sources: [] };
  const text = findings.map((f) => `- ${f.title}: ${f.whatHappened || f.whyItMatters || "No detail given."}`).join("\n");
  return { text, sources: [...new Set(findings.flatMap(locs))] };
}

/** Finds the finding a question names, by a shared word of four or more letters. */
function findingNamed(c: ReportContract, question: string): ReportFinding | null {
  const words = (question.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w));
  let best: { f: ReportFinding; score: number } | null = null;
  for (const f of c.findings) {
    if (f.sources.length === 0) continue; // a point with no located source cannot be shown as "where"
    const hay = `${f.title} ${f.whatHappened} ${f.whyItMatters}`.toLowerCase();
    const score = words.filter((w) => hay.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { f, score };
  }
  return best?.f ?? null;
}

const STOP = new Set(["what", "does", "this", "that", "mean", "where", "which", "about", "with", "from", "have", "should", "would", "could", "report", "document", "your", "there", "these", "those", "page", "quote", "source"]);

type Handler = (q: string, c: ReportContract) => QaAnswer;

const INTENTS: { pattern: RegExp; handle: Handler }[] = [
  {
    pattern: /deadline|how long do i have|when must|due date|time limit/i,
    handle: (_q, c) => {
      const dates = buildChronology(c).filter((r) => r.dateAsWritten !== "Undated");
      const list = dates.length ? ` Dates written in your records: ${dates.map((d) => d.dateAsWritten).join("; ")}.` : "";
      return {
        basis: "YOUR_RECORDS",
        answer: `No deadline is calculated here. A deadline depends on a verified rule, the event that starts it, and the court calendar, and none of these is verified in this tool. Confirm any deadline with the court file or a lawyer.${list}`,
        sources: [...new Set(dates.flatMap((d) => d.source.map((s) => s.locator)))],
      };
    },
  },
  {
    pattern: /case law|precedent|court decision|other cases|previous cases|what have courts said/i,
    handle: (_q, c) => {
      const s10 = c.sections.find((s) => s.id === "S10");
      return {
        basis: "NOT_IN_YOUR_RECORDS",
        answer: `${s10?.note ?? "Case-law research has not been performed."} Nothing here says how any court has decided a similar issue.`,
        sources: [],
      };
    },
  },
  {
    pattern: /missing|not included|not uploaded|not provided|absent|what is not|no record/i,
    handle: (_q, c) => {
      const r = listFindings(bySection(c, "S08"), "Your report lists no missing records.");
      return {
        basis: "YOUR_RECORDS",
        answer: `These records are referred to or expected but are not in what was uploaded. Their absence is not proof that anything was not disclosed.\n${r.text}`,
        sources: r.sources,
      };
    },
  },
  {
    pattern: /right|statut|section|cyfsa|\bact\b|law (says|applies)|legal protection/i,
    handle: (_q, c) => {
      const rights = bySection(c, "S05").filter((f) => f.id.startsWith("R-"));
      if (rights.length === 0) {
        return { basis: "YOUR_RECORDS", answer: "No statutory provision was flagged for this report. Ask counsel which provisions apply to your situation.", sources: [] };
      }
      const text = rights
        .map((f) => `- ${f.title}. ${f.whatLawSays}. This is a candidate only: its conditions are not yet shown by your records.`)
        .join("\n");
      return { basis: "YOUR_RECORDS", answer: `These provisions may be relevant. Each is a candidate only. This is not a finding that it applies.\n${text}`, sources: rights.flatMap(locs) };
    },
  },
  {
    pattern: /court order|the order|endorse|judge said|what did the judge|judgment|judicial/i,
    handle: (_q, c) => {
      const r = listFindings(bySection(c, "S04"), "This document is not a court order or endorsement, so no court order is listed.");
      return {
        basis: "YOUR_RECORDS",
        answer: `A court order has legal effect unless it is changed or ends. This tool does not check whether a copy is genuine or current.\n${r.text}`,
        sources: r.sources,
      };
    },
  },
  {
    pattern: /lawyer|counsel|duty counsel|ask about|discuss|what should i ask|questions? for/i,
    handle: (_q, c) => {
      const r = listFindings(bySection(c, "S12"), "No questions for counsel were produced for this report.");
      return { basis: "YOUR_RECORDS", answer: `Questions to take to counsel:\n${r.text}`, sources: r.sources };
    },
  },
  {
    pattern: /hearsay|second[- ]hand|direct evidence|documentary|opinion|inference|unsupported|corroborat|admissib/i,
    handle: (q) => {
      const term = GLOSSARY.find((g) => q.toLowerCase().includes(g.term.toLowerCase().split(" ")[0]));
      const fallback = /admissib/i.test(q)
        ? { term: "Admissible", meaning: "Allowed to be considered by the court. Admissible does not mean reliable; the judge decides how much weight it gets." }
        : undefined;
      const g = term ?? fallback;
      if (!g) {
        return { basis: "GLOSSARY", answer: "The types are: direct evidence (a person says what they saw or did), documentary evidence (a record), corroborated evidence (supported by another record), hearsay (a person repeats what someone else said), inference (a conclusion drawn from facts), opinion (a view, not a fact), and unsupported (no record yet).", sources: [] };
      }
      return { basis: "GLOSSARY", answer: `${g.term}: ${g.meaning}`, sources: [] };
    },
  },
  {
    pattern: /where|which page|page|paragraph|quote|source|exact words/i,
    handle: (q, c) => {
      const f = findingNamed(c, q);
      if (!f) return { basis: "NOT_IN_YOUR_RECORDS", answer: "Name the point you mean, using a word from the report, and I will show where it appears.", sources: [] };
      const quoted = f.sources.map((s) => s.quote).filter((q) => q.trim().length > 0);
      return {
        basis: "YOUR_RECORDS",
        answer: `"${f.title}" appears at: ${locs(f).join("; ")}.${quoted.length ? ` Quoted text: ${quoted.map((q) => `"${q}"`).join(" ")}` : ""}`,
        sources: locs(f),
      };
    },
  },
  {
    pattern: /what does (this|the) (report|document)|summar|what happened|what is this/i,
    handle: (_q, c) => {
      const s1 = c.findings.find((f) => f.sectionId === "S01");
      return { basis: "YOUR_RECORDS", answer: s1?.whatHappened || "The report has no summary for this document.", sources: s1 ? locs(s1) : [] };
    },
  },
];

/** Answers one question. Returns "not answered" rather than guessing when the report does not cover it. */
export function answerQuestion(question: string, legacy: unknown): QaAnswer {
  const contract = buildSectionedReport(legacy);
  const q = question.trim();
  if (!q) return { basis: "NOT_IN_YOUR_RECORDS", answer: "Type a question to begin.", sources: [] };
  for (const intent of INTENTS) {
    if (intent.pattern.test(q)) return intent.handle(q, contract);
  }
  const named = findingNamed(contract, q);
  if (named) {
    return { basis: "YOUR_RECORDS", answer: `${named.title}: ${named.whatHappened || named.whyItMatters || "No detail given."}`, sources: locs(named) };
  }
  return { basis: "NOT_IN_YOUR_RECORDS", answer: NOT_ANSWERED, sources: [] };
}

export const SUGGESTED_QUESTIONS = [
  "What is missing from this report?",
  "Which court order is described here?",
  "What rights may be relevant?",
  "Where does the first point come from?",
  "What is hearsay?",
  "What should I ask my lawyer?",
  "What is the deadline?",
  "Are there any court decisions about this?",
];
