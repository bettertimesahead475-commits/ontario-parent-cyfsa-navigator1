# Devin Phase-Two Audit Register (analyzer accuracy + test effectiveness)

Branch `engineering/devin-phase-two-audit` from `engineering/integration` @ `3ad1c8c`. Phase-one registers (`DEVIN_*`, PR #137,
merged) carry summary rows pointing here.
Synthetic documents and mocked model output only. No production, database, deployment or paid inference.

## Findings

| ID | Severity | Status | Area | Summary |
|---|---|---|---|---|
| DEVIN-P2-01 | Medium | Fixed (this PR) | Verbatim quotation verification | Quotes matched inside words, so a fragment of a denial was "found word-for-word" |
| DEVIN-P2-02 | Medium | Fixed (this PR) | Statutory citation verification | Fused or unparsed pinpoints were dropped, so fabricated sections showed as internal-reference matches |
| DEVIN-P2-03 | Low | Fixed (this PR) | Red-flag severity | Single-CRITICAL rule ran before quote verification; a fabricated first CRITICAL displaced a located one |
| DEVIN-P2-04 | Low | Open (Claude/Codex) | Page-evidence quotes | `api/services/pageSources.ts` `verifyQuote` has the DEVIN-P2-01 substring behaviour; mirrored by pending SQL `navigator_quote_hits`, so both must change together |
| DEVIN-P2-T1 | Test gap | Fixed (tests) | Test effectiveness | 5 of 19 targeted mutations survived the existing suite; 4 now killed by new tests, 1 is redundant code |

### DEVIN-P2-01 — quotation matching was not word-bounded (Medium)
- **Where:** `shared/quoteVerification.ts` `locateQuote` (used by `applyReportGuards` for Quick Review, Deep Scan and the
  sectioned pipeline); `api/services/analyzerRequirementExtractor.ts` `verifyQuoteInDocumentText`.
- **Reproduction:** document `It is untrue that the father struck the child`; model quote `true that the father struck the child`
  → `EXACT`, severity ceiling `CRITICAL`, label "Found word-for-word in the document." The meaning is inverted. Likewise
  `he hit the child` inside `she hit the children`.
- **Root cause:** `occurrences()` used raw `indexOf` with no boundary check.
- **Fix:** a match may not start or end inside a word (Unicode letters/digits) when the quote itself starts/ends with one.
  Non-bounded hits are skipped, so `no` is no longer ambiguous with `note`. Requirement proposals use the same rule.
- **Exposure:** customer-facing report text and severity whenever the model trims or paraphrases a quotation.

### DEVIN-P2-02 — citation pinpoints were parsed in pieces (Medium)
- **Where:** `shared/citationVerification.ts` `citedSections` (drives `classifyCitation`, `guardCitation`, display).
- **Reproduction:** `CYFSA s. 1003` → sections `["100","3"]` → `INTERNAL_REFERENCE_MATCH`; also `s. 1143`,
  `s. 74(2)(zz)` (clause silently dropped), `s. 81(12)3`, `ss. 74(2) and 1003`.
- **Root cause:** section numbers capped at 3 digits with no boundary; list items needed no separator; unparsed text fused
  onto a pinpoint was ignored.
- **Fix:** whole numbers, separators required between items, and any character fused onto the last item is kept so the key
  cannot verify. All existing citation tests still pass.

### DEVIN-P2-03 — one-CRITICAL rule applied before verification (Low)
- **Where:** `api/services/analyzerSections.ts` `validateRedFlags` → `applyReportGuards`.
- **Reproduction:** two CRITICAL flags; first quote fabricated (ABSENT), second located exactly. Old result: first capped to
  "Affects Evidentiary Weight", second demoted to "Worth Raising With Counsel"; the report shows no CRITICAL finding and
  `modelSeverity` records the demoted value.
- **Fix:** the rule now runs in `applyReportGuards` after the severity ceiling. Every report path calls it
  (`functions/api/analyze.ts`, `directAnalyzer`, sectioned pipeline).

## Mutation testing (targeted, `vitest related`, every mutation restored with `git checkout`)

| ID | Mutation | Before | After |
|---|---|---|---|
| M01–M06 | Quote verified-status, ABSENT ceiling, stored citation label, mixed-Act citations, FACT promotion, neutral-language filter | Killed | Killed |
| M07–M09 | Paid session: revoked / expired / foreign UID accepted | Killed | Killed |
| M10 | Ledger job poll owner check removed | Killed | Killed |
| M11 | Legacy Storage job poll owner check removed | **Survived** | Killed (`tests/devin/legacy-job-owner.test.ts`) |
| M12–M13 | Basic tier extra credit / Forensic access | Killed | Killed |
| M14 | Access-code purchase email check bypassed | **Survived** | Killed (`tests/devin/activate-code-purchase-binding.test.ts`) |
| M15 | Quote severity cap removed | Killed | Killed |
| M16 | Final Case Assessment first Pro gate removed (non-Pro reaches the paid model call) | **Survived** | Killed (`tests/devin/final-case-assessment-entitlement.test.ts`) |
| M17 | Assessment source `uid` check removed | Survived | Not added: the object key already contains `sha256(uid)` |
| M18 | DLQ live-lease check removed (duplicate execution / credit release while running) | **Survived** | Killed (`tests/devin/dlq-live-lease.test.ts`) |
| M19 | Final Case Assessment entitlement recheck removed | Killed | Killed |

**Weak existing test:** `api/cloudflare-analyzer-queue-worker.test.ts` "waits for an active Worker lease…" passes with the
lease check deleted: the env has no requeue binding, so the requeue path throws and the message is retried anyway.

## Regression evidence
| Test file | Old code | New code |
|---|---|---|
| `tests/devin/analyzer-verification-integrity.test.ts` | 11 of 29 fail | 29 pass |
| `tests/devin/red-flag-critical-after-verification.test.ts` | 1 of 2 fail | 2 pass |
| Mutation-gap files (4) | pass on correct code; fail under M11/M14/M16/M18 | — |

## Not covered
- Real-model analyzer quality (paid inference not authorised), live Supabase RLS/RPC, UI-driven refresh/multi-tab testing.
- Phase-two items 3–5 beyond the synthetic documents above (full adversarial corpus, Worker-restart drills) remain open.
