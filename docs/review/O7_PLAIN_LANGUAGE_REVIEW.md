# O7 review package: plain-language wording for parents

Purpose: a person reviews every sentence a parent can see from the AcroForm field-reading route, and approves or edits it.
This is a review request, not a certification. The grade figures below are a heuristic (Flesch-Kincaid with a vowel-group
syllable count) and are only a regression guard. They are not a reading-level certificate.

Method used for the figures: the same formula as `api/services/parentReadability.test.ts`. Target: Grade 8 or below.
Commit: `cc8e9e9` plus the wording change in this package's commit.

## 1. What a parent sees: the field-fact sentences

| Case | Exact text | Grade (est.) | Longest sentence (words) |
|---|---|---|---|
| Field matched to a printed label, blank | The form field printed as "Court File Number" (page 1) is blank. This describes the form field only. It does not show who entered the value, whether it is true, or any legal consequence. | 4.1 | 16 |
| Field matched to a printed label, filled | The form field printed as "Court File Number" (page 1) contains "CV-1". This describes the form field only. It does not show who entered the value, whether it is true, or any legal consequence. | 4.4 | 16 |
| Field not matched to a label | A form field could not be matched to a printed label on the form, so what it is for is not established. Its entry is shown as entered and is not used in this analysis. | 5.7 | 22 |

Review questions:
- Is "what it is for is not established" clear to a parent with no legal training?
- Is "is not used in this analysis" accurate? Today the AcroForm route is off by default and is not connected to any
  analysis report (checklist O13). The sentence is true now only because of that. If integration is approved later, this
  sentence must be re-checked against the integrated report before it is shown to a parent.

## 2. What a parent sees: refusal and error messages

Every message the route can return. Grade figures are estimates.

| Code | HTTP | Exact text | Grade (est.) |
|---|---|---|---|
| LIMITER_UNAVAILABLE | 503 | We cannot read forms right now. Please try again later. | 1.6 (was 12.5, see note) |
| RATE_LIMITED | 429 | Too many form reads. Try again later. | 2.6 |
| BUSY | 429 | Too many form reads are running. Try again shortly. | 3.2 |
| SIGN_IN_REQUIRED | 401 | Authentication required. | short |
| UNSUPPORTED_TYPE / 415 | 415 | Only PDF files can be read for form fields. | review |
| PDF_TOO_LARGE | 413 | The PDF is larger than the supported size. | review |
| INVALID_INPUT | 400 | The file data is not valid base64. | review |
| INVALID_INPUT | 400 | The request body is not valid JSON. | review |
| NOT_A_PDF | 415 | The file is not a PDF. | review |
| MALFORMED_OR_PROTECTED_PDF | 422 | This PDF cannot be read. It may be damaged or protected by a password. | review |
| EXPANDED_CONTENT_TOO_LARGE | 413 | The PDF's content expands beyond the supported size. | review |
| UNSUPPORTED_PAGE_COUNT | 422 | The PDF must contain 1 to 20 pages. | review |
| TOO_MANY_WIDGETS | 422 | The form has too many fields to read. | review |
| INTERNAL_ERROR | 500 | An unexpected error occurred. | short |
| NOT_FOUND (flag off) | 404 | Not found. | short |

Note: the first row was changed in this package's commit. The earlier wording, "Form reads are temporarily unavailable.
Try again later.", scored 12.5. A regression test now enforces the Grade 8 limit on this message only. Rows marked
"review" have not yet been measured with the same method; the reviewer should measure them or confirm them by eye.

## 3. Decisions for the reviewer

1. Approve or edit each sentence in section 1 and section 2.
2. Decide whether a parent should ever see the words "legal consequence" in the blank-field text. The current wording says
   the field text makes no legal claim. Confirm this is the intended message.
3. Confirm that no message says or implies that a form is correct, complete, or valid. The current messages do not.

Not reviewed by this package: the analyzer's own report text (outside the AcroForm route) and any AI-written content.

Sign-off: ____________________ (reviewer, name and date)
