# Stage 6 Milestone 2-E — Amendment & Source-Change Monitoring Foundation

Base: `stage-6-m2d-deterministic-retrieval` @ `f91fdcec7dac35d019da3b834e444e8c719b72d9`.

**Status: MONITORING MODEL ONLY.** No schema change was needed. No cron, no scheduler, no
production updater, no AI interpretation, no automatic `VERIFIED` promotion. This is the
deterministic decision function a future scheduled job would call — the scheduling itself is
explicitly out of scope.

## 1. The core safety rule this milestone enforces

**Source page changed ≠ law changed.** `api/services/legalCorpusMonitoring.ts`'s
`observeSourceChange` never asserts that a detected difference is a legal amendment,
renumbering, split, merge, repeal, or reenactment — those are verified-lineage facts a human
establishes (via `navigator_legal_provision_lineage`, unchanged and untouched by this
milestone), never inferred here from text similarity, checksum difference, or timing. A test
confirms none of those six lineage-relationship terms ever appear anywhere in an observation's
output.

## 2. Monitoring input contract

`MonitoringInput`: `legalSourceId`, `expectedSourceUrl`, `priorSnapshot` (identity + checksum
only, or `null` on a first run), `retrieval` (a discriminated union: `SUCCESS` with a real
`SourceSnapshotCandidate`, or `FAILED` with a bounded error message/URL/timestamp — retrieval
itself already happened before this function is ever called; no network access occurs here),
`parserVersion`, `priorParserVersion`, `priorProvisions` (citation + hash + parser-version
records), `newParseResult` (the real `ParseResult` from `legalCorpusIngestion.ts`, or `null` when
retrieval failed), and an optional `priorParseStatus` for detecting a structural regression.

## 3. Monitoring outcome contract

`SourceMonitoringOutcome`: `UNCHANGED`, `SOURCE_CHANGED`, `PARSER_CHANGED`, `STRUCTURE_CHANGED`,
`PROVISION_CHANGES_DETECTED`, `REQUIRES_INSPECTION`, `RETRIEVAL_FAILED`,
`SOURCE_IDENTITY_MISMATCH`, `INTEGRITY_FAILURE` — using the task's own suggested vocabulary
directly. Every observation also carries `requiresInspection: boolean`, true for every outcome
except `UNCHANGED`.

**Priority ordering, deliberately chosen for maximum usefulness to a reviewer:** when
provision-level history is available and a diff can be computed, the more specific
`PROVISION_CHANGES_DETECTED` (with a `provisionChanges` array naming exactly which citations
changed and how) always takes priority over the generic `SOURCE_CHANGED`/`PARSER_CHANGED` —
telling a reviewer "here specifically is what changed" is strictly more useful than "something
changed." The generic top-level outcomes remain reachable and tested for the case where no
provision-level baseline exists yet (e.g., a source's very first monitoring run, where only
raw-byte tracking has started).

## 4. Snapshot comparison

Reuses `legalCorpusIngestion.ts`'s own `classifySnapshotChange` directly — no second checksum
comparison implementation. Identical raw bytes → `UNCHANGED` contribution; different bytes →
`SOURCE_CHANGED` contribution, always paired with an explicit warning stating this does not by
itself mean the law changed (formatting/template/accessibility-markup/unrelated-correction are
all named as equally plausible causes) and never with a claim that it does.

## 5. Parser version comparison

A parser-version change with unchanged raw bytes is reported as `PARSER_CHANGED` — explicitly
warned as something that "must never be treated as a legal amendment." When provision-level
history exists, `legalCorpusIngestion.ts`'s own `classifyProvisionCandidateChange` (already
distinguishing text-hash-same-but-parser-different) surfaces this at the per-provision level too,
which is why a parser-only change with provision history available correctly escalates to the
more specific `PROVISION_CHANGES_DETECTED` rather than the generic top-level flag (see §3).

## 6. Provision-level comparison

Provisions are diffed by citation key (never by array position — order never matters), reusing
`legalCorpusIngestion.ts`'s existing `classifyProvisionCandidateChange` for citations present in
both the prior and new sets. Citations present only in the prior set are `PROVISION_REMOVED`;
citations present only in the new set are `PROVISION_ADDED`. Neither of these is paired into a
suggested lineage relationship (e.g., "removed X, added Y, therefore X was renumbered to Y") —
they are reported as two independent facts, exactly matching the instruction that a candidate
lineage relationship (if ever proposed) must remain clearly separate from these raw
add/remove/change observations, and this milestone does not implement lineage-candidate proposal
at all, since no genuine need for it was identified yet.

## 7. Effective dates

