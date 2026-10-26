# O8 review package: privacy and legal review of the AcroForm field-reading route

Purpose: a privacy and legal reviewer confirms what data the route touches, what it keeps, for how long, and what it must
never claim. Required before the feature flag `ACROFORM_FIELD_INGESTION` is turned on anywhere. This package does not make
a legal determination.

Status of the feature: OFF in every environment. Not connected to any report (O13). Nothing in this package activates it.

## 1. Data flow (verified from code, commit cc8e9e9 and the wording change in this package's commit)

| Step | What happens | Where | Kept? |
|---|---|---|---|
| Request | Authenticated user sends a PDF as base64 (max about 10 MB). | `api/acroFormRoutes.ts` | Not logged. The modules contain no `console` or logger call. |
| Identity | Firebase ID token verified; the verified `uid` is used as a rate-limit key. | `verifyFirebaseToken` | The `uid` is stored only as a counter key (see section 3). |
| Read | PDF parsed in memory with pdf.js and pdf-parse. Widget names, printed nearby text, and entered values are extracted. | `acroFormExtractor.ts`, `acroFormIngestion.ts`, `pageSources.ts` | Not stored. Freed when the request ends. |
| Response | Source SHA-256, page count, summary counts, and `formFieldFacts` (field name, entered value, printed label if matched). | `res.json` in the route | Returned only to the requesting user. |
| Persistence | None for the PDF or its contents. | none | No table stores PDF content. |

Verified test: `api/acroFormRoutes.test.ts` and `api/services/acroFormReadLimiter.test.ts` confirm the route makes no
database call on the default path. In shared mode the only database call is the rate-limit function (section 3).

## 2. What the response contains about a person

- `enteredValue` is what the form's fields contain. On a court or family form this can include names, addresses, dates,
  and case details. It is returned only to the authenticated user who uploaded the file.
- `sourceSha256` identifies the file's exact bytes. It is a fingerprint, not a name, but it can link two uploads of the
  same file.
- No field value, name, or document text is sent to a model, a third party, or an analytics service by this route. The
  route calls no paid AI model and no billing function.

## 3. Rate-limit data (the shared limiter, not yet applied)

If the migration `supabase/migrations_pending_approval/acroform_shared_read_limit.sql` is applied and
`ACROFORM_LIMIT_BACKEND=shared` is set:
- Table `public.acroform_read_limits` holds `(uid, window_start, reads)`. The `uid` is a Firebase identifier, which is
  personal data under most privacy frameworks, even though it is not a name.
- Row level security is on, with no policies. `anon` and `authenticated` have no privileges. Only the owner-run security
  definer function reads or writes the table.
- Retention: rows for ended windows are deleted only when a later call runs the cleanup. A row for an idle user can
  therefore persist until any user next reads a form. The reviewer must decide whether this is acceptable or whether a
  scheduled purge is required before activation.

## 4. Claims the product must not make (for the reviewer to confirm)

- The route does not verify that a field's entered value is true, complete, or entered by any particular person.
- The route does not decide whether anything is a legal defect. Field presence is not evidence of a breach.
- A "label role" appears only when the form's printed text matches. Printed text can be mistaken; the route says so.

## 5. Open questions for the reviewer

1. Does the legal basis for processing a parent's own uploaded form need a notice in the privacy policy before activation?
   The policy text is not in this repository's review scope.
2. Is the retention of `acroform_read_limits` rows acceptable? Today it is lazy deletion with no fixed maximum age (see
   section 3). Decide whether to require a scheduled purge with a stated maximum age before activation.
3. Unidentified files: a file that does not match a pinned official form still produces field facts, marked
   `formNumber: UNIDENTIFIED`. Should such files be refused instead? (Measured: 1 of 6 current sample files is unidentified.)
4. Should the route's error and success responses be reviewed for any statement that could be read as legal advice?
5. Is `sourceSha256` in responses acceptable, or should it be dropped for a parent-facing view?

## 6. Evidence that exists (not a privacy audit)

- Tests confirm no secret or document text appears in a logged error (`pageSources.limits.test.ts`, no-console-leak test).
- Tests confirm the flag defaults off and a disabled route answers 404 before reading the body.
- No dependency update in this PR changes what data leaves the server.

Not done: a third-party privacy review, a data-protection impact assessment, or any check of the production privacy policy.

Sign-off: ____________________ (reviewer, name and date)
