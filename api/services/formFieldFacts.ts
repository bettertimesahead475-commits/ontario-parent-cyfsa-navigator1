/**
 * Field facts: what an AcroForm field can and cannot say in an analysis report.
 *
 * A PDF form field establishes exactly three things: that the field EXISTS on the form (presence), what text or
 * selection is IN it (entered value), and, only when a printed label confirms it, what the form PRINTS for that
 * field (label role). It establishes none of the following, and no report may imply it:
 *   - who entered the value (party attribution is always NOT_DETERMINED here),
 *   - whether the entered value is true or complete,
 *   - any legal significance (always NOT_ASSESSED here; a field's absence or presence is not a legal defect).
 *
 * This module is the only constructor of FormFieldFact. applyReportGuards() re-derives every fact through
 * guardFormFieldFacts(), so a report cannot carry a label role, or report text, that the mapping did not confirm.
 * An unresolved, conflicting or ambiguous field is still shown as present with its entered value. It is never
 * dropped, and its meaning is never asserted. Other report content is untouched.
 */
import { usableForAnalysis, type PdfFieldMapping, type PdfSemanticRole } from "./officialFormPdfSemanticMap";

export const FIELD_NOT_ESTABLISHED_TEXT =
  "A form field could not be matched to a printed label on the form, so what it is for is not established. " +
  "Its entry is shown as entered and is not used in this analysis.";

export interface FormFieldSource {
  formNumber: string;
  /** SHA-256 of the official PDF the mapping was made from (hex), or null when the source is unverified. */
  sourceSha256: string | null;
}

/**
 * Row attribution: which printed table row a field sits in. ATTRIBUTED only from printed row text, a printed column
 * header, and a row label that is unique on its page. It never identifies a child or a party.
 */
export type RowAttribution =
  | { status: "ATTRIBUTED"; rowLabel: string }
  | { status: "UNRESOLVED"; reason: string };

export const ROW_UNRESOLVED_DEFAULT: RowAttribution = { status: "UNRESOLVED", reason: "NO_ROW_EVIDENCE" };

export interface FormFieldFact {
  formNumber: string;
  sourceSha256: string | null;
  fieldName: string;
  pages: number[];
  /** Presence: the field exists on the form. */
  presence: "FIELD_PRESENT";
  /** Entered value as found in the document; null when blank. Not verified as true, and not attributed to anyone. */
  enteredValue: string | null;
  /** Party attribution is never determined from a field alone. */
  partyAttribution: "NOT_DETERMINED";
  /** Legal significance is never assessed from a field alone. */
  legalSignificance: "NOT_ASSESSED";
  /** The label role, only when the mapping confirmed it from printed text. */
  labelRole: PdfSemanticRole | null;
  labelRoleStatus: "CONFIRMED_BY_LABEL" | "NOT_ESTABLISHED";
  /** The printed label the confirmation was read from, or null when not established. */
  printedLabel: string | null;
  /** Row in a printed table, when the printed text supports it. Never a child or party identity. */
  rowAttribution: RowAttribution;
  reportText: string;
}

function reportTextFor(f: Pick<FormFieldFact, "fieldName" | "pages" | "enteredValue" | "labelRoleStatus" | "printedLabel">): string {
  if (f.labelRoleStatus !== "CONFIRMED_BY_LABEL" || f.printedLabel === null) return FIELD_NOT_ESTABLISHED_TEXT;
  const where = f.pages.length === 1 ? `page ${f.pages[0]}` : `pages ${f.pages.join(", ")}`;
  const entry = f.enteredValue === null ? "is blank" : `contains "${f.enteredValue}"`;
  return (
    `The form field printed as "${f.printedLabel}" (${where}) ${entry}. ` +
    "This describes the form field only. It does not show who entered the value, whether it is true, " +
    "or any legal consequence."
  );
}

/** Only a well-formed ATTRIBUTED row with a non-empty printed label survives; anything else is unresolved. */
function sanitizeRow(raw: unknown): RowAttribution {
  const r = raw as any;
  if (r && r.status === "ATTRIBUTED" && typeof r.rowLabel === "string" && r.rowLabel.trim() !== "") {
    return { status: "ATTRIBUTED", rowLabel: r.rowLabel };
  }
  return ROW_UNRESOLVED_DEFAULT;
}

/** The only constructor. A confirmed label role is copied from the mapping; nothing else can set one. */
export function buildFormFieldFact(
  mapping: PdfFieldMapping,
  enteredValue: string | null,
  source: FormFieldSource,
  rowAttribution: RowAttribution = ROW_UNRESOLVED_DEFAULT
): FormFieldFact {
  const confirmed = usableForAnalysis(mapping);
  const base = {
    formNumber: source.formNumber,
    sourceSha256: source.sourceSha256,
    fieldName: mapping.fieldName,
    pages: [...mapping.pages],
    presence: "FIELD_PRESENT" as const,
    enteredValue: enteredValue === null || enteredValue.trim() === "" ? null : enteredValue,
    partyAttribution: "NOT_DETERMINED" as const,
    legalSignificance: "NOT_ASSESSED" as const,
    labelRole: confirmed ? mapping.role : null,
    labelRoleStatus: confirmed ? ("CONFIRMED_BY_LABEL" as const) : ("NOT_ESTABLISHED" as const),
    printedLabel: confirmed ? mapping.evidenceLabel : null,
    rowAttribution: sanitizeRow(rowAttribution)
  };
  return { ...base, reportText: reportTextFor(base) };
}

/**
 * Re-derives every fact in a report at the server boundary. A fact that is not confirmed has its role removed and its
 * text replaced, whatever the caller put there. The text is always recomputed from the other fields, never trusted.
 */
export function guardFormFieldFacts(report: Record<string, any>): Record<string, any> {
  if (!Array.isArray(report.formFieldFacts)) return report;
  report.formFieldFacts = report.formFieldFacts.map((raw: any): FormFieldFact => {
    const confirmed = raw?.labelRoleStatus === "CONFIRMED_BY_LABEL" && typeof raw.labelRole === "string" && typeof raw.printedLabel === "string";
    const fact: FormFieldFact = {
      formNumber: String(raw?.formNumber ?? ""),
      sourceSha256: typeof raw?.sourceSha256 === "string" ? raw.sourceSha256 : null,
      fieldName: String(raw?.fieldName ?? ""),
      pages: Array.isArray(raw?.pages) ? raw.pages.filter((p: unknown) => Number.isInteger(p)) : [],
      presence: "FIELD_PRESENT",
      enteredValue: typeof raw?.enteredValue === "string" && raw.enteredValue.trim() !== "" ? raw.enteredValue : null,
      partyAttribution: "NOT_DETERMINED",
      legalSignificance: "NOT_ASSESSED",
      labelRole: confirmed ? (raw.labelRole as PdfSemanticRole) : null,
      labelRoleStatus: confirmed ? "CONFIRMED_BY_LABEL" : "NOT_ESTABLISHED",
      printedLabel: confirmed ? String(raw.printedLabel) : null,
      rowAttribution: sanitizeRow(raw?.rowAttribution),
      reportText: ""
    };
    fact.reportText = reportTextFor(fact);
    return fact;
  });
  return report;
}

/** Test and audit helper: the set of roles a report may carry from field facts. */
export function reportableRoles(report: Record<string, any>): string[] {
  const facts: FormFieldFact[] = Array.isArray(report.formFieldFacts) ? report.formFieldFacts : [];
  return facts.filter(f => f.labelRoleStatus === "CONFIRMED_BY_LABEL" && f.labelRole).map(f => f.labelRole as string);
}
