/**
 * Forensic Engine pipeline, as a sequence of serializable steps.
 *
 * The engine state (EngineState) is plain JSON. Each step reads it and returns a new state, so a run can stop after
 * any step, be saved (resumableRunner.ts), and continue in another serverless invocation. `runForensicInvestigation`
 * runs every step in one go for callers that do not need to resume (tests, the benchmark).
 *
 * Steps, in order:
 *   extract:<docId>   EXTRACTION (auxiliary model): the document's own date, people, dated events, claims, each
 *                     with a quotation. Items whose quotation is not in the document are dropped and counted.
 *   build             Case model (deterministic): people merged, chronology, chronology anomalies, conflict leads.
 *   investigate       INVESTIGATION (Claude Opus) over the whole record, or, for a record larger than one pass,
 *   investigate:<id>  one Opus investigation per document followed by
 *   synthesize        SYNTHESIS (Claude Opus) for findings only the whole record shows.
 *   review            ADVERSARIAL_REVIEW (Claude Opus, separate prompt) with verbatim statute text.
 *   visual            VISUAL_VERIFICATION against page images or the original PDF/image.
 *   ground            GROUNDING (deterministic): grounding.ts rules, duplicate merge, appendix.
 *
 * Failure handling: a failed stage is recorded and the report is PARTIAL with a plain statement of what is missing.
 * A failed investigation produces no findings; it never produces findings from a weaker stage instead. In resumable
 * mode a transient failure is retried on a later invocation before it is recorded as a failure.
 * Cost controls: a call budget (carried across invocations), a per-document character cap, per-stage output caps,
 * and a deadline.
 */

import type { GenerateFn, GenerateResult } from "../analyzerSections.js";
import { parseJsonLenient } from "../analyzerSections.js";
import {
  resolveEvidenceRef,
  type CaseClaim,
  type CaseDocument,
  type CaseEvent,
  type CaseModel,
  type CasePerson,
  type Finding,
  type ForensicReport,
  type Hypothesis,
  type InjectionWarning,
  type StageRecord,
} from "./caseModel.js";
import { buildChronology, findChronologyAnomalies, findConflictLeads, type DocumentDate } from "./caseAnalysis.js";
import { detectInstructionLikeText, isolateDocuments } from "./documentIsolation.js";
import { applyReview, dedupeFindings, groundFinding, isMaterial, parseFindingCandidates } from "./grounding.js";
import { EXTRACTION_SYSTEM, INVESTIGATION_SYSTEM, REVIEW_SYSTEM, SYNTHESIS_SYSTEM, VISUAL_SYSTEM } from "./prompts.js";
import { corpusSources, lookupCitation, type CorpusSource } from "./legalCorpusAdapter.js";
import type { CaseDate } from "../legalAuthority.js";

export interface ForensicModels {
  /** Auxiliary model for extraction. */
  extractor: string;
  /** Claude Opus: substantive investigation and synthesis. */
  investigator: string;
  /** Claude Opus: adversarial review. A separate call with a separate prompt, even when the model id is the same. */
  reviewer: string;
  /** Multimodal model for page checks. Defaults to the reviewer. */
  visual?: string;
}

export interface ForensicLimits {
  maxCharsPerDocument: number;
  /** Above this many characters in total, documents are investigated one at a time and then synthesized. */
  singlePassMaxChars: number;
  /** Most characters of document text the adversarial review reads in its one call (see reviewDocuments). */
  reviewMaxChars: number;
  maxCalls: number;
  extractionMaxTokens: number;
  investigationMaxTokens: number;
  synthesisMaxTokens: number;
  reviewMaxTokens: number;
  visualMaxTokens: number;
  stageTimeoutMs: number;
}

export const DEFAULT_LIMITS: ForensicLimits = {
  maxCharsPerDocument: 300_000,
  singlePassMaxChars: 200_000,
  reviewMaxChars: 400_000,
  maxCalls: 24,
  extractionMaxTokens: 8_000,
  investigationMaxTokens: 32_000,
  synthesisMaxTokens: 24_000,
  reviewMaxTokens: 16_000,
  visualMaxTokens: 4_000,
  stageTimeoutMs: 240_000,
};

/** A transient step failure is retried this many times in resumable mode before it is recorded as a failure. */
export const MAX_STEP_ATTEMPTS = 3;

export interface ForensicProgress {
  stage: StageRecord["stage"];
  message: string;
  /** 0..1 within the engine's own run. */
  fraction: number;
}

/** Original files (PDF or image) and page images, kept out of the saved state so each checkpoint stays small. */
export type EngineMedia = Record<string, Pick<CaseDocument, "sourceFile" | "pageImages">>;

