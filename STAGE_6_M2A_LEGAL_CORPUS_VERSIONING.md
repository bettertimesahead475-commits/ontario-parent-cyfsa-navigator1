# Stage 6 Milestone 2-A — Legal Corpus Schema Hardening & Snapshot Versioning

Base: `stage-56-integration-adapter` @ `818d516f9bd78f136ce1beb90648e5b93d72a1ad` (Stage 5 M1 +
Stage 6 M1 + integration baseline + integration adapter, independently audited and closed).

**Status: INFRASTRUCTURE ONLY.** No Ontario or federal statutory text is ingested by this
milestone. No AI legal-selection or RAG logic exists here. No Stage 5 M2 feature is touched.
This document records what exists after this pass, not a claim of corpus completeness.

## 1. Purpose

Stage 6 M1 could represent a legal source, one version-dated range per source, and a
citation-stable provision — but had nowhere to put the actual *text* of a provision as it read
during a specific version, no record of what raw material that text was parsed from, and no way
to represent renumbering/splitting/merging across amendments. M2-A adds exactly those three
things, and nothing else: the durable data model a future ingestion pipeline (M2-B) needs before
it can safely write anything.

## 2. Table ownership

Unchanged from M1, still exactly as before:

- `navigator_legal_sources`, `navigator_legal_source_versions`, `navigator_legal_provisions`,
  `navigator_legal_mappings` — all M1-owned, none recreated or altered by this migration.

New in M2-A (`create_navigator_legal_corpus_versioning.sql`):

- `navigator_legal_provision_versions` — the version-specific text layer.
- `navigator_legal_source_snapshots` — immutable raw-retrieval provenance.
- `navigator_legal_provision_lineage` — amendment/renumbering/split/merge edges.

No second `navigator_legal_mappings`-equivalent table exists; Stage 6 M1's mapping table remains
the sole legal-mapping table.

## 3. Two-level provision model

`navigator_legal_provisions` (M1) stays the stable conceptual/citation identity — one row per
`(legal_source_id, citation)`, e.g. one row for "s. 74(2)" regardless of how many versions of the
CYFSA exist. `navigator_legal_provision_versions` (new) is the versioned text layer: one row per
`(provision, legal_source_version)` pair actually captured, carrying `exact_text`,
`normalized_text`, `text_sha256`, its own `[effective_from, effective_to)` range, and its own
verification state. A mapping (`navigator_legal_mappings`) still references the stable
`provision_id` plus the resolved `legal_source_version_id` — nothing about M1's mapping contract
changes; M2-A only makes it possible to also look up what that provision actually said during
that version, which M1 had no table for at all.

Composite foreign keys (`navigator_provision_version_provision_scope`,
`navigator_provision_version_source_version_scope`) require a provision-version's `provision_id`
and `legal_source_version_id` to both resolve back to the *same* `legal_source_id` — a
provision-version can never be attached to a version from a different statute than its own
provision belongs to.

## 4. Snapshot model

`navigator_legal_source_snapshots` is the immutable record of what was actually retrieved from
an official URL, before any parsing. `raw_content` is the exact text as fetched; `content_sha256`
is its checksum. A `navigator_source_snapshot_guard` trigger freezes `legal_source_id`,
`source_url`, `retrieved_at`, `raw_content`, `content_sha256`, and `created_at` permanently —
only `ingestion_status` may ever change, as a future pipeline advances it through
`RETRIEVED → PARSED → VALIDATED`/`REJECTED`. A snapshot is never an AI-generated summary; it is
the raw material a provision-version's text must ultimately trace back to.

## 5. Verification states

`UNVERIFIED` (ingested/parsed candidate, not yet reviewed) → `COMMITTED_INSPECTION` (queued for
human inspection, still not authoritative) → `VERIFIED` (human-confirmed against the official
source) or `REJECTED` (invalid/unusable). Only `VERIFIED` rows may later be eligible for
deterministic legal retrieval — this mirrors M1's own rule that only `VERIFIED` sources,
versions, and provisions can resolve a mapping.

**AI cannot self-verify**, structurally: `VERIFIED` requires `verified_by` (a human
`accounts.id`) and `verified_at`; every other status requires both to be `null` — enforced by a
`check` constraint in the migration and re-validated in `legalCorpus.ts`'s
`validateVerificationTransition`, which throws if `verifiedBy` is missing when promoting to
`VERIFIED`. No function anywhere in this codebase sets `verification_status = 'VERIFIED'`
without an explicit human id argument; there is no AI-provider identity that could satisfy that
requirement.

## 6. Verified-row immutability

Once `verification_status = 'VERIFIED'`, a `navigator_provision_version_immutable` trigger
rejects *any* update to that row — not a subset of "legally material" columns, all of them,
matching the same full-immutability precedent Stage 4/6 already established for evidence and
legal-mapping provenance. A correction is a new provision-version row, optionally linked back via
`navigator_legal_provision_lineage`, never an in-place edit of verified text.

## 7. Checksum strategy

- **Source snapshot:** `sha256` of the exact `raw_content` string as retrieved — no
  normalization applied before hashing, since this checksum's job is proving nothing was altered
  between fetch and storage.
