/**
 * AcroForm field ingestion: extracted widgets -> row attribution -> semantic mapper -> field facts.
 *
 * Nothing in this module decides meaning on its own. Label roles come only from mapPdfFields (printed text),
 * and every fact is built by buildFormFieldFact, the single constructor that applyReportGuards re-checks.
 *
 * Row attribution is deliberately narrow. A widget is placed in a printed row only when:
 *   - printed text sits on its line to the left (the row label),
 *   - a column header is printed above it, and
 *   - that row label appears in exactly one row on its page.
 * It is never used to identify a child, a party, or a person.
 */
import { createHash } from "node:crypto";
import { extractAcroFormWidgets, type ExtractedWidget } from "./acroFormExtractor.js";
import { identifyOfficialPdf } from "./acroFormIdentity.js";
import { buildFormFieldFact, type FormFieldFact, type RowAttribution } from "./formFieldFacts.js";
import { mapPdfFields, type PdfWidgetInput } from "./officialFormPdfSemanticMap.js";

export interface IngestionSummary {
  fields: number;
  confirmed: number;
  unresolved: number;
  conflicting: number;
  radioGroups: number;
  valueConflicts: number;
  rowAttributed: number;
  rejectedWidgets: number;
  unsupportedValues: number;
}

export interface AcroFormIngestionResult {
  sourceSha256: string;
  /** The official form, when the file is an exact pinned match. Null otherwise. */
  formNumber: string | null;
  identity: "PINNED_OFFICIAL_FILE" | "UNIDENTIFIED";
  pageCount: number;
  pageText: Map<number, string>;
  facts: FormFieldFact[];
  summary: IngestionSummary;
  rejected: { count: number; reasons: Record<string, number> };
}

/** A printed column header: short, a caption rather than a sentence, and not running on past its own line. */
export function isHeaderLike(text: string): boolean {
  const t = text.trim();
  return t.length >= 3 && t.length <= 40 && !/[.;:,]$/.test(t) && /^[A-Z(]/.test(t);
}

/**
 * Row attribution for each widget, by index. A widget is placed in a printed row only when:
 *   1. a printed row label sits on its line to the left,
 *   2. a header-like caption is printed above it, and
 *   3. that caption is printed over a column that repeats across at least two rows of the page (a real table column),
 *   4. the row label names exactly one row on its page.
 * Otherwise the row stays UNRESOLVED with the reason. A caption over a single widget is not a table.
 */
export function attributeRows(widgets: ExtractedWidget[]): RowAttribution[] {
  const rowOf = (o: ExtractedWidget) => Math.round((o.rect[1] + o.rect[3]) / 2);
  return widgets.map(w => {
    const label = w.left.trim();
    if (label === "") return { status: "UNRESOLVED", reason: "NO_PRINTED_ROW_LABEL" };
    if (w.columnHeader === null || !isHeaderLike(w.columnHeader)) return { status: "UNRESOLVED", reason: "NO_COLUMN_HEADER" };
    const columnRows = new Set(
      widgets.filter(o => o.page === w.page && o.columnHeader === w.columnHeader).map(rowOf)
    );
    if (columnRows.size < 2) return { status: "UNRESOLVED", reason: "NO_REPEATED_COLUMN" };
    // The same printed label on two different rows of one page is ambiguous, so it is not used.
    const labelRows = new Set(widgets.filter(o => o.page === w.page && o.left.trim() === label).map(rowOf));
    if (labelRows.size > 1) return { status: "UNRESOLVED", reason: "AMBIGUOUS_ROW_LABEL" };
    return { status: "ATTRIBUTED", rowLabel: label };
  });
}

/** Widgets that share one name must agree on the entered value. If they disagree, the value is withheld. */
export function enteredValueFor(values: (string | null)[]): { value: string | null; conflict: boolean } {
  if (new Set(values).size > 1) return { value: null, conflict: true };
  return { value: values[0] ?? null, conflict: false };
}

function rowForField(rows: RowAttribution[]): RowAttribution {
  const attributed = rows.filter((r): r is { status: "ATTRIBUTED"; rowLabel: string } => r.status === "ATTRIBUTED");
  if (attributed.length === rows.length && new Set(attributed.map(r => r.rowLabel)).size === 1) {
    return { status: "ATTRIBUTED", rowLabel: attributed[0].rowLabel };
  }
  if (attributed.length === 0) return rows[0] ?? { status: "UNRESOLVED", reason: "NO_ROW_EVIDENCE" };
  return { status: "UNRESOLVED", reason: "MIXED_ROW_EVIDENCE" };
}

export async function ingestAcroFormPdf(bytes: Buffer): Promise<AcroFormIngestionResult> {
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const extracted = await extractAcroFormWidgets(bytes);
  const identity = identifyOfficialPdf(sourceSha256, bytes.length);
  const formNumber = identity?.formNumber ?? null;
  const source = { formNumber: formNumber ?? "UNIDENTIFIED", sourceSha256 };

  const mapperInput: PdfWidgetInput[] = extracted.widgets.map(w => ({
    name: w.name,
    page: w.page,
    type: w.type,
    left: w.left,
    above: w.above,
    below: w.below,
    exportValue: w.exportValue,
    columnHeader: w.columnHeader
  }));
  const mappings = mapPdfFields(mapperInput);
  const rows = attributeRows(extracted.widgets);

  let valueConflicts = 0;
  const facts = mappings.map(mapping => {
    const indices = extracted.widgets.map((w, i) => (w.name === mapping.fieldName ? i : -1)).filter(i => i >= 0);
    const { value: entered, conflict } = enteredValueFor(indices.map(i => extracted.widgets[i].value));
    if (conflict) valueConflicts++;
    return buildFormFieldFact(mapping, entered, source, rowForField(indices.map(i => rows[i])));
  });

  const summary: IngestionSummary = {
    fields: mappings.length,
    confirmed: mappings.filter(m => m.status === "CONFIRMED_BY_LABEL").length,
    unresolved: mappings.filter(m => m.status === "UNRESOLVED").length,
    conflicting: mappings.filter(m => m.reason === "CONFLICTING_WIDGET_LABELS").length,
    radioGroups: mappings.filter(m => m.kind === "radio").length,
    valueConflicts,
    rowAttributed: facts.filter(f => f.rowAttribution.status === "ATTRIBUTED").length,
    rejectedWidgets: extracted.rejectedWidgets.count,
    unsupportedValues: extracted.unsupportedValues
  };

  return {
    sourceSha256,
    formNumber,
    identity: identity ? "PINNED_OFFICIAL_FILE" : "UNIDENTIFIED",
    pageCount: extracted.pageCount,
    pageText: extracted.pageText,
    facts,
    summary,
    rejected: extracted.rejectedWidgets
  };
}
