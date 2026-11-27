# Agent B handoff — export fidelity, FCA redaction, persistence audit

Branch: `devin/1795744359-exports-pdf-polish` → base `devin/1795744800-exports-integration` (from 2d955e9).

## Changes
| Export | Fix |
|---|---|
| Final Case Assessment PDF | Honours the export redaction setting (`useRedaction`). Redacted copy: matter title → "Redacted matter", source file names → "Source document N" (S-numbers and page refs kept), phone/date/FC-file-number patterns masked in findings and source text (`redactPiiText`), plus `FINAL_ASSESSMENT_REDACTED_NOTICE`. Button reads "Download redacted PDF". `DocumentAnalyzerTab` passes its live `redactionEnabled` so a toggle change applies without remount. |
| Quick Review PDF | Adds the saved `fileSummary` ("Document Summary"). Empty Practical Verification guide says "Not stated in the document." Title fallback "N/A" → "Not stated in the document". Footer "CYFSA Navigator — Page X of Y". |
| Forensic PDF | Prints the citation exactly as saved (was normalised, e.g. `s. 74(2)(l)` printed as `s. 74(2)`). No longer claims "Each finding has been independently reviewed" when the second review did not complete. Location/significance fallbacks "Record" / "Compare against original commissioned copy." → "Not stated in the document". Adds the saved `whatToVerify` as "Items to Verify". |
| Lawyer Case Brief TXT | Now includes Contradictions and Discrepancies and the File line, matching the PDF. |

`src/utils/redaction.ts`: pattern logic moved to exported pure `redactPiiText`; `useRedaction().redactDocumentText` behaviour unchanged.

## Browser verification (Playwright, headless Chrome, mocked Firebase sign-in, mocked `/api/**`, synthetic case SYN-2026-0417)
- Clicked Export Quick Review PDF, Export Deep Scan PDF, Download PDF Brief, Download .txt Brief, FCA Download PDF; checked with `pdftotext -layout` and `pdftoppm`.
- No API request was made during any export (no analyzer/assessment calls, no credit change).
- Redaction on: Lawyer Case Brief PDF/TXT open nothing; Quick, Forensic and FCA PDFs contain none of the title, file names, file number or dated text.
- Persistence: Case Cabinet file and saved reports survive refresh; hidden after sign-out; not visible to a second user; restored on re-sign-in (keys `*_<uid>`).

## Open findings (not changed here)
- `OPA_COACH_CHAT_MESSAGES` and `OPA_STATUTE_BOOKMARKS` are stored without a per-user suffix, so they carry across accounts on a shared browser.
- Quick Review chronology prints raw enum labels (`DIRECT_OBSERVATION`).
- Quick/Forensic headings use emoji that render as boxes where no emoji font is installed.
- Forensic's last page can hold only the closing footer line.
