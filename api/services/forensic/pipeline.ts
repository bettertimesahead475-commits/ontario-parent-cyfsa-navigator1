/**
 * Forensic Engine pipeline. Separate from the existing sectioned analyzer (api/services/analyzerSections.ts), which
 * keeps serving Quick Review and the current Forensic report unchanged. The server calls it only when the
 * FORENSIC_ENGINE_ENABLED flag is on (api/services/forensic/integration.ts).
 *
 * Stages:
 *   1. EXTRACTION (auxiliary model, one call per document): the document's own date, people, dated events, claims,
 *      each with a quotation. Items whose quotation is not in the document are dropped and counted.
 *   2. Case model (deterministic): people merged across documents, chronology, chronology anomalies and conflict
 *      leads (caseAnalysis.ts). Leads are hints for the investigator, never findings.
 *   3. INVESTIGATION (Claude Opus): open-ended hypotheses and findings over the whole record. When the record is
 *      larger than one pass allows, each document is investigated separately and a SYNTHESIS pass (Claude Opus)
 *      looks for what only the whole record shows.
 *   4. ADVERSARIAL_REVIEW (Claude Opus, separate call and prompt): tries to falsify each finding, with the verbatim
 *      statute text for every verified provision a finding cites.
 *   5. VISUAL_VERIFICATION (multimodal): findings that depend on the page (check boxes, handwriting, stamps) are
 *      checked against the original PDF or image, or supplied page images.
 *   6. GROUNDING (deterministic): grounding.ts rules, duplicate merge, appendix for everything not material.
 *
 * Failure handling: a failed stage is recorded and the report is PARTIAL with a plain statement of what is missing.
 * A failed investigation produces no findings; it never produces findings from a weaker stage instead.
 * Cost controls: a call budget, a per-document character cap, per-stage output caps, and an overall deadline.
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
  type StageRecord,
} from "./caseModel.js";
import { buildChronology, findChronologyAnomalies, findConflictLeads, type DocumentDate } from "./caseAnalysis.js";
import { detectInstructionLikeText, isolateDocuments } from "./documentIsolation.js";
import { applyReview, dedupeFindings, groundFinding, isMaterial, parseFindingCandidates } from "./grounding.js";
import { EXTRACTION_SYSTEM, INVESTIGATION_SYSTEM, REVIEW_SYSTEM, SYNTHESIS_SYSTEM, VISUAL_SYSTEM } from "./prompts.js";

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
  maxCalls: 24,
  extractionMaxTokens: 8_000,
  investigationMaxTokens: 32_000,
  synthesisMaxTokens: 24_000,
  reviewMaxTokens: 16_000,
  visualMaxTokens: 4_000,
  stageTimeoutMs: 240_000,
};

export interface ForensicProgress {
  stage: StageRecord["stage"];
  message: string;
  /** 0..1 within the engine's own run. */
  fraction: number;
}

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

class BudgetExceeded extends Error {}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(String(v ?? "").toUpperCase()) ? (String(v).toUpperCase() as T) : fallback;

