/**
 * Deterministic grounding of model-written chronology dates. No model call. Each chronology row's date is parsed
 * strictly (calendar-valid day, month and year) and searched for in the source document. The AI's date is never
 * changed: the row only gains a `dateGrounding` note saying whether the date can be found in the document.
 */

export type DateGroundingStatus =
  | "UNDATED"
  | "UNPARSEABLE"
  | "INVALID_CALENDAR_DATE"
  | "NOT_FOUND_IN_DOCUMENT"
  | "GROUNDED";

export interface DateGrounding {
  status: DateGroundingStatus;
  /** ISO date (YYYY-MM-DD) when the row's date is a valid calendar date, otherwise null. */
  isoDate: string | null;
  note: string;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_PATTERN = "(January|February|March|April|May|June|July|August|September|October|November|December)";
const WRITTEN_MDY = new RegExp(`\\b${MONTH_PATTERN}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i");
const WRITTEN_DMY = new RegExp(`\\b(\\d{1,2})\\s+${MONTH_PATTERN}\\s+(\\d{4})\\b`, "i");
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;

/** Returns the ISO date for a valid calendar day, or null. Rejects 30 February and similar rollovers. */
export function isoIfValid(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parses the first recognisable date in a chronology cell. `invalid` marks a recognised but impossible date. */
export function parseChronologyDate(text: string): { iso: string | null; invalid: boolean; matched: boolean } {
  const iso = text.match(ISO);
  if (iso) {
    const v = isoIfValid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return { iso: v, invalid: v === null, matched: true };
  }
  const mdy = text.match(WRITTEN_MDY);
  if (mdy) {
    const v = isoIfValid(Number(mdy[3]), MONTHS.indexOf(mdy[1].toLowerCase()) + 1, Number(mdy[2]));
    return { iso: v, invalid: v === null, matched: true };
  }
  const dmy = text.match(WRITTEN_DMY);
  if (dmy) {
    const v = isoIfValid(Number(dmy[3]), MONTHS.indexOf(dmy[2].toLowerCase()) + 1, Number(dmy[1]));
    return { iso: v, invalid: v === null, matched: true };
  }
  return { iso: null, invalid: false, matched: false };
}

/**
 * True when the document contains the calendar date in a written form it uses: ISO, "Month D, YYYY" or "D Month YYYY",
 * with flexible spacing and case. A day inside a longer number (for example 13 inside 113) does not match.
 */
export function documentContainsIsoDate(documentText: string, iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const month = MONTHS[m - 1];
  const monthName = month.charAt(0).toUpperCase() + month.slice(1);
  const patterns = [
    new RegExp(`(?<![\\d-])${iso}(?![\\d-])`),
    new RegExp(`\\b${monthName}\\s+0?${d}(?!\\d),?\\s+${y}\\b`, "i"),
    new RegExp(`(?<!\\d)0?${d}\\s+${monthName}\\s+${y}\\b`, "i"),
  ];
  return patterns.some((p) => p.test(documentText));
}

export function groundDate(dateText: unknown, documentText: string): DateGrounding {
  const text = typeof dateText === "string" ? dateText.trim() : "";
  if (!text || text.toLowerCase() === "undated") {
    return { status: "UNDATED", isoDate: null, note: "The document does not give a date for this item." };
  }
  const parsed = parseChronologyDate(text);
  if (!parsed.matched) {
    return { status: "UNPARSEABLE", isoDate: null, note: "The date is not in a form this check reads (Month D, YYYY; D Month YYYY; or YYYY-MM-DD). Confirm it against the document." };
  }
  if (parsed.invalid || parsed.iso === null) {
    return { status: "INVALID_CALENDAR_DATE", isoDate: null, note: "The date written is not a valid calendar date. Confirm it against the document." };
  }
  if (!documentContainsIsoDate(documentText, parsed.iso)) {
    return { status: "NOT_FOUND_IN_DOCUMENT", isoDate: parsed.iso, note: "This calendar date does not appear in the document in any form this check reads. Confirm it against the document." };
  }
  return { status: "GROUNDED", isoDate: parsed.iso, note: "This calendar date appears in the document." };
}

/** Adds `dateGrounding` to each chronology row. Other fields are not changed. */
export function groundChronology<T extends { date?: unknown }>(rows: T[], documentText: string): Array<T & { dateGrounding: DateGrounding }> {
  return rows.map((row) => ({ ...row, dateGrounding: groundDate(row.date, documentText) }));
}
