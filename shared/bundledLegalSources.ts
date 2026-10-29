/**
 * Provenance manifest for statute text bundled with the app. Each entry pins the exact file by SHA-256, so a change to
 * the text without a deliberate manifest update fails a test (api/services/forensic/bundledLegalSources.test.ts).
 *
 * What is and is not established:
 * - The consolidation period and last amendment are read from the file's own header.
 * - The file has not been compared against live e-Laws for currency. Before relying on a provision for a date after
 *   the consolidation period starts, confirm the e-Laws currency date.
 */
export interface BundledLegalSource {
  id: string;
  title: string;
  citation: string;
  file: string;
  sha256: string;
  sourceUrl: string;
  /** As stated in the file header. */
  consolidationPeriodFrom: string;
  lastAmendment: string;
  retrievalNote: string;
  currencyCheckedAgainstELaws: false;
}

export const BUNDLED_LEGAL_SOURCES: BundledLegalSource[] = [
  {
    id: "on-cyfsa-2017",
    title: "Child, Youth and Family Services Act, 2017",
    citation: "S.O. 2017, c. 14, Sched. 1",
    file: "legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt",
    sha256: "eef339ddf8651e632fe01dca48326da8abae876763f75d8066073ffa1bda1560",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14",
    consolidationPeriodFrom: "2026-07-01",
    lastAmendment: "2025, c. 12, Sched. 1",
    retrievalNote: "Extracted from the official ontario.ca document (legal-reference/README.md). The 2026-06-24 in the filename is not the consolidation date.",
    currencyCheckedAgainstELaws: false,
  },
];
