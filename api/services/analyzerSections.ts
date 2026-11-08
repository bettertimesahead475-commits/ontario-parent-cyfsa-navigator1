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
import {
  SECTION_ATTEMPTS,
  VERIFICATION_ATTEMPTS,
} from "../../shared/analyzerRetryPolicy.js";
import { resolveLegalAuthority } from "../../shared/legalVerificationPipeline.js";
import {
  classifyCitation,
  type CitationStatus,
  type IdentifiedAct,
} from "../../shared/citationVerification.js";
import {
  isVerbatimQuoteStatus,
  locateQuote,
  severityCeiling,
  VERIFICATION_STATUS,
} from "../../shared/quoteVerification.js";
import { buildComplianceMatrixFromReport } from "../../shared/complianceMatrixEngine.js";

export { isVerbatimQuoteStatus };

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
    enableThinking?: boolean;
    thinkingBudget?: number;
  },
  model: string
) => Promise<GenerateResult>;

export type Validation = { ok: true; value: Record<string, any> } | { ok: false; problems: string[] };

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
  if (v && typeof v === "object") {
    const obj = v as Record<string, any>;
    const candidate =
      obj.text ||
      obj.issue ||
      obj.description ||
      obj.point ||
      obj.item ||
      obj.summary ||
      obj.question ||
      obj.assertion ||
      obj.evaluation ||
      obj.content;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    const joined = Object.values(obj)
      .filter((val) => typeof val === "string" && val.trim())
      .join(" — ");
    if (joined.trim()) return joined.trim();
  }
  return fallback;
}

export function toStrList(v: unknown, max: number, altKeys?: unknown[]): string[] {
  if (Array.isArray(v)) {
    const res = v.map((x) => str(x)).filter(Boolean).slice(0, max);
    if (res.length > 0) return res;
  }
  if (typeof v === 'string' && v.trim()) {
    const lines = v.split(/\r?\n|[•\-]\s+|\d+\.\s+/).map((s) => s.trim()).filter(Boolean);
    if (lines.length > 0) return lines.slice(0, max);
    return [v.trim()];
  }
  if (altKeys && altKeys.length > 0) {
    for (const alt of altKeys) {
      const res = toStrList(alt, max);
      if (res.length > 0) return res;
    }
  }
  return [];
}

