/**
 * Section-based analysis pipeline for the CYFSA Document Analyzer.
 *
 * Why sections: the analyzer used to ask Claude for the whole report as one JSON object. A long
 * document made that object long enough to hit max_tokens, the JSON was cut off mid-way, and the
 * whole (paid) analysis failed with "response incomplete" (production, 2026-10-10). Raising the
 * token limit only moves the cliff and makes every request slower.
 *
 * Now each part of the report is its own bounded request with its own output cap, item limits,
 * schema validation and at most one retry. Sections run concurrently, so wall-clock time is the
 * slowest section rather than the sum. Every section must validate before the report is
 * assembled; a section that still fails after its retry fails the analysis honestly rather than
 * shipping a report with silently missing parts.
 *
 * Forensic In-Depth adds statutory-threshold and timeline sections, then an independent
 * verification pass on a stronger model (Claude Opus) over the high-impact findings only.
 */

import { AnalyzerError, logAnalyzerDiagnostic } from "./analyzerErrors.js";
import { ANALYZER_SYSTEM_PROMPT, FIELD_SCHEMAS } from "./analyzerPrompts.js";
import type { AnalysisStage } from "./analyzerStreaming.js";
import { verifyQuote } from "./pageSources.js";
import { isParentAnalysisEnabled, PARENT_ATTRIBUTION_RULES, PARENT_ATTRIBUTION_SCHEMA } from "./parentAnalysisSchema.js";

export type SectionKey = "overview" | "redFlags" | "chronology" | "guidance" | "thresholds" | "timeline";

export interface GenerateResult {
  text: string;
  usage?: { input_tokens: number; output_tokens: number } | null;
  model: string;
  durationMs: number;
  stopReason?: string;
}

export type GenerateFn = (
  params: {
    system?: string;
    messages: any[];
    max_tokens?: number;
    timeoutMs?: number;
    retries?: number;
    requestId?: string;
    stage?: string;
    mode?: "fast" | "full";
  },
  model: string
) => Promise<GenerateResult>;

type Validation = { ok: true; value: Record<string, any> } | { ok: false; problems: string[] };

interface SectionSpec {
  key: SectionKey;
  title: string;
  stage: AnalysisStage;
  fields: string[];
  /** Output cap per mode. Item limits in `limits` keep normal output well below it. */
  maxTokens: { fast: number; full: number };
  limits: (mode: "fast" | "full") => string;
  extraSchema?: string;
  validate: (raw: any, mode: "fast" | "full") => Validation;
}

export const EVIDENCE_CLASSIFICATIONS = [
  "DIRECT",
  "DOCUMENTARY",
  "CORROBORATED",
  "HEARSAY",
  "INFERENCE",
  "OPINION",
  "UNSUPPORTED",
  "UNCLEAR",
] as const;

const SEVERITIES = ["Affects Evidentiary Weight", "Worth Raising With Counsel", "CRITICAL"] as const;
const SEVERITY_RANK: Record<string, number> = {
  "Affects Evidentiary Weight": 1,
  "Worth Raising With Counsel": 2,
  CRITICAL: 3,
};

export const CANONICAL_DISCLAIMER =
  "This document is generated for informational/educational purposes only. It does not constitute legal advice or representation. Please consult a lawyer licensed by the Law Society of Ontario, or contact Legal Aid Ontario, before relying on any conclusion in this report.";

export const UNVERIFIED_CITATION_NOTE =
  "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.";

const ESI_COMPONENT_MAX: Record<string, number> = {
  firsthandKnowledge: 20,
  sourceReliability: 15,
  corroboration: 15,
  documentarySupport: 15,
  internalConsistency: 10,
  contradictoryEvidenceHandling: 10,
  legalAuthorityVerification: 10,
  proceduralDocumentation: 5,
};

// ---------------------------------------------------------------------------
// Value coercion helpers (model output is untrusted input)
// ---------------------------------------------------------------------------