- **Provision text:** `sha256` of `normalizeProvisionText(exactText)`, where normalization is
  deliberately conservative: Unicode **NFC** canonical composition, `CRLF`/`CR` → `LF` line-ending
  normalization, and trimming only the leading/trailing whitespace of the whole text. Internal
  whitespace runs, punctuation, and casing are never altered — a statute's spacing can be legally
  meaningful, unlike Stage 4's separate quote-matching whitespace tolerance (a different,
  intentionally lossy comparison used only to verify AI-quoted excerpts against source pages).
  `exactText` and `normalizedText` are stored and validated separately; `legalCorpus.ts` recomputes
  both from `exactText` and rejects any candidate whose supplied `normalizedText`/`textSha256`
  don't match exactly — a retrieved-text candidate can never assert its own integrity.

Both checksums reuse Stage 4's `hash()` function (`pageSources.ts`) rather than a second SHA-256
implementation.

## 8. Temporal semantics

Unchanged from M1: half-open `[effective_from, effective_to)` ranges, `effective_to = null`
means open-ended. `navigator_legal_provision_versions` gets its own `btree_gist` exclusion
constraint (`navigator_provision_version_no_overlap`) preventing two versions of the *same*
provision from having overlapping effective periods — the identical pattern M1 already applies to
`navigator_legal_source_versions`, scoped one level deeper. `resolveApplicableVersion` in
`legalAuthority.ts` is **untouched** by this migration; M2-A's regression tests
(`legalCorpus.test.ts`) re-run the UNKNOWN-date and historical-version-selection cases against it
directly to confirm nothing here weakened that behavior.

## 9. Lineage model

`navigator_legal_provision_lineage` is a plain edge table (`predecessor_version_id`,
`successor_version_id`, `lineage_type`), not a nullable `supersedes_id` column — a single
`AMENDMENT`/`RENUMBERING`/`REPEAL`/`REENACTMENT` is naturally one edge, a `SPLIT` is one
predecessor linked to multiple successor rows, and a `MERGE` is multiple predecessors linked to
one successor row, all without any special-cased cardinality logic. Self-links are rejected by a
`check` constraint; duplicate edges (same predecessor/successor/type) are rejected by a unique
constraint. Edges are insert-only at the database layer (no `update` grant is issued to
`service_role` for this table) — a recorded lineage fact is not silently redirected later.

## 10. Source trust policy

`classifySourceTrust(jurisdiction, officialPublisher)` in `legalCorpus.ts` returns
`AUTHORITATIVE` only for the exact strings "e-Laws (Government of Ontario)" (jurisdiction `ON`)
and "Justice Laws Canada" (jurisdiction `CA`) — matching Stage 6 M1's existing corpus-scope
notes. Everything else, CanLII explicitly included, classifies as `SECONDARY` and must never
become the source of record for a provision-version while an official government source is
available. This is a pure string classification; it does not fetch, verify, or trust anything by
itself — it only decides which of two already-known publisher strings would be acceptable as
authoritative later.

## 11. Corpus-poisoning defense

Retrieved legal source text is treated as data, never instructions, consistent with the
Stage 4/6 untrusted-content boundary. Concretely, in this milestone:

- A snapshot's checksum is always recomputed and compared against the stored `raw_content`; text
  cannot assert its own integrity.
- A provision-version's `normalizedText`/`textSha256` are always recomputed from `exactText` and
  compared exactly; a candidate cannot supply a "normalized" version disconnected from its
  claimed exact text.
- `verification_status` can only reach `VERIFIED` through an explicit human `verifiedBy` id,
  both in the database `check` constraint and in `legalCorpus.ts`'s transition validator — no
  code path in this repository can promote retrieved text to authoritative on its own.
- A provision-version's `legal_source_id`/`provision_id`/`legal_source_version_id` are all
  foreign-key-checked against existing rows; retrieved text can never invent its own source
  identity.
- Nothing in `legalCorpus.ts` calls an AI provider, fetches a URL, or executes retrieved content
  as code — every function is a pure, synchronous validator or normalizer over already-produced
  structured input, matching `legalAuthority.ts`'s own established pattern.

## 12. Explicit non-goals of this milestone

Not implemented here: statutory corpus ingestion (no CYFSA text is inserted); an actual
retrieval/fetch pipeline; AI-assisted provision parsing; legal-source monitoring/amendment
detection jobs; Stage 5 M2 (chronology, contradictions, corroboration, claim evolution, evidence
gaps, unanswered questions); Stage 6's legal-selection/generation layer (choosing which authority
applies to a given piece of evidence); any HTTP route or UI.

## 13. Future M2-B ingestion boundary

M2-B (not started, not authorized by this milestone) would be the actual pipeline: fetch an
official URL → validate it against `classifySourceTrust` → write a
`navigator_legal_source_snapshots` row → parse candidate provisions (an AI-assisted, non-
authoritative step) → construct `ProvisionVersionCandidate` objects and validate them with
`validateProvisionVersionCandidate` → queue for human inspection
(`COMMITTED_INSPECTION`) → a human calls `validateVerificationTransition` with their own
`accounts.id` to promote to `VERIFIED` (or `REJECTED`). Every deterministic piece of that
pipeline already exists in `legalCorpus.ts`; M2-B's job is wiring retrieval and parsing around
it, not redesigning the validation this milestone already built.
