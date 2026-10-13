/**
 * Print / PDF HTML for the four interactive findings sections.
 *
 * The export is built from the report data only. It never reads which tab is selected or which
 * findings are expanded, so a report prints complete regardless of what is on screen.
 * Every interpolated value is escaped: finding text is influenced by an uploaded document.
 */

import {
  resolveInteractiveFindings,
  lawyerQuestionToText,
  type EvidenceRef,
  type FindingBase,
  type InteractiveFindings,
  type LawyerQuestion,
  type LegalReference,
} from "../../shared/legalFindings";

export const esc = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const para = (label: string, value?: string) => (value && value.trim() ? `<p class="fx-p"><strong>${esc(label)}:</strong> ${esc(value)}</p>` : "");
const list = (label: string, items?: string[]) =>
  items && items.length ? `<p class="fx-p"><strong>${esc(label)}:</strong></p><ul class="fx-ul">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "";

export const AUTHORITY_STATUS_LABEL: Record<LegalReference["status"], string> = {
  VERIFIED: "Verified authority",
  CANDIDATE: "Candidate authority - not yet verified",
  UNVERIFIED: "Unverified legal reference",
};

export function quoteLabel(e: EvidenceRef): string {
  if (!e.quote) return "No quotation provided";
  return e.quoteVerified ? "Quotation found in the document" : "Not found word-for-word in the document";
}

function evidenceHtml(evidence: EvidenceRef[]): string {
  if (!evidence.length) return `<p class="fx-p"><strong>Source evidence:</strong> No source passage was identified for this item.</p>`;
  return (
    `<p class="fx-p"><strong>Source evidence:</strong></p><ul class="fx-ul">` +
    evidence
      .map(
        (e) =>
          `<li>${e.quote ? `&ldquo;${esc(e.quote)}&rdquo; ` : ""}${e.locationInDocument ? `(${esc([e.sourceDocument, e.locationInDocument].filter(Boolean).join(", "))}) ` : ""}<em>${esc(quoteLabel(e))}</em></li>`
      )
      .join("") +
    `</ul>`
  );
}

function authorityHtml(a: LegalReference): string {
  // A link is printed only when it is the registry's recorded link and has not been found broken.
  const link = a.url && a.urlStatus !== "BROKEN" ? `<br/>Source: ${esc(a.url)}${a.urlStatus === "VERIFIED" ? " (link checked)" : " (link not yet checked)"}` : a.lookupUrl ? `<br/>Look it up: ${esc(a.lookupLabel || a.lookupUrl)} - ${esc(a.lookupUrl)}` : "";
  return (
    `<li><strong>${esc(a.citation)}${a.pinpoint ? `, ${esc(a.pinpoint)}` : ""}</strong> - ${esc(a.title)} <em>[${esc(AUTHORITY_STATUS_LABEL[a.status])}]</em>` +
    (a.statuteText ? `<br/>Wording on record: ${esc(a.statuteText)}` : "") +
    (a.generallyCitedFor ? `<br/>Generally cited for: ${esc(a.generallyCitedFor)}` : "") +
    (a.howItApplies ? `<br/>How it may apply here (for lawyer review): ${esc(a.howItApplies)}` : "") +
    (a.limitation ? `<br/>Limitation: ${esc(a.limitation)}` : "") +
    link +
    `</li>`
  );
}

function commonHtml(f: FindingBase): string {
  return (
    para("Plain-language explanation", f.plainLanguage) +
    para("Why it matters", f.whyItMatters) +
    evidenceHtml(f.evidence) +
    (f.authorities.length ? `<p class="fx-p"><strong>Authorities:</strong></p><ul class="fx-ul">${f.authorities.map(authorityHtml).join("")}</ul>` : `<p class="fx-p"><strong>Authorities:</strong> None attached.</p>`) +
    para("Contrary evidence or limits", f.contraryEvidence) +
    list("Missing information", f.missingInformation) +
    list("Suggested verification steps", f.verificationSteps) +
    list("Questions for counsel", f.questionsForCounsel)
  );
}

const card = (title: string, badge: string, inner: string) =>
  `<div class="fx-card"><div class="fx-title">${esc(title)} <span class="fx-badge">${esc(badge)}</span></div>${inner}</div>`;

const ASSESSMENT: Record<string, string> = { POTENTIAL_CONCERN: "Potential concern - not an established violation", INSUFFICIENT_INFORMATION: "Insufficient information" };
const ABSENCE: Record<string, string> = {
  NOT_IN_UPLOADED_MATERIALS: "Not in the uploaded materials",
  CONFIRMED_NONEXISTENT: "Document states it does not exist",
  UNKNOWN: "Unknown",
};

export const FINDINGS_EXPORT_STYLES = `
  .fx-h { font-size: 15px; font-weight: 800; margin: 26px 0 8px; text-transform: uppercase; letter-spacing: .05em; color: #0f172a; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 6px; }
  .fx-note { font-size: 11.5px; color: #57534e; background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; padding: 8px 10px; margin: 8px 0 12px; }
  .fx-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; page-break-inside: avoid; }
  .fx-title { font-weight: 700; font-size: 13.5px; margin-bottom: 6px; }
  .fx-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; background: #eef2ff; color: #3730a3; border-radius: 4px; padding: 1px 6px; margin-left: 6px; }
  .fx-p { font-size: 12.5px; margin: 4px 0; color: #334155; }
  .fx-ul { font-size: 12.5px; margin: 2px 0 6px; padding-left: 20px; color: #334155; }
`;

export function buildFindingsExportHtml(report: Record<string, any>): string {
  const f: InteractiveFindings = resolveInteractiveFindings(report);
  const sectionNote = (key: keyof InteractiveFindings["sectionStatus"]) => {
    const s = f.sectionStatus[key];
    return s.state === "GENERATED" ? "" : `<div class="fx-note">${esc(s.state === "LEGACY" ? "Basic list only: " : "Not available: ")}${esc(s.reason || "Detailed findings were not generated for this part of the report.")}</div>`;
  };
  const empty = (n: number, text: string) => (n ? "" : `<p class="fx-p"><em>${esc(text)}</em></p>`);

  const charter = f.charter
    .map((c) =>
      card(
        `Charter s. ${c.section}: ${c.title}`,
        ASSESSMENT[c.assessment] || c.assessment,
        para("State action", c.stateAction) +
          para("Right affected", c.affectedRight) +
          para("Legal test", c.legalTest) +
          para("Outline of the test (orientation only)", c.testOutline) +
          list("Legal elements the document does not address", c.missingLegalElements) +
          para("Remedies for a lawyer to consider", c.remediesForCounsel) +
          commonHtml(c)
      )
    )
    .join("");

  const verification = f.verification
    .map((v) =>
      card(
        v.claim,
        v.result.replace("_", " "),
        para("Source document", v.sourceDocument) +
          (v.supportingPassage ? `<p class="fx-p"><strong>Supporting passage:</strong></p>${evidenceHtml([v.supportingPassage])}` : "") +
          (v.contradictoryPassage ? `<p class="fx-p"><strong>Contradictory passage:</strong></p>${evidenceHtml([v.contradictoryPassage])}` : "") +
          para("Method", v.method) +
          para("Result note", v.resultNote) +
          para("Missing evidence", v.missingEvidence) +
          para("Next action", v.nextAction) +
          commonHtml({ ...v, evidence: [] })
      )
    )
    .join("");

  const missing = f.missing
    .map((m) =>
      card(
        m.item,
        ABSENCE[m.absenceStatus] || m.absenceStatus,
        para("What depends on it", m.dependsOn) + para("Basis", m.absenceBasis) + list("Next steps", m.nextSteps) + commonHtml(m)
      )
    )
    .join("");

  const questions = f.lawyerQuestions
    .map((q, i) =>
      card(
        `Q${i + 1}. ${q.question}`,
        q.linkedFindingId ? `Linked to ${q.linkedFindingId}` : "General",
        para("What the lawyer assesses", q.whatLawyerAssesses) +
          para("What the uploaded record shows", q.recordShows) +
          para("Still unknown", q.stillUnknown) +
          list("Documents to bring", q.documentsToBring) +
          commonHtml(q)
      )
    )
    .join("");

  const a = f.authoritySummary;
  return (
    `<div class="section-card"><h2 class="fx-h">Legal findings</h2>` +
    `<div class="fx-note"><strong>Authority verification:</strong> ${esc(a.limitation)}</div>` +
    `<h3 class="fx-h">Charter rights issues</h3>` +
    `<div class="fx-note">These are potential concerns for a lawyer to assess, not findings that any right was violated.</div>` +
    sectionNote("charter") + charter + empty(f.charter.length, "No Charter issue was identified on the facts in this document.") +
    `<h3 class="fx-h">Verification checks</h3>` +
    sectionNote("verification") + verification + empty(f.verification.length, "No verification checks were produced.") +
    `<h3 class="fx-h">Missing elements</h3>` +
    `<div class="fx-note">Material missing from the upload is not proof that it does not exist or that anyone acted improperly.</div>` +
    sectionNote("missing") + missing + empty(f.missing.length, "No missing elements were identified.") +
    `<h3 class="fx-h">Ask your lawyer</h3>` +
    sectionNote("lawyerQuestions") + questions + empty(f.lawyerQuestions.length, "No lawyer questions were produced.") +
    `</div>`
  );
}

/** A standalone, consolidated list of the lawyer questions, for taking to an appointment. */
export function buildLawyerQuestionListHtml(report: Record<string, any>): string {
  const f = resolveInteractiveFindings(report);
  const qs: LawyerQuestion[] = f.lawyerQuestions;
  const docs = [...new Set(qs.flatMap((q) => q.documentsToBring))];
  return (
    `<div class="section-card"><h2 class="fx-h">Questions for my lawyer</h2>` +
    `<div class="fx-note">Prepared from an AI-assisted document analysis. These are questions for a lawyer, not legal advice or conclusions. Authorities are marked as verified, candidate or unverified: confirm each before relying on it.</div>` +
    (qs.length
      ? `<ol class="fx-ul">${qs
          .map(
            (q) =>
              `<li style="margin-bottom:10px"><strong>${esc(q.question)}</strong>` +
              [q.whyItMatters && `Why it matters: ${q.whyItMatters}`, q.whatLawyerAssesses && `For the lawyer to assess: ${q.whatLawyerAssesses}`, q.authorities.length && `Authorities: ${q.authorities.map((a) => `${a.citation} [${a.status.toLowerCase()}]`).join("; ")}`, q.evidence.some((e) => e.locationInDocument) && `Where in the document: ${q.evidence.map((e) => e.locationInDocument).filter(Boolean).join("; ")}`]
                .filter(Boolean)
                .map((t) => `<br/><span style="font-size:12px">${esc(t)}</span>`)
                .join("") +
              `</li>`
          )
          .join("")}</ol>`
      : `<p class="fx-p"><em>No lawyer questions are available for this report.</em></p>`) +
    (docs.length ? `<h3 class="fx-h">Documents to bring</h3><ul class="fx-ul">${docs.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "") +
    `</div>`
  );
}

export { lawyerQuestionToText };
