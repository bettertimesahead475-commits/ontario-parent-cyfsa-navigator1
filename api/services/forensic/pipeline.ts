/**
 * Forensic Engine pipeline. Separate from the existing sectioned analyzer (api/services/analyzerSections.ts), which
 * keeps serving Quick Review and the current Forensic report unchanged. Nothing here is wired to a route yet.
 *
 * Stages:
 *   1. EXTRACTION (auxiliary model, one call per document): people, dated events, claims, each with a quotation.
 *      Items whose quotation is not in the document are dropped and counted.
 *   2. Case model (deterministic): merges people across documents, orders events, keeps every source reference.
 *   3. INVESTIGATION (Claude Opus): open-ended hypotheses and findings over the whole record and the case model.
 *   4. ADVERSARIAL_REVIEW (Claude Opus, separate call and prompt): tries to falsify each finding.
 *   5. VISUAL_VERIFICATION (multimodal, only for findings that depend on a page image and only where images exist).
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
import { detectInstructionLikeText, isolateDocuments } from "./documentIsolation.js";
import { applyReview, dedupeFindings, groundFinding, isMaterial, parseFindingCandidates } from "./grounding.js";
import { EXTRACTION_SYSTEM, INVESTIGATION_SYSTEM, REVIEW_SYSTEM, VISUAL_SYSTEM } from "./prompts.js";

export interface ForensicModels {
  /** Auxiliary model for extraction. */
  extractor: string;
  /** Claude Opus: substantive investigation. */
  investigator: string;
  /** Claude Opus: adversarial review. A separate call with a separate prompt, even when the model id is the same. */
  reviewer: string;
  /** Multimodal model for page-image checks. Defaults to the reviewer. */
  visual?: string;
}

export interface ForensicLimits {
  maxCharsPerDocument: number;
  maxCalls: number;
  extractionMaxTokens: number;
  investigationMaxTokens: number;
  reviewMaxTokens: number;
  visualMaxTokens: number;
  stageTimeoutMs: number;
}

export const DEFAULT_LIMITS: ForensicLimits = {
  maxCharsPerDocument: 300_000,
  maxCalls: 16,
  extractionMaxTokens: 8_000,
  investigationMaxTokens: 32_000,
  reviewMaxTokens: 16_000,
  visualMaxTokens: 4_000,
  stageTimeoutMs: 240_000,
};

export interface ForensicRunOptions {
  documents: CaseDocument[];
  generate: GenerateFn;
  models: ForensicModels;
  limits?: Partial<ForensicLimits>;
  deadlineAt: number;
  requestId: string;
  now?: () => number;
}

class BudgetExceeded extends Error {}

