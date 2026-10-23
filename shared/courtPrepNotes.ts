/**
 * Plain-text preparation notes. Built in the browser from the analyzer findings and the parent's own
 * entries. Analyzer findings and parent-supplied text are labelled separately.
 */
import { COURT_PREP_LIMITS, EVENT_TYPE_LABEL, checkResponse, type FactualResponse, type buildCourtPrep } from "./courtPrep";
import { COURT_FORMS, FORM_SAFEGUARDS, COURT_FORM_INDEX_URL } from "./courtPrepForms";
import { REDACTED_COPY_NOTICE, redactForExport } from "./exportRedaction";

type Prep = ReturnType<typeof buildCourtPrep>;

export function buildPrepNotes(
  prepInput: Prep,
  responsesInput: Record<string, FactualResponse>,
  documentTitleInput: string,
  options: { redact?: boolean } = {}
): string {
  // Redaction is enforced here, so every caller that asks for a redacted copy gets one. The title is replaced too.
  const redact = options.redact === true;
  const prep = redact ? redactForExport(prepInput) : prepInput;
  const responses = redact ? redactForExport(responsesInput) : responsesInput;
  const documentTitle = redact ? "Analysis report" : documentTitleInput;
  const lines: string[] = [];
  if (redact) lines.push(REDACTED_COPY_NOTICE, "");
  const rule = "------------------------------------------------------------";
  lines.push(`Court preparation notes: ${documentTitle}`, rule, ...COURT_PREP_LIMITS, "");

  lines.push("1. TIMELINE (from the analyzer, with sources)", rule);
  if (prep.chronology.length === 0) lines.push("No dated items were found in this report.");
  for (const row of prep.chronology) {
    lines.push(`- ${row.dateAsWritten}: ${row.event}`);
    lines.push(`  Type: ${EVENT_TYPE_LABEL[row.eventType]}`);
    lines.push(`  Source: ${row.source.map((s) => s.locator).join("; ") || "not given"}`);
    if (row.disputedByFindingIds.length) lines.push("  Note: another passage gives a different date or description.");
  }
  lines.push("");

  lines.push("2. EVIDENCE INDEX (analyzer findings, not your statements)", rule);
  if (prep.evidenceIndex.length === 0) lines.push("No quoted passages were found.");
  for (const e of prep.evidenceIndex) {
    lines.push(`- ${e.locator}${e.quote ? `: "${e.quote}"` : ""}`);
  }
  lines.push("");

  lines.push("3. YOUR RESPONSES (your own words, not checked by this tool)", rule);
  for (const allegation of prep.allegations) {
    const r = responses[allegation.id];
    const status = r ? checkResponse(r, prep.evidenceIndex) : null;
    lines.push(`Point: ${allegation.title}`);
    lines.push(`Quoted in the record: ${allegation.sources.map((s) => (s.quote ? `"${s.quote}"` : s.locator)).join("; ")}`);
    lines.push(`Your account: ${r?.parentAccount.trim() || "Not written yet."}`);
    lines.push(`Status: ${status ? status.status.replace(/_/g, " ").toLowerCase() : "not written yet"}`);
    for (const p of r?.unverifiedPoints ?? []) if (p.trim()) lines.push(`Not yet supported by any record: ${p.trim()}`);
    for (const q of r?.questionsForCounsel ?? []) if (q.trim()) lines.push(`Question for counsel: ${q.trim()}`);
    lines.push("");
  }
  if (prep.allegations.length === 0) lines.push("No quoted points were found to respond to.", "");

  lines.push("4. FORMS (not checked for currency)", rule);
  for (const f of COURT_FORMS) lines.push(`- Form ${f.formNumber}: ${f.title} (version ${f.versionDate}). Currency: unknown.`);
  lines.push(`Official index: ${COURT_FORM_INDEX_URL}`, ...FORM_SAFEGUARDS, "");

  lines.push("5. DATES TO CONFIRM (no deadline is calculated)", rule);
  for (const c of prep.dateChecks) lines.push(`- ${c.dateAsWritten}: ${c.note}`);
  return lines.join("\n");
}
