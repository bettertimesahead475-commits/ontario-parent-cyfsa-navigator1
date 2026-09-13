# Page-anchored source/evidence foundation

Base reviewed: `22384a833cf7889493a0835c2b68af9726e1caf1`.
Current status: STAGE 4 COMPLETE WITH RELEASE CONDITIONS. The migration was installed and validated only on disposable project unfepurousallhocgehl; not authorized for Production. See HANDOFF.md and STAGE_4_CLOSEOUT.md. The dated audit/correction and next-gate statements below are preserved historical evidence and are superseded by this notice. No production deployment is claimed.

## Architecture audit (before implementation)

- DocumentAnalyzerTab accepts TXT, PDF, HEIC/HEIF, images and audio. Audio is
  transcribed with Gemini and converted to PDF; image conversion exists in the
  upload flow. Uploads carry base64 file content in JSON through authenticated apiFetch.
- Both bulk and single analysis invoke /api/extract-text, then /api/analyze with
  extractedText. A legacy analyze fallback also performs OCR. Gemini receives
  binary PDF/image content with a configured two-model retry chain; Claude handles
  text analysis. Before this change OCR returned one string, with page numbering
  merely requested in the prompt, not structurally guaranteed.
- Analyzer progress, file content, reports and deep-scan reports use per-user
  localStorage. No server document persistence is connected to that legacy UI.
  Print/HTML/PDF-style reports, text briefs, template handoff and legacy timeline/
  RAG consumers depend on the existing AnalysisReport/content shape.
- Existing navigator_documents has stable ID, matter_id (retargeted from cases),
  display_name and timestamps. Versions already have ID, version number, filename,
  MIME, byte size, content hash and extraction status. No reviewed analysis_runs,
  persistent page text, chunks or evidence table exists in these artifacts.
- Existing server tests cover authentication, text decoding, mocked OCR, empty
  output and model/report behavior. They did not prove actual PDF page boundaries,
  quote containment or persistence. The lifecycle SQL has separate prior real-DB
  validation; that evidence does not apply automatically to this new migration.

## Implemented API and pipeline

- POST /api/matters/:matterId/documents accepts filename, mimeType, base64 and
  optional documentId (for a changed version of an existing document). Identity is
  always verified Firebase UID. Body account/owner/role fields are ignored.
- GET /api/matters/:matterId/document-versions/:versionId returns document, version,
  ordered pages and evidence in one authorized database operation.
- POST /api/matters/:matterId/document-versions/:versionId/pages/:pageId/evidence
  analyzes only one stored page. It inherits the paid-session gate and AI rate
  limiter. No case-wide analysis, legal issue mapping or contradiction engine is added.
- Source uploads retain the existing 30-million-base64-character bound and global
  payload/rate/CORS protections. pdf-lib 1.17.1 is the only new direct dependency,
  for structural PDF splitting. Each real PDF page becomes a one-page PDF before
  OCR; blank pages remain in position. Maximum 20 pages, 100,000 text characters
  per page. Encrypted/malformed PDFs fail closed. PNG/JPEG/WebP are single-page
  image sources; TXT is one logical source page, not invented printed pagination.
- /api/extract-text now returns pages plus contentHash; extractedText remains a
  compatibility field. The legacy UI stores sourcePages alongside content in its
  existing local workspace. Existing reports/exports remain LEGACY UNVERIFIED
  analysis: this change does not relabel their claims as canonical evidence.
  The persistent API is backend-only until matter/document selection UI is approved.

## Persistence and retry contract

The new pending artifact is create_navigator_page_evidence_foundation.sql. It
extends existing document/version metadata and adds navigator_document_pages,
navigator_extraction_runs and navigator_evidence_items. Page IDs are generated
once on successful extraction; the pending database guards reject updates/deletes
of completed versions and all existing pages, including cascade deletion. Source
changes require a new version. Document ownership cannot change once it has versions.
Evidence coordinates have composite foreign keys so document, version,
page, matter and run cannot be independently mismatched.

Checksums use SHA-256 over decoded original bytes and preserved UTF-8 page text.
An unchanged upload reuses a completed version and page IDs without OCR. Without
documentId, equal content in the same matter reuses the existing document; with
documentId, changed bytes allocate the next version. An active upload returns
409 rather than starting duplicate OCR. Failed uploads retry the same reserved
version. A processing lease older than ten minutes can be superseded; its old
run cannot later complete that version. This prevents stale writes, not duplicate
provider billing after a worker stalls. Original bytes are not stored, so failed
extraction requires re-upload. New version/hash uniqueness requires checking any
existing rows for duplicates before approval; the migration never silently deletes them.

