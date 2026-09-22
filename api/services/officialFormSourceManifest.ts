// Stage 9D-4B-1 — Real Ontario integration manifest.
//
// PROVENANCE: this metadata was observed by the project lead INDEPENDENTLY OUTSIDE this Claude
// sandbox, on 2026-09-22, by reading the canonical official index page:
//   https://ontariocourtforms.on.ca/en/family-law-rules-forms/
//
// This is development metadata ONLY — title, form number, version date, effective date, and
// PDF/DOCX filenames as reportedly listed on that index page. It establishes, at most,
// OFFICIAL_INDEX_VERIFIED status (see officialFormRetrieval.ts's OfficialIndexMetadataRecord).
// It does NOT establish, and must never be treated as establishing, ARTIFACT_BYTES_VERIFIED:
// no SHA-256, byte length, final redirected artifact URL, actual MIME response, exact size, or
// internal document structure has been observed for any of these five forms in this sandbox
// (this sandbox's outbound network is proxy-blocked from reaching Ontario government hosts).
// Those fields are therefore explicitly left null below — never guessed, never filled with a
// plausible-looking placeholder value.
import { buildOfficialIndexMetadataRecord, type OfficialIndexMetadataRecord } from "./officialFormRetrieval.js";

export const OFFICIAL_INDEX_SOURCE_URL = "https://ontariocourtforms.on.ca/en/family-law-rules-forms/";
export const OFFICIAL_INDEX_OBSERVED_BY = "project lead (outside this Claude sandbox)";
export const OFFICIAL_INDEX_OBSERVED_DATE = "2026-09-22";

export const REAL_ONTARIO_FORM_CANDIDATES: OfficialIndexMetadataRecord[] = [
  buildOfficialIndexMetadataRecord({
    formNumber: "8B",
    officialTitle: "Application (child protection and status review)",
    versionDateRaw: "Feb. 1, 2022",
    effectiveDateRaw: "May 1, 2022",
    pdfFilename: "form-8b-feb-2022-en.pdf",
    docxFilename: "form-8b-feb_1_2022-en.docx"
  }),
  buildOfficialIndexMetadataRecord({
    formNumber: "33B.1",
    officialTitle: "Answer and plan of care (parties other than Children's Aid Society)",
    versionDateRaw: "Dec. 1, 2020",
    effectiveDateRaw: "March 1, 2021",
    pdfFilename: "form-33b-1-en-dec20.pdf",
    docxFilename: "form-33b-1-en-dec20.docx"
  }),
  buildOfficialIndexMetadataRecord({
    formNumber: "33C",
    officialTitle: "Statement of agreed facts (child protection)",
    versionDateRaw: "March 1, 2018",
    effectiveDateRaw: "April 30, 2018",
    pdfFilename: "form_33c_2018.pdf",
    docxFilename: "form_33c_2018.docx"
  }),
  buildOfficialIndexMetadataRecord({
    formNumber: "35.1A",
    officialTitle: "Affidavit (child protection information)",
    versionDateRaw: "Dec. 1, 2020",
    effectiveDateRaw: "March 1, 2021",
    pdfFilename: "form-35-1a-en-dec20.pdf",
    docxFilename: "form-35-1a-en-dec20.docx"
  }),
  buildOfficialIndexMetadataRecord({
    formNumber: "14A",
    officialTitle: "Affidavit (General)",
    versionDateRaw: "Sept. 1, 2005",
    effectiveDateRaw: "May 1, 2006",
    pdfFilename: "flr-14a-sept105-en-fil.pdf",
    docxFilename: "flr_14a_sept105_en_fil.docx"
  })
];