This module has no effective-date field, parameter, or output anywhere — it cannot infer,
substitute, or leak one, structurally, not just by convention. A detected change of any kind
carries no date claim; that determination remains entirely a human/M2-A `verified_at`-gated
decision, made later, outside this file.

## 8. Verification boundary

No function in this file can set `verificationStatus`, `verifiedBy`, or `verifiedAt` — there is
no such parameter anywhere in `observeSourceChange`'s signature or return type. A test confirms
the string `"VERIFIED"` never appears in any observation's serialized output, across every tested
scenario including a hostile-text injection attempt.

## 9. Immutability

`observeSourceChange` is a pure function: it reads its inputs and returns a new object, mutating
nothing. Tests confirm the prior snapshot and prior-provisions inputs are byte-for-byte identical
before and after a call. Nothing in this milestone writes to `navigator_legal_source_snapshots`
or `navigator_legal_provision_versions` — this is an observation/decision layer only.

## 10. Determinism and idempotency

No `Date.now()`, no random ID generation, no I/O anywhere in `observeSourceChange` (confirmed by
its arity — exactly one parameter, the input object, with no hidden environmental dependency).
Identical input always produces an identical (deep-equal) result. `provisionChanges` is always
sorted by citation string, so parser output order, repository row order, or `priorProvisions`
array order never affect the result — tests confirm this with reversed and duplicated input
orderings.

## 11. Retrieval failure

A failed retrieval (`retrieval.status === "FAILED"`) is reported as exactly that —
`RETRIEVAL_FAILED`, carrying the bounded error message, requested URL, and attempt timestamp —
and nothing else. It is never interpreted as "the source was removed," "the provision was
repealed," or any other conclusion; the prior snapshot's checksum is reported unchanged
(conceptually preserved, since this function performs no writes at all), and no provision-level
comparison is attempted (there is no new text to compare against).

## 12. Source identity

A returned snapshot whose `legalSourceId` or `sourceUrl` doesn't match what this monitoring run
was configured to check is rejected as `SOURCE_IDENTITY_MISMATCH` before any comparison logic
runs — there is no cross-source diffing path in this file at all.

## 13. Integrity

Every successfully-retrieved snapshot is re-validated through `legalCorpus.ts`'s own
`validateSourceSnapshotCandidate` (checksum recomputed and compared) before any change
classification proceeds; a failure here is `INTEGRITY_FAILURE`, not silently ignored or trusted.

## 14. M2-D compatibility

M2-D's `resolveProvisionVersion` only ever considers `VERIFIED` provision-versions (Milestone
2-D, §3). This milestone's observations carry no field capable of promoting anything to
`VERIFIED`, so M2-D's retrieval behavior is provably unaffected by any observation this file
produces until a human separately acts through M2-A's existing verification contract — confirmed
directly by a test asserting no `newVerificationStatus`/`promoteToVerified` field exists on any
observation.

## 15. Reuse, not duplication

This file introduces no new checksum function, no new text-normalization rule, and no new
per-provision change-classification algorithm — it composes `legalCorpus.ts`'s
`normalizeProvisionText`/`sha256Hex`/`validateSourceSnapshotCandidate` and
`legalCorpusIngestion.ts`'s `classifySnapshotChange`/`classifyProvisionCandidateChange` directly.

## 16. Real CYFSA fixture use

The M2-C fixture (`api/services/__fixtures__/cyfsa-s74-real-excerpt.txt`) is reused for four
tests: confirming an unchanged real excerpt reports `UNCHANGED`, and three clearly-labeled
*simulated* modifications (a wording change to paragraph (a), an added synthetic paragraph (d),
and a removed paragraph (c)) demonstrating `PROVISION_TEXT_CHANGED`, `PROVISION_ADDED`, and
`PROVISION_REMOVED` respectively. None of these simulated edits are presented as, or should be
mistaken for, an actual Ontario legislative amendment — they exist only to prove the diff logic
against real-shaped text.

## 17. Persistence — deliberately not implemented

No schema change was needed or made. If durable monitoring observations are ever persisted, the
proposed shape is a straightforward table mirroring `MonitoringObservation`'s fields
(`legal_source_id`, `retrieval_attempted_at`, `prior_snapshot_sha256`, `new_snapshot_sha256`,
`outcome`, `requires_inspection`, a JSON `provision_changes` array, `warnings`) with the same
RLS/service-role-only posture as every other Stage 6 table — but this is a documented proposal
for a future milestone, not something this one creates, since no concrete need for durable
storage (versus recomputing on demand) was established here.

## 18. Explicit non-goals

No cron, scheduled job, or Vercel function; no automatic corpus updater; no automatic `VERIFIED`
promotion; no AI-assisted amendment interpretation; no RAG or embeddings; no case-law monitoring;
no lineage-candidate auto-creation; no route; no UI; no production deployment.
