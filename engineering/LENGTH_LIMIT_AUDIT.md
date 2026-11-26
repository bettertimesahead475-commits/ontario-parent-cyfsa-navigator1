# Length limits and truncation audit (legal and evidence verification)

Audited 2026-11-26 by Claude (backend) on `engineering/claude-review`. Scope: every `slice(`, `substring(`, `.length >`
or named `MAX_*` limit in `shared/` and `api/services/` that touches legal authority, quotations, findings or evidence.
Method: grep plus reading each call site. Classification:
- **Silent**: truncates or skips content without a visible signal. Must be fixed or made explicit.
- **Explicit**: refuses or reports the limit to the user. Acceptable.
- **Display**: affects only a snippet or label, never a verdict or stored provenance. Acceptable.

## Findings

| # | Location | Limit | Class | Effect on verification | Status |
|---|---|---|---|---|---|
| L-1 | `shared/legalVerificationPipeline.ts` `evaluatePropositionSupport` | 4,000-char windows, 3,000-char overlap (step 1,000), max 200 windows (about 200,000 chars) | was Silent (skipped), now Explicit | Long text was skipped; now windowed. A single match up to 3,000 characters is guaranteed to lie wholly in one window; longer matches are NOT guaranteed. Beyond 200 windows → NOT_EVALUATED with reason | Fixed `c38d59a`, `5940df4`, reviewer corrections in the commit after `0b28e15`; residual: matches over 3,000 chars |
| L-1a | same | provided proposition that is empty, whitespace-only or NOT_EVALUATED | was Silent (VERIFIED/SUPPORTED) | — | Fixed: UNVERIFIED (reviewer finding 1) |
| L-1b | `api/services/analyzerStreaming.ts` `generateAnalysisJobId` | server job ids used `Math.random` | was Silent (predictable Storage keys) | — | Fixed: uses `newAnalysisJobId` (Web Crypto, fails closed) (reviewer finding 7) |
| L-2 | `shared/legalVerificationPipeline.ts` `finalizeResolution` | incomplete proposition | was Silent (VERIFIED), now Explicit | Returned VERIFIED/SUPPORTED with an unevaluated proposition | Fixed `5940df4` (UNVERIFIED) |
| L-3 | `api/services/analyzerRequirementExtractor.ts:246` | `exactQuote.slice(0, 2000)` | **Silent** | Stored `source_exact_quote` no longer equals the source text; provenance claims a verbatim quote it is not | **Open.** Recommended: refuse to store a longer quote (or store the full text if the column allows). Owner: Claude; needs a schema check |
| L-4 | `api/services/caseActionWorkspace.ts:256` | `sourceExactQuote.slice(0, 2000)` | **Silent** | Same as L-3 for user-entered case actions | **Open.** Same fix as L-3 |
| L-5 | `api/services/analyzerSections.ts:383, 463` | `items.slice(0, 6)` for threshold analysis and procedural violations | **Silent** | Findings beyond the 6th are dropped with no marker | **Open.** Recommended: keep all, or add a "n more not shown" flag. Owner: Claude |
| L-6 | `api/services/analyzerSections.ts:299` | `.slice(0, 8)` | Needs review | Not yet classified | **Open** |
| L-7 | `api/services/analyzerRequirementExtractor.ts:236, 247` | description 2,000 / author 500 chars | Display or provenance | Descriptions only; not verdicts | Acceptable; recorded |
| L-8 | `api/services/directAnalyzer.ts:29` `DIRECT_ANALYSIS_MAX_CHARS` 75,000 | direct path refused, falls back | Explicit | Recorded with reason "oversized" and the chunked pipeline runs | Acceptable |
| L-9 | `api/services/directCaseBrief.ts:62` 75,000 | returns null silently | Silent, but not a verdict | A case brief is not produced and no reason is shown | **Open** (low): record reason like L-8 |
| L-10 | `api/services/documentSources.ts:41` page text > 30,000 | 422 PAGE_TOO_LARGE | Explicit | Requires chunking; refuses | Acceptable |
| L-11 | `api/services/pageSources.ts:245` extracted text > 100,000 | refused | Explicit | — | Acceptable |
| L-12 | `api/services/pageSources.ts:310, 325` quote > 10,000; statement > 2,000 | refused | Explicit | — | Acceptable |
| L-13 | `api/services/legalCorpus.ts:82, 141` exactText 50,000; rawContent 5,000,000 | refused | Explicit | — | Acceptable |
| L-14 | `shared/m2b-chronology.ts:114` > 1,000 events | throws | Explicit | — | Acceptable |
| L-15 | `api/services/legalSources.ts:180` pinpoint > 200 | refused | Explicit | — | Acceptable |
| L-16 | `shared/complianceMatrixEngine.ts:339, 350` snippets 260 / 240 | display | Display | — | Acceptable |
| L-17 | `shared/analyzerRetryPolicy.ts` id slice 12 | id format | Not a limit on content | — | Acceptable |

## Not yet verified

- Whether the `source_exact_quote` column has a database length limit (L-3, L-4). Needs the schema, which is in
  `supabase/` and was not read in this pass.
- L-6 and the rest of `analyzerSections.ts`: classify before the next release.
- No test pins L-3 to L-5 today. Each needs a regression test before it is changed.

## Coordination

- Devin's adversarial document audit should test L-3 to L-5 with a synthetic document whose quotation is longer than
  2,000 characters. That test is the release gate for those items.