export interface EngineState {
  schema: "forensic-engine-state-v1";
  requestId: string;
  models: ForensicModels;
  limits: ForensicLimits;
  /** Documents without their original files or page images (see EngineMedia). */
  documents: CaseDocument[];
  plan: string[];
  done: string[];
  /** Failed attempts per step, counted across invocations. */
  attempts: Record<string, number>;
  calls: number;
  budgetExhausted: boolean;
  startedAt: number;
  stages: StageRecord[];
  incompleteness: string[];
  injectionWarnings: InjectionWarning[];
  extraction: { people: CasePerson[]; events: CaseEvent[]; claims: CaseClaim[]; documentDates: DocumentDate[]; dropped: number };
  caseModel: CaseModel | null;
  findings: Finding[];
  hypotheses: Hypothesis[];
  openQuestions: string[];
  investigatedDocuments: number;
  report: ForensicReport | null;
}

export interface StepDeps {
  generate: GenerateFn;
  /** Absolute epoch-ms deadline for this invocation's AI calls. */
  deadlineAt: number;
  media?: EngineMedia;
  now?: () => number;
  onProgress?: (p: ForensicProgress) => void | Promise<void>;
  /** True when a later invocation can retry a transient failure. */
  resumable?: boolean;
  /** Legal corpus sources for citation lookup. Defaults to the bundled CYFSA consolidation only. */
  corpus?: CorpusSource[];
}

/**
 * The date the legal question is assessed at: the latest date a document states for itself (sworn, issued, endorsed,
 * written), else the latest court-record date in the chronology. Filename and metadata dates never count.
 */
export function caseDateFor(cm: CaseModel): CaseDate {
  const own = cm.documentDates.map((d) => d.date).filter((d): d is string => Boolean(d));
  const court = cm.chronology
    .filter((c) => c.date && cm.events.find((e) => e.id === c.eventId)?.dateSource === "COURT_RECORD")
    .map((c) => c.date as string);
  const all = (own.length ? own : court).sort();
  return all.length ? { kind: "EXACT", date: all[all.length - 1] } : { kind: "UNKNOWN" };
}

export type StepOutcome = "DONE" | "RETRY_LATER";

export class BudgetExceeded extends Error {}
/** Not enough time is left in this invocation to start a model call. Never counted as a failed attempt. */
export class DeadlineReached extends Error {}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(String(v ?? "").toUpperCase()) ? (String(v).toUpperCase() as T) : fallback;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------------

export function createEngineState(params: {
  documents: CaseDocument[];
  models: ForensicModels;
  limits?: Partial<ForensicLimits>;
  requestId: string;
  now?: number;
}): { state: EngineState; media: EngineMedia } {
  const limits = { ...DEFAULT_LIMITS, ...params.limits };
  const media: EngineMedia = {};
  const documents = params.documents.map((d) => {
    const { sourceFile, pageImages, ...rest } = d;
    if (sourceFile || pageImages) media[d.id] = { ...(sourceFile ? { sourceFile } : {}), ...(pageImages ? { pageImages } : {}) };
    return rest;
  });
  const totalChars = documents.reduce((s, d) => s + Math.min(d.text.length, limits.maxCharsPerDocument), 0);
  const multiPass = totalChars > limits.singlePassMaxChars && documents.length > 1;
  const plan = [
    ...documents.map((d) => `extract:${d.id}`),
    "build",
    ...(multiPass ? [...documents.map((d) => `investigate:${d.id}`), "synthesize"] : ["investigate"]),
    "review",
    "visual",
    "ground",
  ];
  const incompleteness: string[] = [];
  const injectionWarnings = detectInstructionLikeText(documents);
  if (injectionWarnings.length > 0) {
    incompleteness.push(
      `${injectionWarnings.length} passage(s) in the documents read like instructions to an AI. They were treated as evidence and not followed.`
    );
  }
  for (const d of documents) {
    if (d.text.length > limits.maxCharsPerDocument) {
      incompleteness.push(`Document "${d.title}" was truncated at ${limits.maxCharsPerDocument} characters; the remainder was not analyzed.`);
    }
  }
  return {
    media,
    state: {
      schema: "forensic-engine-state-v1",
      requestId: params.requestId,
      models: params.models,
      limits,
      documents,
      plan,
      done: [],
      attempts: {},
      calls: 0,
      budgetExhausted: false,
      startedAt: params.now ?? Date.now(),
      stages: [],
      incompleteness,
      injectionWarnings,
      extraction: { people: [], events: [], claims: [], documentDates: [], dropped: 0 },
      caseModel: null,
      findings: [],
      hypotheses: [],
      openQuestions: [],
      investigatedDocuments: 0,
      report: null,
    },
  };
}

export function nextStep(state: EngineState): string | null {
  return state.plan.find((s) => !state.done.includes(s)) ?? null;
}

const withMedia = (docs: CaseDocument[], media: EngineMedia = {}): CaseDocument[] => docs.map((d) => ({ ...d, ...media[d.id] }));

function stageRecord(state: EngineState, stage: StageRecord["stage"], model: string | null): StageRecord {
  let r = state.stages.find((s) => s.stage === stage);
  if (!r) {
    r = { stage, status: "COMPLETED", model, calls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, error: null };
    state.stages.push(r);
  }
  return r;
}

