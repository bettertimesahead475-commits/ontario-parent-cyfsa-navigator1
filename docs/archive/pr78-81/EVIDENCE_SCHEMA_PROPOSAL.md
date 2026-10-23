# Evidence Schema Reconciliation (Priority 3)

Status: **proposal, tested on disposable PostgreSQL 16.** Not applied. The proposal is `supabase/proposals/evidence_schema_additive_v1.sql`, with tests in `supabase/proposals/evidence_schema_additive_v1.test.sql`.

## The gap

The Phase 7B reconciled file `phase7b_reconciled_evidence_foundation.sql` creates `navigator_evidence_items` with four columns: `id`, `matter_id`, `classification`, `created_at`, `updated_at`. Runtime code reads and writes far more.

Verified on PostgreSQL 16 after the 7B chain: missing `exact_quote`, `page_id`, `page_number`, `normalized_statement`, `document_id`, `document_version_id`, `quote_verification`, `review_state`, `extraction_run_id`, `quote_start_offset`, `quote_end_offset`, `confidence`. Missing table: `navigator_document_pages`, `navigator_extraction_runs`.

## Runtime dependencies

Files that reference each column (grep over `api`, `shared`, `src`, excluding tests). Counts are approximate, since the search is textual.

| Column | Files | Example consumers |
|---|---|---|
| exact_quote | 8 | `api/services/pageSources.ts` (quote verification) |
| page_id | 8 | `pageSources.ts` (page binding) |
| page_number | 10 | `pageSources.ts`, `professionalWorkspace.ts` |
| normalized_statement | 8 | `pageSources.ts`, evidence review |
| quote_verification | 7 | `pageSources.ts` |
| review_state | 14 | `shared/evidenceReview.ts`, `EvidenceReviewWorkspace.tsx` |
| document_id, document_version_id | 10, 8 | `professionalWorkspace.ts`, `caseActionWorkspace.ts` |
| extraction_run_id | 3 | evidence-run check |
| quote_start_offset | 4 | quote verification |
| confidence | 11 | evidence review |
| `navigator_document_pages` table | 1 (`professionalWorkspace.ts`) | page reads |

## What the proposal adds

Additive only. Nothing is replaced, no column is dropped, and the 7B definition is kept.

- **Columns on `navigator_evidence_items`**: document, version, page, and quote provenance; `review_state`; `confidence`; `extraction_run_id`. Added only when the table is empty (guarded).
- **`navigator_extraction_runs`** (new): with the original status, provenance, and terminal-state checks.
- **`navigator_document_pages`** (new): checksum-bound, insert-only page text.
- **Composite same-matter keys**: evidence to document (matter), version (document), page (version and page number), and run (version and matter). These stop cross-matter linking at the database.
- **Helper functions**, copied verbatim from the original file: quote normalization, quote validation, evidence-run check. Quote validation runs on every evidence insert against the stored page text.
- **Guards**: evidence provenance is immutable (review state may change); pages are insert-only with checksum; terminal runs are immutable.
- **RLS and grants**: RLS on the three evidence tables. No `anon` or `authenticated` privileges. `service_role` only.
- **Guard against populated tables**: the migration raises `NOT_EMPTY` or `ALREADY_APPLIED` rather than altering populated data.
- **Additive columns on existing tables**: `navigator_documents` (`original_filename`, `content_type`, `status`) and `navigator_document_versions` (`page_count`, `parser_metadata`, `extraction_run_id`), plus two uniqueness constraints.

## What the proposal does not add

- **`navigator_source_operation`** (the RPC that creates documents, versions, and runs, and enforces the upload flow). Not ported. Runtime calls to it will fail on any database where this proposal is applied, unless it is ported separately.
- **Document and version guards** (`navigator_source_guard` for `navigator_documents` and `navigator_document_versions`: completed versions immutable, source identity immutable). Not ported. Without them, a version's content hash can change after completion.
- **Read-only RLS policies**. None exist, by design: access is server-side with the service role.

These two omissions are real gaps. The proposal does not claim the page-evidence feature works end to end. It makes the evidence rows and their guards match what the runtime reads, and leaves the upload path to a separate review.

## Tests

`evidence_schema_additive_v1.test.sql`, run after the 7B chain and the proposal, on a UTF-8 database. All in one transaction, rolled back.

| # | Expectation | Result |
|---|---|---|
| 1 | Valid EXACT quote accepted | PASS |
| 2 | Unsupported quote recorded as ABSENT with REQUIRES_SOURCE | PASS |
| 3 | Fabricated quote rejected | PASS |
| 4 | Wrong offsets rejected | PASS |
| 5 | Run from another matter rejected | PASS |
| 6 | Document link across matters rejected | PASS (rejected by the run-hierarchy check, which runs first. This does not isolate the composite key.) |
| 7 | Quote provenance cannot change | PASS |
| 8 | Review state can change | PASS |
| 9 | Page text cannot change | PASS |
| 10 | Checksum mismatch rejected | PASS |
| 11 | Terminal run cannot change | PASS |
| 12 | RLS on; no `anon` or `authenticated` privileges | PASS |

Separately: the proposal refuses to run on a database with an evidence row (`NOT_EMPTY`), and refuses to run twice (`ALREADY_APPLIED`).

## Limits

- Tested on PostgreSQL 16 with the Supabase roles simulated. Not on a Supabase branch.
- Test 6 is not isolated (see above). The composite key is not directly proven by a test.
- No test for the upload path, since it is not ported.
- `navigator_document_versions` and `navigator_documents` were created locally from the pending case-ownership file. Production's columns were checked read-only and match.

## Owner decisions

1. Approve the proposal as the evidence schema, replacing `create_navigator_page_evidence_foundation.sql`.
2. Decide whether `navigator_source_operation` and the document and version guards are ported now (separate review), or the upload feature stays disabled until they are.
3. Confirm the legal-provenance fields (`quote_verification`, `review_state`) match the intended review model.