Evidence reanalysis uses stored page text, never OCR, and appends a separately
identified run. Repeated evidence requests can create multiple runs; there is no
automatic deduplication/idempotency claim. Each result retains its extraction_run_id.
Runs track operation/provider/configured model/schema/status/times/failure category.
Evidence runs include input/output token counts. OCR run model metadata records
the configured fallback chain, not a claimed observed model revision. OCR token
usage and provider cost are not yet recorded. No hidden prompts or secrets are stored.

Runs now carry a constrained document ID: composite foreign keys enforce
run/version/document/matter consistency and the version's current-run pointer.
Run identity and terminal states are immutable. Processing has no completion/failure
metadata; completed requires a completion timestamp and no failure category; failed
requires both. Document-level status still reflects the latest version operation,
not an aggregate or guaranteed status of the highest-numbered version.

## Quotes, classifications and injection

The canonical classification/review enums are explicit in TypeScript and SQL.
AI review claims are reset to UNREVIEWED; unsupported or ambiguous quotes become
REQUIRES_SOURCE. AI FACT output is downgraded to UNVERIFIED_CLAIM. Allegations remain
allegations. Nothing in containment verifies that the underlying statement is true.
No human confirmation API is implemented in this milestone.

Quotes use exact containment first, then whitespace-only normalization. Original
page text and model quote are preserved. Offsets are zero-based Unicode code points,
end-exclusive, matching PostgreSQL character indexing after adding one to start.
Multiple matches are AMBIGUOUS with null offsets; absent/partly fabricated or
punctuation-changed quotes are unsupported. No fuzzy punctuation repair occurs.
Backend checks page identity, enums and quote containment; SQL additionally checks
stored offsets against the source for verified quotes, including explicit JSON
types, non-null bounds, uniqueness and canonical normalized boundaries. Direct
evidence INSERT/UPDATE also invokes quote validation. Unsupported quotes require
explicit null offsets and REQUIRES_SOURCE; verified quotes require nonempty text.

Comparison whitespace is exactly U+0009–000D, U+0020, U+00A0, U+1680,
U+2000–200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. Map these
25 characters to ASCII space, collapse runs, trim outer spaces. No Unicode folding
or punctuation changes occur. The TypeScript and SQL declarations use this same
set; offline tests compare all BMP code points against the declared SQL set.
Execution of the corrected SQL normalization remains an isolated-DB test gate.

OCR and evidence prompts identify documents as untrusted source material, prohibit
following embedded commands, exposing hidden prompts or performing actions, and
require neutral attributed schema output. Evidence calls have no tools or secret
values in input. Hostile-text tests prove deterministic application handling, not
that a live model can never produce a malicious or unsupported statement. Human
review remains required; normalized statements are model proposals, not findings.

## Transactional security

