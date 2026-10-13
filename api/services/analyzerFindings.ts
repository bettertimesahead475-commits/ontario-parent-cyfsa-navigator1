/**
 * Structured, evidence-grounded findings for the report's four legal tabs:
 * Charter issues, verification checks, missing elements, questions for counsel.
 *
 * Division of labour (this is the whole safety model):
 *   The model writes analysis: plain-language explanations, why it matters, how a test applies.
 *   The SERVER owns everything checkable:
 *     - evidence quotations are checked against the source text word for word;
 *     - authorities are chosen by registry key and turned into citations, wording and links from
 *       api/services/legalAuthorityRegistry.ts, never from model text;
 *     - authority status (VERIFIED / CANDIDATE / UNVERIFIED) comes from recorded retrieval checks;
 *     - ids, section/result enums and links between findings are assigned and validated here;
 *     - any result that depends on a quotation being real is downgraded when it is not.
 *
 * Generation is additive and soft-failing: the report's existing arrays (whatToVerify, etc.) are
 * still produced by the section pipeline. If a section here cannot be generated, the report says so
 * and the tab falls back to those arrays; it never invents content to fill a tab.
 */

import { ANALYZER_SYSTEM_PROMPT } from "./analyzerPrompts.js";
import { AnalyzerError } from "./analyzerErrors.js";
import { parseJsonObject, verifyQuoteAgainstSource, isVerbatimQuoteStatus, type GenerateFn, type GenerateResult } from "./analyzerSections.js";
import {
  LEGAL_AUTHORITY_REGISTRY,
  REGISTRY_VERSION,
  getRegistryEntry,
  referenceFromKey,
  unverifiedReference,
  matchRegistryByCitation,
  registryPromptList,
  authorityFitsCharterSection,
} from "./legalAuthorityRegistry.js";
import { LEGAL_AUTHORITY_VERIFICATION } from "./legalAuthorityVerification.js";
import {
  CHARTER_SECTIONS,
  VERIFICATION_RESULTS,
  firstSentence,
  type AbsenceStatus,
  type CharterAssessment,
  type CharterFinding,
  type CharterSection,
  type EvidenceRef,
  type FindingBase,
  type FindingSectionKey,
  type FindingSectionState,
  type InteractiveFindings,
  type LawyerQuestion,
  type LawyerQuestionLinkType,
  type LegalReference,
  type MissingElement,
  type VerificationItem,
  type VerificationResult,
} from "../../shared/legalFindings.js";

export type Mode = "fast" | "full";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const LIMITS: Record<FindingSectionKey, { fast: number; full: number; maxTokens: { fast: number; full: number } }> = {
  charter: { fast: 3, full: 5, maxTokens: { fast: 5000, full: 7000 } },
  verification: { fast: 6, full: 10, maxTokens: { fast: 5500, full: 8000 } },
  missing: { fast: 5, full: 8, maxTokens: { fast: 4500, full: 6500 } },
  lawyerQuestions: { fast: 6, full: 10, maxTokens: { fast: 4500, full: 7000 } },
};

const SECTION_TIMEOUT_MS = { fast: 70_000, full: 100_000 };
const MIN_RETRY_BUDGET_MS = 25_000;
const MAX_QUOTE_CHARS = 600;

// ---------------------------------------------------------------------------
// Value helpers (model output is untrusted input)
// ---------------------------------------------------------------------------

const str = (v: unknown, max = 1500): string => {
  const s = typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);
};

const strList = (v: unknown, maxItems: number, maxLen = 600): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];

const CONCLUSIVE = /\b(violat(?:ed|es|ion|ions)|breach(?:ed|es)?|unlawful(?:ly)?|illegal(?:ly)?|unconstitutional)\b/i;
/** Charter findings are potential concerns. Conclusive wording is prefixed rather than rewritten. */
export function tempered(text: string): string {
  const t = str(text, 1500);
  return t && CONCLUSIVE.test(t) && !/^possible, not established:/i.test(t) ? `Possible, not established: ${t}` : t;
}

// ---------------------------------------------------------------------------
// Evidence and authority resolution
// ---------------------------------------------------------------------------