function fail(state: EngineState, r: StageRecord, err: unknown, consequence: string) {
  r.status = "FAILED";
  r.error = err instanceof Error ? err.message : String(err);
  state.incompleteness.push(consequence);
}

// ---------------------------------------------------------------------------------------------------------------------
// One step
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Runs one step and returns the new state. RETRY_LATER means a transient failure in resumable mode (or not enough
 * time left in this invocation): the state records the attempt but the step is not done, so a later invocation
 * repeats it. The input state is never modified.
 */
export async function runEngineStep(input: EngineState, step: string, deps: StepDeps): Promise<{ state: EngineState; outcome: StepOutcome }> {
  const state = clone(input);
  const now = deps.now ?? Date.now;
  const limits = state.limits;
  const docs = withMedia(state.documents, deps.media);
  const progress = async (stage: StageRecord["stage"], message: string, fraction: number) => {
    try {
      await deps.onProgress?.({ stage, message, fraction });
    } catch {
      // Progress reporting never affects the analysis.
    }
  };
  const call = async (stage: StageRecord["stage"], model: string, system: string, content: any, maxTokens: number): Promise<GenerateResult> => {
    if (state.calls >= limits.maxCalls) {
      state.budgetExhausted = true;
      throw new BudgetExceeded(`Call budget of ${limits.maxCalls} reached.`);
    }
    const remaining = deps.deadlineAt - now();
    if (remaining <= 1_000) throw new DeadlineReached("Analysis deadline reached.");
    state.calls++;
    return deps.generate(
      {
        system,
        messages: [{ role: "user", content }],
        max_tokens: maxTokens,
        timeoutMs: Math.min(limits.stageTimeoutMs, remaining),
        retries: 1,
        requestId: state.requestId,
        stage: `forensic_${stage.toLowerCase()}`,
        mode: "full",
      },
      model
    );
  };
  const account = (r: StageRecord, res: GenerateResult) => {
    r.calls++;
    r.inputTokens += res.usage?.input_tokens ?? 0;
    r.outputTokens += res.usage?.output_tokens ?? 0;
    r.durationMs += res.durationMs ?? 0;
  };

  /**
   * Shared failure policy. Resumable mode retries a transient error later; a budget stop, or a step that has used its
   * attempts, is recorded with its consequence. A deadline stop in resumable mode is an interruption, not a failure.
   */
  const onError = (err: unknown, r: StageRecord, consequence: string): StepOutcome => {
    if (deps.resumable && err instanceof DeadlineReached) return "RETRY_LATER";
    if (deps.resumable && !(err instanceof BudgetExceeded)) {
      state.attempts[step] = (state.attempts[step] ?? 0) + 1;
      if (state.attempts[step] < MAX_STEP_ATTEMPTS) return "RETRY_LATER";
    }
    fail(state, r, err, consequence);
    return "DONE";
  };
  const finish = (outcome: StepOutcome) => {
    if (outcome === "DONE") state.done.push(step);
    return { state, outcome };
  };

  const [kind, docId] = step.split(":");

  if (kind === "extract") {
    const doc = docs.find((d) => d.id === docId)!;
    const r = stageRecord(state, "EXTRACTION", state.models.extractor);
    if (state.done.length === 0) await progress("EXTRACTION", "Indexing people, dates and claims in each document...", 0.05);
    if (state.budgetExhausted) return finish("DONE");
    try {
      const iso = isolateDocuments([doc], limits.maxCharsPerDocument);
      const res = await call("EXTRACTION", state.models.extractor, `${EXTRACTION_SYSTEM}\n\n${iso.systemNotice}`, iso.content, limits.extractionMaxTokens);
      account(r, res);
      ingestExtraction(state, docs, doc, parseJsonLenient(res.text) ?? {});
      return finish("DONE");
    } catch (err) {
      return finish(onError(err, r, `Extraction did not complete for "${doc.title}". The investigation read the document directly without an index for it.`));
    }
  }

  if (kind === "build") {
    const x = state.extraction;
    const chronology = buildChronology(x.events);
    state.caseModel = {
      documents: state.documents.map(({ id, title, kind: k, extractionMethod }) => ({ id, title, kind: k, extractionMethod })),
      people: x.people,
      events: chronology.map((c) => x.events.find((e) => e.id === c.eventId)!),
      claims: x.claims,
      relations: [],
      documentDates: x.documentDates,
      chronology,
      chronologyAnomalies: findChronologyAnomalies(x.events, x.documentDates),
      conflictLeads: findConflictLeads(x.events, x.claims),
      openQuestions: [],
      droppedUngrounded: x.dropped,
    };
    return finish("DONE");
  }

  const cm = state.caseModel!;
  const index = () =>
    JSON.stringify({
      documentDates: cm.documentDates.map((d) => ({ document: d.documentId, kind: d.kind, date: d.date, dateText: d.dateText })),
      people: cm.people.map((p) => ({ name: p.name, roles: p.roles })),
      chronology: cm.chronology,
      claims: cm.claims.map((c) => ({ id: c.id, assertedBy: c.assertedBy, basis: c.basis, statement: c.statement, document: c.sources[0]?.documentId, page: c.sources[0]?.page })),
      leads: [...cm.chronologyAnomalies, ...cm.conflictLeads],
    });
  const takeHypotheses = (raw: any, prefix: string) =>
    (Array.isArray(raw?.hypotheses) ? raw.hypotheses : []).map((h: any, i: number): Hypothesis => ({
      id: `${prefix}${String(h?.id ?? `H${i + 1}`)}`,
      question: String(h?.question ?? ""),
      rationale: String(h?.rationale ?? ""),
      outcome: oneOf(h?.outcome, ["SUPPORTED", "UNDERMINED", "MIXED"] as const, "UNRESOLVED" as any) as Hypothesis["outcome"],
      findingIds: [],
    }));
  const takeFindings = (raw: any, prefix: string) =>
    parseFindingCandidates(raw.findings, docs).map((f) => ({ ...f, id: `${prefix}${f.id}`, hypothesisId: f.hypothesisId ? `${prefix}${f.hypothesisId}` : null }));
  const takeQuestions = (raw: any) => (Array.isArray(raw?.openQuestions) ? raw.openQuestions : []).map(String).filter(Boolean);

  if (kind === "investigate") {
    const r = stageRecord(state, "INVESTIGATION", state.models.investigator);
    const perDoc = Boolean(docId);
    const doc = perDoc ? docs.find((d) => d.id === docId)! : null;
    const position = perDoc ? state.documents.findIndex((d) => d.id === docId) : 0;
    await progress("INVESTIGATION", perDoc ? `Investigating document ${position + 1} of ${docs.length}...` : "Claude Opus is investigating the record...", 0.2 + (perDoc ? 0.35 * (position / docs.length) : 0));
    if (perDoc && state.budgetExhausted) return finish("DONE");
    try {
      const iso = isolateDocuments(perDoc ? [doc!] : docs, limits.maxCharsPerDocument);
      const res = await call(
        "INVESTIGATION",
        state.models.investigator,
        `${INVESTIGATION_SYSTEM}\n\n${iso.systemNotice}`,
        perDoc
          ? `CASE MODEL AND LEADS for the whole record (machine-extracted; verify against the documents):\n${index()}\n\nDOCUMENT ${position + 1} of ${docs.length}:\n${iso.content}`
          : `CASE MODEL AND LEADS (machine-extracted; verify against the documents):\n${index()}\n\nDOCUMENTS:\n${iso.content}`,
        limits.investigationMaxTokens
      );
      account(r, res);
      const raw = parseJsonLenient(res.text);
      if (!raw || !Array.isArray(raw.findings)) throw new Error(perDoc ? `Investigation of "${doc!.title}" returned no findings array.` : "Investigation returned no findings array.");
      const prefix = perDoc ? `${doc!.id}:` : "";
      state.findings.push(...takeFindings(raw, prefix));
      state.hypotheses.push(...takeHypotheses(raw, prefix));
      state.openQuestions.push(...takeQuestions(raw));
      state.investigatedDocuments++;
      return finish("DONE");
    } catch (err) {
      return finish(
        onError(
          err,
          r,
          perDoc
            ? `The investigation of "${doc!.title}" did not complete; it has no document-level findings.`
            : "The investigation stage did not complete, so this report contains no findings. Re-run the analysis."
        )
      );
    }
  }

  if (kind === "synthesize") {
    const r = stageRecord(state, "SYNTHESIS", state.models.investigator);
    if (state.investigatedDocuments === 0) {
      r.status = "SKIPPED";
      return finish("DONE");
    }
    try {
      const perDocChars = Math.max(4_000, Math.floor(limits.singlePassMaxChars / docs.length));
      const iso = isolateDocuments(docs, perDocChars);
      const summary = state.findings.map((f) => ({ id: f.id, title: f.title, statement: f.statement, class: f.evidenceClass, quotes: f.supporting.map((s) => ({ documentId: s.documentId, page: s.page, quote: s.quote })) }));
      const res = await call(
        "SYNTHESIS",
        state.models.investigator,
        `${SYNTHESIS_SYSTEM}\n\n${iso.systemNotice}`,
        `CASE MODEL AND LEADS:\n${index()}\n\nPER-DOCUMENT FINDINGS:\n${JSON.stringify(summary)}\n\nDOCUMENTS (each truncated to ${perDocChars} characters for this pass):\n${iso.content}`,
        limits.synthesisMaxTokens
      );
      account(r, res);
      const raw = parseJsonLenient(res.text);
      if (!raw || !Array.isArray(raw.findings)) throw new Error("Synthesis returned no findings array.");
      state.findings.push(...takeFindings(raw, "case:"));
      state.hypotheses.push(...takeHypotheses(raw, "case:"));
      state.openQuestions.push(...takeQuestions(raw));
      return finish("DONE");
    } catch (err) {
      return finish(onError(err, r, "The case-level synthesis did not complete. Cross-document findings may be missing."));
    }
  }

  if (kind === "review") {
    await progress("ADVERSARIAL_REVIEW", "Independent adversarial review is trying to falsify each finding...", 0.6);
    const r = stageRecord(state, "ADVERSARIAL_REVIEW", state.models.reviewer);
    if (state.findings.length === 0) {
      r.status = "SKIPPED";
      return finish("DONE");
    }
    try {
      const scope = reviewDocuments(docs, state.findings, limits.reviewMaxChars ?? DEFAULT_LIMITS.reviewMaxChars, limits.maxCharsPerDocument);
      if (scope.note && !state.incompleteness.includes(scope.note)) state.incompleteness.push(scope.note);
      const iso = isolateDocuments(scope.docs, limits.maxCharsPerDocument);
      const proposed = state.findings.map((f) => ({
        findingId: f.id,
        title: f.title,
        statement: f.statement,
        evidenceClass: f.evidenceClass,
        supporting: f.supporting.map((s) => ({ documentId: s.documentId, quote: s.quote, page: s.page, foundInSource: s.verified })),
        contradicting: f.contradicting.map((s) => ({ documentId: s.documentId, quote: s.quote, page: s.page, foundInSource: s.verified })),
        legalIssues: f.legalIssues.map((l) => ({ citation: l.citation, explanation: l.explanation, citationStatus: l.citationStatus })),
      }));
      const statutes = new Map<string, string>();
      for (const f of state.findings) for (const l of f.legalIssues) if (l.statuteText) statutes.set(l.citation, l.statuteText);
      const statuteBlock = statutes.size
        ? `\n\nSTATUTE TEXT (verbatim from the bundled CYFSA consolidation):\n${[...statutes].map(([c, t]) => `[${c}]\n${t}`).join("\n\n")}`
        : "\n\nSTATUTE TEXT: none supplied; every cited provision is unverified.";
      const res = await call(
        "ADVERSARIAL_REVIEW",
        state.models.reviewer,
        `${REVIEW_SYSTEM}\n\n${iso.systemNotice}`,
        `PROPOSED FINDINGS:\n${JSON.stringify(proposed)}${statuteBlock}\n\nDOCUMENTS:\n${iso.content}`,
        limits.reviewMaxTokens
      );
      account(r, res);
      const raw = parseJsonLenient(res.text);
      if (!raw || !Array.isArray(raw.reviews)) throw new Error("Review returned no reviews array.");
      state.findings = applyReview(state.findings, raw.reviews, docs);
      if (scope.notFull.length > 0) {
        // Every finding was reviewed against part of the record: contrary text elsewhere was not checked (rule 11).
        const partialRecord = scope.notFull.map((id) => docs.find((d) => d.id === id)?.title ?? id);
        for (const f of state.findings) f.review = { ...f.review, partialRecord };
      }
      const unreviewed = state.findings.filter((f) => f.review.verdict === "NOT_REVIEWED").length;
      if (unreviewed > 0) state.incompleteness.push(`${unreviewed} finding(s) were not addressed by the adversarial review.`);
      return finish("DONE");
    } catch (err) {
      return finish(onError(err, r, "The adversarial review did not complete. Findings are unreviewed; none can be reported as confirmed noncompliance."));
    }
  }

  if (kind === "visual") {
    await progress("VISUAL_VERIFICATION", "Checking page-dependent findings against the original pages...", 0.85);
    const r = stageRecord(state, "VISUAL_VERIFICATION", state.models.visual ?? state.models.reviewer);
    const needsVisual = state.findings.filter((f) => f.dependsOnVisual && f.review.verdict !== "REJECTED");
    const visualSource = (f: Finding) => {
      for (const ref of f.supporting) {
        const d = docs.find((x) => x.id === ref.documentId);
        if (!d) continue;
        if (ref.page !== null && d.pageImages?.[ref.page]) return { doc: d, page: ref.page, kind: "page" as const };
        if (d.sourceFile) return { doc: d, page: ref.page, kind: "file" as const };
      }
      return null;
    };
    const checkable = needsVisual.filter((f) => visualSource(f) !== null);
    if (needsVisual.length === 0) {
      r.status = "SKIPPED";
      return finish("DONE");
    }
    if (checkable.length === 0) {
      r.status = "SKIPPED";
      state.incompleteness.push(`${needsVisual.length} finding(s) depend on the page itself, but no page image or original file was available. They are marked uncertain.`);
      return finish("DONE");
    }
    try {
      const content: any[] = [];
      const sentFiles = new Set<string>();
      const questions: any[] = [];
      for (const f of checkable) {
        const src = visualSource(f)!;
        if (src.kind === "page") {
          const img = src.doc.pageImages![src.page!];
          content.push({ type: "text", text: `Page image for finding ${f.id}: document ${src.doc.id}, page ${src.page}.` });
          content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
        } else if (!sentFiles.has(src.doc.id)) {
          sentFiles.add(src.doc.id);
          const file = src.doc.sourceFile!;
          content.push({ type: "text", text: `Original file for document ${src.doc.id} ("${src.doc.title}").` });
          content.push(
            file.mediaType === "application/pdf"
              ? { type: "document", source: { type: "base64", media_type: file.mediaType, data: file.data } }
              : { type: "image", source: { type: "base64", media_type: file.mediaType, data: file.data } }
          );
        }
        questions.push({ findingId: f.id, documentId: src.doc.id, page: src.page, statement: f.statement });
      }
      content.push({ type: "text", text: `QUESTIONS (look at the named page of the named document):\n${JSON.stringify(questions)}` });
      const res = await call("VISUAL_VERIFICATION", r.model!, VISUAL_SYSTEM, content, limits.visualMaxTokens);
      account(r, res);
      const raw = parseJsonLenient(res.text);
      const results = new Map<string, any>((Array.isArray(raw?.results) ? raw.results : []).map((x: any) => [String(x?.findingId), x]));
      state.findings = state.findings.map((f) => {
        const v = results.get(f.id);
        if (!v) return f;
        return {
          ...f,
          visualVerification: oneOf(v.verdict, ["CONFIRMED", "CONTRADICTED"] as const, "INCONCLUSIVE" as any) as Finding["visualVerification"],
          visualNote: String(v.observation ?? ""),
        };
      });
      if (checkable.length < needsVisual.length) {
        state.incompleteness.push(`${needsVisual.length - checkable.length} page-dependent finding(s) had no page image or original file and are marked uncertain.`);
      }
      return finish("DONE");
    } catch (err) {
      return finish(onError(err, r, "Page verification did not complete. Findings that depend on the page itself are marked uncertain."));
    }
  }

  if (kind === "ground") {
    await progress("GROUNDING", "Checking every quotation against the source and applying evidence rules...", 0.95);
    const r = stageRecord(state, "GROUNDING", null);
    const t0 = now();
    // Legal corpus: each single-section CYFSA citation is looked up for the case date (deterministic lookup).
    const caseDate = caseDateFor(cm);
    const sources = deps.corpus ?? corpusSources();
    const citationCache = new Map<string, any>();
    for (const f of state.findings) {
      for (const l of f.legalIssues) {
        if (!l.citation) continue;
        try {
          const cacheKey = `${l.citation}:${caseDate.kind === "EXACT" ? caseDate.date : "UNKNOWN"}`;
          let found = citationCache.get(cacheKey);
          if (found === undefined) {
            found = await lookupCitation(l.citation, caseDate, sources);
            citationCache.set(cacheKey, found);
          }
          l.corpus = found ? { ...found, caseDate: caseDate.kind === "UNKNOWN" ? null : caseDate.date } : null;
          if (found?.outcome === "BEFORE_EARLIEST_VERSION") {
            f.grounding.notes.push(`${l.citation}: the case date ${caseDate.kind === "UNKNOWN" ? "" : caseDate.date + " "}is before the consolidation held (from ${found.effectiveFrom}); the version in force then was not checked.`);
          }
        } catch {
          l.corpus = { outcome: "LOOKUP_FAILED", requiresResearch: true, source: "legal corpus", effectiveFrom: null, verificationStatus: null, note: "The legal corpus could not be consulted; confirm with counsel.", caseDate: null };
        }
      }
    }
    const grounded = dedupeFindings(state.findings.map(groundFinding));
    r.durationMs = now() - t0;
    const material = grounded.filter(isMaterial);
    const appendix = grounded.filter((f) => !isMaterial(f));
    for (const h of state.hypotheses) h.findingIds = material.filter((f) => f.hypothesisId === h.id).map((f) => f.id);
    if (cm.droppedUngrounded > 0) {
      state.incompleteness.push(`${cm.droppedUngrounded} extracted item(s) were dropped because their quotation was not found in the source.`);
    }
    cm.openQuestions = state.openQuestions;
    const totals = state.stages.reduce(
      (t, s) => ({ calls: t.calls + s.calls, inputTokens: t.inputTokens + s.inputTokens, outputTokens: t.outputTokens + s.outputTokens, durationMs: t.durationMs }),
      { calls: 0, inputTokens: 0, outputTokens: 0, durationMs: now() - state.startedAt }
    );
    state.report = {
      schema: "forensic-engine-v1",
      // Partial whenever part of the record or the method was not covered, not only when a stage failed: a truncated
      // document, a call budget that ran out, or a review that read part of the record.
      status:
        state.stages.some((s) => s.status === "FAILED") ||
        state.budgetExhausted ||
        state.documents.some((d) => d.text.length > limits.maxCharsPerDocument) ||
        state.findings.some((f) => (f.review.partialRecord?.length ?? 0) > 0)
          ? "PARTIAL"
          : "COMPLETE",
      incompleteness: state.incompleteness,
      caseModel: cm,
      hypotheses: state.hypotheses,
      findings: material,
      appendix,
      injectionWarnings: state.injectionWarnings,
      stages: state.stages,
      totals,
    };
    return finish("DONE");
  }

  throw new Error(`Unknown engine step "${step}".`);
}

