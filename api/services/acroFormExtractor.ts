/**
 * Server-side AcroForm widget extractor.
 *
 * Reads every form-field widget in a PDF: field name, type, export value, entered value, page, rectangle, and the
 * printed text beside it. It does no interpretation. Meaning comes only from acroFormIngestion.ts, which passes the
 * printed text through the semantic mapper.
 *
 * Fail-closed rules:
 *   - Input must start with "%PDF-" and be within the size limit.
 *   - The document must open with the empty user password and have 1 to MAX_PAGES pages.
 *   - A widget is skipped (and counted by reason) when its name, rectangle, or type is missing or malformed.
 *   - An entered value that is not a short string (array, object, oversized text) becomes null and is counted.
 *   - Nothing is written anywhere. This function reads bytes and returns data.
 */
import { pdfJsReady } from "./pdfPolyfill.js";
import { extractTextFromPdfBuffer } from "./pageSources.js";

export const ACROFORM_MAX_BYTES = 10 * 1024 * 1024;
export const ACROFORM_MAX_PAGES = 20;
export const ACROFORM_MAX_WIDGETS = 2000;
export const ACROFORM_MAX_VALUE_CHARS = 2000;

const ALLOWED_FIELD_TYPES = new Set(["Tx", "Btn", "Ch", "Sig"]);

export type AcroFormErrorCode =
  | "NOT_A_PDF"
  | "PDF_TOO_LARGE"
  | "MALFORMED_OR_PROTECTED_PDF"
  | "UNSUPPORTED_PAGE_COUNT"
  | "TOO_MANY_WIDGETS";

export class AcroFormError extends Error {
  constructor(public readonly code: AcroFormErrorCode, message: string) {
    super(message);
    this.name = "AcroFormError";
  }
}

export interface ExtractedWidget {
  name: string;
  page: number;
  type: string | null;
  rect: [number, number, number, number];
  exportValue: string | null;
  /** The entered value as a short string, or null when blank, unsupported, or too long. */
  value: string | null;
  /** Nearest printed text above the widget that spans its centre. Provenance only. */
  columnHeader: string | null;
  left: string;
  above: string;
  below: string;
}

export interface ExtractionResult {
  pageCount: number;
  /** Page text as the analyzer reads it (server-extracted from the uploaded file). Keyed by 1-based page. */
  pageText: Map<number, string>;
  widgets: ExtractedWidget[];
  /** Unique AcroForm field names, including parent nodes that have no widget of their own. */
  acroFormUniqueNames: string[];
  /** Widgets skipped entirely (malformed name, rectangle, or type). */
  rejectedWidgets: { count: number; reasons: Record<string, number> };
  /** Widgets kept, whose entered value was withheld because it was not a short string. */
  unsupportedValues: number;
}

function finiteRect(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  if (!raw.every(n => typeof n === "number" && Number.isFinite(n))) return null;
  return raw as [number, number, number, number];
}

function shortValue(raw: unknown): { value: string | null; unsupported: boolean } {
  if (raw === null || raw === undefined) return { value: null, unsupported: false };
  // A single-choice field stores its selection as a one-element array. Anything longer is a multi-select value.
  if (Array.isArray(raw) && raw.length === 1 && typeof raw[0] === "string") raw = raw[0];
  if (typeof raw !== "string") return { value: null, unsupported: true };
  if (raw.length > ACROFORM_MAX_VALUE_CHARS) return { value: null, unsupported: true };
  return { value: raw.trim() === "" ? null : raw, unsupported: false };
}

