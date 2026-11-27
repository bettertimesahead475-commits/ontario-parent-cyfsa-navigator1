/**
 * Splits a Lawyer Case Brief point into its labelled parts. The analyzer is asked to write each point as
 * "ISSUE — DOCUMENT EVIDENCE — SIGNIFICANCE — LIMITATION/COUNTERPOINT — VERIFY/NEXT QUESTION" in plain text,
 * so labels are matched only in upper case and only when a separator follows them. A point with fewer than two
 * labels is returned unstructured, word for word, rather than guessed at.
 */

export type CaseBriefPart = "issue" | "documentEvidence" | "significance" | "limitation" | "verify";

export const CASE_BRIEF_PART_LABELS: Record<CaseBriefPart, string> = {
  issue: "Issue",
  documentEvidence: "Document Evidence",
  significance: "Significance",
  limitation: "Limitation / Counterpoint",
  verify: "Verify / Next Question",
};

export const CASE_BRIEF_PART_ORDER: CaseBriefPart[] = ["issue", "documentEvidence", "significance", "limitation", "verify"];

export interface StructuredCaseBriefPoint {
  structured: boolean;
  parts: Partial<Record<CaseBriefPart, string>>;
  /** The original point with markdown emphasis removed. Always present. */
  text: string;
}

const LABEL_PATTERN =
  /(?<![A-Za-z])(ISSUE|DOCUMENT EVIDENCE|EVIDENCE|SIGNIFICANCE|LIMITATION\s*\/\s*COUNTERPOINT|LIMITATION|COUNTERPOINT|VERIFY\s*\/\s*NEXT QUESTION|VERIFY|NEXT QUESTION)(?![A-Za-z])\s*(?:\*\*)?\s*(?::|—|–|\s-\s)/g;

function partFor(label: string): CaseBriefPart {
  const l = label.replace(/\s+/g, " ");
  if (l === "ISSUE") return "issue";
  if (l === "DOCUMENT EVIDENCE" || l === "EVIDENCE") return "documentEvidence";
  if (l === "SIGNIFICANCE") return "significance";
  if (l.startsWith("LIMITATION") || l === "COUNTERPOINT") return "limitation";
  return "verify";
}

function clean(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/^[\s:—–\-|;]+/, "")
    .replace(/[\s—–\-|;]+$/, "")
    .trim();
}

/** True when index i falls inside a quotation, so a label there is quoted text rather than a section boundary. */
function insideQuote(raw: string, i: number): boolean {
  const before = raw.slice(0, i);
  const curly = (before.match(/\u201C/g) || []).length - (before.match(/\u201D/g) || []).length;
  return curly > 0 || (before.match(/"/g) || []).length % 2 === 1;
}

export function parseCaseBriefPoint(point: string): StructuredCaseBriefPoint {
  const raw = typeof point === "string" ? point : "";
  const text = raw.replace(/\*\*/g, "").trim();
  const matches: { part: CaseBriefPart; start: number; end: number }[] = [];
  const seen = new Set<CaseBriefPart>();
  for (const m of raw.matchAll(LABEL_PATTERN)) {
    if (insideQuote(raw, m.index ?? 0)) continue;
    const part = partFor(m[1]);
    if (seen.has(part)) continue;
    seen.add(part);
    let start = m.index ?? 0;
    // Include an opening "**" around the label in the label span.
    if (raw.slice(Math.max(0, start - 2), start) === "**") start -= 2;
    matches.push({ part, start, end: (m.index ?? 0) + m[0].length });
  }
  if (matches.length < 2) return { structured: false, parts: {}, text };

  const parts: Partial<Record<CaseBriefPart, string>> = {};
  const preface = clean(raw.slice(0, matches[0].start));
  matches.forEach((m, i) => {
    const value = clean(raw.slice(m.end, i + 1 < matches.length ? matches[i + 1].start : raw.length));
    if (value) parts[m.part] = value;
  });
  if (preface) parts.issue = parts.issue ? `${preface} ${parts.issue}` : preface;
  return { structured: Object.keys(parts).length >= 2, parts: Object.keys(parts).length >= 2 ? parts : {}, text };
}

/** Splits "Question: … | What the uploaded record shows: … | Still unknown: … | Source: …" into labelled lines. */
export function parseLabelledPipeItem(item: string): { label: string; value: string }[] | null {
  const text = (typeof item === "string" ? item : "").replace(/\*\*/g, "").trim();
  const segments = text.split(/\s+\|\s+/);
  if (segments.length < 2) return null;
  const rows = segments.map((segment) => {
    const m = segment.match(/^([A-Z][A-Za-z ,'/()-]{1,48}):\s*(.*)$/s);
    return m ? { label: m[1].trim(), value: m[2].trim() } : { label: "", value: segment.trim() };
  });
  return rows.some((r) => r.label) ? rows : null;
}