navigator_source_operation is VOLATILE SECURITY INVOKER, pins search_path, sets a
five-second lock timeout, revokes EXECUTE from PUBLIC/anon/authenticated and grants
only service_role (plus the function owner's inherent access). New tables enable
RLS with no public policies and revoke public/anon/authenticated access.

New table ACLs first revoke ALL from service_role as well, removing broader default
grants. Required access is SELECT/INSERT/UPDATE on runs/evidence and SELECT/INSERT
on pages; no DELETE/TRUNCATE/TRIGGER/REFERENCES grant is added. Trigger functions
have no direct service-role EXECUTE grant; the invoker helpers have explicit grants.
All functions pin search_path. Source guards have no caller-controlled bypass.
Evidence updates preserve provenance and may change only review_state; updated_at
is set by the guard. Unsupported evidence cannot shed REQUIRES_SOURCE without a
separately designed source-resolution workflow.

Every operation obtains the verified UID's account lock, invokes the existing
read_navigator_owned_matter authorization checks, then locks source rows and performs
the actual read/write in that same transaction. Upload allocation serializes on
account/matter to avoid duplicate versions. This conservative design trades
throughput for correctness; independent-page provider calls occur outside database
transactions and completion reauthorizes before publishing output. Revocation
during a provider call prevents persistence. If failure tracking is itself denied,
the run may remain processing; extraction retries recover expired leases, while
stale evidence-run maintenance remains an operational follow-up. No content is
retrieved later using a detached authorization grant.

RPC lock order is account → matter → client → OWNER membership → document →
version → run/page. Candidate discovery is not authorization: dedup locks and
revalidates the document's matter before locking its version, including before
cached returns. Other version operations use the same document-first order.
Privileged maintenance writers must follow this order too; deadlocks fail closed.

The SQL regression tests inspect declarations, required checks and lock ordering
without executing SQL. Service tests simulate denial at dedup/retrieval boundaries.
These do not prove trigger enforcement, FK rejection or concurrency on PostgreSQL.

No migration was executed. An unavailable pending RPC returns a safe 503. The
existing analyzer extraction endpoint remains usable without the pending schema.

Second-audit run-attribution correction: navigator_require_evidence_run is the
canonical database check used by both the evidence INSERT trigger and
complete_evidence. The caller locks the version first; the helper then locks the
run FOR UPDATE, preventing concurrent terminalization until transaction end.
It requires matching matter/document/version, operation=evidence, status=processing,
and a present UUID string at the existing usage_metadata.pageId matching page_id.
No second run-page field is introduced. Missing runs, malformed page identity,
wrong-page/wrong-operation runs and terminal runs fail before evidence persistence.
The active-run check is INSERT-only: post-completion review-state UPDATEs retain
their existing behavior, while provenance remains immutable. The helper is
SECURITY INVOKER with a pinned search_path and restricted EXECUTE privileges.

Migration ordering tests now assert both markers exist before comparing positions.
Offline reference cases cover accepted/rejected run combinations and review-only
updates alongside SQL declaration/wiring checks. They do not execute the trigger
or establish PostgreSQL race behavior. Re-audit and separately approved installation
remain required; no database access is part of this correction pass.

## Validation and next gate

Run-attribution correction verification: targeted tests passed 108/108 across
three files; the full suite passed 307/307 across nine files (19 added tests).
Standalone typecheck exited 0. Production build passed with the existing large-chunk
warning. Diff and correction-file whitespace checks passed. npm audit exited 1
with the unchanged 10 moderate and one high findings; no audit fix was run.
Only this document, pageMigration.test.ts and the pending migration changed in
this correction pass. No database was accessed and no migration was executed.
The corrected implementation is ready for another READ-ONLY pre-approval audit,
not installation. All changes remain uncommitted and unpublished.

Audit-correction verification: targeted page-source/document-source/SQL-contract
tests passed 89/89 across three files; the full suite passed 288/288 across nine
files (47 added over the initial page foundation). Final standalone typecheck
passed with exit 0. Production build passed with the existing large-chunk warning.
The final change after the build affects only pending SQL and a test assertion,
not bundled application code. npm audit exited 1 with 10 moderate and one high
advisory, unchanged; no audit fix was run. Diff and new-file whitespace checks
passed. All five audit corrections are implemented, ready for another READ-ONLY
pre-approval audit, not approved database execution. No database was connected to
or modified during these corrections. Nothing was committed, pushed or deployed.

Prior implementation verification (before audit corrections): the complete suite passed 241/241 tests across eight
files (46 more than the 195-test lifecycle baseline). The production build passed.
Standalone `npm run lint` (`tsc --noEmit`) passed with exit 0. An earlier overlapping
build/typecheck attempt reported disappearing generated dist assets; the standalone
typecheck after build completion resolved that verification issue without changing
tsconfig. `npm audit` reported 10 moderate and one high vulnerability; no audit fix
or unrelated dependency remediation was performed. The changes remain uncommitted
for review. New database behavior still requires the separately approved validation
below; passing mocked service tests does not establish database correctness.

Deterministic tests create real multi-page PDFs locally and verify one-page OCR
inputs/order, blank-page identity, limits, hashes, Unicode offsets, all requested
quote cases, enums and hostile fixtures. Service tests exercise real service code
with a doubled database transport: cached/retry behavior, failures, scoped RPC
arguments, denial and page-only reanalysis. These are not live-DB concurrency proof.

Before release, approve and validate the new SQL in the disposable project:
installation over reviewed schema; table constraints/grants; cross-account reads
and writes; composite citation mismatches; concurrent duplicate upload and version
allocation; stale-worker completion; rollback on page/evidence insert failure;
revocation while provider work runs; offset/whitespace parity; repeated evidence
runs; actual PostgREST result shapes. Retain the outstanding dedicated Firebase
and full authenticated HTTP lifecycle release gates. Do not replay production SQL.

Chunk persistence is intentionally absent: evidence calls reject pages over
30,000 characters until bounded page-preserving chunk support is implemented.
Source read responses currently return one version's pages/evidence; pagination,
retention/deletion controls, binary storage, queue execution and cost accounting
need review before large-volume production use.

The future ten-document benchmark can score source/version/page IDs, exact quote
verification, classifications and per-run outcomes. Human labels are still needed
for facts captured/missed, accuracy, names/dates and lawyer usefulness. Chronology
metrics wait for a later chronology implementation. Do not run that benchmark yet.

Recommended next milestone: isolated database/API validation of this source model,
then a matter-scoped source/evidence review UI. Do not expand case intelligence
until source attribution and human review workflows have passed that gate.
