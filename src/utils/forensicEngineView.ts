/**
 * View model for the Forensic Engine record attached to a report (report.forensicEngine). Shared by the screen
 * (ForensicEngineRecord.tsx) and the PDF export, so both show the same facts. Pure; no rendering.
 */

const CLASS_LABEL: Record<string, string> = {
  A: "Confirmed fact in source document",
  B: "Information not recorded in source",
  C: "Inference requiring verification",
  D: "Potential legal issue",
  E: "Confirmed legal noncompliance",
};
const GROUNDING_LABEL: Record<string, string> = {
  UNSUPPORTED: "Not supported by the source",
  REJECTED_BY_REVIEW: "Rejected by adversarial review",
  DUPLICATE: "Merged into another finding",
};
const VERDICT_LABEL: Record<string, string> = {
  UPHELD: "Upheld by adversarial review",
  QUALIFIED: "Qualified by adversarial review",
  REJECTED: "Rejected by adversarial review",
  NOT_REVIEWED: "Not reviewed",
};

export interface EngineFindingView {
  id: string;
  title: string;
  significance: "high" | "medium" | "low";
  /** True for confirmed facts (A) and confirmed noncompliance (E); the rest are leads and questions for counsel. */
  established: boolean;
  /** Distinct documents whose text supports the finding. */
  documentsSupporting: number;
  /** The adversarial review read only part of the record for this finding. */
  reviewedPartially: boolean;
  statement: string;
  classLabel: string;
  review: string;
  uncertainty: string;
  sources: Array<{ where: string; quote: string; verified: boolean }>;
  counter: Array<{ where: string; quote: string }>;
  alternatives: string[];
  missing: string[];
  citations: Array<{ citation: string; status: string; statuteText: string | null; corpusNote: string | null }>;
  visual: string;
  notes: string[];
}

export interface EngineRecordView {
  status: "COMPLETE" | "PARTIAL";
  incompleteness: string[];
  injectionWarnings: Array<{ where: string; excerpt: string }>;
  hypotheses: Array<{ question: string; outcome: string }>;
  /** Deterministic summary: counts and the high-significance findings. No model wrote it. */
  summary: { established: number; leads: number; setAside: number; highSignificance: string[] };
  /** Ranked: significance, then evidence class (E, A, D, C, B), then uncertainty. Established findings first. */
  findings: EngineFindingView[];
  /** Dated events whose quotation was located in the source, in date order, with where the date came from. */
  chronology: Array<{ date: string; description: string; where: string; quote: string; dateSource: string }>;
  documentDates: Array<{ document: string; kind: string; date: string; quote: string }>;
  /** Every provision cited by a finding, once, with its check status and the findings that rely on it. */
  authorities: Array<{ citation: string; status: string; findings: string[] }>;
  /** Missing information named by the findings, once each: what to request in disclosure. */
  missingEvidence: string[];
  setAside: Array<{ title: string; reason: string; notes: string[] }>;
  openQuestions: string[];
}

const DATE_SOURCE_LABEL: Record<string, string> = {
  COURT_RECORD: "Court or event date in the record",
  DOCUMENT_BODY: "Date stated in the document",
  FILENAME: "Date from a filename only",
  METADATA: "Date from file metadata only",
};
const SIGNIFICANCE_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const CLASS_ORDER: Record<string, number> = { E: 0, A: 1, D: 2, C: 3, B: 4 };
const UNCERTAINTY_ORDER: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const rank = (f: any) =>
  (SIGNIFICANCE_ORDER[String(f?.significance)] ?? 1) * 100 + (CLASS_ORDER[String(f?.evidenceClass)] ?? 5) * 10 + (UNCERTAINTY_ORDER[String(f?.uncertainty)] ?? 1);

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const s = (v: unknown) => (typeof v === "string" ? v : "");

export function isEngineRecord(v: unknown): boolean {
  return Boolean(v && typeof v === "object" && (v as any).schema === "forensic-engine-v1");
}

