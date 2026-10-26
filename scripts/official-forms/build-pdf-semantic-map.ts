// Regenerates compat/pdf-semantic-map-2026-10-26.json from the recorded widget snapshot and the DOCX semantic maps.
// Run: npx tsx scripts/official-forms/build-pdf-semantic-map.ts
import fs from "node:fs";
import path from "node:path";
import { mapPdfFields, compareWithDocx, type PdfWidgetInput } from "../../api/services/officialFormPdfSemanticMap.ts";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const snapshot = JSON.parse(fs.readFileSync(path.join(root, "scripts/official-forms/compat/pdf-widgets-2026-10-26.json"), "utf8"));

// DOCX semantic keys, read from the map sources so the record cannot drift from the code.
function docxKeysFrom(files: string[]): string[] {
  const keys = new Set<string>();
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, "api/services", f), "utf8");
    for (const m of src.matchAll(/semanticKey: "([^"]+)"/g)) keys.add(m[1]);
  }
  return [...keys].sort();
}
const DOCX_BY_FORM: Record<string, { files: string[]; docxFile: string }> = {
  "35.1A": { files: ["form351aSemanticFieldMap.ts"], docxFile: "48d81005-form-35-1a-en-dec20.docx" },
  "33C": { files: ["form33cSemanticFieldMap.ts"], docxFile: "3bf6f793-form_33c_2018.docx" },
  "33B.1": { files: [], docxFile: "df0e02ef-form-33b-1-en-dec20.docx" },
  "14A": { files: ["form14aSemanticFieldMap.ts"], docxFile: "c01f056a-flr_14a_sept105_en_fil.docx" },
  "8B": {
    files: ["form8bFinalSemanticFieldMap.ts", "form8bAdminChildPartySemanticFieldMap.ts", "form8bRequestedOrderSemanticFieldMap.ts"],
    docxFile: "d39f83dd-form-8b-feb_1_2022-en.docx"
  }
};

const forms: Record<string, unknown> = {};
for (const [fileName, entry] of Object.entries<any>(snapshot.forms)) {
  const form = entry.formNumber as string;
  const isUnmatched = form.startsWith("unmatched");
  const key = isUnmatched ? "UNMATCHED-33B(PDF)" : form;
  const widgets: PdfWidgetInput[] = entry.widgets;
  const mappings = mapPdfFields(widgets);
  const confirmed = mappings.filter(m => m.status === "CONFIRMED_BY_LABEL");
  const widgetNames = new Set(widgets.map(w => w.name));
  const parents = (entry.acroFormUniqueNames as string[]).filter(n => !widgetNames.has(n));
  const docx = DOCX_BY_FORM[form];
  const docxKeys = docx && docx.files.length ? docxKeysFrom(docx.files) : [];
  const roles = confirmed.map(m => m.role!);
  forms[key] = {
    fileName,
    acroFormUniqueNames: entry.acroFormUniqueNames.length,
    widgetNames: widgetNames.size,
    nonWidgetParentNodes: parents,
    fieldsMapped: mappings.length,
    confirmed: confirmed.length,
    unresolved: mappings.length - confirmed.length,
    coveragePercent: Math.round((confirmed.length / mappings.length) * 1000) / 10,
    unresolvedByReason: mappings
      .filter(m => m.status !== "CONFIRMED_BY_LABEL")
      .reduce((a: Record<string, number>, m) => ((a[m.reason!] = (a[m.reason!] || 0) + 1), a), {}),
    docxComparison: docx && docx.files.length
      ? { docxFile: docx.docxFile, docxKeyCount: docxKeys.length, ...compareWithDocx(roles, docxKeys) }
      : { docxFile: docx?.docxFile ?? null, note: "No DOCX semantic map exists for this form; no comparison is made." },
    mappings
  };
}

const record = {
  recordedAt: snapshot.recordedAt,
  method: "Widgets and printed label text extracted by scripts/official-forms/extract-pdf-widgets.mjs. Mapped by api/services/officialFormPdfSemanticMap.ts using printed text only; field names are grouping keys, not evidence.",
  forms
};
fs.writeFileSync(path.join(root, "scripts/official-forms/compat/pdf-semantic-map-2026-10-26.json"), JSON.stringify(record, null, 1) + "\n");
console.log("wrote mapping record");