export function resolveEvidence(raw: unknown, documentText: string, sourceDocument = ""): EvidenceRef[] {
  const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const out: EvidenceRef[] = [];
  for (const item of items.slice(0, 4)) {
    if (!item || typeof item !== "object") continue;
    const quote = str((item as any).quote, MAX_QUOTE_CHARS);
    const locationInDocument = str((item as any).locationInDocument, 160);
    if (!quote && !locationInDocument) continue;
    if (!quote) {
      out.push({ locationInDocument, sourceDocument: sourceDocument || undefined, quoteCheck: "NOT_PROVIDED", quoteVerified: false });
      continue;
    }
    const check = verifyQuoteAgainstSource(documentText, quote) as EvidenceRef["quoteCheck"];
    out.push({
      quote,
      locationInDocument,
      sourceDocument: sourceDocument || undefined,
      quoteCheck: check,
      quoteVerified: isVerbatimQuoteStatus(check),
    });
  }
  return out;
}

export function resolveAuthorities(
  rawAuthorities: unknown,
  rawOther: unknown,
  opts: { section?: CharterSection; autoKeys?: string[] } = {}
): { refs: LegalReference[]; droppedKeys: string[] } {
  const refs: LegalReference[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();

  const push = (ref: LegalReference | null, howItApplies?: string) => {
    if (!ref) return;
    const id = ref.key ?? `free:${ref.citation.toLowerCase()}`;
    if (seen.has(id)) return;
    seen.add(id);
    if (howItApplies) ref.howItApplies = tempered(howItApplies);
    refs.push(ref);
  };

  // Deterministic attachments first (e.g. the Charter section a finding is about).
  for (const key of opts.autoKeys ?? []) push(referenceFromKey(key));

  for (const item of (Array.isArray(rawAuthorities) ? rawAuthorities : []).slice(0, 8)) {
    const key = str(typeof item === "string" ? item : (item as any)?.key, 120);
    const how = typeof item === "object" && item ? str((item as any).howItApplies, 800) : "";
    if (!key) continue;
    const entry = getRegistryEntry(key);
    if (!entry) {
      // A key the registry does not contain is a model-invented authority: show it as unverified text.
      push(unverifiedReference(key), how);
      continue;
    }
    if (opts.section && !authorityFitsCharterSection(entry, opts.section)) {
      dropped.push(key);
      continue;
    }
    push(referenceFromKey(key), how);
  }

  for (const text of (Array.isArray(rawOther) ? rawOther : []).slice(0, 4)) {
    const t = str(text, 300);
    if (!t) continue;
    const match = matchRegistryByCitation(t);
    if (match) {
      if (opts.section && !authorityFitsCharterSection(match, opts.section)) dropped.push(match.key);
      else push(referenceFromKey(match.key));
    } else push(unverifiedReference(t));
  }
  return { refs: refs.slice(0, 8), droppedKeys: dropped };
}

// ---------------------------------------------------------------------------
// Section validators
// ---------------------------------------------------------------------------

type Ctx = { documentText: string; sourceDocument: string; mode: Mode };

function base(raw: any, prefix: string, n: number, ctx: Ctx, extras: { section?: CharterSection; autoKeys?: string[] } = {}): FindingBase & { droppedKeys: string[] } {
  const { refs, droppedKeys } = resolveAuthorities(raw?.authorities, raw?.otherLegalReferences, { section: extras.section, autoKeys: extras.autoKeys });
  return {
    id: `${prefix}-${n}`,
    title: str(raw?.title, 200) || firstSentence(str(raw?.plainLanguage, 400), 110),
    plainLanguage: str(raw?.plainLanguage, 1500),
    whyItMatters: str(raw?.whyItMatters, 1200),
    evidence: resolveEvidence(raw?.evidence, ctx.documentText, ctx.sourceDocument),
    contraryEvidence: str(raw?.contraryEvidence, 1200),
    missingInformation: strList(raw?.missingInformation, 6),
    verificationSteps: strList(raw?.verificationSteps, 6),
    questionsForCounsel: strList(raw?.questionsForCounsel, 4),
    authorities: refs,
    relatedIds: [],
    droppedKeys,
  };
}

function strip<T extends { droppedKeys: string[] }>(o: T): Omit<T, "droppedKeys"> {
  const { droppedKeys: _d, ...rest } = o;
  return rest;
}

export function validateCharter(raw: any, ctx: Ctx): { items: CharterFinding[]; dropped: number } | null {
  if (!Array.isArray(raw?.charter)) return null;
  let dropped = 0;
  const items: CharterFinding[] = [];
  for (const r of raw.charter) {
    if (!r || typeof r !== "object") { dropped++; continue; }
    const section = str(r.section, 4).replace(/^s\.?\s*/i, "") as CharterSection;
    // Only the sections the analysis is permitted to raise; anything else is not a supported issue.
    if (!["7", "8", "9", "10", "12", "15"].includes(section)) { dropped++; continue; }
    const b = base(r, "ch", items.length + 1, ctx, { section, autoKeys: [`charter-s${section}`] });
    if (!b.plainLanguage) { dropped++; continue; }
    let assessment: CharterAssessment = r.assessment === "POTENTIAL_CONCERN" ? "POTENTIAL_CONCERN" : "INSUFFICIENT_INFORMATION";
    const missingInformation = [...b.missingInformation];
    // A potential concern needs at least one passage that is really in the document.
    if (assessment === "POTENTIAL_CONCERN" && !b.evidence.some((e) => e.quoteVerified)) {
      assessment = "INSUFFICIENT_INFORMATION";
      missingInformation.push("No passage supporting this concern could be located word-for-word in the document, so it is shown as insufficient information rather than a potential concern.");
    }
    const entry = getRegistryEntry(`charter-s${section}`);
    const finding: CharterFinding = {
      ...strip(b),
      plainLanguage: tempered(b.plainLanguage),
      whyItMatters: tempered(b.whyItMatters),
      missingInformation,
      section,
      assessment,
      stateAction: str(r.stateAction, 800),
      affectedRight: str(r.affectedRight, 600),
      legalTest: tempered(str(r.legalTest, 1500)),
      testOutline: entry?.testOutline,
      missingLegalElements: strList(r.missingLegalElements, 6),
      remediesForCounsel: tempered(str(r.remediesForCounsel, 1000)),
      droppedAuthorityKeys: b.droppedKeys.length ? b.droppedKeys : undefined,
    };
    items.push(finding);
    if (items.length >= LIMITS.charter[ctx.mode]) break;
  }
  return { items, dropped };
}

export function validateVerification(raw: any, ctx: Ctx): { items: VerificationItem[]; dropped: number } | null {
  if (!Array.isArray(raw?.verification)) return null;
  let dropped = 0;
  const items: VerificationItem[] = [];
  for (const r of raw.verification) {
    if (!r || typeof r !== "object") { dropped++; continue; }
    const claim = str(r.claim, 800);
    if (!claim) { dropped++; continue; }
    const sourceDocument = str(r.sourceDocument, 200) || ctx.sourceDocument;
    const b = base(r, "vc", items.length + 1, { ...ctx, sourceDocument });
    const supporting = resolveEvidence(r.supportingPassage, ctx.documentText, sourceDocument)[0];
    const contradictory = resolveEvidence(r.contradictoryPassage, ctx.documentText, sourceDocument)[0];

    let result: VerificationResult = (VERIFICATION_RESULTS as readonly string[]).includes(str(r.result, 20).toUpperCase())
      ? (str(r.result, 20).toUpperCase() as VerificationResult)
      : "UNVERIFIED";
    let resultNote: string | undefined;
    // Results that rest on a quotation are only kept when the quotation is really in the document.
    if (result === "VERIFIED" && !supporting?.quoteVerified) {
      result = "INCONCLUSIVE";
      resultNote = "Changed from VERIFIED: the supporting passage could not be located word-for-word in the document.";
    } else if (result === "VERIFIED" && contradictory?.quoteVerified) {
      result = "INCONCLUSIVE";
      resultNote = "Changed from VERIFIED: the document also contains a passage that points the other way.";
    } else if (result === "CONTRADICTED" && !contradictory?.quoteVerified) {
      result = "INCONCLUSIVE";
      resultNote = "Changed from CONTRADICTED: the contradicting passage could not be located word-for-word in the document.";
    }
    items.push({
      ...strip(b),
      evidence: [supporting, contradictory].filter((e): e is EvidenceRef => Boolean(e)),
      claim,
      sourceDocument,
      supportingPassage: supporting,
      contradictoryPassage: contradictory,
      method: str(r.method, 600),
      result,
      resultNote,
      missingEvidence: str(r.missingEvidence, 800),
      nextAction: str(r.nextAction, 800),
    });
    if (items.length >= LIMITS.verification[ctx.mode]) break;
  }
  return { items, dropped };
}

export function validateMissing(raw: any, ctx: Ctx): { items: MissingElement[]; dropped: number } | null {
  if (!Array.isArray(raw?.missing)) return null;
  let dropped = 0;
  const items: MissingElement[] = [];
  for (const r of raw.missing) {
    if (!r || typeof r !== "object") { dropped++; continue; }
    const item = str(r.item, 400);
    if (!item) { dropped++; continue; }
    const b = base(r, "ms", items.length + 1, ctx);
    let absenceStatus: AbsenceStatus = (["NOT_IN_UPLOADED_MATERIALS", "CONFIRMED_NONEXISTENT", "UNKNOWN"] as const).includes(r.absenceStatus)
      ? r.absenceStatus
      : "NOT_IN_UPLOADED_MATERIALS";
    let absenceBasis = str(r.absenceBasis, 800);
    // "Does not exist" is a claim about the world. Only the document itself can support it.
    if (absenceStatus === "CONFIRMED_NONEXISTENT" && !b.evidence.some((e) => e.quoteVerified)) {
      absenceStatus = "NOT_IN_UPLOADED_MATERIALS";
      absenceBasis = `${absenceBasis ? absenceBasis + " " : ""}Shown as not in the uploaded materials: no passage in the document that confirms the record does not exist could be located.`.trim();
    }
    if (!absenceBasis) {
      absenceBasis =
        absenceStatus === "CONFIRMED_NONEXISTENT"
          ? "The document states that this record does not exist."
          : "It is not in the uploaded materials. That does not show that the record does not exist or that anyone acted improperly.";
    }
    items.push({
      ...strip(b),
      item,
      dependsOn: str(r.dependsOn, 600),
      absenceStatus,
      absenceBasis,
      nextSteps: strList(r.nextSteps, 6),
    });
    if (items.length >= LIMITS.missing[ctx.mode]) break;
  }
  return { items, dropped };
}

export function validateQuestions(raw: any, ctx: Ctx, knownIds: Set<string>, redFlagIds: Set<string>): { items: LawyerQuestion[]; dropped: number } | null {
  if (!Array.isArray(raw?.lawyerQuestions)) return null;
  let dropped = 0;
  const items: LawyerQuestion[] = [];
  const TYPES: LawyerQuestionLinkType[] = ["charter", "verification", "missing", "redFlag", "threshold", "timeline", "general"];
  for (const r of raw.lawyerQuestions) {
    if (!r || typeof r !== "object") { dropped++; continue; }
    const question = str(r.question, 700);
    if (question.length < 10) { dropped++; continue; }
    const b = base({ ...r, plainLanguage: question, title: question }, "q", items.length + 1, ctx);
    const linkedId = str(r.linkedFindingId, 40);
    // A question links only to a finding that exists in this report.
    const linkOk = linkedId && (knownIds.has(linkedId) || redFlagIds.has(linkedId));
    const linkedType = TYPES.includes(r.linkedType) ? r.linkedType : "general";
    items.push({
      ...strip(b),
      title: firstSentence(question, 110),
      plainLanguage: question,
      question,
      whatLawyerAssesses: str(r.whatLawyerAssesses, 800),
      documentsToBring: strList(r.documentsToBring, 8, 200),
      linkedType: linkOk ? linkedType : "general",
      linkedFindingId: linkOk ? linkedId : undefined,
      relatedIds: linkOk ? [linkedId] : [],
    });
    if (items.length >= LIMITS.lawyerQuestions[ctx.mode]) break;
  }
  return { items, dropped };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export const FINDINGS_RULES = `
STRUCTURED LEGAL FINDINGS - additional rules for this request
A. AUTHORITIES BY KEY ONLY. Cite law only through the "authorities" field as {"key": "<key>", "howItApplies": "<how it bears on THIS document>"}, using a key from the AUTHORITY LIST below. NEVER write a case name, neutral citation, reporter citation, statutory wording, section number or URL yourself. If the list has nothing suitable, return an empty "authorities" array. "otherLegalReferences" is a last resort for a reference you believe matters but is not on the list; it will be displayed as UNVERIFIED and must be a plain description.
B. QUOTATIONS ARE VERBATIM. "quote" must be an exact, contiguous passage copied from the document. If you cannot copy one, leave "quote" empty and give only "locationInDocument". Never paraphrase inside a quote. Never invent a page or paragraph number: if the document has none, say "location not stated".
C. CHARTER ISSUES. Raise a Charter section (7, 8, 9, 10, 12 or 15) only where the document's own facts plausibly engage it AND there is state action (an agency, court or police actor did or decided something). Most child-protection documents engage few or none: return an empty array rather than listing sections. State what the legal test requires and which element the record does not establish. These are POTENTIAL CONCERNS for a lawyer to assess, never findings that a right was violated. Do not use the words "violated", "breach" or "unconstitutional" about the agency.
D. ABSENCE IS NOT MISCONDUCT. A record missing from the uploaded document does not show it does not exist, was not done, or that anyone acted improperly. Use absenceStatus NOT_IN_UPLOADED_MATERIALS unless the document itself states the record does not exist (then CONFIRMED_NONEXISTENT with the quote in "evidence").
E. VERIFICATION IS LIMITED TO THE DOCUMENT. You can only compare statements against other passages in the same document. VERIFIED means the document contains a passage that supports the claim and none that contradicts it. A claim that depends on a record outside the document is UNVERIFIED. CONTRADICTED needs a quoted contradicting passage. NOT_APPLICABLE is for a checklist item the document's facts do not engage.
F. PLAIN LANGUAGE. Write for a parent: short sentences, no Latin, no unexplained abbreviations. Distinguish what the document says from what you infer.
G. Return an object containing ONLY the key(s) shown. No commentary outside the JSON.
`;

function systemPrompt(): string {
  return `${ANALYZER_SYSTEM_PROMPT}\n\n${FINDINGS_RULES}\nAUTHORITY LIST (the only keys you may use):\n${registryPromptList()}`;
}

const EVIDENCE_SHAPE = `[{"quote": "exact words copied from the document, or empty", "locationInDocument": "Page X, Paragraph Y"}]`;
const AUTH_SHAPE = `[{"key": "<key from the authority list>", "howItApplies": "1-3 sentences on how this authority bears on the facts here"}]`;

const SCHEMAS: Record<FindingSectionKey, string> = {
  charter: `{"charter": [{
  "section": "7 | 8 | 9 | 10 | 12 | 15",
  "assessment": "POTENTIAL_CONCERN | INSUFFICIENT_INFORMATION",
  "title": "short label",
  "plainLanguage": "2-3 plain sentences: what the issue is",
  "whyItMatters": "why this matters to the parent",
  "stateAction": "what the state actor did or decided, per the document",
  "affectedRight": "the right potentially affected",
  "legalTest": "how the legal test for this section applies in outline to these facts",
  "evidence": ${EVIDENCE_SHAPE},
  "contraryEvidence": "anything in the document that cuts against the concern",
  "missingLegalElements": ["element of the test the record does not establish"],
  "missingInformation": ["facts or records needed"],
  "authorities": ${AUTH_SHAPE},
  "otherLegalReferences": [],
  "remediesForCounsel": "possible procedural implications or remedies for a lawyer to assess (not a recommendation)",
  "verificationSteps": ["how to check this"],
  "questionsForCounsel": ["a question about this issue"]
}]}`,
  verification: `{"verification": [{
  "title": "short label",
  "claim": "a specific claim in the document that needs checking",
  "sourceDocument": "the document name, or 'uploaded document'",
  "supportingPassage": {"quote": "exact words from the document", "locationInDocument": "Page X, Paragraph Y"},
  "contradictoryPassage": {"quote": "exact words that conflict with the claim", "locationInDocument": "Page X, Paragraph Y"},
  "method": "how the claim can be checked",
  "result": "VERIFIED | CONTRADICTED | UNVERIFIED | INCONCLUSIVE | NOT_APPLICABLE",
  "plainLanguage": "2 plain sentences on what was found",
  "whyItMatters": "why it matters",
  "missingEvidence": "what record would settle it",
  "nextAction": "the next step for the parent",
  "contraryEvidence": "anything that cuts against the claim",
  "authorities": ${AUTH_SHAPE},
  "otherLegalReferences": [],
  "missingInformation": [],
  "verificationSteps": [],
  "questionsForCounsel": []
}]}  (omit "contradictoryPassage" when the document has none)`,
  missing: `{"missing": [{
  "title": "short label",
  "item": "the information or document that is missing",
  "dependsOn": "the legal or evidentiary question that depends on it",
  "whyItMatters": "why the missing information matters",
  "plainLanguage": "2 plain sentences",
  "absenceStatus": "NOT_IN_UPLOADED_MATERIALS | CONFIRMED_NONEXISTENT | UNKNOWN",
  "absenceBasis": "what the absence is based on",
  "evidence": ${EVIDENCE_SHAPE},
  "authorities": ${AUTH_SHAPE},
  "otherLegalReferences": [],
  "nextSteps": ["a concrete step to obtain it"],
  "contraryEvidence": "",
  "missingInformation": [],
  "verificationSteps": [],
  "questionsForCounsel": []
}]}`,
  lawyerQuestions: `{"lawyerQuestions": [{
  "question": "a specific question about THIS file, not generic advice",
  "whyItMatters": "why the question matters",
  "linkedType": "charter | verification | missing | redFlag | threshold | timeline | general",
  "linkedFindingId": "the id of the finding it comes from, from the FINDINGS INDEX, or empty",
  "evidence": ${EVIDENCE_SHAPE},
  "authorities": ${AUTH_SHAPE},
  "otherLegalReferences": [],
  "whatLawyerAssesses": "what the lawyer would need to assess",
  "documentsToBring": ["documents to bring to the consultation"]
}]}`,
};

const SECTION_TITLE: Record<FindingSectionKey, string> = {
  charter: "Charter rights issues",
  verification: "verification checks",
  missing: "missing elements",
  lawyerQuestions: "questions for counsel",
};

export function buildFindingsPrompt(
  key: FindingSectionKey,
  mode: Mode,
  documentText: string,
  extra?: { index?: unknown; retryNote?: string }
): string {
  const limit = LIMITS[key][mode];
  return [
    "<document>",
    "DOCUMENT TEXT CONTENT:",
    documentText,
    "</document>",
    extra?.index ? `\nFINDINGS INDEX (ids you may use in linkedFindingId; do not invent ids):\n${JSON.stringify(extra.index)}` : "",
    "",
    `TASK: Produce ONLY the "${SECTION_TITLE[key]}" findings for an educational CYFSA evidence audit of the document above.`,
    `Return exactly one JSON object shaped like this (replace the descriptions with your analysis of THIS document):\n${SCHEMAS[key]}`,
    `LIMITS: at most ${limit} items; choose the most significant. An empty array is correct when the document supports nothing for this section.${key === "lawyerQuestions" ? " Return at least 1 question." : ""}`,
    extra?.retryNote ? `\nCORRECTION REQUIRED: ${extra.retryNote}` : "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface FindingsRunOptions {
  mode: Mode;
  documentText: string;
  sourceDocument?: string;
  model: string;
  generate: GenerateFn;
  deadlineAt: number;
  requestId: string;
  now?: () => number;
  onSection?: (key: FindingSectionKey, value: unknown[]) => Promise<void> | void;
}

export interface FindingsResult {
  findings: InteractiveFindings;
  usageByModel: Record<string, { input_tokens: number; output_tokens: number }>;
}

type SectionOutcome<T> = { items: T[]; state: FindingSectionState; reason?: string };

function addUsage(acc: FindingsResult["usageByModel"], model: string, usage?: GenerateResult["usage"]) {
  if (!usage) return;
  const cur = acc[model] || { input_tokens: 0, output_tokens: 0 };
  cur.input_tokens += usage.input_tokens || 0;
  cur.output_tokens += usage.output_tokens || 0;
  acc[model] = cur;
}

async function generateSection<T>(
  key: FindingSectionKey,
  opts: FindingsRunOptions,
  usage: FindingsResult["usageByModel"],
  validate: (parsed: any) => { items: T[] } | null,
  extra?: { index?: unknown }
): Promise<SectionOutcome<T>> {
  const now = opts.now ?? Date.now;
  let retryNote: string | undefined;
  let reason = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remaining = opts.deadlineAt - now();
    if (remaining < (attempt === 1 ? 12_000 : MIN_RETRY_BUDGET_MS)) {
      reason = reason || "not enough time remained within the analysis time limit";
      break;
    }
    let result: GenerateResult;
    try {
      result = await opts.generate(
        {
          system: systemPrompt(),
          messages: [{ role: "user", content: [{ type: "text", text: buildFindingsPrompt(key, opts.mode, opts.documentText, { index: extra?.index, retryNote }) }] }],
          max_tokens: LIMITS[key].maxTokens[opts.mode],
          timeoutMs: Math.min(SECTION_TIMEOUT_MS[opts.mode], remaining - 3_000),
          retries: 1,
          requestId: opts.requestId,
          stage: `findings:${key}`,
          mode: opts.mode,
        },
        opts.model
      );
    } catch (err: any) {
      reason = err instanceof AnalyzerError ? err.userMessage : String(err?.message || "request failed").slice(0, 200);
      // Permanent provider failures (bad key, invalid model) will not improve on retry.
      if (err instanceof AnalyzerError && !err.retryable) break;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 600 + Math.floor(Math.random() * 400)));
      continue;
    }
    addUsage(usage, opts.model, result.usage);
    if (result.stopReason === "max_tokens") {
      reason = "the response was cut off before finishing";
      retryNote = "Your previous answer was cut off because it was too long. Return fewer items and shorter text.";
      continue;
    }
    const parsed = parseJsonObject(result.text);
    if (!parsed) {
      reason = "the response was not a valid JSON object";
      retryNote = "Your previous answer was not one valid JSON object. Return only the JSON object.";
      continue;
    }
    const checked = validate(parsed);
    if (!checked) {
      reason = `the response did not contain a "${key}" list`;
      retryNote = `Your previous answer had no "${key}" array. Return the object shaped exactly as described.`;
      continue;
    }
    if (key === "lawyerQuestions" && checked.items.length === 0) {
      reason = "no usable questions were returned";
      retryNote = "Return at least one specific question, each with a question and a reason it matters.";
      continue;
    }
    return { items: checked.items, state: "GENERATED" };
  }
  return { items: [], state: "UNAVAILABLE", reason: `This part could not be generated (${reason || "unknown reason"}).` };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();

/** Links findings to the report's red flags when they cite the same passage. Deterministic. */
export function linkToRedFlags(findings: FindingBase[], redFlags: Array<{ id?: string; phraseDetected?: string; locationInDocument?: string }>): void {
  const flags = redFlags
    .filter((f) => f && f.id)
    .map((f) => ({ id: String(f.id), phrase: norm(f.phraseDetected || ""), loc: norm(f.locationInDocument || "") }));
  for (const finding of findings) {
    for (const ev of finding.evidence) {
      const q = ev.quote && ev.quoteVerified ? norm(ev.quote) : "";
      const loc = norm(ev.locationInDocument || "");
      for (const f of flags) {
        const sameQuote = q.length >= 12 && f.phrase.length >= 12 && (q.includes(f.phrase) || f.phrase.includes(q));
        const sameLoc = loc.length >= 6 && loc === f.loc;
        if ((sameQuote || sameLoc) && !finding.relatedIds.includes(f.id)) finding.relatedIds.push(f.id);
      }
    }
  }
}

export function summarizeAuthorities(findings: FindingBase[]): InteractiveFindings["authoritySummary"] {
  const seen = new Map<string, LegalReference>();
  for (const f of findings) for (const a of f.authorities) seen.set(a.key ?? `free:${a.citation}`, a);
  const refs = [...seen.values()];
  const verifiedCount = refs.filter((r) => r.status === "VERIFIED").length;
  const candidateCount = refs.filter((r) => r.status === "CANDIDATE").length;
  const unverifiedCount = refs.filter((r) => r.status === "UNVERIFIED").length;
  const checkedAt = LEGAL_AUTHORITY_VERIFICATION.generatedAt;
  let limitation: string;
  if (!checkedAt) {
    limitation =
      "No retrieval check against the official publishers has been recorded for this release, so no authority below is marked VERIFIED. Statutes and cases are shown as candidates from CYFSA Navigator's curated list; confirm every citation, link and statement of the law with a lawyer or the official source (Ontario e-Laws, the federal Justice Laws site, or the court's own decision) before relying on it.";
  } else if (verifiedCount === 0 && refs.length > 0) {
    limitation = `Authority checks were last recorded on ${checkedAt.slice(0, 10)}, but none of the authorities cited here passed. Confirm each one with a lawyer or the official source before relying on it.`;
  } else {
    limitation = `Authorities marked VERIFIED had their published source retrieved and matched on ${checkedAt.slice(0, 10)}. Candidates have not been retrieved and must be confirmed. This confirms that a source exists and matches its citation; it does not say how the law applies to your case.`;
  }
  if (unverifiedCount > 0) limitation += " References marked UNVERIFIED were not found in CYFSA Navigator's authority list.";
  return { registryVersion: REGISTRY_VERSION, lastRetrievalCheckAt: checkedAt, verifiedCount, candidateCount, unverifiedCount, limitation };
}

/**
 * First wave: charter, verification and missing elements need only the document, so they can run
 * alongside the report's other sections.
 */
export function startFindingsWaveA(opts: FindingsRunOptions) {
  const usage: FindingsResult["usageByModel"] = {};
  const ctx: Ctx = { documentText: opts.documentText, sourceDocument: opts.sourceDocument || "uploaded document", mode: opts.mode };
  const wrap = async <T,>(key: FindingSectionKey, validate: (p: any) => { items: T[] } | null) => {
    const out = await generateSection<T>(key, opts, usage, validate);
    await opts.onSection?.(key, out.items as unknown[]);
    return out;
  };
  const promise = Promise.all([
    wrap<CharterFinding>("charter", (p) => validateCharter(p, ctx)),
    wrap<VerificationItem>("verification", (p) => validateVerification(p, ctx)),
    wrap<MissingElement>("missing", (p) => validateMissing(p, ctx)),
  ]);
  return { promise, usage, ctx };
}

/** Second wave plus assembly: questions are generated from the validated findings so they can link to them. */
export async function finishFindings(
  opts: FindingsRunOptions,
  wave: ReturnType<typeof startFindingsWaveA>,
  redFlags: Array<{ id?: string; category?: string; phraseDetected?: string; locationInDocument?: string }> = []
): Promise<FindingsResult> {
  const [charter, verification, missing] = await wave.promise;
  const usage = wave.usage;

  linkToRedFlags(charter.items, redFlags);
  linkToRedFlags(verification.items, redFlags);
  linkToRedFlags(missing.items, redFlags);

  const index = [
    ...charter.items.map((f) => ({ id: f.id, type: "charter", title: f.title, summary: firstSentence(f.plainLanguage, 180) })),
    ...verification.items.map((f) => ({ id: f.id, type: "verification", title: f.title, summary: firstSentence(f.plainLanguage || f.claim, 180) })),
    ...missing.items.map((f) => ({ id: f.id, type: "missing", title: f.title, summary: firstSentence(f.plainLanguage || f.item, 180) })),
    ...redFlags.slice(0, 8).map((f) => ({ id: String(f.id), type: "redFlag", title: f.category || "Red flag", summary: firstSentence(f.phraseDetected || "", 140) })),
  ];
  const known = new Set([...charter.items, ...verification.items, ...missing.items].map((f) => f.id));
  const flagIds = new Set(redFlags.filter((f) => f.id).map((f) => String(f.id)));

  const questions = await generateSection<LawyerQuestion>(
    "lawyerQuestions",
    opts,
    usage,
    (p) => validateQuestions(p, wave.ctx, known, flagIds),
    { index }
  );
  linkToRedFlags(questions.items, redFlags);
  await opts.onSection?.("lawyerQuestions", questions.items);

  const status = (o: SectionOutcome<unknown>) => (o.reason ? { state: o.state, reason: o.reason } : { state: o.state });
  const all: FindingBase[] = [...charter.items, ...verification.items, ...missing.items, ...questions.items];
  return {
    usageByModel: usage,
    findings: {
      schemaVersion: 1,
      charter: charter.items,
      verification: verification.items,
      missing: missing.items,
      lawyerQuestions: questions.items,
      sectionStatus: { charter: status(charter), verification: status(verification), missing: status(missing), lawyerQuestions: status(questions) },
      authoritySummary: summarizeAuthorities(all),
    },
  };
}

/** Convenience for callers (Deep Scan) that run both waves back to back. */
export async function generateInteractiveFindings(
  opts: FindingsRunOptions,
  redFlags: Array<{ id?: string; category?: string; phraseDetected?: string; locationInDocument?: string }> = []
): Promise<FindingsResult> {
  return finishFindings(opts, startFindingsWaveA(opts), redFlags);
}

export { CHARTER_SECTIONS, LEGAL_AUTHORITY_REGISTRY };
