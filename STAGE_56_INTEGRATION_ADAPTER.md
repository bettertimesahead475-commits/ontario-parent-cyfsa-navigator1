# Stage 5 ↔ Stage 6 Integration Adapter

Bridges Stage 5's reviewed-evidence model to Stage 6's legal-mapping input contract, in
`api/services/stage56Adapter.ts`. Deterministic, provider-independent, no database access, no
AI calls, no new persistence, no new routes, no new UI, no new migration.

## Ownership (unchanged by this adapter)

**Stage 5 owns:** evidence classification, evidence review state, exact quote, quote
verification, page/document/version/run provenance, evidence item identity, matter identity.
**Stage 6 owns:** legal source/provision selection, temporal resolution (`resolveApplicableVersion`),
legal review state (`ReviewState`), `navigator_legal_mappings`.

The adapter cannot violate this boundary by construction, not just convention: its output type,
`LegalMappingInputBase`, is `Omit<LegalMappingInput, "legalSource" | "provision">` — the two
fields a caller would need to select a legal authority are typed out of existence here. A caller
must merge this adapter's output with an already-selected `LegalSource`/`LegalProvision` before
calling Stage 6's own `buildLegalMapping`; that merge, and the authority selection it requires,
happens entirely outside this file.

## Adapter responsibilities

- `toStage5EvidenceReference(row: EvidenceRow)` — validates and passes through a Stage 5
  evidence row's identity, classification, review state, and provenance fields unchanged. Every
  field is a direct copy of an already-persisted value; nothing is derived or fabricated. A
  malformed or incomplete row is rejected, never patched.
- `translateCaseDate(input)` — converts an explicit, structured Stage 5-supplied date into
  Stage 6's `CaseDate`. Missing or unrecognized input becomes `{ kind: "UNKNOWN" }`, which
  `resolveApplicableVersion` already resolves to `UNKNOWN_DATE`/`REQUIRES_RESEARCH` — never a
  silent fallback to today's date, an upload timestamp, or "current law." Stage 5 M1 has no
  structured event-date model yet, so in practice this function receives either an explicit
  caller-supplied date or nothing; it never parses free text.
- `buildLegalMappingInputBase(request)` — assembles everything a Stage 6 mapping needs except
  legal authority selection: `matterId`, `evidenceItemId`, `evidenceClassification`,
  `evidenceReviewState`, translated `caseDate`, `potentialIssue`, `reasonForRelevance`, and
  `associatedEventOrPersonId` (null unless a real id is supplied — never synthesized, since
  Stage 5 M2's structured events/entities don't exist yet). It calls Stage 6's own
  `assertSafeLegalLanguage` on `reasonForRelevance` rather than re-implementing that check, so a
  synthetic legal conclusion is rejected the same way it would be inside Stage 6 itself.

## Review-state separation

Stage 5's `EVIDENCE_REVIEW_STATES` (`UNREVIEWED`/`REVIEWED`/`CONFIRMED`/`DISPUTED`/
`REQUIRES_SOURCE`/`NOT_RELEVANT`) and Stage 6's `ReviewState`
(`UNREVIEWED`/`CONFIRMED_RELEVANT`/`POSSIBLY_RELEVANT`/`NOT_RELEVANT`/`REQUIRES_RESEARCH`/
`SUPERSEDED`) are different domains with only coincidentally-overlapping members. The adapter
passes Stage 5's `evidenceReviewState` through as plain evidence metadata on the output object;
no function in this file reads it to set, infer, or default a Stage 6 legal review state. Legal
review state is set only by Stage 6's own `buildLegalMapping` (automatically, to `UNREVIEWED` or
`REQUIRES_RESEARCH` depending on authority/temporal resolution) and by `applyHumanReview`
(exclusively human-driven) — both untouched by this adapter, and in fact unreachable from it,
since it never has a `legalSource`/`provision` to call `buildLegalMapping` with.

## Provenance and quote-safety translation

`toStage5EvidenceReference` preserves `quoteVerification` exactly, including `AMBIGUOUS` and
`ABSENT` — it never presents an unsupported quote as verified, and never fabricates an offset
when Stage 4/5 recorded `null`. Document/version/page/run ids pass through as the same UUIDs
Stage 4 assigned; there is no id remapping or resynthesis anywhere in this file.

## Null/unknown behavior

- No usable case date → `{ kind: "UNKNOWN" }`, never a fallback date.
- No real associated event or person → `null`, never a synthetic id.
- No legal source/provision → not applicable; this adapter's output type has no such fields to
  leave null in the first place.

## Explicit non-responsibilities

This adapter does not: select or propose a legal source/provision/version; generate
`potentialIssue` or `reasonForRelevance` text (both are required caller inputs, validated but
not authored here); implement Stage 5 M2 (chronology, contradictions, corroboration, claim
evolution, evidence gaps, unanswered questions); implement Stage 6 M2 (corpus ingestion,
provision-version storage, amendment lineage, source monitoring); call any external AI provider;
persist anything to any table, existing or new; expose any HTTP route or UI.
