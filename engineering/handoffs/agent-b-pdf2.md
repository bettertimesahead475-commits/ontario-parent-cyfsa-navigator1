# Agent B handoff: PDF-2 (T-11) real-PDF verification of Quick Review, guide and template exports

Branch `devin/1795798796-exports-pdf2`, based on `engineering/integration` `8623990`. Do not merge or deploy from this branch.

## Method

- Local build: `DISABLE_HMR=true npx vite --port 5173 --strictPort`, restarted after every edit.
- Headless Chromium 156 through `playwright-core`; each export popup is saved with `page.pdf()` (Chromium `Page.printToPDF`, Letter, backgrounds on, CSS page size).
- Mocked Firebase sign-in and a synthetic saved Quick Review (`fixtures.mjs`); every `/api/**` request is intercepted and logged. **No export made an API request** (`api` column), so no analyzer runs, no inference and no credit changes.
- Per PDF: `%PDF-` magic, `pdfinfo` page count, `pdftotext -layout` per page (non-empty lines, excluding the running "Page N of M" footer), expected headings, a scan for emoji/symbol glyphs, U+FFFD and mojibake (`Ã.`, `â€`), literal `**`, and `pdftoppm` page images, which were viewed.
- A page counts as sparse when it has fewer than 4 text lines.

## Defects found and fixed

| Defect (before) | Exports affected | Fix |
|---|---|---|
| Literal `**` markdown in the PDF text | 12 of 15 guides; Family Rights and CAS Procedure branded PDFs | `guideTextHtml()` in `src/utils/printExport.ts`: escapes the text, turns `**x**` into `<strong>x</strong>`; used by `CYFSAGuideTab.tsx` and `ParentJourney.tsx` |
| Emoji/symbol glyphs (⚖ ⚠ ✓ 💡 🔗) in headings and text | all 15 guides; Respondent Answer template (⚠) | Removed from the guide section headings and checklist titles; `guideTextHtml()` drops leading pictographs from guide copy; removed ⚠️ from the template draft notice and hearsay advisory in the print HTML (on-screen UI unchanged) |
| Title-only first page (whole first card pushed to page 2) | guides: Protection Grounds, Parent Rights (MHA), Indigenous Rights, Proactive Mental Health; branded Family Rights, CAS Procedure | The print rule letting `.section-card` break across pages came *before* the base `page-break-inside: avoid`, so it never applied. Moved after the base rules in both stylesheets |
| Page holding only the footer line | guides: CLRA 300 days, Evidence/Hearsay; branded Charter Rights; template Plan of Care | Guide disclaimer and footer wrapped in `.end-matter` (`break-inside: avoid`); template notice/footer kept with the last section |
| Quick Review harness could not open the export | (harness only) | Seeded the saved Forensic report too and waited for the export button; the export itself was fine |

The print-preview screen designs are unchanged: same colours, fonts, letterhead and card styling; only page-break behaviour, the removed glyphs and the bold rendering differ.

## Evidence (final run, all fixes applied)

| File | Pages | Text lines per page | Sparse pages | Glyph/mojibake hits | Expected headings | API calls |
|---|---|---|---|---|---|---|
| `quick-review.pdf` | 3 | 27, 26, 11 | none | none | all found | 0 |
| `guide-emergency-removal.pdf` | 4 | 27, 16, 20, 5 | none | none | all found | 0 |
| `guide-protection-grounds.pdf` | 3 | 38, 17, 17 | none | none | all found | 0 |
| `guide-worker-authority-limits.pdf` | 3 | 23, 18, 5 | none | none | all found | 0 |
| `guide-right-to-counsel-legal-representation.pdf` | 3 | 26, 19, 9 | none | none | all found | 0 |
| `guide-parent-child-rights.pdf` | 3 | 27, 20, 5 | none | none | all found | 0 |
| `guide-indigenous-rights-cyfsa-and-c92.pdf` | 4 | 35, 37, 19, 19 | none | none | all found | 0 |
| `guide-plan-of-care-requirements.pdf` | 3 | 25, 20, 5 | none | none | all found | 0 |
| `guide-proactive-mental-health-substance-engagement.pdf` | 5 | 32, 29, 14, 25, 12 | none | none | all found | 0 |
| `guide-parent-rights-mental-health-act.pdf` | 5 | 35, 27, 19, 26, 7 | none | none | all found | 0 |
| `guide-kinship-family-placement-preference.pdf` | 3 | 26, 20, 5 | none | none | all found | 0 |
| `guide-access-visitation-rights.pdf` | 3 | 24, 19, 5 | none | none | all found | 0 |
| `guide-appeal-rights.pdf` | 3 | 26, 17, 8 | none | none | all found | 0 |
| `guide-clra-parentage-300-days.pdf` | 3 | 21, 16, 5 | none | none | all found | 0 |
| `guide-evidence- hearsay.pdf` | 3 | 24, 17, 5 | none | none | all found | 0 |
| `guide-procedural-timelines.pdf` | 3 | 27, 18, 10 | none | none | all found | 0 |
| `branded-charter-rights.pdf` | 2 | 26, 23 | none | none | all found | 0 |
| `branded-investigation.pdf` | 3 | 24, 26, 10 | none | none | all found | 0 |
| `branded-defense-strategies.pdf` | 1 | 23 | none | none | all found | 0 |
| `branded-rights.pdf` | 8 | 32, 34, 34, 31, 32, 32, 32, 2 | 8 | none | all found | 0 |
| `branded-cyfsa-procedure.pdf` | 5 | 39, 32, 33, 32, 9 | none | none | all found | 0 |
| `branded-five-day-rule.pdf` | 1 | 15 | none | none | all found | 0 |
| `branded-45-day-roadmap.pdf` | 4 | 26, 25, 27, 6 | none | none | all found | 0 |
| `template-affidavit-prep.pdf` | 1 | 32 | none | none | all found | 0 |
| `template-timeline-tracker.pdf` | 1 | 13 | none | none | all found | 0 |
| `template-evidence-log.pdf` | 1 | 15 | none | none | all found | 0 |
| `template-issue-sheet.pdf` | 1 | 15 | none | none | all found | 0 |
| `template-prep-sheet.pdf` | 1 | 18 | none | none | all found | 0 |
| `template-respondent-answer.pdf` | 1 | 32 | none | none | all found | 0 |
| `template-plan-of-care-prep.pdf` | 2 | 24, 7 | none | none | all found | 0 |
No final-run PDF contains `**`, U+FFFD or mojibake. Before the fixes: 14 PDFs contained `**`, 16 contained emoji glyphs, and 8 had sparse pages (Protection Grounds, Parent Rights (MHA), CLRA 300 days, Evidence/Hearsay, Charter Rights, Family Rights, CAS Procedure, Plan of Care). The Quick Review was already 3 full pages.

## Remaining

- **Family Rights branded PDF (8 pages) can end on a page holding only the 2-line legal disclaimer.** Page 7 is full and Chromium does not move earlier lines forward to honour `break-before: avoid`. It depends on web-font timing: re-rendering the same saved HTML gave 11 lines on the last page. Not fixed; a dependable fix needs restructuring `printBrandedDocument` callers so the disclaimer sits inside the last card.
- Guide copy in `src/data.ts` still contains emoji and `**` for the on-screen guide; only the PDF output strips them.

## Tests

- New `src/utils/printExport.guide.test.tsx` (5 tests): `**` → `<strong>`, escaping, emoji removal; CYFSA guide and Family Rights PDFs have no `**` or pictographs and the break rule follows the base rule; Respondent Answer print has no pictographs. All fail on the old code.
