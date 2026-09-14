# Stage 6 Milestone 1 — CYFSA Legal Intelligence & Authority Foundation

Base reviewed: `d0ce37774b4473aaac9c340c5bfba5442a01b33f` (`stage-4-page-evidence-foundation`).
Branch: `stage-6-legal-intelligence`, created from that commit directly. Stage 5 is neither
implemented nor modified by this milestone.

**Status: MILESTONE 1 ONLY — NOT STAGE 6 COMPLETE.** This document records what exists after
this pass. It is not a claim that legal mapping, provider integration, or a review workspace
is implemented.

**Pre-commit audit addendum:** this milestone underwent an adversarial pre-commit audit before
being frozen. The audit found and fixed one migration-breaking defect (a composite foreign key
referencing a unique constraint that did not yet exist on `navigator_evidence_items`), one
unreachable validation path (malformed case dates were never actually rejected), one silently
dropped contract field (`associatedEventOrPersonId`), and a missing evidence-review/mapping-review
distinction. See §10a below for the full list. Everything in the rest of this document already
reflects the corrected implementation.

## 1. Existing legal-reference architecture discovered (audit)

The repository already contains `legal-reference/` — verbatim official statute text (CYFSA,
Bill C-92, Mental Health Act) used historically for citation-accuracy checks in the parent-facing
content. This is source *text*, not a database schema: there was no `legal_sources`,
`legal_source_versions`, `legal_provisions`, `statute_provisions`, or `legal_issue_mappings`
table, type, or service anywhere in `api/`, `src/types.ts`, or `supabase/migrations_pending_approval/`
before this change (confirmed by full-repository search). No existing correct model was
duplicated; this is a new, minimal model.

## 2. Legal-source model

Three curated tables (`api/services/legalAuthority.ts` types; SQL below):

- `navigator_legal_sources` — jurisdiction (`ON`/`CA`), title, `source_type`
  (`STATUTE`/`REGULATION`/`COURT_RULE`/`CASE_LAW`/`CHARTER`), citation, official publisher,
  authoritative `https://` URL, verification state, retrieval timestamp.
- `navigator_legal_source_versions` — one row per point-in-time version of a source:
  `effective_from`/`effective_to` (half-open range, `effective_to = null` means open-ended),
  status (`NOT_YET_IN_FORCE`/`IN_FORCE`/`REPEALED`/`SUPERSEDED`), verification state,
  `supersedes_version_id` for explicit lineage.
- `navigator_legal_provisions` — one row per citable provision (e.g. `s. 74(2)`) scoped to a
  source, independent of any specific version, with its own verification state.

The initial seed target is the CYFSA (`legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt`);
no seed data is inserted by this milestone — only the schema and the deterministic logic that
would validate and resolve it. The model is source-type-generic, so CYFSA regulations, Family
Law Rules, the Courts of Justice Act, Charter provisions, and later selected case law fit the
same three tables without redesign. No corpus ingestion pipeline exists; this stays a curated,
manually-populated authority set by design ("do not ingest an uncontrolled legal corpus").

## 3. Temporal version model and deterministic resolver

`resolveApplicableVersion(versions, caseDate)` in `api/services/legalAuthority.ts` answers
"what version of this authority was potentially applicable on the relevant case date" without
ever guessing. It:

1. Validates every version's shape (`validateLegalSourceVersion`) before comparing dates.
2. Refuses to resolve if any two verified versions of the same source overlap, or an
   open-ended version precedes a later one — returns `OVERLAPPING_VERSIONS` instead of picking one.
3. Treats ranges as half-open `[effective_from, effective_to)`, so a date on a shared boundary
   belongs to the version that begins there — deterministic, not ambiguous.