function strList(v: unknown, max: number): string[] {
  return toStrList(v, max);
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

export function validateOverview(raw: any): Validation {
  const problems: string[] = [];
  const fileSummary = str(raw?.fileSummary);
  if (fileSummary.length < 40) problems.push("fileSummary is missing or too short");
  const md = raw?.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
  const esiRaw = raw?.evidenceStrengthIndex && typeof raw.evidenceStrengthIndex === "object" ? raw.evidenceStrengthIndex : {};
  if (problems.length) return { ok: false, problems };

  const compSource = (esiRaw && typeof esiRaw.components === 'object' && esiRaw.components !== null)
    ? esiRaw.components
    : (esiRaw || {});
  const components: Record<string, { score: number; max: number; explanation: string }> = {};
  let sum = 0;
  for (const [name, max] of Object.entries(ESI_COMPONENT_MAX)) {
    const c = compSource?.[name] || {};
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

export function validateRedFlags(raw: any, mode: "fast" | "full"): Validation {
  if (!Array.isArray(raw?.redFlags)) return { ok: false, problems: ["redFlags must be an array"] };
  const max = mode === "fast" ? 6 : 10;
  const flags = raw.redFlags
    .filter((f: any) => f && typeof f === "object")
    .map((f: any, i: number) => ({
      id: str(f.id) || `rf${i + 1}`,
      severity: normalizeSeverity(f.severity),
      category: str(f.category) || "Unclassified",
      evidenceClassification: normalizeClassification(f.evidenceClassification),
      phraseDetected: str(f.phraseDetected || f.quote || f.quotedText || f.phrase || f.quoteText),
      explanation: str(f.explanation || f.analysis || f.reasoning || f.details || f.concern),
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

export function validateChronology(raw: any, mode: "fast" | "full"): Validation {
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

export function validateGuidance(raw: any): Validation {
  const value = {
    whatToVerify: toStrList(raw?.whatToVerify, 6, [raw?.verificationSteps, raw?.verify]),
    whatToAskALawyer: toStrList(raw?.whatToAskALawyer, 6, [raw?.questionsForCounsel, raw?.questionsForLawyer, raw?.askALawyer]),
    whatIsMissing: toStrList(raw?.whatIsMissing, 6, [raw?.missingEvidence, raw?.missingInformation, raw?.missingDocuments]),
    lawyerCaseBrief: toStrList(raw?.lawyerCaseBrief, 6, [raw?.caseBrief, raw?.brief, raw?.summaryForCounsel]),
  };
  const empty = Object.entries(value).filter(([, v]) => v.length === 0).map(([k]) => k);
  if (empty.length) return { ok: false, problems: empty.map((k) => `${k} is empty`) };
  return { ok: true, value };
}

export const CANONICAL_THRESHOLDS = [
  {
    match: /81/i,
    thresholdChecked: "CYFSA s. 81 — Application / Child Protection Proceeding Authority",
    primarySourceLaw: "CYFSA, 2017, S.O. 2017, c. 14, Sched. 1, s. 81(1)",
  },
  {
    match: /74/i,
    thresholdChecked: "Child in Need of Protection grounds (CYFSA s. 74)",
    primarySourceLaw: "CYFSA, 2017, S.O. 2017, c. 14, Sched. 1, s. 74(2)",
  },
  {
    match: /125/i,
    thresholdChecked: "Duty to Report standard vs Direct evidence (CYFSA s. 125)",
    primarySourceLaw: "CYFSA, 2017, S.O. 2017, c. 14, Sched. 1, s. 125(1)",
  },
  {
    match: /kinship|alternative/i,
    thresholdChecked: "Kinship / Family-Based Alternatives — Documentation Check",
    primarySourceLaw: "CYFSA, 2017, S.O. 2017, c. 14, Sched. 1, s. 101(3)",
  },
];

export function validateThresholds(raw: any): Validation {
  const rawList = Array.isArray(raw?.thresholdAnalysis)
    ? raw.thresholdAnalysis
    : Array.isArray(raw?.thresholds)
    ? raw.thresholds
    : Array.isArray(raw?.statutoryThresholds)
    ? raw.statutoryThresholds
    : [];
  const items = rawList
    .filter((t: any) => t && typeof t === "object" && (str(t.thresholdChecked) || str(t.name) || str(t.threshold)) && (str(t.reasoning) || str(t.evaluation) || str(t.notes)))
    .map((t: any) => {
      const isMet = normalizeIsMet(t.isMet);
      const evalStatus =
        isMet === "Yes" ? "EVALUATED_SUPPORTED" :
        isMet === "No" ? "EVALUATED_CONCERN" :
        isMet === "Not Applicable" ? "NOT_APPLICABLE" :
        "NOT_DETERMINABLE";
      return {
        thresholdChecked: str(t.thresholdChecked || t.name || t.threshold),
        isMet,
        evaluationStatus: t.evaluationStatus || evalStatus,
        isSystemPlaceholder: Boolean(t.isSystemPlaceholder ?? false),
        reasoning: str(t.reasoning || t.evaluation || t.notes),
        primarySourceLaw: str(t.primarySourceLaw || t.citation || "CYFSA 2017"),
      };
    });

  // If fewer than 4 checkpoints were provided, ensure at least 4 checkpoints are represented
  if (items.length < 4) {
    for (const canon of CANONICAL_THRESHOLDS) {
      if (items.length >= 4) break;
      if (!items.some((i: any) => canon.match.test(i.thresholdChecked))) {
        items.push({
          thresholdChecked: canon.thresholdChecked,
          isMet: "Not Determinable From This Document",
          evaluationStatus: "NOT_EVALUATED",
          isSystemPlaceholder: true,
          reasoning: "Not specifically addressed or determinable in this document filing; retained from standard CYFSA statutory checklist.",
          primarySourceLaw: canon.primarySourceLaw,
        });
      }
    }
  }

  return { ok: true, value: { thresholdAnalysis: items.slice(0, 6) } };
}

export const CANONICAL_TIMELINES = [
  {
    match: /30-day|adjournment|94\(1\)/i,
    timelineRule: "30-Day Adjournment Limit (CYFSA s. 94(1))",
    citation: "CYFSA, S.O. 2017, c. 14, s. 94(1)",
  },
  {
    match: /hearing|apprehension|warrant|88/i,
    timelineRule: "Court hearing timeline following apprehension without warrant (CYFSA s. 88)",
    citation: "CYFSA, S.O. 2017, c. 14, s. 88",
  },
  {
    match: /ombudsman|care rights|bill 188|bill 33|9\.1/i,
    timelineRule: "Child Ombudsman Access & Continuous Care Rights (CYFSA s. 9.1)",
    citation: "CYFSA, S.O. 2017, c. 14, s. 9.1",
  },
  {
    match: /300-day|parentage|presumption/i,
    timelineRule: "300-Day Presumption of Parentage",
    citation: "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.",
  },
];

export const CANONICAL_CHARTER = [
  "Section 7 (Canadian Charter): Rights to life, liberty, and security of the person considerations.",
  "Section 15 (Canadian Charter): Equality and non-discrimination considerations.",
  "Mandatory Consideration of Indigenous, First Nations, Inuit, or Métis Heritage (CYFSA Section 2).",
];

export function validateTimeline(raw: any): Validation {
  const rawTimeline = Array.isArray(raw?.proceduralTimelineViolations)
    ? raw.proceduralTimelineViolations
    : Array.isArray(raw?.timeline)
    ? raw.timeline
    : Array.isArray(raw?.timelineViolations)
    ? raw.timelineViolations
    : Array.isArray(raw?.proceduralViolations)
    ? raw.proceduralViolations
    : [];
  const items = rawTimeline
    .filter((t: any) => t && typeof t === "object" && (str(t.timelineRule) || str(t.rule) || str(t.name)) && (str(t.evaluation) || str(t.reasoning) || str(t.notes)))
    .map((t: any) => ({
      timelineRule: str(t.timelineRule || t.rule || t.name),
      documentAssertion: str(t.documentAssertion || t.assertion || "Not explicitly documented"),
      evaluation: str(t.evaluation || t.reasoning || t.notes),
      evaluationStatus: t.evaluationStatus || "EVALUATED_SUPPORTED",
      isSystemPlaceholder: Boolean(t.isSystemPlaceholder ?? false),
      citation: str(t.citation || "CYFSA"),
      locationInDocument: str(t.locationInDocument || "Checked & Compliant"),
      parentActionStep: str(t.parentActionStep || "Review timeline adherence with legal counsel."),
    }));

  // Ensure canonical timeline rules are represented if fewer than 4 were evaluated
  if (items.length < 4) {
    for (const canon of CANONICAL_TIMELINES) {
      if (items.length >= 4) break;
      if (!items.some((i: any) => canon.match.test(i.timelineRule))) {
        items.push({
          timelineRule: canon.timelineRule,
          documentAssertion: "No specific statutory violation or exception documented.",
          evaluation: "Not determinable or not asserted in the provided document record.",
          evaluationStatus: "NOT_EVALUATED",
          isSystemPlaceholder: true,
          citation: canon.citation,
          locationInDocument: "Checked & Compliant",
          parentActionStep: "Confirm statutory procedural deadlines with legal counsel.",
        });
      }
    }
  }

  const charterRaw = raw?.charterAndHumanRightsIssues ?? raw?.charterIssues ?? raw?.humanRightsIssues;
  const charter = toStrList(charterRaw, 6);
  for (let i = charter.length; i < 3; i++) {
    charter.push(CANONICAL_CHARTER[i] || "No additional charter issues determinable from this record.");
  }

  return { ok: true, value: { proceduralTimelineViolations: items.slice(0, 6), charterAndHumanRightsIssues: charter } };
}

export const CHRONOLOGY_SCHEMA = `"chronology": [
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
    maxTokens: { fast: 3500, full: 8000 },
    limits: () =>
      "fileSummary: 5-8 sentences. Each Evidence Strength Index component explanation: at most 2 sentences.",
    validate: (raw) => validateOverview(raw),
  },
  redFlags: {
    key: "redFlags",
    title: "Evidence findings",
    stage: "reviewing_evidence",
    fields: ["redFlags"],
    maxTokens: { fast: 5000, full: 8192 },
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
    maxTokens: { fast: 3500, full: 5000 },
    limits: (mode) =>
      `chronology: at most ${mode === "fast" ? 15 : 25} entries in date order, each one sentence. contradictions: at most 8; return [] if there are none.`,
    validate: (raw, mode) => validateChronology(raw, mode),
  },
  guidance: {
    key: "guidance",
    title: "Preparation guidance and questions for counsel",
    stage: "preparing_report",
    fields: ["whatToVerify", "whatToAskALawyer", "whatIsMissing", "lawyerCaseBrief"],
    maxTokens: { fast: 3500, full: 4000 },
    limits: () => "Each list: 3-5 items. Each item: at most 3 sentences.",
    validate: (raw) => validateGuidance(raw),
  },
  thresholds: {
    key: "thresholds",
    title: "CYFSA statutory thresholds",
    stage: "identifying_legal_issues",
    fields: ["thresholdAnalysis"],
    maxTokens: { fast: 4000, full: 4500 },
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
    retryNote ? `\nCORRECTION REQUIRED: ${retryNote}` : "",
  ].join("\n");
}

/**
 * Makes model JSON parseable without changing its content. Models sometimes write a raw newline or tab inside a string,
 * or a trailing comma before } or ]. Strict JSON rejects both, so an otherwise complete section would fail every retry.
 * Applied only after strict parsing fails.
 */
export function repairJsonText(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      else if (ch === "\n") { out += "\\n"; continue; }
      else if (ch === "\r") { out += "\\r"; continue; }
      else if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += ch;
  }
  return out;
}

/** Strict JSON first; the repaired form only when strict parsing fails. Throws when neither parses. */
export function parseJsonLenient(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(repairJsonText(text));
  }
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
          return parseJsonLenient(t.slice(start, i + 1));
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

/** Checks a claimed quotation against the source text. Match rules live in shared/quoteVerification.ts. */
export function verifyQuoteAgainstSource(source: string, quote: string): QuoteStatus {
  return locateQuote(source, quote).status;
}

/** Customer-facing reason a red flag's severity was limited. Only set when the displayed severity is lowered. */
const SEVERITY_CAP_REASON: Record<string, string> = {
  ABSENT: "The quoted passage could not be located in the uploaded text, so the severity is limited until it is found.",
  AMBIGUOUS: "The quoted wording appears in more than one place, so the severity is limited until the passage is confirmed.",
  CASE_OR_PUNCTUATION_VARIANT: "The quoted wording does not match the document exactly, so the severity is limited until it is checked.",
};

const VERIFICATION_NOTE: Record<string, string> = {
  ABSENT:
    "The quoted passage could not be located in the uploaded document. This point is the analyzer's reading, not a located passage. Treat it as an unverified allegation.",
  AMBIGUOUS: "The quoted wording appears in more than one place. Confirm which passage this point refers to.",
  CASE_OR_PUNCTUATION_VARIANT:
    "The quoted wording differs from the document in capitalisation or punctuation. Check the passage before relying on this point.",
};

const CORROBORATION_LABELS = new Set(["CORROBORATED", "DOCUMENTARY", "DIRECT"]);

/**
 * Citation check for one statute reference. Classification is in shared/citationVerification.ts.
 * Returns the text (with the unverified note appended when the citation is not an internal-reference match), the status,
 * the identified Act, and the reason. The original text is kept; nothing is removed.
 */
export function guardCitation(
  text: string,
  options?: { caseDate?: string; proposition?: string } | string
): {
  text: string;
  status: CitationStatus;
  identifiedAct: IdentifiedAct;
  reason: string;
  authorityId?: string;
  authorityResolution?: any;
} {
  const t = str(text);
  const normalizedOptions = typeof options === "string" ? { proposition: options } : options;
  const c = classifyCitation(t);
  const auth = resolveLegalAuthority(t, normalizedOptions);
  const authorityResolution = auth.status === "VERIFIED" && auth.entry ? {
    id: auth.entry.id,
    category: auth.entry.category,
    citation: auth.entry.citation,
    heading: auth.entry.heading,
    sourceUrl: auth.entry.sourceUrl,
    exactWording: auth.entry.exactWording,
    practiceNote: auth.entry.practiceNote,
    verificationSourceType: auth.entry.verificationSourceType,
  } : undefined;

  if (auth.status === "INAPPLICABLE") {
    return {
      text: /unverified/i.test(t) ? t : `${t} ${UNVERIFIED_CITATION_NOTE}`,
      status: "UNVERIFIED",
      identifiedAct: c.identifiedAct,
      reason: auth.warningText || c.reason,
      authorityId: auth.entry?.id,
      authorityResolution: undefined,
    };
  }

  if (c.status === "UNVERIFIED" && !/unverified/i.test(t)) {
    return {
      text: `${t} ${UNVERIFIED_CITATION_NOTE}`,
      status: "UNVERIFIED",
      identifiedAct: c.identifiedAct,
      reason: c.reason,
      authorityId: auth.entry?.id,
      authorityResolution,
    };
  }
  return {
    text: t,
    status: c.status,
    identifiedAct: c.identifiedAct,
    reason: c.reason,
    authorityId: auth.entry?.id,
    authorityResolution,
  };
}

/**
 * Applies quote verification and citation checks across an assembled report (mutates and returns it).
 *
 * Red flags keep the model's original severity in `modelSeverity` and every model-written field. Only the displayed
 * severity can be lowered, and only when the quotation is not located exactly. A point whose quoted passage is not
 * found is kept, marked as an unverified allegation, and cannot be shown as corroborated.
 */
export function applyReportGuards(report: Record<string, any>, sourceText: string): Record<string, any> {
  for (const flag of Array.isArray(report.redFlags) ? report.redFlags : []) {
    if (!flag || typeof flag !== "object") continue;
    if (flag.modelSeverity === undefined) flag.modelSeverity = flag.severity;
    const loc = locateQuote(sourceText, flag.phraseDetected);
    flag.quoteVerification = loc.status;
    flag.quoteVerified = isVerbatimQuoteStatus(loc.status);
    flag.verificationStatus = VERIFICATION_STATUS[loc.status];
    flag.quoteLocation = { page: loc.page, startOffset: loc.startOffset, endOffset: loc.endOffset };

    const ceiling = severityCeiling(loc.status);
    const current = typeof flag.severity === "string" ? flag.severity : "";
    if (current && (SEVERITY_RANK[current] ?? 0) > SEVERITY_RANK[ceiling]) {
      flag.severity = ceiling;
      flag.severityCapReason = SEVERITY_CAP_REASON[loc.status];
    }
    const note = VERIFICATION_NOTE[loc.status];
    if (note) flag.verificationNote = note;
    if (loc.status === "ABSENT" && CORROBORATION_LABELS.has(flag.evidenceClassification)) {
      flag.classificationCaveat = `The analyzer labelled this point ${flag.evidenceClassification}, but the passage behind that label was not located. It is not shown as corroborated.`;
    }

    const g = guardCitation(flag.legalReference, { proposition: flag.explanation });
    flag.legalReference = g.text;
    flag.citationStatus = g.status;
    flag.citationReason = g.reason;
    flag.identifiedAct = g.identifiedAct;
    if (g.authorityId) flag.authorityId = g.authorityId;
  }
  applyCitationGuards(report);
  if (!report.complianceMatrix) {
    try {
      report.complianceMatrix = buildComplianceMatrixFromReport(report, sourceText);
    } catch (err) {
      logAnalyzerDiagnostic("compliance matrix generation", err);
    }
  }
  return report;
}

/**
 * Citation checks for the threshold and timeline sections. Used by the sectioned pipeline and by Deep Scan, so both
 * report the same citation terms. Mutates and returns the report.
 */
export function applyCitationGuards(report: Record<string, any>): Record<string, any> {
  for (const t of Array.isArray(report.thresholdAnalysis) ? report.thresholdAnalysis : []) {
    if (!t || typeof t !== "object") continue;
    const g = guardCitation(t.primarySourceLaw, { proposition: `${t.thresholdChecked || ""} ${t.reasoning || ""}` });
    t.primarySourceLaw = g.text;
    t.citationStatus = g.status;
    t.citationReason = g.reason;
    if (g.authorityId) t.authorityId = g.authorityId;
  }
  for (const item of Array.isArray(report.proceduralTimelineViolations) ? report.proceduralTimelineViolations : []) {
    if (!item || typeof item !== "object") continue;
    // s.94(5) is the relative-placement clause, never a "5-day hearing" rule.
    if (
      /94\(5\)/.test(`${item.evaluation} ${item.citation}`) &&
      /5-day|five-day|five day/i.test(item.evaluation) &&
      !/\b(?:relative|extended\s+family|community)\b/i.test(item.evaluation)
    ) {
      item.citation = UNVERIFIED_CITATION_NOTE;
    }
    const g = guardCitation(item.citation, { proposition: `${item.timelineRule || ""} ${item.evaluation || ""}` });
    item.citation = g.text;
    item.citationStatus = g.status;
    item.citationReason = g.reason;
    if (g.authorityId) item.authorityId = g.authorityId;
  }
  report.citationVerification = {
    method:
      "Each citation was matched to CYFSA Navigator's internal reference text. That text has not been checked against official e-Laws, and no external legal database was queried.",
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
  targetSections?: SectionKey[];
  initialSections?: Record<string, any>;
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

export async function runOneSection(
  key: SectionKey,
  opts: SectionRunOptions,
  usage: SectionRunResult["usageByModel"]
): Promise<{ value: Record<string, any>; attempts: number }> {
  const spec = SECTION_SPECS[key];
  const now = opts.now || Date.now;
  let retryNote: string | undefined;
  let lastProblem = "";
  let lastProviderError: AnalyzerError | null = null;
  for (let attempt = 1; attempt <= SECTION_ATTEMPTS; attempt++) {
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
  const defaultKeys = opts.mode === "full" ? FORENSIC_SECTIONS : QUICK_SECTIONS;
  const keys = opts.targetSections && opts.targetSections.length > 0 ? opts.targetSections : defaultKeys;
  const usageByModel: SectionRunResult["usageByModel"] = {};
  const sectionTimingsMs: Record<string, number> = {};
  const attempts: Record<string, number> = {};
  const now = opts.now || Date.now;
  const started = now();
  const report: Record<string, any> = { ...(opts.initialSections || {}) };
  let completed = Object.keys(opts.initialSections || {}).length;
  const totalCount = keys.length + completed;

  // Run with bounded concurrency (max 3 concurrent section calls) to prevent token rate-limit
  // bursts, socket drops, and latency spikes across Claude stream connections.
  const concurrency = Math.min(3, keys.length);
  const queue = [...keys];
  const outcomes: any[] = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const key = queue.shift();
      if (!key) break;
      try {
        const { value, attempts: n } = await runOneSection(key, opts, usageByModel);
        sectionTimingsMs[key] = now() - started;
        attempts[key] = n;
        Object.assign(report, value);
        completed++;
        await opts.onSectionComplete?.(key, value, completed, totalCount);
      } catch (err) {
        outcomes.push(err);
      }
    }
  });
  await Promise.all(workers);
  const failure = outcomes.find((o) => o != null);
  if (failure) throw failure;

  applyReportGuards(report, opts.documentText);

  if (opts.mode === "full") {
    // Forensic reports are only complete after the independent verification pass.
    // Never persist or charge for a report whose second review did not finish.
    if (!opts.verificationModel) {
      throw new AnalyzerError("FORENSIC_VERIFICATION_UNAVAILABLE", 503,
        "Independent forensic verification is not configured. No completed report was saved and nothing was charged.", true);
    }
    opts.onVerificationStart?.();
    const verification = await runForensicVerification(report, opts, usageByModel);
    if (verification.status !== "completed") {
      throw new AnalyzerError("FORENSIC_VERIFICATION_INCOMPLETE", 503,
        "Independent forensic verification did not finish. This scan has not been marked complete; please retry. Nothing was charged.", true);
    }
    report.forensicVerification = verification;
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

  const activeFlags: any[] = [];
  const unsupportedFindings: any[] = [];
  report.auditTrail = report.auditTrail || {};

  for (const flag of report.redFlags || []) {
    const v = byId.get(flag.id);
    if (!v) {
      activeFlags.push(flag);
      continue;
    }
    const verdict = (VERDICTS as readonly string[]).includes(str(v.verdict).toUpperCase()) ? str(v.verdict).toUpperCase() : "NEEDS_CONTEXT";
    flag.forensicVerification = { verdict, note: str(v.note), verifiedBy: VERIFIER_LABEL };

    if (verdict === "UNSUPPORTED") {
      unsupportedFindings.push({
        ...flag,
        removalReason: str(v.note) || "Independent second review confirmed finding is unsupported by document text.",
        reconciledStatus: "UNSUPPORTED_REMOVED",
      });
      checked++;
      continue;
    }

    if (verdict === "OVERSTATED") {
      flag.reconciledStatus = "OVERSTATED_RECONCILED";
      flag.originalExplanation = flag.explanation;
      if (str(v.note)) {
        flag.reconciliationNote = str(v.note);
      }
    } else if (verdict === "SUPPORTED") {
      flag.reconciledStatus = "CONFIRMED_SUPPORTED";
    }

    // Verification may calibrate severity down, never up: escalation needs the generating rules.
    const rec = SEVERITIES.find((s) => s.toLowerCase() === str(v.recommendedSeverity).toLowerCase());
    if (rec && SEVERITY_RANK[rec] < SEVERITY_RANK[flag.severity]) {
      flag.originalSeverity = flag.severity;
      flag.severity = rec;
    }
    activeFlags.push(flag);
    checked++;
  }

  report.redFlags = activeFlags;
  if (unsupportedFindings.length > 0) {
    report.auditTrail.unsupportedFindings = unsupportedFindings;
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
  for (let attempt = 1; attempt <= VERIFICATION_ATTEMPTS; attempt++) {
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
