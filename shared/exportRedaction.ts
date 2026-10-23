/**
 * Redaction for exported copies. Every free-text string is replaced, including summaries, quotations, titles,
 * parents' own words, and metadata. Only structural values survive: ids, enums, verification labels, and legal
 * references (for example "CYFSA s. 88"). The result is NOT guaranteed to be anonymous. Free text can still
 * carry identifying facts that a structural field does not show, so the export carries a notice saying so.
 */
export const REDACTED_TEXT = "[removed from redacted copy]";

export const REDACTED_COPY_NOTICE =
  "Redacted copy: document text, names, and other free text are removed. This copy is not guaranteed to be anonymous. Review it before sharing.";

// Keys whose string values are structural (ids, enums, labels, legal references), not free text.
const STRUCTURAL_KEYS = new Set([
  "id",
  "ids",
  "legacyId",
  "sectionId",
  "findingId",
  "allegationFindingId",
  "supportingEntryIds",
  "contraryEntryIds",
  "disputedByFindingIds",
  "kind",
  "type",
  "concern",
  "classification",
  "citationStatus",
  "recordKind",
  "scoring",
  "verdict",
  "eventType",
  "verifiedBy",
  "schemaVersion",
]);

// Legal references are kept only when the value is a short citation such as "CYFSA s. 74(2)".
// Any other prose stored under a citation key is free text and is removed.
const CITATION_KEYS = new Set(["legalReference", "citation", "primarySourceLaw"]);
// A single section reference only. Connectives and trailing words are not allowed, so no name can follow a citation.
const CITATION_PATTERN = /^(CYFSA\s+)?s\.\s*\d+(\([a-z0-9]+\))*$/i;

function redactNode(node: unknown, key: string | undefined): unknown {
  // An empty string is not free text. Replacing it would make an unanswered field look answered.
  if (typeof node === "string") {
    if (node === "") return node;
    if (key !== undefined && CITATION_KEYS.has(key)) {
      return node.length <= 60 && CITATION_PATTERN.test(node.trim()) ? node : REDACTED_TEXT;
    }
    return key !== undefined && STRUCTURAL_KEYS.has(key) ? node : REDACTED_TEXT;
  }
  if (Array.isArray(node)) return node.map((item) => redactNode(item, key));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, value] of Object.entries(node as Record<string, unknown>)) {
      // Identifying metadata is dropped whole, not just its strings.
      out[childKey] = childKey === "metadata" ? {} : redactNode(value, childKey);
    }
    return out;
  }
  return node;
}

/** Returns a copy with all free text replaced. The input is not modified. */
export function redactForExport<T>(value: T): T {
  return redactNode(value, undefined) as T;
}