function ingestExtraction(state: EngineState, docs: CaseDocument[], doc: CaseDocument, raw: any) {
  const x = state.extraction;
  const dd = raw.documentDate;
  if (dd && String(dd.quote ?? "").trim()) {
    const ref = resolveEvidenceRef(docs, doc.id, String(dd.quote));
    if (ref.verified) {
      x.documentDates.push({
        documentId: doc.id,
        kind: oneOf(dd.kind, ["SWORN", "ISSUED", "ENDORSED", "WRITTEN"] as const, "UNKNOWN" as any) as DocumentDate["kind"],
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(dd.isoDate ?? "")) ? String(dd.isoDate) : null,
        dateText: String(dd.dateText ?? ""),
        source: ref,
      });
    } else {
      x.dropped++;
    }
  }
  for (const p of Array.isArray(raw.people) ? raw.people : []) {
    const ref = resolveEvidenceRef(docs, doc.id, String(p?.quote ?? p?.name ?? ""));
    if (!ref.verified) { x.dropped++; continue; }
    const name = String(p?.name ?? "").trim();
    const key = name.toLowerCase().replace(/[^a-z]/g, "");
    if (!key) { x.dropped++; continue; }
    const existing = x.people.find((q) => q.name.toLowerCase().replace(/[^a-z]/g, "") === key);
    const roles = (Array.isArray(p?.roles) ? p.roles : []).map(String).filter(Boolean);
    if (existing) {
      existing.mentions.push(ref);
      for (const role of roles) if (!existing.roles.includes(role)) existing.roles.push(role);
    } else {
      x.people.push({ id: `P${x.people.length + 1}`, name, roles, mentions: [ref] });
    }
  }
  for (const e of Array.isArray(raw.events) ? raw.events : []) {
    const ref = resolveEvidenceRef(docs, doc.id, String(e?.quote ?? ""));
    if (!ref.verified) { x.dropped++; continue; }
    x.events.push({
      id: `E${x.events.length + 1}`,
      description: String(e?.description ?? ""),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(e?.isoDate ?? "")) ? String(e.isoDate) : null,
      dateText: String(e?.dateText ?? ""),
      dateSource: oneOf(e?.dateSource, ["COURT_RECORD", "DOCUMENT_BODY", "FILENAME", "METADATA"] as const, "UNKNOWN" as any) as CaseEvent["dateSource"],
      participants: (Array.isArray(e?.participants) ? e.participants : []).map(String),
      sources: [ref],
    });
  }
  for (const c of Array.isArray(raw.claims) ? raw.claims : []) {
    const ref = resolveEvidenceRef(docs, doc.id, String(c?.quote ?? ""));
    if (!ref.verified) { x.dropped++; continue; }
    x.claims.push({
      id: `C${x.claims.length + 1}`,
      assertedBy: String(c?.assertedBy ?? ""),
      statement: String(c?.statement ?? ""),
      basis: oneOf(c?.basis, ["FIRSTHAND", "NAMED_SOURCE", "UNNAMED_SOURCE", "OPINION"] as const, "UNCLEAR" as any) as CaseClaim["basis"],
      sources: [ref],
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// What the adversarial review reads
// ---------------------------------------------------------------------------------------------------------------------

/** Characters of context kept on each side of a quoted passage when a document is reduced for the review. */
const REVIEW_WINDOW_CHARS = 2_500;

/**
 * The documents the adversarial review reads. Normally the whole record. When the record is larger than the review's
 * budget (a large multi-document case: up to 10 documents of 300,000 characters would be about 750,000 tokens in one
 * call), the review reads every document a finding cites, in full where its share of the budget allows and otherwise
 * as the passages around each quotation, and the reduction is stated in the report. It is never silent.
 */
export function reviewDocuments(
  docs: CaseDocument[],
  findings: Finding[],
  budget: number,
  maxCharsPerDocument: number
): { docs: CaseDocument[]; note: string | null; notFull: string[] } {
  const len = (d: CaseDocument) => Math.min(d.text.length, maxCharsPerDocument);
  const total = docs.reduce((n, d) => n + len(d), 0);
  if (total <= budget) return { docs, note: null, notFull: [] };
  const refs = findings.flatMap((f) => [...f.supporting, ...f.contradicting]);
  const citedOnly = docs.filter((d) => refs.some((r) => r.documentId === d.id));
  // Findings that cite nothing (information not recorded) are checked against the whole record, each document cut to
  // an equal share.
  const cited = citedOnly.length ? citedOnly : docs;
  const share = Math.floor(budget / Math.max(1, cited.length));
  let reduced = 0;
  const notFull = docs.filter((d) => !cited.includes(d)).map((d) => d.id);
  const out = cited.map((d) => {
    if (len(d) <= share) return d;
    reduced++;
    notFull.push(d.id);
    const spans = refs
      .filter((r) => r.documentId === d.id && r.startOffset !== null && r.endOffset !== null)
      .map((r) => [Math.max(0, r.startOffset! - REVIEW_WINDOW_CHARS), Math.min(d.text.length, r.endOffset! + REVIEW_WINDOW_CHARS)] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
      else merged.push([...sp]);
    }
    const text = merged.map(([a, b]) => `[Excerpt, characters ${a}-${b}]\n${d.text.slice(a, b)}`).join("\n[...]\n").slice(0, share);
    return { ...d, text: text || d.text.slice(0, share) };
  });
  const omitted = docs.length - cited.length;
  const parts = [
    omitted > 0 ? `${omitted} document(s) that no finding cites were not re-read` : "",
    reduced > 0 ? `${reduced} long document(s) were reduced to the passages around the quoted text` : "",
  ].filter(Boolean);
  return {
    docs: out,
    notFull: docs.filter((d) => notFull.includes(d.id)).map((d) => d.id),
    note: `The record is larger than the adversarial review reads in one pass: ${parts.join(", and ")}. The review could not look for contrary text outside what it read.`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Independent steps in parallel
// ---------------------------------------------------------------------------------------------------------------------

/** Model calls a batch of independent steps may have in flight at once. */
export const MAX_PARALLEL_STEPS = 4;
const PARALLEL_KINDS = new Set(["extract", "investigate"]);

/**
 * The next step and the pending steps after it that do not depend on each other: per-document extraction, and
 * per-document investigation in multi-pass runs. Each makes one model call, so the batch is capped by the calls left.
 */
export function parallelSteps(state: EngineState, max = MAX_PARALLEL_STEPS): string[] {
  const first = nextStep(state);
  if (!first) return [];
  const [kind, docId] = first.split(":");
  if (!PARALLEL_KINDS.has(kind) || !docId) return [first];
  const cap = Math.max(1, Math.min(max, state.limits.maxCalls - state.calls));
  const out: string[] = [];
  for (const s of state.plan.slice(state.plan.indexOf(first))) {
    if (state.done.includes(s)) continue;
    const [k, d] = s.split(":");
    if (k !== kind || !d || out.length >= cap) break;
    out.push(s);
  }
  return out;
}

/**
 * Runs independent steps with their model calls in parallel, and returns exactly the state that running them one
 * after another would: every step first runs against the same input with its call recorded, then the steps are
 * replayed in plan order against the evolving state, each receiving its recorded result (or error) instead of a new
 * call. The replay uses the time the batch started, so the deadline check matches the one the call passed.
 */
export async function runEngineSteps(input: EngineState, steps: string[], deps: StepDeps): Promise<{ state: EngineState; outcomes: Record<string, StepOutcome> }> {
  if (steps.length === 1) {
    const r = await runEngineStep(input, steps[0], deps);
    return { state: r.state, outcomes: { [steps[0]]: r.outcome } };
  }
  const startedAt = (deps.now ?? Date.now)();
  const recorded = new Map<string, { ok: true; res: GenerateResult } | { ok: false; err: unknown }>();
  await Promise.allSettled(
    steps.map((step) =>
      runEngineStep(input, step, {
        ...deps,
        onProgress: undefined,
        generate: async (p, model) => {
          try {
            const res = await deps.generate(p, model);
            recorded.set(step, { ok: true, res });
            return res;
          } catch (err) {
            recorded.set(step, { ok: false, err });
            throw err;
          }
        },
      })
    )
  );
  let state = input;
  const outcomes: Record<string, StepOutcome> = {};
  for (const step of steps) {
    const r = await runEngineStep(state, step, {
      ...deps,
      now: () => startedAt,
      generate: async (p, model) => {
        const rec = recorded.get(step);
        if (!rec) return deps.generate(p, model);
        recorded.delete(step);
        if (rec.ok === true) return rec.res;
        throw rec.err;
      },
    });
    state = r.state;
    outcomes[step] = r.outcome;
  }
  return { state, outcomes };
}

// ---------------------------------------------------------------------------------------------------------------------
// Whole run in one invocation
// ---------------------------------------------------------------------------------------------------------------------

export interface ForensicRunOptions {
  documents: CaseDocument[];
  generate: GenerateFn;
  models: ForensicModels;
  limits?: Partial<ForensicLimits>;
  deadlineAt: number;
  requestId: string;
  now?: () => number;
  onProgress?: (p: ForensicProgress) => void | Promise<void>;
}

/** Runs every step in this invocation. A stage that fails is recorded, never retried, and the report says so. */
export async function runForensicInvestigation(opts: ForensicRunOptions): Promise<ForensicReport> {
  const created = createEngineState({ documents: opts.documents, models: opts.models, limits: opts.limits, requestId: opts.requestId, now: (opts.now ?? Date.now)() });
  let state = created.state;
  const deps: StepDeps = { generate: opts.generate, deadlineAt: opts.deadlineAt, media: created.media, now: opts.now, onProgress: opts.onProgress, resumable: false };
  for (let steps = parallelSteps(state); steps.length > 0; steps = parallelSteps(state)) {
    ({ state } = await runEngineSteps(state, steps, deps));
  }
  return state.report!;
}
