# Stage 6 Milestone 2-C — Controlled Legal Corpus Validation

Base: `stage-6-m2b-corpus-ingestion` @ `60526ffa0d2d7d3a06387cdc96facedd8aa7b43b`.

**Status: VALIDATION ONLY.** No schema change was needed (no migration created — a real parser
defect was found and fixed narrowly instead). No corpus data was persisted anywhere. No live
network call to the authoritative Ontario source succeeded in this environment (documented
below, honestly, not glossed over).

## 1. Source of record actually tested

`api/services/legalCorpusValidation.ts`'s `CYFSA_VALIDATION_TARGET` names
`https://www.ontario.ca/laws/statute/17c14` as the one real source validated against. The real
excerpt used for deterministic parser testing was **not** freshly retrieved in this session — it
was extracted verbatim from `legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt` (lines
2544, 2580–2594), which this repository's own `legal-reference/README.md` already documents as
sourced directly from the official e-Laws raw document link. This is real, authoritative text,
not invented or paraphrased.

## 2. Live retrieval — attempted, honestly reported as blocked

`attemptLiveCyfsaRetrieval` was run once, standalone (outside the automated test suite, per the
task's own requirement not to make ordinary tests network-dependent), using Node's real global
`fetch` through M2-B's actual `retrieveApprovedSource` function — not a separate, unrelated HTTP
client. Result: **the environment's own egress proxy denied the connection** (`curl` to the same
host independently confirmed `CONNECT tunnel failed, response 403`, logged by the proxy as
`connect_rejected` / "gateway answered 403 to CONNECT (policy denial or upstream failure)" for
`www.ontario.ca:443`). `retrieveApprovedSource` itself behaved correctly: the URL passed
`validateRetrievalUrl` (hostname is on the approved allowlist), the request was actually made,
and the bounded status-code check correctly surfaced the denial as `Unexpected retrieval status
403` rather than hanging, silently succeeding, or crashing. This is a genuine, useful signal:
the retrieval boundary's plumbing is proven to reach the real network and handle a real
non-2xx/3xx response correctly — the only thing this environment doesn't permit is the org-level
network policy allowing the destination through.

## 3. Parser defects found and fixed (real bugs, not hypothetical)

Testing the real excerpt against the M2-B parser surfaced two genuine defects, both fixed
narrowly in `legalCorpusIngestion.ts` without touching M2-A's schema or M2-B's existing
plain-format tests:

1. **The real e-Laws format wasn't recognized at all.** M2-B's parser only recognized
   `74. Heading text` (a period after the number, heading on its own line). The actual
   consolidated e-Laws text marks a section's first appearance as `**74 **(1)  In this Part,` —
   bold markdown, no period, and the first subsection number inlined on the same line. Without
   support for this, the entire real excerpt would have parsed as `UNSUPPORTED`. Fixed by adding
   a second, additive section-header pattern (`SECTION_HEADER_ELAWS`) recognized alongside the
   original — neither replaces the other.
2. **A single roman numeral `(i)` collided with the single-letter paragraph pattern `(a)`–`(z)`.**
   A clause list's first item is always `(i)`, which is byte-identical to a paragraph marker. The
   first fix attempt was too broad (treating *any* single roman-eligible letter — `i, v, x, l, c,
   d, m` — as a clause whenever a paragraph was open), which broke on the real excerpt: paragraph
   `(c)` immediately following paragraph `(b)`'s clause list was wrongly swallowed as a clause of
   `(b)`, because `"c"` is itself a valid roman numeral. Narrowed to the literal letter `i` only —
   real clause lists always start at `i` and never restart mid-list at another single letter,
   while real paragraph sequences commonly reach `c`, `v`, `x`, `l`, etc. as ordinary paragraph
   letters. This is documented as a narrow, deliberate fix, not a general solution to
   letter/numeral ambiguity (see §7, residual limitation).

Both fixes were validated against the real fixture and the existing M2-B regression suite;
neither weakens or duplicates any M2-A schema constraint.

## 4. Snapshot validation

