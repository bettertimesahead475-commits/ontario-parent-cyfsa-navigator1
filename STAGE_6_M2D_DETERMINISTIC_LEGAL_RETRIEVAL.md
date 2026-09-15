# Stage 6 Milestone 2-D — Deterministic Legal Authority Retrieval

Base: `stage-6-m2c-corpus-validation` @ `d5f20399cb1b94513a106dcdd565684a232b8d40`.

**Status: RETRIEVAL LAYER ONLY.** No schema change was needed — the M2-A schema already
supported this milestone exactly as designed. No legal selection, no AI call, no RAG, no
persistence write, no route, no UI.

## 1. Retrieval vs. selection — the boundary this milestone enforces

`api/services/legalCorpusRetrieval.ts` answers exactly one question: *given a legal source id, a
normalized provision citation, and a case date, which VERIFIED provision-version applies?* It
never answers *which provision might apply to a fact pattern* — that remains entirely the
concern of `api/services/legalAuthority.ts`'s mapping/review boundary (`buildLegalMapping`,
`applyHumanReview`), untouched by this milestone. Every input here must already carry a
deterministic identity; there is no code path anywhere in this file that accepts free text and
guesses a citation from it.

## 2. Retrieval contract

`ProvisionRetrievalInput`: `legalSourceId`, `citation` (raw or pre-normalized), `caseDate`
(reusing `legalAuthority.ts`'s own `CaseDate` type directly — `EXACT`/`APPROXIMATE`/`UNKNOWN` —
rather than defining a fourth date shape), and optional `matterId`/`evidenceItemId` carried
through purely as provenance, never required for or used by the lookup itself.

`RetrievalOutcome`: `RESOLVED`, `RESOLVED_OPEN_ENDED`, `UNKNOWN_DATE`, `INVALID_CASE_DATE`,
`PROVISION_NOT_FOUND`, `NO_MATCH`, `BEFORE_EARLIEST_VERSION`, `AFTER_LAST_CLOSED_VERSION`,
`GAP_IN_COVERAGE`, `MULTIPLE_MATCHES`, `UNVERIFIED_ONLY`, `OVERLAPPING_VERSIONS`,
`INTEGRITY_FAILURE` — deliberately mirroring `legalAuthority.ts`'s existing
`resolveApplicableVersion` outcome vocabulary at the source-version level, extended with the two
outcomes unique to provision-version retrieval (`UNVERIFIED_ONLY`, `INTEGRITY_FAILURE`). Every
result also carries a `requiresResearch: boolean`, true for every outcome except `RESOLVED`/
`RESOLVED_OPEN_ENDED` — a downstream consumer that only checks this one flag can never mistake
an ambiguous or failed result for a trusted one.

## 3. VERIFIED-only default

`resolveProvisionVersion` filters to `verificationStatus === "VERIFIED"` before any date
comparison. If a provision has only `UNVERIFIED`/`COMMITTED_INSPECTION`/`REJECTED` versions, the
outcome is `UNVERIFIED_ONLY` — never a silent fallback to unverified text. There is no separate
"inspection mode" parameter or flag on this function that could be confused with normal
retrieval; a caller wanting to see non-VERIFIED candidates for review tooling would need to call
a distinctly-named function (not built in this milestone, since no concrete need for it was
identified) rather than pass a flag that risks being left on accidentally.

## 4. Temporal resolution

Unchanged semantics from `legalAuthority.ts`: half-open `[effective_from, effective_to)`,
`effective_to = null` meaning open-ended. All six required boundary cases are tested exactly:
immediately before `effective_from` (no match), exactly `effective_from` (matches, inclusive),
immediately before `effective_to` (matches), exactly `effective_to` (no match, exclusive),
open-ended version (matches any date at or after its start), and historical/current version
selection across a real multi-version timeline.

## 5. UNKNOWN date safety

`resolveProvisionVersion(versions, caseDate)`'s only date input is the `caseDate` parameter
itself — the function has no access to `Date.now()`, a retrieval timestamp, or an upload
timestamp, so it cannot substitute one even by accident (verified by asserting the function's
arity is exactly 2). `caseDate.kind === "UNKNOWN"` always returns `UNKNOWN_DATE`; a malformed
`EXACT`/`APPROXIMATE` date string returns `INVALID_CASE_DATE` rather than being silently
compared as a garbage string.

## 6. Citation normalization

`normalizeProvisionCitation` normalizes only the leading section label (`74`/`s. 74`/`section
74` → `s.74`, reusing `legalCorpusIngestion.ts`'s own `normalizeSectionLabel` rather than a
second implementation) and then requires every subsequent `(subsection)(paragraph)(clause)`
group to already be well-formed, appending each verbatim. `s.74`, `s.74(2)`, `s.74(2)(a)`, and
`s.74(2)(a)(i)` are confirmed as four distinct string identities. A citation with no recognizable
section number, or an unterminated nested group, is rejected outright — never guessed or
repaired.

## 7. Ambiguity and multiple-match behavior

Two distinct failure modes are kept separate: `OVERLAPPING_VERSIONS` (a data-integrity problem —
two versions of the same provision have genuinely overlapping effective ranges, detected via the
same proven sorted-adjacent-pair algorithm `legalAuthority.ts` uses) is checked *before* any date
comparison, over all versions regardless of verification state. `MULTIPLE_MATCHES` (more than one
VERIFIED version matches a specific date) is checked after; given the overlap check already runs
first, this outcome is defensive — mathematically it should be unreachable if overlap detection
is doing its job — but it is retained anyway, exactly mirroring `legalAuthority.ts`'s own
documented stance on this same redundancy at the source-version level. In neither case is a
version arbitrarily chosen.