export async function runForensicInvestigation(opts: ForensicRunOptions): Promise<ForensicReport> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const now = opts.now ?? Date.now;
  const started = now();
  const stages: StageRecord[] = [];
  const incompleteness: string[] = [];
  const docs = opts.documents;
  let calls = 0;

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
  const extraction = record("EXTRACTION", opts.models.extractor);
  const people = new Map<string, CasePerson>();
  const events: CaseEvent[] = [];
  const claims: CaseClaim[] = [];
  let dropped = 0;
  for (const doc of docs) {
    try {
      const iso = isolateDocuments([doc], limits.maxCharsPerDocument);
      const res = await call("EXTRACTION", opts.models.extractor, `${EXTRACTION_SYSTEM}\n\n${iso.systemNotice}`, iso.content, limits.extractionMaxTokens);
      account(extraction, res);
      const raw = parseJsonLenient(res.text) ?? {};
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
        const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(String(e?.isoDate ?? "")) ? String(e.isoDate) : null;
        const ds = String(e?.dateSource ?? "UNKNOWN").toUpperCase();
        events.push({
          id: `E${events.length + 1}`,
          description: String(e?.description ?? ""),
          date: isoDate,
          dateText: String(e?.dateText ?? ""),
          dateSource: (["COURT_RECORD", "DOCUMENT_BODY", "FILENAME", "METADATA"].includes(ds) ? ds : "UNKNOWN") as CaseEvent["dateSource"],
          participants: (Array.isArray(e?.participants) ? e.participants : []).map(String),
          sources: [ref],
        });
      }
      for (const c of Array.isArray(raw.claims) ? raw.claims : []) {
        const ref = resolveEvidenceRef(docs, doc.id, String(c?.quote ?? ""));
        if (!ref.verified) { dropped++; continue; }
        const basis = String(c?.basis ?? "UNCLEAR").toUpperCase();
        claims.push({
          id: `C${claims.length + 1}`,
          assertedBy: String(c?.assertedBy ?? ""),
          statement: String(c?.statement ?? ""),
          basis: (["FIRSTHAND", "NAMED_SOURCE", "UNNAMED_SOURCE", "OPINION"].includes(basis) ? basis : "UNCLEAR") as CaseClaim["basis"],
          sources: [ref],
        });
      }
    } catch (err) {
      fail(extraction, err, `Extraction did not complete for "${doc.title}". The investigation read the document directly without an index for it.`);
      if (err instanceof BudgetExceeded) break;
    }
  }
  events.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  const caseModel: CaseModel = {
    documents: docs.map(({ id, title, kind, extractionMethod }) => ({ id, title, kind, extractionMethod })),
    people: [...people.values()],
    events,
    claims,
    relations: [],
    openQuestions: [],
    droppedUngrounded: dropped,
  };

  // 3. Investigation ---------------------------------------------------------------------------------------------
  const investigation = record("INVESTIGATION", opts.models.investigator);
  let findings: Finding[] = [];
  let hypotheses: Hypothesis[] = [];
  try {
    const iso = isolateDocuments(docs, limits.maxCharsPerDocument);
    const index = JSON.stringify({
      people: caseModel.people.map((p) => ({ name: p.name, roles: p.roles })),
      events: caseModel.events.map((e) => ({ id: e.id, date: e.date, dateText: e.dateText, dateSource: e.dateSource, description: e.description, document: e.sources[0]?.documentId, page: e.sources[0]?.page })),
      claims: caseModel.claims.map((c) => ({ id: c.id, assertedBy: c.assertedBy, basis: c.basis, statement: c.statement, document: c.sources[0]?.documentId, page: c.sources[0]?.page })),
    });
    const res = await call(
      "INVESTIGATION",
      opts.models.investigator,
      `${INVESTIGATION_SYSTEM}\n\n${iso.systemNotice}`,
      `CASE MODEL (machine-extracted index; verify against the documents):\n${index}\n\nDOCUMENTS:\n${iso.content}`,
      limits.investigationMaxTokens
    );
    account(investigation, res);
    const raw = parseJsonLenient(res.text);
    if (!raw || !Array.isArray(raw.findings)) throw new Error("Investigation returned no findings array.");
    findings = parseFindingCandidates(raw.findings, docs);
    hypotheses = (Array.isArray(raw.hypotheses) ? raw.hypotheses : []).map((h: any, i: number): Hypothesis => ({
      id: String(h?.id ?? `H${i + 1}`),
      question: String(h?.question ?? ""),
      rationale: String(h?.rationale ?? ""),
      outcome: (["SUPPORTED", "UNDERMINED", "MIXED"].includes(String(h?.outcome).toUpperCase()) ? String(h.outcome).toUpperCase() : "UNRESOLVED") as Hypothesis["outcome"],
      findingIds: [],
    }));
    caseModel.openQuestions = (Array.isArray(raw.openQuestions) ? raw.openQuestions : []).map(String).filter(Boolean);
  } catch (err) {
    fail(investigation, err, "The investigation stage did not complete, so this report contains no findings. Re-run the analysis.");
  }

  // 4. Adversarial review ---------------------------------------------------------------------------------------
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
        legalIssues: f.legalIssues.map((l) => ({ citation: l.citation, explanation: l.explanation })),
      }));
      const res = await call(
        "ADVERSARIAL_REVIEW",
        opts.models.reviewer,
        `${REVIEW_SYSTEM}\n\n${iso.systemNotice}`,
        `PROPOSED FINDINGS:\n${JSON.stringify(proposed)}\n\nDOCUMENTS:\n${iso.content}`,
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
  const visual = record("VISUAL_VERIFICATION", opts.models.visual ?? opts.models.reviewer);
  const needsVisual = findings.filter((f) => f.dependsOnVisual && f.review.verdict !== "REJECTED");
  const withImage = needsVisual.filter((f) =>
    f.supporting.some((r) => r.page !== null && docs.find((d) => d.id === r.documentId)?.pageImages?.[r.page])
  );
  if (needsVisual.length === 0) {
    visual.status = "SKIPPED";
  } else if (withImage.length === 0) {
    visual.status = "SKIPPED";
    incompleteness.push(`${needsVisual.length} finding(s) depend on a page image, but no page images were supplied. They are marked uncertain.`);
  } else {
    try {
      const content: any[] = [];
      const questions: any[] = [];
      for (const f of withImage) {
        const ref = f.supporting.find((r) => r.page !== null && docs.find((d) => d.id === r.documentId)?.pageImages?.[r.page!])!;
        const img = docs.find((d) => d.id === ref.documentId)!.pageImages![ref.page!];
        content.push({ type: "text", text: `Image for finding ${f.id}: document ${ref.documentId}, page ${ref.page}.` });
        content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
        questions.push({ findingId: f.id, statement: f.statement });
      }
      content.push({ type: "text", text: `QUESTIONS:\n${JSON.stringify(questions)}` });
      const res = await call("VISUAL_VERIFICATION", visual.model!, VISUAL_SYSTEM, content, limits.visualMaxTokens);
      account(visual, res);
      const raw = parseJsonLenient(res.text);
      const results = new Map<string, any>((Array.isArray(raw?.results) ? raw.results : []).map((r: any) => [String(r?.findingId), r]));
      findings = findings.map((f) => {
        const r = results.get(f.id);
        if (!r) return f;
        const v = String(r.verdict).toUpperCase();
        return {
          ...f,
          visualVerification: (["CONFIRMED", "CONTRADICTED"].includes(v) ? v : "INCONCLUSIVE") as Finding["visualVerification"],
          visualNote: String(r.observation ?? ""),
        };
      });
    } catch (err) {
      fail(visual, err, "Page-image verification did not complete. Findings that depend on a page image are marked uncertain.");
    }
  }

  // 6. Grounding -------------------------------------------------------------------------------------------------
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
