/**
 * Semantic mapping for the current official Ontario court-form PDFs (AcroForm fields).
 *
 * This module is PURE: it takes widget descriptors that were read from a verified PDF (name, page,
 * field type, and the printed label text nearest the widget) and returns one mapping per field name.
 * It never reads files and never uses field names as evidence. A field name is only a grouping key:
 * widgets sharing a name are one value in the PDF, and the mapping must agree across all of them.
 *
 * Status rules (fail closed):
 *   - CONFIRMED_BY_LABEL: exactly one semantic role matches, every widget with that name agrees, and
 *     the role comes from printed label text on the page.
 *   - UNRESOLVED: no rule matched (NO_RULE), two rules matched different roles (AMBIGUOUS_LABEL), the
 *     widgets sharing one name disagree (CONFLICTING_WIDGET_LABELS), or a signature has no printed
 *     label (SIGNATURE_NO_LABEL).
 * An UNRESOLVED field must never feed an analysis conclusion. Use usableForAnalysis() to gate that.
 */

export const PDF_SEMANTIC_ROLES = [
  "COURT_FILE_NUMBER",
  "COURT_NAME",
  "COURT_OFFICE_ADDRESS",
  "FORM_DATE_AFFIDAVIT",
  "PARTY_ADDRESS_FOR_SERVICE",
  "PARTY_LAWYER",
  "DEPONENT_NAME",
  "DEPONENT_RESIDENCE",
  "DEPONENT_SIGNATURE",
  "SWORN_MUNICIPALITY",
  "SWORN_PROVINCE",
  "SIGNATURE_DATE",
  "COMMISSIONER_NAME",
  "COMMISSIONER_SIGNATURE",
  "STATEMENTS_OF_FACT"
] as const;
export type PdfSemanticRole = (typeof PDF_SEMANTIC_ROLES)[number];

export type PdfFieldKind = "text" | "checkbox" | "radio" | "choice" | "signature" | "unknown";

export interface PdfWidgetInput {
  /** The AcroForm field name. Used only to group widgets that share one value. Never used as evidence. */
  name: string;
  page: number;
  /** pdfjs fieldType: "Tx", "Btn", "Ch", "Sig", or null when the type is absent. */
  type: string | null;
  /** Printed text on the same line, immediately to the left of the widget. */
  left: string;
  /** Printed text directly above the widget. */
  above: string;
  /** Printed text below the widget. */
  below: string;
  /** Checkbox or radio export value, as stored in the PDF. Null for non-button fields. */
  exportValue?: string | null;
  /** Nearest printed text above the widget that spans its centre (table column header). Provenance only. */
  columnHeader?: string | null;
}

export type PdfMappingReason =
  | "NO_RULE"
  /** Widgets share one name but carry different export values: a radio group. No radio rule exists yet. */
  | "RADIO_GROUP_NOT_CONFIRMED"
  | "AMBIGUOUS_LABEL"
  | "CONFLICTING_WIDGET_LABELS"
  | "SIGNATURE_NO_LABEL"
  /** No printed text within the extraction window (for example, a table cell whose heading is further away). */
  | "NO_PRINTED_LABEL_NEARBY";

export interface PdfFieldMapping {
  fieldName: string;
  kind: PdfFieldKind;
  pages: number[];
  widgetCount: number;
  role: PdfSemanticRole | null;
  status: "CONFIRMED_BY_LABEL" | "UNRESOLVED";
  reason: PdfMappingReason | null;
  ruleIds: string[];
  /** The printed label text the decision was read from (first widget). */
  evidenceLabel: string;
  /** Distinct export values across the widgets sharing this name (button fields). Empty for other types. */
  exportValues: string[];
  /** Distinct column headers recorded for this name's widgets. Provenance only, never used to confirm a role. */
  columnHeaders: string[];
  /** True when one of those column headers is printed on more than one page (a continuation table). */
  headerRepeatsAcrossPages: boolean;
}

interface LabelledWidget extends PdfWidgetInput {
  kind: PdfFieldKind;
}

interface Rule {
  id: string;
  role: PdfSemanticRole;
  test: (w: LabelledWidget) => boolean;
}

