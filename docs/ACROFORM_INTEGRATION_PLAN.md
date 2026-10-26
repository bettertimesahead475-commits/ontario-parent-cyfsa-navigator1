# AcroForm field facts: integration plan (not activated)

Status: planning only. Nothing here is enabled. The route stays behind `ACROFORM_FIELD_INGESTION` (default OFF). Field
facts are not shown in any production report.

## 1. Safest future integration point
The analyzer already has one place where every report passes a server-side trust boundary: `applyReportGuards`
(`api/services/analyzerSections.ts`). Field facts are added to a report there, using the same guard that already
enforces citation status and quote verification. The integration point is therefore the report assembly step, after
the analyzer's sections are generated and before the report is saved or returned. No new path to the client is needed.

Why this point and not others:
- The upload pipeline (`uploadSource`, `pageSources`) is not changed. Field reading stays a separate, read-only step.
- The client never sends field interpretations. It sends a PDF; the server produces the facts. The guard re-derives them.
- Parent and professional reports both pass through the same report object, so one guard covers both.

## 2. Preserving existing behaviour
- Upload, extraction, authentication, billing, and the analyzer's sections stay as they are.
- The field step runs only when the flag is on, and only after the existing upload has produced its pages.
- It makes no billing or credit call. Its cost is bounded CPU (see the resource limits).
- Its output is a separate section of the report, so an empty or failed field read does not change the analyzer's findings.

## 3. Provenance and uncertainty, per fact
Every fact shown must carry:
- where it came from: the form's identity (pinned, or "not identified"), the file's SHA-256, the page, and the field name;
- what kind of statement it is: "this field is present", "this is what it says", "this is who it is attributed to" (never
  shown: party attribution is always "not determined");
- how sure we are: "the label matches" (confirmed from printed text) or "we could not tell what this box is for" (not
  established);
- what it does not say: that it was filled in by anyone in particular, that it is true, or that it has any legal effect.

Unresolved fields are shown only as "present, not used" with the entered text. Conflicting fields are shown with no value.

## 4. Parent-facing language (Grade 8 or lower)
Requirements, checked on samples:
- Sentences of about 20 words or fewer. Use one idea per sentence.
- Plain words. Say "box" or "line" rather than "field", and "form" rather than "AcroForm".
- Say what we saw, then what we did not check. Do not use the words "violation", "breach", "defect", or "non-compliant".
- No legal claims from a blank or filled field alone.

Estimated grade level (Flesch-Kincaid, syllable heuristic, not a certified tool):

| Sentence | Grade (est.) |
|---|---|
| Current field-fact wording (confirmed) | 3.4 |
| Current wording (not established) | 5.7 |
| Proposed: "The "Name of court" box on page 1 is blank. The box is not filled in." | -0.9 |
| Proposed: "On page 1, the box labelled "Name of court" says: "Name of court". This is what the form says. It does not show who filled it in or whether it is correct." | 1.4 |
| Proposed: "We could not tell what this box on your form is for, so we did not use it. The text in it is shown exactly as it appears." | 2.9 |

These are estimates from a rough syllable count. A plain-language reviewer must check the final wording before activation.

## 5. Privacy and legal review before activation
- Privacy: court documents contain children's and families' personal information. Review what is shown, to whom, and what
  errors reveal. The route stores nothing, but the analyzer's existing pipeline may. Confirm that before activation.
- Retention: confirm that no uploaded bytes or extracted values are kept. The route keeps none; the analyzer's pipeline
  is out of this review.
- Legal: a lawyer must review the wording so that a field fact is never presented as evidence of a legal defect. Field
  presence and blank values are not legal conclusions.
- Accessibility and translation: review for screen readers and for French, if the product offers it.
- Monitoring: decide what is logged on an error, and confirm that no field value is logged (tested for the route).

## 6. Steps before any activation (each needs the owner's approval)
1. Resolve the residual risks in `ACROFORM_SECURITY_AUDIT.md`, especially the existing upload-path regex.
2. Add a per-user rate limit.
3. Add the field step to the report assembly behind the flag, with tests for every fact kind.
4. Get the privacy and legal reviews above.
5. Run a staging test with real uploads and the Grade 8 review.
6. Enable for a small test group first, then decide on production.