## 8. Source trust

This module does not implement its own source-trust classification — it consumes whatever
`legalSourceId` the caller has already resolved via `legalCorpusIngestion.ts`'s
`classifyRetrievalHostname` (retrieval-time) or `legalCorpus.ts`'s `classifySourceTrust`
(publisher-string time). `legalSourceId` passes straight through on the resolved record; nothing
in this file re-derives, overrides, or weakens that classification.

## 9. Integrity validation

Every version passed to `resolveProvisionVersion` is checked with `legalCorpus.ts`'s own
`validateProvisionVersionCandidate` (recomputing `normalizedText`/`textSha256` from `exactText`
and requiring an exact match) before any other logic runs. If a `VERIFIED` record fails this
check, the result is `INTEGRITY_FAILURE` immediately — a corrupted verified record is never
trusted, never silently repaired, and never treated as if it simply didn't exist. A corrupted
*non-VERIFIED* record does not block resolution of an otherwise-valid VERIFIED one elsewhere in
the set (it's simply excluded from date matching, same as any other non-VERIFIED record).

## 10. Provenance output

A resolved `ProvisionVersionCandidate` carries `id`, `provisionId`, `legalSourceId`,
`legalSourceVersionId`, `exactText`, `normalizedText`, `textSha256`, `effectiveFrom`,
`effectiveTo`, `verificationStatus`, `verifiedBy`, `verifiedAt` — everything a downstream lawyer
review surface needs, and nothing beyond it (no internal security metadata, no raw database row).

## 11. Deterministic ordering

`resolveProvisionVersion` always sorts its input by `(effectiveFrom, id)` before any comparison —
a test confirms the forward, shuffled, and fully-reversed orderings of the same three-version
set all produce an identical resolved result. The repository-orchestration layer
(`retrieveLegalAuthority`) inherits this guarantee automatically, since it delegates to the same
pure function; a second test confirms this holds through that layer too.

## 12. Amendment lineage

`resolveProvisionVersion` has no lineage-table access and no lineage parameter at all (its
signature is `(versions, caseDate)`) — it is structurally incapable of following a
renumbering/split/merge/repeal/reenactment relationship. If a requested citation genuinely no
longer resolves to any version (because it was renumbered, say), the result is
`PROVISION_NOT_FOUND` or `NO_MATCH`, never a heuristic hop to a different provision's versions.
Full amendment-aware lookup (following `navigator_legal_provision_lineage` to suggest "this
citation is now called X") is explicitly deferred to a future milestone (M2-E scope).

## 13. Stage 5 ↔ 6 compatibility

`ProvisionRetrievalInput.caseDate` is typed as `legalAuthority.ts`'s own `CaseDate` — no
adaptation layer is needed beyond what `stage56Adapter.ts` already produces. Neither this file's
input nor its output has any field for evidence classification or evidence review state; a test
confirms `resolveProvisionVersion`'s result object has no `classification`, `evidenceReviewState`,
or `reviewStatus` field a caller could mistake for something this module set. No blocking defect
was found in the existing adapter or `legalAuthority.ts`, and neither was modified.

## 14. Legal-language safety

This module produces only structured outcome enums and passthrough legal text — it authors no
natural-language sentences of its own. A test confirms none of the fixed warning strings this
file emits contain conclusion language ("violated," "illegal," "Charter breach," etc.).

## 15. Repository abstraction

`LegalCorpusRepository` is a two-method, read-only interface (`findProvisionByCitation`,
`findProvisionVersions`). No concrete Supabase implementation is included in this milestone —
this is intentionally the seam a future server-side adapter would implement, following the exact
same server-derived-identity pattern (`verifyFirebaseToken`, never a client-supplied UID) already
used throughout `api/evidenceReviewRoutes.ts` and the Stage 6 M1/M2-A service layer. The pure
resolver (`resolveProvisionVersion`) requires no repository at all and is fully testable in
memory; `retrieveLegalAuthority` is the only function that touches one, and it does nothing but
normalize input, call the two repository methods, and delegate to the pure resolver.

## 16. Real CYFSA fixture compatibility

The M2-C real excerpt (`api/services/__fixtures__/cyfsa-s74-real-excerpt.txt`) is reused, not
duplicated: citations parsed from it (`s.74(2)(a)`, `s.74(2)(b)`, `s.74(2)(c)`) are confirmed to
round-trip correctly through `normalizeProvisionCitation`, and a `ProvisionVersionCandidate`
built from the real paragraph-(a) text is confirmed to resolve correctly through
`resolveProvisionVersion`.

## 17. Unresolved items carried forward

- No concrete `LegalCorpusRepository` implementation exists yet (Supabase-backed or otherwise) —
  this milestone deliberately stops at the interface.
- The `MULTIPLE_MATCHES` outcome remains defensive/unreachable under correct data, mirroring
  `legalAuthority.ts`'s own acknowledged stance on the equivalent case.
- Amendment-lineage-aware retrieval ("this citation was renumbered to X, would you like that
  instead?") is out of scope here, deferred to M2-E.
- The DNS-rebinding/connection-pinning limitation documented in M2-C is unrelated to and
  unaffected by this milestone (this module never performs network retrieval itself).