// Each rule states what the page prints next to the widget. None reads the field name.
const RULES: Rule[] = [
  { id: "court-file-number", role: "COURT_FILE_NUMBER", test: w => w.kind === "text" && /Court File Number/i.test(w.above) },
  { id: "court-name", role: "COURT_NAME", test: w => w.kind === "choice" && /ONTARIO/.test(w.above) },
  { id: "court-office-address", role: "COURT_OFFICE_ADDRESS", test: w => w.kind === "text" && /\(Name of court\)/i.test(w.above) },
  { id: "affidavit-date", role: "FORM_DATE_AFFIDAVIT", test: w => w.kind === "text" && /\bdated\b/i.test(w.above) && /Affidavit/i.test(w.above) },
  { id: "party-address-for-service", role: "PARTY_ADDRESS_FOR_SERVICE", test: w => w.kind === "text" && /Full legal name & address for service/i.test(w.above + " " + w.left) },
  { id: "party-lawyer", role: "PARTY_LAWYER", test: w => w.kind === "text" && /Lawyer.s name & address/i.test(w.above + " " + w.left) },
  { id: "deponent-name", role: "DEPONENT_NAME", test: w => w.kind === "text" && /My name is \(full legal name\)/i.test(w.left) },
  { id: "deponent-residence", role: "DEPONENT_RESIDENCE", test: w => w.kind === "text" && /I live in \(municipality & province\)/i.test(w.left) },
  { id: "deponent-signature", role: "DEPONENT_SIGNATURE", test: w => w.kind === "signature" && /^\s*Signature\s*\(This form is to be signed/i.test(w.below) },
  { id: "sworn-municipality", role: "SWORN_MUNICIPALITY", test: w => w.kind === "text" && /Sworn\/Affirmed before me at/i.test(w.left) },
  { id: "sworn-province", role: "SWORN_PROVINCE", test: w => w.kind === "text" && /^\s*in\s*$/i.test(w.left) && /before me at/i.test(w.above) },
  { id: "signature-date", role: "SIGNATURE_DATE", test: w => w.kind === "text" && /^\s*on\s*$/i.test(w.left) && /province, state, or country/i.test(w.above) },
  { id: "commissioner-name", role: "COMMISSIONER_NAME", test: w => w.kind === "text" && /Type or print name below/i.test(w.above) },
  { id: "commissioner-signature", role: "COMMISSIONER_SIGNATURE", test: w => w.kind === "signature" && /^\s*Commissioner for taking affidavits/i.test(w.below) },
  { id: "statements-of-fact", role: "STATEMENTS_OF_FACT", test: w => w.kind === "text" && /consecutively numbered paragraphs/i.test(w.above + " " + w.left) }
];

export function pdfFieldKind(type: string | null): PdfFieldKind {
  switch (type) {
    case "Tx":
      return "text";
    case "Btn":
      return "checkbox";
    case "Ch":
      return "choice";
    case "Sig":
      return "signature";
    default:
      return "unknown";
  }
}

function rolesFor(w: LabelledWidget): { roles: PdfSemanticRole[]; ruleIds: string[] } {
  const hits = RULES.filter(r => r.test(w));
  return { roles: [...new Set(hits.map(h => h.role))], ruleIds: hits.map(h => h.id) };
}

/** One mapping per distinct field name. Widgets that share a name are one value in the PDF. */
export function mapPdfFields(widgets: PdfWidgetInput[]): PdfFieldMapping[] {
  const groups = new Map<string, LabelledWidget[]>();
  for (const w of widgets) {
    const list = groups.get(w.name) ?? [];
    list.push({ ...w, kind: pdfFieldKind(w.type) });
    groups.set(w.name, list);
  }

  const out: PdfFieldMapping[] = [];
  for (const [fieldName, ws] of groups) {
    const exportValues = [...new Set(ws.map(w => w.exportValue).filter((v): v is string => typeof v === "string"))].sort();
    // Shared name with different export values: a radio group (only one option can be chosen).
    const isRadioGroup = ws[0].kind === "checkbox" && exportValues.length > 1;
    const kind: PdfFieldKind = isRadioGroup ? "radio" : ws[0].kind;
    const pages = [...new Set(ws.map(w => w.page))].sort((a, b) => a - b);
    const perWidget = ws.map(rolesFor);
    const columnHeaders = [...new Set(ws.map(w => w.columnHeader).filter((v): v is string => typeof v === "string" && v.trim() !== ""))].sort();
    const headerPages = new Map<string, Set<number>>();
    for (const w of ws) {
      if (!w.columnHeader) continue;
      (headerPages.get(w.columnHeader) ?? headerPages.set(w.columnHeader, new Set()).get(w.columnHeader)!).add(w.page);
    }
    const headerRepeatsAcrossPages = [...headerPages.values()].some(set => set.size > 1);
    const base = {
      fieldName,
      kind,
      pages,
      widgetCount: ws.length,
      ruleIds: [...new Set(perWidget.flatMap(p => p.ruleIds))],
      evidenceLabel: ws[0].kind === "signature" ? ws[0].below : ws[0].left || ws[0].above,
      exportValues,
      columnHeaders,
      headerRepeatsAcrossPages
    };
    if (isRadioGroup) {
      out.push({ ...base, role: null, status: "UNRESOLVED", reason: "RADIO_GROUP_NOT_CONFIRMED" });
      continue;
    }
    const allRoles = [...new Set(perWidget.flatMap(p => p.roles))];
    const everyWidgetHit = perWidget.every(p => p.roles.length > 0);

    if (allRoles.length === 0) {
      const anyText = ws.some(w => (w.left + w.above + w.below).trim().length > 0);
      const reason: PdfMappingReason = !anyText
        ? "NO_PRINTED_LABEL_NEARBY"
        : kind === "signature" ? "SIGNATURE_NO_LABEL" : "NO_RULE";
      out.push({ ...base, role: null, status: "UNRESOLVED", reason });
    } else if (allRoles.length > 1) {
      out.push({ ...base, role: null, status: "UNRESOLVED", reason: "AMBIGUOUS_LABEL" });
    } else if (!everyWidgetHit) {
      out.push({ ...base, role: null, status: "UNRESOLVED", reason: "CONFLICTING_WIDGET_LABELS" });
    } else {
      out.push({ ...base, role: allRoles[0], status: "CONFIRMED_BY_LABEL", reason: null });
    }
  }
  return out.sort((a, b) => a.fieldName.localeCompare(b.fieldName));
}

/** Only a CONFIRMED mapping may feed an analysis. Unresolved fields produce no conclusion. */
export function usableForAnalysis(mapping: PdfFieldMapping): boolean {
  return mapping.status === "CONFIRMED_BY_LABEL" && mapping.role !== null;
}

/**
 * Concept crosswalk between a PDF semantic role and the DOCX semantic keys that already exist in the
 * per-form DOCX maps (api/services/form*SemanticFieldMap.ts). An entry means "the same printed concept",
 * not "the same field". Field-level equivalence is not claimed by this table.
 * A role with no entry has no DOCX counterpart in any current map.
 */
export const DOCX_KEY_CROSSWALK: Partial<Record<PdfSemanticRole, readonly string[]>> = {
  COURT_FILE_NUMBER: ["courtFileNumber"],
  COURT_NAME: ["courtLevel"],
  COURT_OFFICE_ADDRESS: ["courtOfficeAddress"],
  PARTY_ADDRESS_FOR_SERVICE: ["applicantNameAndAddressForService", "respondentNameAndAddressForService"],
  PARTY_LAWYER: ["applicantLawyerNameAndAddress", "respondentLawyerNameAndAddress"],
  DEPONENT_NAME: ["deponentFullLegalName"],
  STATEMENTS_OF_FACT: ["statementOfFactsBody"],
  SIGNATURE_DATE: ["signatureBlock.dateOfSignature"]
};

export interface DocxConceptComparison {
  /** PDF roles whose concept also has a DOCX key in this form's map. */
  sharedConcepts: PdfSemanticRole[];
  /** PDF roles with no DOCX key in this form's map (or no crosswalk entry at all). */
  pdfOnlyConcepts: PdfSemanticRole[];
  /** DOCX keys that no PDF role in this form covers. */
  docxOnlyKeys: string[];
}

export function compareWithDocx(pdfRoles: readonly PdfSemanticRole[], docxKeys: readonly string[]): DocxConceptComparison {
  const roles = [...new Set(pdfRoles)].sort();
  const keys = new Set(docxKeys);
  const shared: PdfSemanticRole[] = [];
  const pdfOnly: PdfSemanticRole[] = [];
  for (const role of roles) {
    const counterpart = DOCX_KEY_CROSSWALK[role] ?? [];
    (counterpart.some(k => keys.has(k)) ? shared : pdfOnly).push(role);
  }
  const covered = new Set(Object.values(DOCX_KEY_CROSSWALK).flat());
  const docxOnlyKeys = [...keys].filter(k => !covered.has(k) || !roles.some(r => (DOCX_KEY_CROSSWALK[r] ?? []).includes(k))).sort();
  return { sharedConcepts: shared, pdfOnlyConcepts: pdfOnly, docxOnlyKeys };
}