export async function runForensicInvestigation(opts: ForensicRunOptions): Promise<ForensicReport> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const now = opts.now ?? Date.now;
  const started = now();
  const stages: StageRecord[] = [];
  const incompleteness: string[] = [];
  const docs = opts.documents;
  let calls = 0;
  const progress = async (stage: StageRecord["stage"], message: string, fraction: number) => {
    try {
      await opts.onProgress?.({ stage, message, fraction });
    } catch {
      // Progress reporting never affects the analysis.
    }
  };

  const call = async (stage: StageRecord["stage"], model: string, system: string, content: any, maxTokens: number): Promise<GenerateResult> => {
    if (calls >= limits.maxCalls) throw new BudgetExceeded(`Call budget of ${limits.maxCalls} reached.`);
    const remaining = opts.deadlineAt - now();
    if (remaining <= 1_000) throw new BudgetExceeded("Analysis deadline reached.");
    calls++;
    return opts.generate(
      {
        system,
        messages: [{ role: "user", content }],
        max_tokens: maxTokens,
        timeoutMs: Math.min(limits.stageTimeoutMs, remaining),
        retries: 1,
        requestId: opts.requestId,
        stage: `forensic_${stage.toLowerCase()}`,
        mode: "full",
      },
      model
    );
  };

  const record = (stage: StageRecord["stage"], model: string | null): StageRecord => {
    const r: StageRecord = { stage, status: "COMPLETED", model, calls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, error: null };
    stages.push(r);
    return r;
  };
  const account = (r: StageRecord, res: GenerateResult) => {
    r.calls++;
    r.inputTokens += res.usage?.input_tokens ?? 0;
    r.outputTokens += res.usage?.output_tokens ?? 0;
    r.durationMs += res.durationMs ?? 0;
  };
  const fail = (r: StageRecord, err: unknown, consequence: string) => {
    r.status = "FAILED";
    r.error = err instanceof Error ? err.message : String(err);
    incompleteness.push(consequence);
  };

  const injectionWarnings = detectInstructionLikeText(docs);
  if (injectionWarnings.length > 0) {
    incompleteness.push(
      `${injectionWarnings.length} passage(s) in the documents read like instructions to an AI. They were treated as evidence and not followed.`
    );
  }
  for (const d of docs) {
    if (d.text.length > limits.maxCharsPerDocument) {
      incompleteness.push(`Document "${d.title}" was truncated at ${limits.maxCharsPerDocument} characters; the remainder was not analyzed.`);
    }
  }

  // 1. Extraction ----------------------------------------------------------------------------------------------
  await progress("EXTRACTION", "Indexing people, dates and claims in each document...", 0.05);
  const extraction = record("EXTRACTION", opts.models.extractor);
  const people = new Map<string, CasePerson>();
  const events: CaseEvent[] = [];
  const claims: CaseClaim[] = [];
  const documentDates: DocumentDate[] = [];
  let dropped = 0;
  for (const doc of docs) {
    try {
      const iso = isolateDocuments([doc], limits.maxCharsPerDocument);
      const res = await call("EXTRACTION", opts.models.extractor, `${EXTRACTION_SYSTEM}\n\n${iso.systemNotice}`, iso.content, limits.extractionMaxTokens);
      account(extraction, res);
      const raw = parseJsonLenient(res.text) ?? {};
      const dd = raw.documentDate;
      if (dd && String(dd.quote ?? "").trim()) {
        const ref = resolveEvidenceRef(docs, doc.id, String(dd.quote));
        if (ref.verified) {
          documentDates.push({
            documentId: doc.id,
            kind: oneOf(dd.kind, ["SWORN", "ISSUED", "ENDORSED", "WRITTEN"] as const, "UNKNOWN"),
            date: /^\d{4}-\d{2}-\d{2}$/.test(String(dd.isoDate ?? "")) ? String(dd.isoDate) : null,
            dateText: String(dd.dateText ?? ""),
            source: ref,
          });
        } else {
          dropped++;
        }
      }
      for (const p of Array.isArray(raw.people) ? raw.people : []) {
        const ref = resolveEvidenceRef(docs, doc.id, String(p?.quote ?? p?.name ?? ""));
        if (!ref.verified) { dropped++; continue; }
        const name = String(p?.name ?? "").trim();
        const key = name.toLowerCase().replace(/[^a-z]/g, "");
        if (!key) { dropped++; continue; }
        const existing = people.get(key);
        const roles = (Array.isArray(p?.roles) ? p.roles : []).map(String).filter(Boolean);
        if (existing) {
          existing.mentions.push(ref);
          for (const r of roles) if (!existing.roles.includes(r)) existing.roles.push(r);
        } else {
          people.set(key, { id: `P${people.size + 1}`, name, roles, mentions: [ref] });
        }
      }
      for (const e of Array.isArray(raw.events) ? raw.events : []) {
        const ref = resolveEvidenceRef(docs, doc.id, String(e?.quote ?? ""));
        if (!ref.verified) { dropped++; continue; }
        events.push({
          id: `E${events.length + 1}`,
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
        if (!ref.verified) { dropped++; continue; }
        claims.push({
          id: `C${claims.length + 1}`,
          assertedBy: String(c?.assertedBy ?? ""),
          statement: String(c?.statement ?? ""),
          basis: oneOf(c?.basis, ["FIRSTHAND", "NAMED_SOURCE", "UNNAMED_SOURCE", "OPINION"] as const, "UNCLEAR" as any) as CaseClaim["basis"],
          sources: [ref],
        });
      }
    } catch (err) {
      fail(extraction, err, `Extraction did not complete for "${doc.title}". The investigation read the document directly without an index for it.`);
      if (err instanceof BudgetExceeded) break;
    }
  }

  // 2. Case model ----------------------------------------------------------------------------------------------
  const chronology = buildChronology(events);
  const caseModel: CaseModel = {
    documents: docs.map(({ id, title, kind, extractionMethod }) => ({ id, title, kind, extractionMethod })),
    people: [...people.values()],
    events: chronology.map((c) => events.find((e) => e.id === c.eventId)!),
    claims,
    relations: [],
    documentDates,
    chronology,
    chronologyAnomalies: findChronologyAnomalies(events, documentDates),
    conflictLeads: findConflictLeads(events, claims),
    openQuestions: [],
    droppedUngrounded: dropped,
  };
  const index = (docFilter?: string) =>
    JSON.stringify({
      documentDates: caseModel.documentDates.map((d) => ({ document: d.documentId, kind: d.kind, date: d.date, dateText: d.dateText })),
      people: caseModel.people.map((p) => ({ name: p.name, roles: p.roles })),
      chronology: caseModel.chronology.filter((c) => !docFilter || c.documentId === docFilter),
      claims: caseModel.claims
        .filter((c) => !docFilter || c.sources[0]?.documentId === docFilter)
        .map((c) => ({ id: c.id, assertedBy: c.assertedBy, basis: c.basis, statement: c.statement, document: c.sources[0]?.documentId, page: c.sources[0]?.page })),
      leads: [...caseModel.chronologyAnomalies, ...caseModel.conflictLeads],
    });

  // 3. Investigation (single pass, or per document + synthesis) -------------------------------------------------
  const investigation = record("INVESTIGATION", opts.models.investigator);
  let findings: Finding[] = [];
  let hypotheses: Hypothesis[] = [];
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

  const totalChars = docs.reduce((s, d) => s + Math.min(d.text.length, limits.maxCharsPerDocument), 0);
  const multiPass = totalChars > limits.singlePassMaxChars && docs.length > 1;
  await progress("INVESTIGATION", "Claude Opus is investigating the record...", 0.2);
  if (!multiPass) {
    try {
      const iso = isolateDocuments(docs, limits.maxCharsPerDocument);
      const res = await call(
        "INVESTIGATION",
        opts.models.investigator,
        `${INVESTIGATION_SYSTEM}\n\n${iso.systemNotice}`,
        `CASE MODEL AND LEADS (machine-extracted; verify against the documents):\n${index()}\n\nDOCUMENTS:\n${iso.content}`,
        limits.investigationMaxTokens
      );
      account(investigation, res);
      const raw = parseJsonLenient(res.text);
      if (!raw || !Array.isArray(raw.findings)) throw new Error("Investigation returned no findings array.");
      findings = takeFindings(raw, "");
      hypotheses = takeHypotheses(raw, "");
      caseModel.openQuestions = takeQuestions(raw);
    } catch (err) {
      fail(investigation, err, "The investigation stage did not complete, so this report contains no findings. Re-run the analysis.");
    }
  } else {
    let completedDocs = 0;
    for (const [i, doc] of docs.entries()) {
      try {
        const iso = isolateDocuments([doc], limits.maxCharsPerDocument);
        const res = await call(
          "INVESTIGATION",
          opts.models.investigator,
          `${INVESTIGATION_SYSTEM}\n\n${iso.systemNotice}`,
          `CASE MODEL AND LEADS for the whole record (machine-extracted; verify against the documents):\n${index()}\n\nDOCUMENT ${i + 1} of ${docs.length}:\n${iso.content}`,
          limits.investigationMaxTokens
        );
        account(investigation, res);
        const raw = parseJsonLenient(res.text);
        if (!raw || !Array.isArray(raw.findings)) throw new Error(`Investigation of "${doc.title}" returned no findings array.`);
        findings.push(...takeFindings(raw, `${doc.id}:`));
        hypotheses.push(...takeHypotheses(raw, `${doc.id}:`));
        caseModel.openQuestions.push(...takeQuestions(raw));
        completedDocs++;
      } catch (err) {
        fail(investigation, err, `The investigation of "${doc.title}" did not complete; it has no document-level findings.`);
        if (err instanceof BudgetExceeded) break;
      }
      await progress("INVESTIGATION", `Investigated ${i + 1} of ${docs.length} documents...`, 0.2 + 0.35 * ((i + 1) / docs.length));
    }
    const synthesis = record("SYNTHESIS", opts.models.investigator);
    if (completedDocs === 0) {
      synthesis.status = "SKIPPED";
    } else {
      try {
        const perDoc = Math.max(4_000, Math.floor(limits.singlePassMaxChars / docs.length));
        const iso = isolateDocuments(docs, perDoc);
        const summary = findings.map((f) => ({ id: f.id, title: f.title, statement: f.statement, class: f.evidenceClass, quotes: f.supporting.map((r) => ({ documentId: r.documentId, page: r.page, quote: r.quote })) }));
        const res = await call(
          "SYNTHESIS",
          opts.models.investigator,
          `${SYNTHESIS_SYSTEM}\n\n${iso.systemNotice}`,
          `CASE MODEL AND LEADS:\n${index()}\n\nPER-DOCUMENT FINDINGS:\n${JSON.stringify(summary)}\n\nDOCUMENTS (each truncated to ${perDoc} characters for this pass):\n${iso.content}`,
          limits.synthesisMaxTokens
        );
        account(synthesis, res);
        const raw = parseJsonLenient(res.text);
        if (!raw || !Array.isArray(raw.findings)) throw new Error("Synthesis returned no findings array.");
        findings.push(...takeFindings(raw, "case:"));
        hypotheses.push(...takeHypotheses(raw, "case:"));
        caseModel.openQuestions.push(...takeQuestions(raw));
      } catch (err) {
        fail(synthesis, err, "The case-level synthesis did not complete. Cross-document findings may be missing.");
      }
    }
  }

  // 4. Adversarial review ---------------------------------------------------------------------------------------
  await progress("ADVERSARIAL_REVIEW", "Independent adversarial review is trying to falsify each finding...", 0.6);
  const review = record("ADVERSARIAL_REVIEW", opts.models.reviewer);
  if (findings.length === 0) {
    review.status = "SKIPPED";
  } else {
    try {
      const iso = isolateDocuments(docs, limits.maxCharsPerDocument);
      const proposed = findings.map((f) => ({
        findingId: f.id,
        title: f.title,
        statement: f.statement,
        evidenceClass: f.evidenceClass,
        supporting: f.supporting.map((r) => ({ documentId: r.documentId, quote: r.quote, page: r.page, foundInSource: r.verified })),
        contradicting: f.contradicting.map((r) => ({ documentId: r.documentId, quote: r.quote, page: r.page, foundInSource: r.verified })),
        legalIssues: f.legalIssues.map((l) => ({ citation: l.citation, explanation: l.explanation, citationStatus: l.citationStatus })),
      }));
      const statutes = new Map<string, string>();
      for (const f of findings) for (const l of f.legalIssues) if (l.statuteText) statutes.set(l.citation, l.statuteText);
      const statuteBlock = statutes.size
        ? `\n\nSTATUTE TEXT (verbatim from the bundled CYFSA consolidation):\n${[...statutes].map(([c, t]) => `[${c}]\n${t}`).join("\n\n")}`
        : "\n\nSTATUTE TEXT: none supplied; every cited provision is unverified.";
      const res = await call(
        "ADVERSARIAL_REVIEW",
        opts.models.reviewer,
        `${REVIEW_SYSTEM}\n\n${iso.systemNotice}`,
        `PROPOSED FINDINGS:\n${JSON.stringify(proposed)}${statuteBlock}\n\nDOCUMENTS:\n${iso.content}`,
        limits.reviewMaxTokens
      );
      account(review, res);
      const raw = parseJsonLenient(res.text);
      if (!raw || !Array.isArray(raw.reviews)) throw new Error("Review returned no reviews array.");
      findings = applyReview(findings, raw.reviews, docs);
      const unreviewed = findings.filter((f) => f.review.verdict === "NOT_REVIEWED").length;
      if (unreviewed > 0) incompleteness.push(`${unreviewed} finding(s) were not addressed by the adversarial review.`);
    } catch (err) {
      fail(review, err, "The adversarial review did not complete. Findings are unreviewed; none can be reported as confirmed noncompliance.");
    }
  }

  // 5. Visual verification ----------------------------------------------------------------------------------------
  await progress("VISUAL_VERIFICATION", "Checking page-dependent findings against the original pages...", 0.85);
  const visual = record("VISUAL_VERIFICATION", opts.models.visual ?? opts.models.reviewer);
  const needsVisual = findings.filter((f) => f.dependsOnVisual && f.review.verdict !== "REJECTED");
  const visualSource = (f: Finding) => {
    for (const r of f.supporting) {
      const d = docs.find((x) => x.id === r.documentId);
      if (!d) continue;
      if (r.page !== null && d.pageImages?.[r.page]) return { doc: d, page: r.page, kind: "page" as const };
      if (d.sourceFile) return { doc: d, page: r.page, kind: "file" as const };
    }
    return null;
  };
  const checkable = needsVisual.filter((f) => visualSource(f) !== null);
  if (needsVisual.length === 0) {
    visual.status = "SKIPPED";
  } else if (checkable.length === 0) {
    visual.status = "SKIPPED";
    incompleteness.push(`${needsVisual.length} finding(s) depend on the page itself, but no page image or original file was available. They are marked uncertain.`);
  } else {
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
      const res = await call("VISUAL_VERIFICATION", visual.model!, VISUAL_SYSTEM, content, limits.visualMaxTokens);
      account(visual, res);
      const raw = parseJsonLenient(res.text);
      const results = new Map<string, any>((Array.isArray(raw?.results) ? raw.results : []).map((r: any) => [String(r?.findingId), r]));
      findings = findings.map((f) => {
        const r = results.get(f.id);
        if (!r) return f;
        return {
          ...f,
          visualVerification: oneOf(r.verdict, ["CONFIRMED", "CONTRADICTED"] as const, "INCONCLUSIVE" as any) as Finding["visualVerification"],
          visualNote: String(r.observation ?? ""),
        };
      });
      if (checkable.length < needsVisual.length) {
        incompleteness.push(`${needsVisual.length - checkable.length} page-dependent finding(s) had no page image or original file and are marked uncertain.`);
      }
    } catch (err) {
      fail(visual, err, "Page verification did not complete. Findings that depend on the page itself are marked uncertain.");
    }
  }

  // 6. Grounding -------------------------------------------------------------------------------------------------
  await progress("GROUNDING", "Checking every quotation against the source and applying evidence rules...", 0.95);
  const grounding = record("GROUNDING", null);
  const t0 = now();
  const grounded = dedupeFindings(findings.map(groundFinding));
  grounding.durationMs = now() - t0;
  const material = grounded.filter(isMaterial);
  const appendix = grounded.filter((f) => !isMaterial(f));
  for (const h of hypotheses) h.findingIds = material.filter((f) => f.hypothesisId === h.id).map((f) => f.id);
  if (caseModel.droppedUngrounded > 0) {
    incompleteness.push(`${caseModel.droppedUngrounded} extracted item(s) were dropped because their quotation was not found in the source.`);
  }

  const totals = stages.reduce(
    (t, s) => ({ calls: t.calls + s.calls, inputTokens: t.inputTokens + s.inputTokens, outputTokens: t.outputTokens + s.outputTokens, durationMs: t.durationMs }),
    { calls: 0, inputTokens: 0, outputTokens: 0, durationMs: now() - started }
  );
  const failed = stages.some((s) => s.status === "FAILED");
  return {
    schema: "forensic-engine-v1",
    status: failed ? "PARTIAL" : "COMPLETE",
    incompleteness,
    caseModel,
    hypotheses,
    findings: material,
    appendix,
    injectionWarnings,
    stages,
    totals,
  };
}
