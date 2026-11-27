# Agent B: Quick Review / Forensic PDF layout polish

Branch `devin/1795746615-exports-pdf-layout`, based on `engineering/integration` at `0a7c680`. `src/utils/finalAssessmentExport.ts` and `src/utils/redaction.ts` are untouched.

## Changes
1. **No emoji headings.** Nine `section-title` headings in `printAnalyzer` (Quick Review, combined and cabinet exports) and the Forensic "✓ Second Review" label had emoji or check marks, which print as empty boxes (missing glyphs). The headings now start with the text.
2. **Readable chronology labels.** The Quick Review chronology "Evidence" column uses `evidenceLabel` from `src/utils/parentReportView.ts`, the same plain-language label the parent view uses; the only change there is the new `export`. Examples: `HEARSAY` becomes "Second-hand (hearsay)", `DIRECT_OBSERVATION` becomes "Direct observation".
3. **Forensic closing footer.** It is now `break-inside: avoid` and `break-before: avoid`, so it cannot be split, and it is not separated from the content before it.
4. **Quick Review end matter.** The legal statement and the citation warning are wrapped in `.end-matter` (`break-before: avoid; break-inside: avoid`). In print, their spacing is compact (14px/8px margins, 9px/8.5px text). The page totals come from `@page { counter(page) " of " counter(pages) }`, so they always reflect the real page count.

## Verification
All runs use Playwright with headless Chrome, a mocked sign-in and mocked `/api`, and synthetic reports. Each PDF was checked with `pdftotext -layout`, `pdftoppm -r 80` and `pdfinfo`.

| Case | Before (`0a7c680`) | After |
|---|---|---|
| Sparse Quick Review (summary + not-scored ESI + empty guide) | 2 pages; page 2 has only the end matter | 1 page, "Page 1 of 1" |
| Sparse Quick Review with a chronology | 2 pages; page 2 has the guide and the end matter | Same (the end matter stays with the guide) |
| Full Quick Review | 3 pages | 3 pages, chronology shows "Second-hand (hearsay)" and "Direct observation" |
| Emoji code points in the Quick Review and Forensic HTML and PDF text | 9 headings, plus "✓" | 0 |

- **Forensic footer-only last page:** not reproducible on `0a7c680`. A sweep of 161 rendered variants (0–40 extra chronology rows, 0–120 summary lengths) gave 0 footer-only last pages before and after the change, and every page showed a correct "Page N of M" total. The page I reported in the first handoff came from an earlier build. The CSS change is hardening.
- **Tests:** 5 new tests, all failing on `0a7c680`:
  - `DocumentAnalyzerTab.export.test.tsx`: no emoji headings, readable chronology labels, end matter kept together.
  - `forensicPdfRenderer.test.ts`: no emoji or check-mark glyphs, footer kept whole.
- **Totals:** `npx tsc --noEmit -p .` reports 0 errors. Vitest: 319 files passed, 15 skipped; 4743 tests passed, 512 skipped, 0 failed.