export async function extractAcroFormWidgets(bytes: Buffer): Promise<ExtractionResult> {
  if (bytes.length > ACROFORM_MAX_BYTES) throw new AcroFormError("PDF_TOO_LARGE", "The PDF is larger than the supported size.");
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new AcroFormError("NOT_A_PDF", "The file is not a PDF.");

  await pdfJsReady;
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc: any;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), password: "", verbosity: 0 }).promise;
  } catch {
    throw new AcroFormError("MALFORMED_OR_PROTECTED_PDF", "This PDF cannot be read. It may be damaged or protected by a password.");
  }

  try {
    const pageCount = doc.numPages;
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > ACROFORM_MAX_PAGES) {
      throw new AcroFormError("UNSUPPORTED_PAGE_COUNT", `The PDF must contain 1 to ${ACROFORM_MAX_PAGES} pages.`);
    }

    const rejected: Record<string, number> = {};
    let unsupportedValues = 0;
    const reject = (reason: string) => {
      rejected[reason] = (rejected[reason] ?? 0) + 1;
    };
    const widgets: ExtractedWidget[] = [];

    for (let p = 1; p <= pageCount; p++) {
      const page = await doc.getPage(p);
      const texts = (await page.getTextContent()).items
        .filter((i: any) => typeof i.str === "string" && i.str.trim())
        .map((i: any) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]) }));

      for (const a of await page.getAnnotations({ intent: "display" })) {
        if (a.subtype !== "Widget") continue;
        if (typeof a.fieldName !== "string" || a.fieldName.trim() === "") {
          reject("MISSING_NAME");
          continue;
        }
        const rect = finiteRect(a.rect);
        if (!rect) {
          reject("MALFORMED_RECT");
          continue;
        }
        const type = a.fieldType ?? null;
        if (type !== null && !ALLOWED_FIELD_TYPES.has(type)) {
          reject("UNSUPPORTED_FIELD_TYPE");
          continue;
        }
        if (widgets.length >= ACROFORM_MAX_WIDGETS) throw new AcroFormError("TOO_MANY_WIDGETS", "The form has too many fields to read.");

        const [x1, y1, x2, y2] = rect;
        const midY = (y1 + y2) / 2;
        const centreX = (x1 + x2) / 2;
        const left = texts
          .filter((t: any) => Math.abs(t.y + t.h / 2 - midY) < 6 && t.x + t.w <= x1 + 2 && x1 - (t.x + t.w) < 260)
          .sort((a: any, b: any) => b.x - a.x).slice(0, 3).reverse().map((t: any) => t.s).join(" ");
        const above = texts
          .filter((t: any) => t.y > y2 && t.y - y2 < 28 && t.x < x2 && t.x + t.w > x1)
          .sort((a: any, b: any) => a.y - b.y).map((t: any) => t.s).join(" ");
        const below = texts
          .filter((t: any) => t.y < y1 && y1 - t.y < 28 && t.x < x2 && t.x + t.w > x1)
          .sort((a: any, b: any) => b.y - a.y).map((t: any) => t.s).join(" ");
        const columnHeaderCandidates = texts
          .filter((t: any) => t.y > y2 && t.y - y2 < 90 && t.x <= centreX && t.x + t.w >= centreX)
          .sort((a: any, b: any) => a.y - b.y);

        const value = shortValue(a.fieldValue);
        if (value.unsupported) unsupportedValues++;
        widgets.push({
          name: a.fieldName,
          page: p,
          type,
          rect,
          exportValue: typeof a.exportValue === "string" ? a.exportValue : typeof a.buttonValue === "string" ? a.buttonValue : null,
          value: value.value,
          columnHeader: columnHeaderCandidates.length ? columnHeaderCandidates[0].s : null,
          left: left.slice(0, 160),
          above: above.slice(0, 160),
          below: below.slice(0, 160)
        });
      }
    }

    const fields = (await doc.getFieldObjects()) ?? {};
    const pageText = new Map<number, string>();
    const textPages = await extractTextFromPdfBuffer(bytes);
    for (const pg of textPages?.pages ?? []) pageText.set(pg.pageNumber, pg.text);

    return {
      pageCount,
      pageText,
      widgets,
      acroFormUniqueNames: Object.keys(fields).sort(),
      rejectedWidgets: { count: Object.values(rejected).reduce((a, b) => a + b, 0), reasons: rejected },
      unsupportedValues
    };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
