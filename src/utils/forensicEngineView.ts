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
  statement: string;
  classLabel: string;
  review: string;
  uncertainty: string;
  sources: Array<{ where: string; quote: string; verified: boolean }>;
  counter: Array<{ where: string; quote: string }>;
  alternatives: string[];
  missing: string[];
  citations: Array<{ citation: string; status: string; statuteText: string | null }>;
  visual: string;
  notes: string[];
}

export interface EngineRecordView {
  status: "COMPLETE" | "PARTIAL";
  incompleteness: string[];
  injectionWarnings: Array<{ where: string; excerpt: string }>;
  hypotheses: Array<{ question: string; outcome: string }>;
  findings: EngineFindingView[];
  setAside: Array<{ title: string; reason: string; notes: string[] }>;
  openQuestions: string[];
}

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
    statement: s(f.statement),
    classLabel: `${CLASS_LABEL[s(f.evidenceClass)] ?? "Unclassified"} (${s(f.evidenceClass) || "?"})`,
    review: VERDICT_LABEL[s(f.review?.verdict)] ?? "Not reviewed",
    uncertainty: s(f.uncertainty).toLowerCase() || "unknown",
    sources: arr(f.supporting).map((r) => ({ where: where(r), quote: s(r.quote), verified: r.verified === true })),
    counter: arr(f.contradicting).map((r) => ({ where: where(r), quote: s(r.quote) })),
    alternatives: arr(f.alternativeExplanations).map(s).filter(Boolean),
    missing: arr(f.missingInformation).map(s).filter(Boolean),
    citations: arr(f.legalIssues).filter((l) => s(l.citation)).map((l) => ({
      citation: s(l.citation),
      status: s(l.citationStatus) === "INTERNAL_REFERENCE_MATCH" ? "Checked against bundled statute text" : "Unverified — confirm with counsel",
      statuteText: typeof l.statuteText === "string" ? l.statuteText : null,
    })),
    visual:
      f.visualVerification === "CONFIRMED" ? "Confirmed on the page"
      : f.visualVerification === "CONTRADICTED" ? "Contradicted by the page"
      : f.visualVerification === "INCONCLUSIVE" ? "Page check inconclusive"
      : f.visualVerification === "NOT_AVAILABLE" ? "Depends on the page; not checked"
      : "",
    notes: arr(f.grounding?.notes).map(s).filter(Boolean),
  });
  return {
    status: record.status === "PARTIAL" ? "PARTIAL" : "COMPLETE",
    incompleteness: arr(record.incompleteness).map(s).filter(Boolean),
    injectionWarnings: arr(record.injectionWarnings).map((w) => ({ where: where(w), excerpt: s(w.excerpt) })),
    hypotheses: arr(record.hypotheses).map((h) => ({ question: s(h.question), outcome: s(h.outcome).toLowerCase() })),
    findings: arr(record.findings).map(view),
    setAside: arr(record.appendix).map((f) => ({ title: s(f.title) || s(f.id), reason: GROUNDING_LABEL[s(f.grounding?.status)] ?? "Set aside", notes: arr(f.grounding?.notes).map(s) })),
    openQuestions: arr(record.caseModel?.openQuestions).map(s).filter(Boolean),
  };
}

/** HTML block for the PDF export. Every value passes through the caller's escaper. */
export function renderEngineRecordHtml(record: any, esc: (v: string) => string): string {
  const v = buildEngineRecordView(record);
  if (!v) return "";
  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");
  const findings = v.findings
    .map(
      (f) => `<div class="threat-flag"><div class="threat-body">
        <strong>${esc(f.title)}</strong> — ${esc(f.classLabel)}<br/>${esc(f.statement)}<br/>
        <em>${esc(f.review)}; uncertainty ${esc(f.uncertainty)}${f.visual ? `; ${esc(f.visual)}` : ""}</em>
        ${f.sources.map((src) => `<div class="threat-phrase">${esc(src.where)}: "${esc(src.quote)}"${src.verified ? "" : " (not found word-for-word)"}</div>`).join("")}
        ${f.counter.length ? `<div><strong>Contrary or explaining text:</strong>${list(f.counter.map((c) => `${c.where}: "${c.quote}"`))}</div>` : ""}
        ${f.alternatives.length ? `<div><strong>Other explanations:</strong>${list(f.alternatives)}</div>` : ""}
        ${f.missing.length ? `<div><strong>Missing information:</strong>${list(f.missing)}</div>` : ""}
        ${f.citations.length ? `<div><strong>Law:</strong>${list(f.citations.map((c) => `${c.citation} — ${c.status}`))}</div>` : ""}
        ${f.notes.length ? `<div style="font-size:11px;color:#92400e;">${list(f.notes)}</div>` : ""}
      </div></div>`
    )
    .join("");
  return `<div class="section-card">
    <h3 class="section-title">Forensic Engine record</h3>
    <p><strong>Status:</strong> ${v.status === "PARTIAL" ? "Partial analysis" : "Complete"}</p>
    ${v.incompleteness.length ? `<p><strong>What this analysis did not do:</strong></p>${list(v.incompleteness)}` : ""}
    ${v.injectionWarnings.length ? `<p><strong>Text in the documents that read like instructions to an AI (not followed):</strong></p>${list(v.injectionWarnings.map((w) => `${w.where}: "${w.excerpt}"`))}` : ""}
    ${findings}
    ${v.setAside.length ? `<p><strong>Proposed findings set aside:</strong></p>${list(v.setAside.map((a) => `${a.title} — ${a.reason}`))}` : ""}
    ${v.hypotheses.length ? `<p><strong>Questions investigated:</strong></p>${list(v.hypotheses.map((h) => `${h.question} (${h.outcome})`))}` : ""}
    ${v.openQuestions.length ? `<p><strong>Open questions:</strong></p>${list(v.openQuestions)}` : ""}
  </div>`;
}