4. Only matches `VERIFIED` versions; if none exist, returns `NO_VERIFIED_VERSION`.
5. Returns one of: `RESOLVED`, `RESOLVED_OPEN_ENDED`, `RESOLVED_APPROXIMATE` (approximate dates
   resolve but carry an explicit warning), `UNKNOWN_DATE`, `BEFORE_EARLIEST_VERSION`,
   `AFTER_LAST_CLOSED_VERSION`, `GAP_IN_COVERAGE`, `OVERLAPPING_VERSIONS`, or
   `MULTIPLE_APPLICABLE_VERSIONS` — every ambiguous case is a distinct, explicit outcome, never
   a silently-picked default.

The pending migration additionally enforces non-overlap at the database layer with a
`btree_gist` exclusion constraint over `daterange(effective_from, effective_to, '[)')` per
`legal_source_id`, so the invariant holds even for direct/manual writes, not only through the
application path.

## 4. Legal authority ≠ legal conclusion (safety model)

`assertSafeLegalLanguage()` rejects conclusion language ("violated", "broke the law",
"unlawful", "proves misconduct", "is guilty", "committed an offence", "court erred",
"negligent", "liable", "in breach of", "failed to comply with", "acted contrary to") in any
`reasonForRelevance` text before a mapping can be built. The pending migration repeats a
narrower version of this pattern as a `check` constraint on `reason_for_relevance` only — a
fail-closed backstop, not the primary enforcement, since natural-language matching is
inherently partial and a paraphrased conclusion without these literal words will still pass
(documented as a residual limitation in §9, not something regex can fully close). Permitted
framing ("potentially relevant provision", "may engage", "authority identified for legal
review", "further factual/legal review required") is exercised directly in tests.

Critically, this screening is scoped to *generated reasoning only* — it is never applied to
`legalSource.title`, provision citations, or quoted authority/source text, all of which may
legitimately use these words (a judgment can say a party "was found negligent"; that is
authoritative text, not this system's conclusion). A test confirms `validateLegalSource`
accepts a title containing such language untouched, and the SQL check constraint is attached
only to the `reason_for_relevance` column, never to `navigator_legal_sources.title` or
`navigator_legal_provisions.label`. This mirrors the existing Stage 4 evidence-language guard
in `pageSources.ts` (`validateEvidence`'s neutral-attribution check) rather than inventing a
second convention.

## 5. Legal mapping contract (Stage 5 integration boundary)

`buildLegalMapping(input, versions)` assembles a `LegalMappingResult` from already-produced
inputs — it never calls a model and never touches a database. Inputs: matter id, one
evidence-item id (the *only* Stage 4 dependency, via `navigator_evidence_items.id`), evidence
classification, the evidence's own `evidenceReviewState` (see §6), a `LegalSource`, a
`LegalProvision`, a case date, a potential issue, safe reasoning text, and an optional
`associatedEventOrPersonId`. Output: citation, resolved source/version/provision ids, the
associated event/person id (passed through, not dropped), the full `ResolutionResult` (outcome
+ warnings), a review status, and a `confidence` field that this milestone leaves `null` (no
provider score exists yet — Stage 6 M1 assembles structure, not scoring; its semantics are
documented narrowly in code as authority-match/relevance confidence, never a probability that a
violation occurred or that a party would prevail). This is deliberately independent of any
speculative Stage 5 table: a future chronology/contradiction engine can supply
`evidenceItemId`/`potentialIssue`/`associatedEventOrPersonId` once it exists, but nothing here
assumes its shape — every id is an opaque string, never a typed reference into an unbuilt table.

## 6. Reviewed vs. unreviewed evidence, and human review model

Two independent review axes exist and must never be conflated: whether the *evidence itself*
has been human-reviewed (Stage 4's `EvidenceReviewState`: `UNREVIEWED`/`REVIEWED`/`CONFIRMED`/
`DISPUTED`/`REQUIRES_SOURCE`/`NOT_RELEVANT`), and whether *this legal mapping* has been
human-reviewed (`ReviewState` below). `buildLegalMapping` requires `evidenceReviewState` as an
explicit input; when it is not `REVIEWED`/`CONFIRMED`, the mapping carries a warning saying so
— but this never changes `reviewStatus` itself. A mapping can be `UNREVIEWED` over
already-human-confirmed evidence, or (separately) built over evidence nobody has looked at yet;
the two facts stay visible and distinct in the result, so a downstream consumer reading only
`reviewStatus` cannot mistake "evidence exists" for "a human confirmed this authority applies."

Review states (`REVIEW_STATES`): `UNREVIEWED`, `CONFIRMED_RELEVANT`, `POSSIBLY_RELEVANT`,
`NOT_RELEVANT`, `REQUIRES_RESEARCH`, `SUPERSEDED` — reusing the Stage 4 evidence review-state
naming convention rather than inventing a parallel vocabulary. `buildLegalMapping` marks a
mapping `REQUIRES_RESEARCH` automatically whenever temporal resolution is ambiguous or the
source/provision is not yet `VERIFIED`; it never marks anything `CONFIRMED_RELEVANT` itself.
`applyHumanReview(current, next)` is the only path to `CONFIRMED_RELEVANT`, and requires the
mapping to currently be `UNREVIEWED`, `POSSIBLY_RELEVANT`, or `REQUIRES_RESEARCH` — an
AI-generated mapping cannot self-promote to a human-confirmed one. The pending migration's
`navigator_legal_mapping_touch` trigger keeps `reviewed_by`/`reviewed_at` consistent with
`review_status` and freezes every provenance column (matter, evidence, source, version,
provision, **potential issue**, reasoning, temporal outcome) after creation — the audit found
the first draft of this trigger froze `reason_for_relevance` but left `potential_issue`
silently editable, which would have let a later update quietly rewrite what the mapping was
originally about; both are now frozen identically. A reviewer disputing the framing changes
`review_status` (e.g. to `NOT_RELEVANT`), never the substance of what was identified.

## 7. Provenance model

`navigator_legal_mappings` carries composite foreign keys — `(provision_id, legal_source_id)`,
`(legal_source_version_id, legal_source_id)`, `(evidence_item_id, matter_id)` — so a mapping's
provision/version cannot silently belong to a different source, and its evidence cannot belong
to a different matter than the mapping claims. Combined with the existing Stage 4 chain
(evidence → page → document version → document), the full provenance path is: legal authority
→ potential issue → reviewed evidence → page → document/version. Nothing existing in Stage 4's
provenance model is altered; this migration adds new tables, one new outbound FK from a new
table to the existing `navigator_evidence_items(id, matter_id)` composite identity, and — found
necessary during audit — one new additive unique constraint on `navigator_evidence_items(id,
matter_id)` itself, since no such constraint existed yet and the composite FK cannot be created
without it. `evidence_item_id` intentionally has no `ON DELETE CASCADE` (the audit's original
draft did): a mapping must block deletion of evidence it references, not silently disappear
when that evidence is deleted, to preserve the audit trail.

## 8. Safety model — source text as data

Legal source/provision text, retrieved web pages, and any future case-law text are treated as
data, never instructions, consistent with the existing Stage 4 `SOURCE_SYSTEM` prompt-injection
boundary in `pageSources.ts`. No live model call is made anywhere in this milestone — every
function in `legalAuthority.ts` is a pure, synchronous validator or assembler over
already-produced structured input.

## 9. Limitations

- No seed data: the CYFSA (or any source) has zero rows in `navigator_legal_sources` after this
  migration. Populating verified sources/versions/provisions is a separate task requiring
  citation-by-citation verification against `legal-reference/`, not automated ingestion.
- No provider integration exists yet (no Claude/Gemini call proposes a mapping); `confidence`
  is always `null` in this milestone's output.
- No API routes or UI expose this model; it is service-layer logic and pending schema only.
- The migration is **pending, unexecuted, uncommitted-to-any-database**. It has not been
  installed on the disposable validation project or any other project.
- Case-law ingestion, Family Law Rules, and Courts of Justice Act rows are out of scope for
  this milestone; only the schema's extensibility to them has been verified, not populated.
- Conclusion-language screening is a regex backstop, not NLP: a paraphrased conclusion that
  avoids the listed literal phrases (e.g. "the agency's handling fell short of what the statute
  required") will still pass `assertSafeLegalLanguage()` and the SQL check. Mandatory human
  review before any mapping is confirmed relevant remains the actual safety boundary, not the
  regex.
- Provisions are identified independently of any specific source version (one `citation` per
  `legal_source_id`, e.g. one row for "s. 74(2)" regardless of how many versions of the CYFSA
  exist). This keeps a stable citation identity across amendments, matching how lawyers cite
  sections, but nothing currently records *which* versions a given provision citation actually
  existed in or with what text — a provision row could in principle be cited against a version
  where that section was numbered or worded differently. Milestone 1 does not solve this: it is
  flagged for Milestone 2 (see §12), not redesigned now, since doing so without seed data to
  validate against would be speculative.
- `btree_gist` is targeted at Supabase's standard `extensions` schema; the migration comment
  requires a pre-flight check (`show search_path;`) confirming that schema is reachable before
  execution on any target project, since this was not and cannot be verified by connecting to a
  live database during this audit.

## 10. Tests

`api/services/legalAuthority.test.ts` — 72 tests covering: source/version/provision validation
(well-formed and malformed citations/dates/URLs/enums, and non-UUID ids for every id field);
temporal resolution for exact date, date inside a range, before the first version, after a
closed version, an open-ended version, adjacent versions (boundary ownership on both sides),
overlapping versions (including order-independent detection and open-ended-then-another-version
overlap), an unknown date, a malformed/invalid date (both exact and approximate), an approximate
date including one crossing an amendment boundary, a gap between versions, no verified version,
an empty version list, mixed-source input rejection, and one stable provision citation
resolving correctly against two different source versions; safe vs. conclusion legal language,
including the added breach/compliance/contrary-to phrasings, a false-positive check that
authoritative source titles are never screened, and a check that an incidental neutral use of
"breach" alone is not flagged; the mapping contract (resolved, ambiguous, unverified-source,
mismatched-provision, missing-field, non-UUID-id, associated-event-id pass-through and
rejection, evidence-review-state warning behavior, and never-self-scoring cases); and the
human-review state machine (allowed and rejected transitions, including a `SUPERSEDED` mapping
never self-promoting to confirmed). Stage 4 tests (`pageSources.test.ts`, `pageMigration.test.ts`)
are untouched and still pass.

## 11. Verification run

1. Targeted Stage 6 tests: **72/72 passed** (`api/services/legalAuthority.test.ts`).
2. Stage 4 regression: **96/96 passed** (`pageSources.test.ts` + `pageMigration.test.ts`).
3. Full suite: **379/379 passed** across 10 files (307 baseline + 72 new).
4. Standalone typecheck (`tsc --noEmit --pretty false`): exit 0.
5. Production build (`npm run build`): exit 0, existing large-chunk warning unchanged.
6. `git diff --check`: exit 0 (no whitespace errors).
7. `npm audit`: exit 0 command run, 11 vulnerabilities reported (10 moderate, 1 high) —
   unchanged from the Stage 4 closeout baseline. No `npm audit fix` was run.

No database was accessed. No migration was executed. Nothing was committed or pushed.

## 12. Next Stage 6 task

**Stage 6 Milestone 2 (not started):** populate a verified seed set of `navigator_legal_sources`
/ `navigator_legal_source_versions` / `navigator_legal_provisions` rows for the CYFSA from
`legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt` (citation-by-citation, matching
the corrected section numbers already documented in `legal-reference/README.md`), then design
the read-side query contract that a future evidence-review workspace would call to list
potentially relevant authority for a given piece of reviewed evidence. Do not begin Milestone 2
automatically; it requires separate scoped authorization, and any database seeding requires the
same pending-migration/no-execution discipline as this milestone.