export function buildEngineRecordView(record: any): EngineRecordView | null {
  if (!isEngineRecord(record)) return null;
  const titles = new Map<string, string>(arr(record.caseModel?.documents).map((d: any) => [s(d.id), s(d.title) || s(d.id)]));
  const where = (r: any) => `${titles.get(s(r.documentId)) ?? s(r.documentId)}${typeof r.page === "number" ? `, page ${r.page}` : ""}`;
  const view = (f: any): EngineFindingView => ({
    id: s(f.id),
    title: s(f.title),
    significance: (["high", "medium", "low"].includes(s(f.significance).toLowerCase()) ? s(f.significance).toLowerCase() : "medium") as EngineFindingView["significance"],
    established: s(f.evidenceClass) === "A" || s(f.evidenceClass) === "E",
    documentsSupporting: new Set(arr(f.supporting).filter((r) => r.verified === true).map((r) => s(r.documentId))).size,
    statement: s(f.statement),
    classLabel: `${CLASS_LABEL[s(f.evidenceClass)] ?? "Unclassified"} (${s(f.evidenceClass) || "?"})`,
    review: `${VERDICT_LABEL[s(f.review?.verdict)] ?? "Not reviewed"}${arr(f.review?.partialRecord).length ? ` (the review read only part of the record; not read in full: ${arr(f.review.partialRecord).map(s).join("; ")})` : ""}`,
    reviewedPartially: arr(f.review?.partialRecord).length > 0,
    uncertainty: s(f.uncertainty).toLowerCase() || "unknown",
    sources: arr(f.supporting).map((r) => ({ where: where(r), quote: s(r.quote), verified: r.verified === true })),
    counter: arr(f.contradicting).map((r) => ({ where: where(r), quote: s(r.quote) })),
    alternatives: arr(f.alternativeExplanations).map(s).filter(Boolean),
    missing: arr(f.missingInformation).map(s).filter(Boolean),
    citations: arr(f.legalIssues).filter((l) => s(l.citation)).map((l) => ({
      citation: s(l.citation),
      status: s(l.citationStatus) === "INTERNAL_REFERENCE_MATCH" ? "Checked against bundled statute text" : "Unverified — confirm with counsel",
      statuteText: typeof l.statuteText === "string" ? l.statuteText : null,
      corpusNote: l.corpus && typeof l.corpus.note === "string"
        ? `${l.corpus.note}${l.corpus.caseDate ? ` (case date ${l.corpus.caseDate}` : ""}${l.corpus.effectiveFrom ? `${l.corpus.caseDate ? "; " : " ("}text held from ${l.corpus.effectiveFrom}` : ""}${l.corpus.caseDate || l.corpus.effectiveFrom ? ")" : ""}`
        : null,
    })),
    visual:
      f.visualVerification === "CONFIRMED" ? "Confirmed on the page"
      : f.visualVerification === "CONTRADICTED" ? "Contradicted by the page"
      : f.visualVerification === "INCONCLUSIVE" ? "Page check inconclusive"
      : f.visualVerification === "NOT_AVAILABLE" ? "Depends on the page; not checked"
      : "",
    notes: arr(f.grounding?.notes).map(s).filter(Boolean),
  });
  const ranked = arr(record.findings)
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map(({ f }) => view(f));
  const findings = [...ranked.filter((f) => f.established), ...ranked.filter((f) => !f.established)];
  const setAside = arr(record.appendix).map((f) => ({ title: s(f.title) || s(f.id), reason: GROUNDING_LABEL[s(f.grounding?.status)] ?? "Set aside", notes: arr(f.grounding?.notes).map(s) }));
  const events = new Map<string, any>(arr(record.caseModel?.events).map((e: any) => [s(e.id), e]));
  const authorities = new Map<string, { citation: string; status: string; findings: string[] }>();
  for (const f of findings) {
    for (const c of f.citations) {
      const key = c.citation.replace(/\s+/g, " ").trim().toLowerCase();
      const a = authorities.get(key) ?? { citation: c.citation, status: c.status, findings: [] };
      if (!a.findings.includes(f.title)) a.findings.push(f.title);
      authorities.set(key, a);
    }
  }
  return {
    status: record.status === "PARTIAL" ? "PARTIAL" : "COMPLETE",
    incompleteness: arr(record.incompleteness).map(s).filter(Boolean),
    injectionWarnings: arr(record.injectionWarnings).map((w) => ({ where: where(w), excerpt: s(w.excerpt) })),
    hypotheses: arr(record.hypotheses).map((h) => ({ question: s(h.question), outcome: s(h.outcome).toLowerCase() })),
    summary: {
      established: findings.filter((f) => f.established).length,
      leads: findings.filter((f) => !f.established).length,
      setAside: setAside.length,
      highSignificance: findings.filter((f) => f.significance === "high").map((f) => f.title),
    },
    findings,
    chronology: arr(record.caseModel?.chronology).map((c: any) => {
      const e = events.get(s(c.eventId));
      const src = arr(e?.sources)[0];
      return {
        date: s(c.dateText) || s(c.date) || "Undated",
        description: s(c.description),
        where: where({ documentId: c.documentId, page: c.page }),
        quote: s(src?.quote),
        dateSource: DATE_SOURCE_LABEL[s(e?.dateSource)] ?? "Source of date unclear",
      };
    }),
    documentDates: arr(record.caseModel?.documentDates).map((d: any) => ({
      document: titles.get(s(d.documentId)) ?? s(d.documentId),
      kind: s(d.kind).toLowerCase(),
      date: s(d.dateText) || s(d.date),
      quote: s(d.source?.quote),
    })),
    authorities: [...authorities.values()],
    missingEvidence: [...new Set(findings.flatMap((f) => f.missing))],
    setAside,
    openQuestions: arr(record.caseModel?.openQuestions).map(s).filter(Boolean),
  };
}

/** HTML block for the PDF export, in the same order as the screen. Every value passes through the caller's escaper. */
export function renderEngineRecordHtml(record: any, esc: (v: string) => string): string {
  const v = buildEngineRecordView(record);
  if (!v) return "";
  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");
  const finding = (f: EngineFindingView, n: number) => `<div class="threat-flag"><div class="threat-body">
        <strong>${n}. ${esc(f.title)}</strong> — ${esc(f.classLabel)}<br/>${esc(f.statement)}<br/>
        <em>Significance ${esc(f.significance)}; ${esc(f.review)}; uncertainty ${esc(f.uncertainty)}${f.documentsSupporting > 1 ? `; supported by ${f.documentsSupporting} documents` : ""}${f.visual ? `; ${esc(f.visual)}` : ""}</em>
        ${f.sources.map((src) => `<div class="threat-phrase">${esc(src.where)}: "${esc(src.quote)}"${src.verified ? "" : " (not found word-for-word)"}</div>`).join("")}
        ${f.counter.length ? `<div><strong>Contrary or explaining text:</strong>${list(f.counter.map((c) => `${c.where}: "${c.quote}"`))}</div>` : ""}
        ${f.alternatives.length ? `<div><strong>Other explanations:</strong>${list(f.alternatives)}</div>` : ""}
        ${f.missing.length ? `<div><strong>Missing information:</strong>${list(f.missing)}</div>` : ""}
        ${f.citations.length ? `<div><strong>Law:</strong>${list(f.citations.map((c) => `${c.citation} — ${c.status}${c.corpusNote ? ` — ${c.corpusNote}` : ""}`))}</div>` : ""}
        ${f.notes.length ? `<div style="font-size:11px;color:#92400e;">${list(f.notes)}</div>` : ""}
      </div></div>`;
  const established = v.findings.filter((f) => f.established);
  const leads = v.findings.filter((f) => !f.established);
  const heading = (t: string) => `<p><strong>${esc(t)}</strong></p>`;
  return `<div class="section-card">
    <h3 class="section-title">Forensic Engine record</h3>
    <p><strong>Status:</strong> ${v.status === "PARTIAL" ? "Partial analysis" : "Complete"}</p>
    ${v.incompleteness.length ? `${heading("What this analysis did not do:")}${list(v.incompleteness)}` : ""}
    ${v.injectionWarnings.length ? `${heading("Text in the documents that read like instructions to an AI (not followed):")}${list(v.injectionWarnings.map((w) => `${w.where}: "${w.excerpt}"`))}` : ""}
    ${heading("Summary")}<p>${esc(summaryLine(v))}</p>${list(v.summary.highSignificance.map((t) => `High significance: ${t}`))}
    ${established.length ? `${heading("Established by the record")}${established.map((f, i) => finding(f, i + 1)).join("")}` : ""}
    ${leads.length ? `${heading("Leads, inferences and questions for counsel")}${leads.map((f, i) => finding(f, established.length + i + 1)).join("")}` : ""}
    ${v.chronology.length ? `${heading("Chronology (each entry quoted from the source)")}${list(v.chronology.map((c) => `${c.date} — ${c.description} (${c.where}; ${c.dateSource})`))}` : ""}
    ${v.documentDates.length ? `${heading("Document dates")}${list(v.documentDates.map((d) => `${d.document}: ${d.kind} ${d.date}`))}` : ""}
    ${v.authorities.length ? `${heading("Legal authorities cited")}${list(v.authorities.map((a) => `${a.citation} — ${a.status} (relied on by: ${a.findings.join("; ")})`))}` : ""}
    ${v.missingEvidence.length ? `${heading("Missing evidence: what to request in disclosure")}${list(v.missingEvidence)}` : ""}
    ${v.openQuestions.length ? `${heading("Next investigative steps and open questions")}${list(v.openQuestions)}` : ""}
    ${v.setAside.length ? `${heading("Proposed findings set aside:")}${list(v.setAside.map((a) => `${a.title} — ${a.reason}`))}` : ""}
    ${v.hypotheses.length ? `${heading("Questions investigated:")}${list(v.hypotheses.map((h) => `${h.question} (${h.outcome})`))}` : ""}
  </div>`;
}

/** One sentence: what the record establishes, what it raises, and what was set aside. */
export function summaryLine(v: EngineRecordView): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  if (v.findings.length === 0) {
    return `No finding survived adversarial review and source checks${v.summary.setAside ? `; ${n(v.summary.setAside, "proposed finding was", "proposed findings were")} set aside` : ""}.`;
  }
  return `${n(v.summary.established, "finding is", "findings are")} established by the record and ${n(v.summary.leads, "is a lead or question", "are leads or questions")} for counsel${v.summary.setAside ? `; ${n(v.summary.setAside, "proposed finding was", "proposed findings were")} set aside by review or source checks` : ""}.`;
}

/**
 * The engine status alone, for redacted copies: whether the analysis is complete and how many gaps it reports. It
 * carries no document text, names or titles, so a redacted copy still says when an analysis is partial.
 */
export function engineStatusSummary(record: any): { status: "COMPLETE" | "PARTIAL"; gaps: number } | null {
  if (!isEngineRecord(record)) return null;
  return { status: record.status === "PARTIAL" ? "PARTIAL" : "COMPLETE", gaps: arr(record.incompleteness).length };
}

export function renderEngineStatusHtml(record: any, esc: (v: string) => string): string {
  const s = engineStatusSummary(record);
  if (!s) return "";
  const line =
    s.status === "PARTIAL"
      ? `Partial analysis: ${s.gaps} part(s) of the analysis did not complete. Details are removed from this redacted copy.`
      : "Complete. Details are removed from this redacted copy.";
  return `<div class="section-card"><h3 class="section-title">Forensic Engine record</h3><p><strong>Status:</strong> ${esc(line)}</p></div>`;
}