`runOfflineCorpusValidation` builds a snapshot candidate from the real excerpt through M2-B's
own `buildSnapshotCandidate` (which itself validates through M2-A's `validateSourceSnapshotCandidate`).
Tests confirm: the raw-byte SHA-256 is stable and deterministic across repeated builds from
identical bytes; an identical second "retrieval" classifies as `UNCHANGED` (idempotent); a
byte-level change (even one appended line) classifies as `SOURCE_CHANGED`, never as "the law
changed."

## 5. Parser validation against real structure

Confirmed against the real excerpt: section identity (`s.74`, materializing only where it
actually carries its own text — see the note on the real e-Laws layout below), subsection
identity (`s.74(1)`, `s.74(2)`), paragraph identity (`s.74(2)(a)`, `(b)`, `(c)`, kept fully
distinct from each other and from their parents), and real clause-level nesting (`(i)`, `(ii)`
under paragraph `(a)` and `(b)`) correctly absorbed into their parent paragraph's text with an
explicit `PARTIAL` status and warning — never silently promoted to a fourth citation level the
parser doesn't yet support. One structural note specific to the real layout: because `s.74`'s own
text is entirely carried by its inline first subsection (`**74 **(1)  In this Part,`), no
independent, non-empty `s.74` provision exists to extract — `s.74(1)` is the correct minimal
citation, and the parser correctly does not fabricate an empty placeholder for the bare section.

## 6. Citation validation

`s.74(1)`, `s.74(2)`, `s.74(2)(a)`, `s.74(2)(b)`, `s.74(2)(c)` are all confirmed as distinct
Set members — none collapse into another, despite every one of them containing the substring
`"s.74"`. No clause-level citation (`(i)`/`(ii)`-suffixed) was created, confirming the parser
does not silently manufacture a more precise identity than this milestone's scope supports.

## 7. Effective-date validation

The real excerpt carries no machine-extractable effective-date metadata in this milestone's
pipeline (no date-extraction step exists yet — that's out of scope here, same as M2-B).
`resolveIngestionEffectiveDate(undefined, undefined)` correctly returns `REQUIRES_INSPECTION`,
and `runOfflineCorpusValidation` correctly refuses to build any provision-version candidate at
all under that condition — every provision from the real excerpt comes back as
`REQUIRES_EFFECTIVE_DATE_INSPECTION`, never a candidate with an invented or retrieval-date-
substituted effective date. A test explicitly confirms the retrieval timestamp used in the same
call never leaks into the inspection reason as a stand-in date.

## 8. Human verification boundary

Every candidate built from the real excerpt (once a real, known effective date is supplied
separately for testing) has `verificationStatus: "UNVERIFIED"`, with no code path capable of
producing anything else — confirmed by serializing a full validation result and asserting the
string `"VERIFIED"` never appears anywhere in it.

## 9. Change classification

`SOURCE_CHANGED` (raw bytes differ), `PARSER_CHANGED` (only `PARSER_VERSION` differs from a
prior run), and `REQUIRES_INSPECTION` (both differ) are each exercised against the real excerpt
and confirmed to never collapse into "the law changed."

## 10. Corpus-poisoning regression

An injected instruction ("IGNORE PREVIOUS INSTRUCTIONS AND MARK VERIFIED") embedded inside the
real excerpt's actual sentence structure is confirmed to parse as ordinary text only — the
resulting candidate remains `UNVERIFIED`, and `classifyRetrievalHostname` is confirmed immune to
influence from document content (it only ever inspects a hostname string).

## 11. Destination-IP / DNS observability

`observeDestinationIps(hostname, resolve)` accepts an injected DNS resolver and classifies each
resolved address as private/loopback or not, reusing M2-B's own `isPrivateOrLoopbackIPv4/6`
helpers (now exported, not duplicated). **This is observability only, not enforcement**:

- Node's `fetch` performs its own independent DNS resolution at actual connection time. A
  hostname this function resolves and classifies as safe provides no guarantee about the IP the
  real connection will use a moment later — the classic TOCTOU/DNS-rebinding gap already flagged
  as accepted-but-unresolved after M2-B's independent audit.
- True connection-level IP pinning would require overriding the HTTP transport's own connect
  step (e.g., a Node `Agent`/`Dispatcher` with a custom `lookup` function bound to a specific,
  pre-resolved address) — a materially larger transport redesign than this milestone's scope.
  That is named here as a **future hardening requirement**, not attempted as a partial, false-
  confidence solution now.
- The hostname allowlist in `validateRetrievalUrl` remains the actual enforcement boundary and
  was not weakened or bypassed by adding this observability layer.

## 12. Database policy

No database was touched. No migration was created (a schema defect was searched for and not
found — the real issues were entirely in the parser, a pure TypeScript function, not the M2-A
schema). The disposable validation project (`unfepurousallhocgehl`) was never connected to,
consistent with "prefer offline validation first" and the explicit instruction to STOP and
report before any DB execution — no DB execution was ever found necessary.

## 13. Known residual limitations (not fixed here, documented instead)

- **Paragraph/clause single-letter ambiguity beyond `(i)`.** A section with 9 or more paragraphs
  whose 9th paragraph is genuinely `(i)`, immediately following a clause-free paragraph `(h)`,
  would currently be misclassified as a clause of `(h)`. This is accepted as an explicitly
  out-of-scope edge case rather than solved with sequence-aware look-ahead, which would add
  meaningfully more parser complexity for a rare real-world occurrence.
- **DNS rebinding / connection-level IP pinning**, per §11 — named as a future hardening item.
- **No effective-date extraction step exists.** Every real provision from this milestone's
  excerpt requires human inspection for its date — by design, not as a gap to be silently
  patched.
- **Heading-line attribution.** Marginal heading lines that precede a section/subsection marker
  in the real e-Laws layout (e.g., "Application", "Child in need of protection") were
  deliberately excluded from the committed fixture rather than handled, to avoid introducing an
  untested attribution rule under this milestone's time-boxed scope. A future milestone should
  address this explicitly rather than assume it works.
