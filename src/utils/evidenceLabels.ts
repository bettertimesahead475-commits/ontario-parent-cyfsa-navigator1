/** Plain-language labels for analyzer evidence classifications. Parents see these, never the raw codes. */
export const EVIDENCE_LABELS: Record<string, string> = {
  DIRECT: "Direct evidence",
  DOCUMENTARY: "Documented",
  CORROBORATED: "Corroborated",
  HEARSAY: "Second-hand (hearsay)",
  INFERENCE: "Inference",
  OPINION: "Opinion",
  UNSUPPORTED: "Unsupported",
  UNCLEAR: "Unclear",
  COURT_ORDER: "Court order",
  JUDICIAL_ENDORSEMENT: "Judge's endorsement",
  JUDICIAL_FINDING: "Judge's finding",
  PARTY_ALLEGATION: "Party's allegation",
  REFERENCED_DOCUMENT_NOT_PROVIDED: "Referenced record not uploaded",
};

export function evidenceLabel(code: string | null | undefined): string {
  if (!code) return "";
  return EVIDENCE_LABELS[code] ?? code;
}