function str(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

function strList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter(Boolean).slice(0, max);
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalizeClassification(v: unknown): string {
  const up = str(v).toUpperCase();
  return (EVIDENCE_CLASSIFICATIONS as readonly string[]).includes(up) ? up : "UNCLEAR";
}

function normalizeSeverity(v: unknown): string {
  const s = str(v).replace(/^\[|\]$/g, "").trim();
  const match = SEVERITIES.find((x) => x.toLowerCase() === s.toLowerCase());
  return match || "Worth Raising With Counsel";
}

function normalizeIsMet(v: unknown): string {
  const s = str(v).toLowerCase();
  if (s.startsWith("yes")) return "Yes";
  if (s.startsWith("no") && !s.startsWith("not")) return "No";
  if (s.includes("not determinable")) return "Not Determinable From This Document";
  return "Inconclusive";
}

// ---------------------------------------------------------------------------
// Section specifications
// ---------------------------------------------------------------------------

function validateOverview(raw: any): Validation {
  const problems: string[] = [];
  const fileSummary = str(raw?.fileSummary);
  if (fileSummary.length < 40) problems.push("fileSummary is missing or too short");
  const md = raw?.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
  const esiRaw = raw?.evidenceStrengthIndex && typeof raw.evidenceStrengthIndex === "object" ? raw.evidenceStrengthIndex : null;
  if (!esiRaw || typeof esiRaw.components !== "object") problems.push("evidenceStrengthIndex.components is missing");
  if (problems.length) return { ok: false, problems };

  const components: Record<string, { score: number; max: number; explanation: string }> = {};
  let sum = 0;
  for (const [name, max] of Object.entries(ESI_COMPONENT_MAX)) {
    const c = esiRaw.components?.[name] || {};
    const score = clampInt(c.score, 0, max);
    sum += score;
    components[name] = { score, max, explanation: str(c.explanation) };
  }

  return {
    ok: true,
    value: {
      documentTitle: str(raw.documentTitle) || "Uploaded Document",
      documentType: str(raw.documentType) || "Unclassified document",
      metadata: {
        fileNumber: str(md.fileNumber),
        applicantName: str(md.applicantName),
        respondentName: str(md.respondentName),
        childNames: str(md.childNames),
        hearingDate: str(md.hearingDate),
      },
      // The disclaimer is fixed text; never trust a model-written variant of it.
      disclaimer: CANONICAL_DISCLAIMER,
      completenessScore: clampInt(raw.completenessScore, 0, 100),
      completenessScoreMethod: str(raw.completenessScoreMethod),
      evidenceStrengthIndex: {
        score: sum, // the published method: the score is the sum of the components, never invented
        scale: "0-100",
        label: "Evidence Strength Index",
        method: str(esiRaw.method) || "Calculated from the documented evidence in this file only.",
        components,
        calculation: "The final score equals the sum of the eight component scores.",
        limitations: str(esiRaw.limitations),
      },
      fileSummary,
    },
  };
}

function validateRedFlags(raw: any, mode: "fast" | "full"): Validation {
  if (!Array.isArray(raw?.redFlags)) return { ok: false, problems: ["redFlags must be an array"] };
  const max = mode === "fast" ? 6 : 10;
  const flags = raw.redFlags
    .filter((f: any) => f && typeof f === "object")
    .map((f: any, i: number) => ({
      id: str(f.id) || `rf${i + 1}`,
      severity: normalizeSeverity(f.severity),
      category: str(f.category) || "Unclassified",
      evidenceClassification: normalizeClassification(f.evidenceClassification),
      phraseDetected: str(f.phraseDetected),
      explanation: str(f.explanation),
      verifyRequirement: str(f.verifyRequirement),
      legalReference: str(f.legalReference),
      locationInDocument: str(f.locationInDocument),
      parentActionStep: str(f.parentActionStep),
    }))
    // A flag without its quote or explanation breaks Core Rule 1, so it is not shown.
    .filter((f: any) => f.phraseDetected && f.explanation)
    .slice(0, max);
  if (raw.redFlags.length > 0 && flags.length === 0) {
    return { ok: false, problems: ["every red flag was missing its exact quote (phraseDetected) or explanation"] };
  }
  // Rule: never more than one CRITICAL per document.
  let seenCritical = false;
  for (const f of flags) {
    if (f.severity === "CRITICAL") {
      if (seenCritical) f.severity = "Worth Raising With Counsel";
      seenCritical = true;
    }
  }
  return { ok: true, value: { redFlags: flags } };
}

function validateChronology(raw: any, mode: "fast" | "full"): Validation {
  if (!Array.isArray(raw?.chronology)) return { ok: false, problems: ["chronology must be an array"] };
  const chronology = raw.chronology
    .filter((e: any) => e && typeof e === "object" && str(e.event))
    .map((e: any) => ({
      date: str(e.date) || "Undated",
      event: str(e.event),
      locationInDocument: str(e.locationInDocument),
      evidenceClassification: normalizeClassification(e.evidenceClassification),
    }))
    .slice(0, mode === "fast" ? 15 : 25);
  const contradictions = Array.isArray(raw?.contradictions)
    ? raw.contradictions
        .filter((c: any) => c && typeof c === "object" && str(c.description))
        .map((c: any) => ({
          description: str(c.description),
          locations: strList(c.locations, 6),
          significance: str(c.significance),
        }))
        .slice(0, 8)
    : [];
  return { ok: true, value: { chronology, contradictions } };
}

function validateGuidance(raw: any): Validation {
  const value = {
    whatToVerify: strList(raw?.whatToVerify, 6),
    whatToAskALawyer: strList(raw?.whatToAskALawyer, 6),
    whatIsMissing: strList(raw?.whatIsMissing, 6),
    lawyerCaseBrief: strList(raw?.lawyerCaseBrief, 6),
  };
  const empty = Object.entries(value).filter(([, v]) => v.length === 0).map(([k]) => k);
  if (empty.length) return { ok: false, problems: empty.map((k) => `${k} is empty`) };
  return { ok: true, value };
}

function validateThresholds(raw: any): Validation {
  if (!Array.isArray(raw?.thresholdAnalysis)) return { ok: false, problems: ["thresholdAnalysis must be an array"] };
  const items = raw.thresholdAnalysis
    .filter((t: any) => t && typeof t === "object" && str(t.thresholdChecked) && str(t.reasoning))
    .map((t: any) => ({
      thresholdChecked: str(t.thresholdChecked),
      isMet: normalizeIsMet(t.isMet),
      reasoning: str(t.reasoning),
      primarySourceLaw: str(t.primarySourceLaw),
    }));
  if (items.length < 4) return { ok: false, problems: [`thresholdAnalysis has ${items.length} of the 4 required checkpoints`] };
  return { ok: true, value: { thresholdAnalysis: items } };
}

function validateTimeline(raw: any): Validation {
  if (!Array.isArray(raw?.proceduralTimelineViolations)) {
    return { ok: false, problems: ["proceduralTimelineViolations must be an array"] };
  }
  const items = raw.proceduralTimelineViolations
    .filter((t: any) => t && typeof t === "object" && str(t.timelineRule) && str(t.evaluation))
    .map((t: any) => ({
      timelineRule: str(t.timelineRule),
      documentAssertion: str(t.documentAssertion),
      evaluation: str(t.evaluation),
      citation: str(t.citation),
      locationInDocument: str(t.locationInDocument),
      parentActionStep: str(t.parentActionStep),
    }));
  const charter = strList(raw?.charterAndHumanRightsIssues, 6);
  const problems: string[] = [];
  if (items.length < 4) problems.push(`proceduralTimelineViolations has ${items.length} of the 4 required checkpoints`);
  if (charter.length < 3) problems.push(`charterAndHumanRightsIssues has ${charter.length} of the 3 required items`);
  if (problems.length) return { ok: false, problems };
  return { ok: true, value: { proceduralTimelineViolations: items, charterAndHumanRightsIssues: charter } };
}

const CHRONOLOGY_SCHEMA = `"chronology": [
  {
    "date": "Date exactly as written in the document (e.g. 'March 3, 2026'), or 'Undated' with the nearest sequence marker",
    "event": "One sentence describing what the document says happened. Attribute it (e.g. 'Worker states...') rather than presenting it as established fact.",
    "locationInDocument": "Page X, Paragraph Y",
    "evidenceClassification": "One of: DIRECT, DOCUMENTARY, CORROBORATED, HEARSAY, INFERENCE, OPINION, UNSUPPORTED, UNCLEAR"
  }
],
"contradictions": [
  {
    "description": "Two statements in THIS document that cannot both be accurate, described neutrally. Only include genuine internal inconsistencies.",
    "locations": ["Page X, Paragraph Y", "Page X, Paragraph Z"],
    "significance": "Why the inconsistency matters to evidentiary weight, and what record could resolve it."
  }
]`;

const SECTION_SPECS: Record<SectionKey, SectionSpec> = {
  overview: {
    key: "overview",
    title: "Document summary and Evidence Strength Index",
    stage: "reviewing_evidence",
    fields: [
      "documentTitle",
      "documentType",
      "metadata",
      "disclaimer",
      "completenessScore",
      "completenessScoreMethod",
      "evidenceStrengthIndex",
      "fileSummary",
    ],
    maxTokens: { fast: 3500, full: 4000 },
    limits: () =>
      "fileSummary: 5-8 sentences. Each Evidence Strength Index component explanation: at most 2 sentences.",
    validate: (raw) => validateOverview(raw),
  },
  redFlags: {
    key: "redFlags",
    title: "Evidence findings",
    stage: "reviewing_evidence",
    fields: ["redFlags"],
    maxTokens: { fast: 5000, full: 7000 },
    limits: (mode) =>
      `At most ${mode === "fast" ? 6 : 10} red flags - choose the most significant. Each explanation: 3-5 sentences. ` +
      "phraseDetected must be copied verbatim from the document (an exact, contiguous passage); never paraphrase inside it. " +
      "If the document contains no red flags, return an empty array.",
    validate: (raw, mode) => validateRedFlags(raw, mode),
  },
  chronology: {
    key: "chronology",
    title: "Chronology and contradictions",
    stage: "building_chronology",
    fields: [],
    extraSchema: CHRONOLOGY_SCHEMA,
    maxTokens: { fast: 3500, full: 4500 },
    limits: (mode) =>
      `chronology: at most ${mode === "fast" ? 15 : 25} entries in date order, each one sentence. contradictions: at most 8; return [] if there are none.`,
    validate: (raw, mode) => validateChronology(raw, mode),
  },
  guidance: {
    key: "guidance",
    title: "Preparation guidance and questions for counsel",
    stage: "preparing_report",
    fields: ["whatToVerify", "whatToAskALawyer", "whatIsMissing", "lawyerCaseBrief"],
    maxTokens: { fast: 3500, full: 4500 },
    limits: () => "Each list: 3-5 items. Each item: at most 3 sentences.",
    validate: (raw) => validateGuidance(raw),
  },
  thresholds: {
    key: "thresholds",
    title: "CYFSA statutory thresholds",
    stage: "identifying_legal_issues",
    fields: ["thresholdAnalysis"],
    maxTokens: { fast: 4000, full: 4000 },
    limits: () => "Exactly the 4 checkpoints listed, in that order. Each reasoning: 3-5 sentences.",
    validate: (raw) => validateThresholds(raw),
  },
  timeline: {
    key: "timeline",
    title: "Procedural timelines and Charter issues",
    stage: "identifying_legal_issues",
    fields: ["proceduralTimelineViolations", "charterAndHumanRightsIssues"],
    maxTokens: { fast: 5000, full: 5000 },
    limits: () =>
      "proceduralTimelineViolations: exactly the 4 checkpoints listed, each evaluation 2-3 sentences. charterAndHumanRightsIssues: exactly 3 items, each 2-3 sentences.",
    validate: (raw) => validateTimeline(raw),
  },
};

export const QUICK_SECTIONS: SectionKey[] = ["overview", "redFlags", "chronology", "guidance"];
export const FORENSIC_SECTIONS: SectionKey[] = ["overview", "redFlags", "chronology", "guidance", "thresholds", "timeline"];

export function sectionTitle(key: string): string {
  return (SECTION_SPECS as Record<string, SectionSpec>)[key]?.title || key;
}

// ---------------------------------------------------------------------------
// Prompt construction and parsing
// ---------------------------------------------------------------------------

export function buildSectionPrompt(key: SectionKey, mode: "fast" | "full", documentText: string, retryNote?: string): string {
  const spec = SECTION_SPECS[key];
  const schemaParts = spec.fields.map((f) => FIELD_SCHEMAS[f]).filter(Boolean);
  if (spec.extraSchema) schemaParts.push(spec.extraSchema);
  // Parent attribution rides on the overview call. With the flag OFF this function returns the same text as before.
  const parentOn = key === "overview" && isParentAnalysisEnabled();
  if (parentOn) schemaParts.push(PARENT_ATTRIBUTION_SCHEMA);
  return [
    "<document>",
    "DOCUMENT TEXT CONTENT:",
    documentText,
    "</document>",
    "",
    `TASK: Produce ONLY the "${spec.title}" section of an educational CYFSA evidence audit of the document above. ` +
      "Other sections of the report are produced separately, so include only the keys shown below.",
    "",
    "Return exactly one JSON object - no markdown fences, no commentary before or after it - with these keys. " +
      "The text inside each value describes what to write; replace it with your analysis of this document:",
    "{",
    schemaParts.join(",\n"),
    "}",
    "",
    `LIMITS: ${spec.limits(mode)}`,
    "Every direct quotation must be copied verbatim from the document. Never present your own interpretation as a quotation.",
    ...(parentOn ? [PARENT_ATTRIBUTION_RULES] : []),
    retryNote ? `\nCORRECTION REQUIRED: ${retryNote}` : "",
  ].join("\n");
}

/** Extracts the first complete JSON object from model text. Returns null when there is none. */
export function parseJsonObject(text: string): any | null {
  if (!text) return null;
  let t = text.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(t.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null; // unbalanced: the object was cut off
}

// ---------------------------------------------------------------------------
// Deterministic post-generation guards
// ---------------------------------------------------------------------------

export type QuoteStatus = string;

function normalizeForQuote(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Checks a claimed quotation against the source text. Only EXACT/NORMALIZED_WHITESPACE count as verbatim. */
export function verifyQuoteAgainstSource(source: string, quote: string): QuoteStatus {
  const q = (quote || "").trim().replace(/^["'“‘]+|["'”’]+$/g, "").trim();
  if (!q || !source) return "ABSENT";
  // The app-wide verifier first (EXACT / NORMALIZED_WHITESPACE / AMBIGUOUS = present more than
  // once), then a punctuation-normalized fallback for curly quotes and dashes that OCR or the
  // model may have straightened.
  const status = verifyQuote(source, q).status;
  if (status === "EXACT" || status === "NORMALIZED_WHITESPACE" || status === "AMBIGUOUS") return status;
  if (normalizeForQuote(source).includes(normalizeForQuote(q))) return "NORMALIZED_PUNCTUATION";
  return "ABSENT";
}

export function isVerbatimQuoteStatus(status: string): boolean {
  return ["EXACT", "NORMALIZED_WHITESPACE", "AMBIGUOUS", "NORMALIZED_PUNCTUATION"].includes(status);
}

/**
 * Provisions whose text the app has compared against the bundled CYFSA text (src/utils/statuteReference.ts).
 * Only these may be labelled CONFIRMED_REFERENCE. A section number alone is not a check: 94(5) and 125(1)
 * exist in the bundled text but have no compared entry here, so they stay UNVERIFIED. This must mirror
 * the keys of BUNDLED_STATUTE_ENTRIES; a test enforces that. This is a local reference list, not an
 * external legal database lookup, and the report says so.
 */
export const CONFIRMED_SECTION_KEYS = ["74(2)", "81(7)", "88", "94(1)", "94(2)"] as const;
const CONFIRMED_SECTION_PATTERNS = CONFIRMED_SECTION_KEYS.map((key) => new RegExp(`^${key.replace(/[()]/g, "\\$&")}$`));

/**
 * Every section number a citation names, including lists such as "ss. 74(2) and 125(1)" or
 * "s. 74(2), 94(5)". Only numbers introduced by a section keyword count, so "S.O. 2017, c. 14" adds nothing.
 */
function citedSections(text: string): string[] {
  const out: string[] = [];
  // Keyword, then a list of items: "74(2)" or a bare subsection "(5)" continuing the previous section.
  const list = /\b(?:s|ss|sec|secs|section|sections|subs?|subsections?)\.?\s*((?:(?:\d{1,3}(?:\(\d+\))*|\(\d+\))(?:\([a-z]\))*(?:\s*(?:,|and|or|&|to|-|–)\s*)?)+)/gi;
  for (const m of text.matchAll(list)) {
    let base = "";
    for (const item of m[1].matchAll(/(\d{1,3})((?:\(\d+\))*)|\((\d+)\)/g)) {
      if (item[1]) {
        base = item[1];
        out.push(item[1] + item[2]);
      } else if (base) {
        out.push(`${base}(${item[3]})`);
      }
    }
  }
  return out;
}

/** Returns the citation text, with the unverified note appended when it names an unconfirmed section. */
export function guardCitation(text: string): { text: string; status: "CONFIRMED_REFERENCE" | "UNVERIFIED" | "NONE" } {
  const t = str(text);
  if (!t) return { text: t, status: "NONE" };
  if (/unverified/i.test(t)) return { text: t, status: "UNVERIFIED" };
  const sections = citedSections(t);
  const clra = /\bCLRA\b|Children's Law Reform Act/i.test(t);
  // A regulation's subsection can share a number with a CYFSA section, so a citation naming one is never confirmed.
  const otherInstrument = /\bregulations?\b|\breg\b/i.test(t);
  const unconfirmed = clra || otherInstrument || sections.some((s) => !CONFIRMED_SECTION_PATTERNS.some((p) => p.test(s)));
  if (unconfirmed) return { text: `${t} ${UNVERIFIED_CITATION_NOTE}`, status: "UNVERIFIED" };
  return { text: t, status: sections.length ? "CONFIRMED_REFERENCE" : "NONE" };
}

/** Applies quote verification and citation guards across an assembled report (mutates and returns it). */
export function applyReportGuards(report: Record<string, any>, sourceText: string): Record<string, any> {
  for (const flag of Array.isArray(report.redFlags) ? report.redFlags : []) {
    const status = verifyQuoteAgainstSource(sourceText, flag.phraseDetected);
    flag.quoteVerification = status;
    flag.quoteVerified = isVerbatimQuoteStatus(status);
    const g = guardCitation(flag.legalReference);
    flag.legalReference = g.text;
    flag.citationStatus = g.status;
  }
  for (const t of Array.isArray(report.thresholdAnalysis) ? report.thresholdAnalysis : []) {
    const g = guardCitation(t.primarySourceLaw);
    t.primarySourceLaw = g.text;
    t.citationStatus = g.status;
  }
  for (const item of Array.isArray(report.proceduralTimelineViolations) ? report.proceduralTimelineViolations : []) {
    // s.94(5) is the relative-placement clause, never a "5-day hearing" rule.
    if (/94\(5\)/.test(`${item.evaluation} ${item.citation}`) && /5-day|five-day|five day/i.test(item.evaluation)) {
      item.citation = UNVERIFIED_CITATION_NOTE;
    }
    const g = guardCitation(item.citation);
    item.citation = g.text;
    item.citationStatus = g.status;
  }
  report.citationVerification = {
    method: "Checked against CYFSA Navigator's confirmed statute reference list. No external legal database was queried.",
  };
  return report;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface SectionRunOptions {
  mode: "fast" | "full";
  documentText: string;
  primaryModel: string;
  verificationModel?: string;
  generate: GenerateFn;
  /** Absolute epoch-ms deadline for all AI work; every attempt's timeout is clamped to it. */
  deadlineAt: number;
  requestId: string;
  onSectionComplete?: (key: SectionKey, value: Record<string, any>, completed: number, total: number) => Promise<void> | void;
  onVerificationStart?: () => void;
  now?: () => number;
}

export interface SectionRunResult {
  report: Record<string, any>;
  usageByModel: Record<string, { input_tokens: number; output_tokens: number }>;
  sectionTimingsMs: Record<string, number>;
  attempts: Record<string, number>;
}

const SECTION_TIMEOUT_MS = { fast: 75_000, full: 110_000 };
const MIN_RETRY_BUDGET_MS = 25_000;

function addUsage(acc: SectionRunResult["usageByModel"], model: string, usage?: GenerateResult["usage"]) {
  if (!usage) return;
  const cur = acc[model] || { input_tokens: 0, output_tokens: 0 };
  cur.input_tokens += usage.input_tokens || 0;
  cur.output_tokens += usage.output_tokens || 0;
  acc[model] = cur;
}

async function runOneSection(
  key: SectionKey,
  opts: SectionRunOptions,
  usage: SectionRunResult["usageByModel"]
): Promise<{ value: Record<string, any>; attempts: number }> {
  const spec = SECTION_SPECS[key];
  const now = opts.now || Date.now;
  let retryNote: string | undefined;
  let lastProblem = "";
  let lastProviderError: AnalyzerError | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remaining = opts.deadlineAt - now();
    if (attempt > 1 && remaining < MIN_RETRY_BUDGET_MS) break;
    if (remaining < 5_000) break;
    const timeoutMs = Math.min(SECTION_TIMEOUT_MS[opts.mode], remaining - 3_000);
    let result: GenerateResult;
    try {
      result = await opts.generate(
        {
          system: ANALYZER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: [{ type: "text", text: buildSectionPrompt(key, opts.mode, opts.documentText, retryNote) }] }],
          max_tokens: spec.maxTokens[opts.mode],
          timeoutMs,
          retries: 1, // retries are handled here, inside the deadline, not stacked in the client
          requestId: opts.requestId,
          stage: `section:${key}`,
          mode: opts.mode,
        },
        opts.primaryModel
      );
    } catch (err: any) {
      // Permanent provider failures (bad key, invalid model, rejected request) are never retried.
      if (err instanceof AnalyzerError && !err.retryable) throw err;
      lastProviderError = err instanceof AnalyzerError ? err : null;
      // The raw provider message is logged (redacted) and never placed in customer text.
      logAnalyzerDiagnostic(`section ${key} attempt ${attempt}`, err);
      lastProblem = "the AI service did not return a usable response";
      if (attempt === 1) await new Promise((r) => setTimeout(r, 750 + Math.floor(Math.random() * 500)));
      continue;
    }
    addUsage(usage, opts.primaryModel, result.usage);
    lastProviderError = null;

    if (result.stopReason === "max_tokens") {
      lastProblem = "the response was incomplete - it hit its length limit before finishing";
      retryNote =
        "Your previous answer was cut off because it was too long. Stay strictly within the LIMITS: fewer items and shorter sentences.";
      continue;
    }
    const parsed = parseJsonObject(result.text);
    if (!parsed) {
      lastProblem = "the response was not a valid JSON object";
      retryNote = "Your previous answer was not one valid JSON object. Return only the JSON object, with no other text.";
      continue;
    }
    const checked = spec.validate(parsed, opts.mode);
    if (checked.ok === true) return { value: checked.value, attempts: attempt };
    lastProblem = (checked as { ok: false; problems: string[] }).problems.join("; ");
    retryNote = `Your previous answer failed validation: ${lastProblem}. Fix these problems and return the complete section.`;
  }
  // A provider failure (rate limit, outage, timeout) keeps its own classification so the parent
  // sees the real reason; only content that never validated is reported as an invalid response.
  if (lastProviderError) throw lastProviderError;
  throw new AnalyzerError(
    "AI_RESPONSE_INVALID",
    422,
    `Part of the analysis ("${spec.title}") could not be completed reliably (${lastProblem || "time limit reached"}). ` +
      "Your document is safe and no partial report was saved as complete. Please retry.",
    true
  );
}

export async function runSectionedAnalysis(opts: SectionRunOptions): Promise<SectionRunResult> {
  const keys = opts.mode === "full" ? FORENSIC_SECTIONS : QUICK_SECTIONS;
  const usageByModel: SectionRunResult["usageByModel"] = {};
  const sectionTimingsMs: Record<string, number> = {};
  const attempts: Record<string, number> = {};
  const now = opts.now || Date.now;
  const started = now();
  let completed = 0;
  const report: Record<string, any> = {};

  // allSettled-style: wait for every section so a failure never leaves requests running unobserved.
  const outcomes = await Promise.all(
    keys.map(async (key) => {
      try {
        const { value, attempts: n } = await runOneSection(key, opts, usageByModel);
        sectionTimingsMs[key] = now() - started;
        attempts[key] = n;
        Object.assign(report, value);
        completed++;
        await opts.onSectionComplete?.(key, value, completed, keys.length);
        return null;
      } catch (err) {
        return err;
      }
    })
  );
  const failure = outcomes.find((o) => o !== null);
  if (failure) throw failure;

  applyReportGuards(report, opts.documentText);

  if (opts.mode === "full" && opts.verificationModel) {
    opts.onVerificationStart?.();
    report.forensicVerification = await runForensicVerification(report, opts, usageByModel);
  }

  return { report, usageByModel, sectionTimingsMs, attempts };
}

// ---------------------------------------------------------------------------
// Forensic verification (independent second model over high-impact findings)
// ---------------------------------------------------------------------------

const VERDICTS = ["SUPPORTED", "OVERSTATED", "UNSUPPORTED", "MISQUOTED", "NEEDS_CONTEXT"] as const;

export function buildVerificationPrompt(report: Record<string, any>, documentText: string): string {
  const findings = (report.redFlags || []).map((f: any) => ({
    id: f.id,
    severity: f.severity,
    category: f.category,
    evidenceClassification: f.evidenceClassification,
    quotedText: f.phraseDetected,
    quoteFoundVerbatim: f.quoteVerified === true,
    explanation: f.explanation,
    legalReference: f.legalReference,
  }));
  const thresholds = (report.thresholdAnalysis || []).map((t: any) => ({
    thresholdChecked: t.thresholdChecked,
    isMet: t.isMet,
    reasoning: t.reasoning,
  }));
  return [
    "<document>",
    documentText,
    "</document>",
    "",
    "You are the independent verification reviewer for an educational CYFSA evidence audit of the document above. " +
      "Another model produced the findings below. Check each one against the document itself, not against the other model's reasoning.",
    "",
    "<findings>",
    JSON.stringify({ redFlags: findings, thresholdAnalysis: thresholds }, null, 1),
    "</findings>",
    "",
    "For every finding decide: SUPPORTED (the document supports it as stated), OVERSTATED (real issue, but the severity or " +
      "certainty goes beyond what the document shows), UNSUPPORTED (the document does not support it), MISQUOTED (the quoted " +
      "text is not in the document or is taken out of context), or NEEDS_CONTEXT (cannot be judged without records not in this document). " +
      "Flag unsupported factual conclusions, mischaracterized quotations, statutory references stated with more confidence than the " +
      "verified reference allows, and overconfident legal assertions. Do not add new findings.",
    "",
    "Return exactly one JSON object, no other text:",
    "{",
    '  "findings": [{"id": "rf1", "verdict": "SUPPORTED|OVERSTATED|UNSUPPORTED|MISQUOTED|NEEDS_CONTEXT", "recommendedSeverity": "Affects Evidentiary Weight|Worth Raising With Counsel|CRITICAL", "note": "1-2 sentences citing the passage that decides it"}],',
    '  "thresholds": [{"thresholdChecked": "exact name from the input", "verdict": "SUPPORTED|OVERSTATED|UNSUPPORTED|NEEDS_CONTEXT", "note": "1-2 sentences"}],',
    '  "overallAssessment": "2-4 sentences on how reliable the findings are overall"',
    "}",
  ].join("\n");
}

export function mergeVerification(report: Record<string, any>, parsed: any, model: string): number {
  let checked = 0;
  const byId = new Map<string, any>();
  for (const v of Array.isArray(parsed?.findings) ? parsed.findings : []) {
    if (v && typeof v === "object" && str(v.id)) byId.set(str(v.id), v);
  }
  for (const flag of report.redFlags || []) {
    const v = byId.get(flag.id);
    if (!v) continue;
    const verdict = (VERDICTS as readonly string[]).includes(str(v.verdict).toUpperCase()) ? str(v.verdict).toUpperCase() : "NEEDS_CONTEXT";
    flag.forensicVerification = { verdict, note: str(v.note), verifiedBy: VERIFIER_LABEL };
    // Verification may calibrate severity down, never up: escalation needs the generating rules.
    const rec = SEVERITIES.find((s) => s.toLowerCase() === str(v.recommendedSeverity).toLowerCase());
    if (rec && SEVERITY_RANK[rec] < SEVERITY_RANK[flag.severity]) {
      flag.originalSeverity = flag.severity;
      flag.severity = rec;
    }
    checked++;
  }
  const thresholdVerdicts = new Map<string, any>();
  for (const v of Array.isArray(parsed?.thresholds) ? parsed.thresholds : []) {
    if (v && typeof v === "object") thresholdVerdicts.set(str(v.thresholdChecked).toLowerCase(), v);
  }
  for (const t of report.thresholdAnalysis || []) {
    const v = thresholdVerdicts.get(str(t.thresholdChecked).toLowerCase());
    if (!v) continue;
    const verdict = (VERDICTS as readonly string[]).includes(str(v.verdict).toUpperCase()) ? str(v.verdict).toUpperCase() : "NEEDS_CONTEXT";
    t.forensicVerification = { verdict, note: str(v.note), verifiedBy: VERIFIER_LABEL };
    checked++;
  }
  return checked;
}

// Customer-facing label for the second review. Provider model identifiers are never sent to customers.
const VERIFIER_LABEL = "Independent second review";

async function runForensicVerification(
  report: Record<string, any>,
  opts: SectionRunOptions,
  usage: SectionRunResult["usageByModel"]
): Promise<Record<string, any>> {
  const model = opts.verificationModel as string;
  const now = opts.now || Date.now;
  const started = now();
  const findingCount = (report.redFlags || []).length + (report.thresholdAnalysis || []).length;
  if (findingCount === 0) {
    return { status: "completed", checkedFindings: 0, overallAssessment: "There were no findings to verify.", durationMs: 0 };
  }
  let reason = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remaining = opts.deadlineAt - now();
    if (remaining < (attempt === 1 ? 30_000 : MIN_RETRY_BUDGET_MS)) {
      reason = reason || "not enough time remained within the analysis time limit";
      break;
    }
    try {
      const result = await opts.generate(
        {
          system: ANALYZER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: [{ type: "text", text: buildVerificationPrompt(report, opts.documentText) }] }],
          max_tokens: 4000,
          timeoutMs: Math.min(90_000, remaining - 3_000),
          retries: 1,
          requestId: opts.requestId,
          stage: "forensic_verification",
          mode: "full",
        },
        model
      );
      addUsage(usage, model, result.usage);
      const parsed = result.stopReason === "max_tokens" ? null : parseJsonObject(result.text);
      if (!parsed) {
        reason = "the verification response was incomplete";
        continue;
      }
      const checked = mergeVerification(report, parsed, model);
      return {
        status: "completed",
        checkedFindings: checked,
        totalFindings: findingCount,
        overallAssessment: str(parsed.overallAssessment),
        durationMs: now() - started,
      };
    } catch (err: any) {
      if (err instanceof AnalyzerError && !err.retryable) {
        reason = err.userMessage;
        break;
      }
      // The raw provider message is logged (redacted) and never placed in customer text.
      logAnalyzerDiagnostic("forensic verification", err);
      reason = "the verification request could not be completed";
    }
  }
  // Verification is an added check on findings that already passed validation; when it cannot run,
  // the report says so plainly instead of implying the findings were verified.
  return {
    status: "incomplete",
    checkedFindings: 0,
    totalFindings: findingCount,
    reason: `Independent verification could not be completed: ${reason}. The findings below have not been second-reviewed.`,
    durationMs: now() - started,
  };
}
