# Analyzer reasoning configuration and tool use (audit, 2026-11-28)

Scope: the Cloudflare analyzer path (`functions/api/analyze.ts`, `_analyzer-model-adapter.ts`,
`api/services/analyzerSections.ts`, `analyzerModels.ts`, `final-case-assessment.ts`). Legacy `api/_server.ts` is not on
the production path. Findings are from code, not from provider logs.

## 1. What each level sends to the provider

| Level | Model (default) | Request shape | Extended thinking | Reasoning effort | Tools |
|---|---|---|---|---|---|
| Basic Review (Quick) | `claude-sonnet-5` (`DEFAULT_QUICK_MODEL`) | Streaming Messages API. Four section requests in parallel; each has a system prompt and one user text block | `thinking: {type: "disabled"}` | not sent | none |
| Deep Scan (Forensic) | `claude-opus-5` (`DEFAULT_FORENSIC_MODEL`) | Six section requests (three at a time), then one verification request | `thinking: {type: "disabled"}` | not sent | none |
| Final Case Assessment | `claude-opus-5` | One request, `max_tokens` 6,000, 75 s timeout | `thinking: {type: "disabled"}` | not sent | none |

How the thinking field is chosen (`buildThinkingRequestFields`, `analyzerModels.ts`):
- `enableThinking` is never set `true` by any caller on the Cloudflare path (grep confirms; it appears only in the
  legacy `api/_server.ts`). So every request takes the disabled branch.
- `claude-sonnet-5` and `claude-opus-5` match the current-generation pattern and are not in
  `MODELS_REJECTING_DISABLED_THINKING`, so the disabled form is sent. If thinking were enabled, current models take
  `adaptive` thinking, and `budget_tokens` is rejected on them.
- `output_config.effort` is sent only for the always-on models (`claude-*-5-5`), which this path does not use.

Other provider settings: `stream: true`, `anthropic-version: 2023-06-01`, `max_tokens` via `effectiveMaxTokens`, and
a provider deadline per call. No temperature or top-p is set in the request body.

## 2. Are these reasoning or conventional completion requests?

Conventional prompt-based completion with JSON output. The model is asked for JSON in text, the response is parsed and
validated (`validateRedFlags`, `validateChronology`, and so on), and deterministic code guards the result afterwards.
No extended thinking, no adaptive reasoning, no reasoning-effort setting and no function calling are used on any level.

## 3. Tool and deterministic capability already in the analyzer

Searched `functions/api`, `api` and `shared` for `tool_use`, `tools:` and `tool_choice`: no provider tool definitions.

Deterministic steps that already run, with no model call:
- **Quote verification** (`shared/quoteVerification.ts`): exact, whitespace, and variant matching with page mapping.
- **Citation and statute resolution** (`shared/legalVerificationPipeline.ts`, `citationVerification.ts`): `resolveLegalAuthority`,
  `guardCitation`, bundled CYFSA section keys.
- **Compliance matrix** (`shared/complianceMatrixEngine.ts`): Standard 7 service-plan deadline calculation
  (`calculateStandard7ServicePlanDeadline`), run in `analyze.ts`.
- **Report guards** (`applyReportGuards`): severity ceilings, one-CRITICAL rule, citation status.

Deterministic modules that exist but are **not** used by the analyzer:
- `shared/m2a-deterministic.ts`, `m2b-chronology.ts`, `m2c-claims.ts`, `m2d-relationships.ts`, `m2e-intelligence.ts`:
  case intelligence (fingerprints, date precision, claim classification, contradiction relationships, findings). Only
  their own tests and `api/services/caseIntelligence.ts` import them.
- `shared/courtPrep.ts` `parseWrittenDate` and `dateChecks`: used by the court-prep workspace, not the analyzer.

## 4. Defect found during this audit

`parseWrittenDate` (`courtPrep.ts`) relies on `Date.parse`, which rolls an impossible date such as "February 30, 2026"
forward to 2 March. The analyzer's chronology does not use it, so there is no live effect, but the court-prep workspace
would sort such a date as if it were valid. Recorded for the owner; not changed here (outside the analyzer path).

## 5. Changes made in this pass

- **Chronology date grounding (Deep Scan only).** `shared/chronologyGrounding.ts` checks each chronology date with a strict
  calendar parser and searches the source document for it. It adds `dateGrounding` to each row
  (`GROUNDED`, `NOT_FOUND_IN_DOCUMENT`, `INVALID_CALENDAR_DATE`, `UNPARSEABLE`, `UNDATED`). It changes no AI text and
  makes no provider call. Gated on `isForensic`, so Basic output is unchanged.
- Tests: `tests/devin/chronology-grounding.test.ts` (7 cases) and an analyzer-level case in
  `api/cloudflare-forensic-queue-progress.test.ts`.

## 6. What this architecture can and cannot improve

- **Accuracy:** deterministic checks catch dates the model invents. They cannot judge whether a date or event is
  legally significant, which still needs the model.
- **Provider calls and tokens:** no reduction from this change. The reductions that matter are the ones already
  identified in `analysis-reuse-baseline-20261128.md` (sending the document once per level instead of with every
  section), which need prompt-caching and owner decisions.
- **Processing time:** the grounding pass runs in milliseconds on the final report.
- **Agent loops:** none exist, and none were added. Tool calling would add provider round trips; it is not
  recommended for these fixed section schemas.
- **Not introduced:** adaptive thinking or effort settings. Enabling them would raise output tokens and latency on
  every section and needs paid comparison runs, so no change is made without authorisation.

## 7. Open items

1. Replace `Date.parse` in `courtPrep.parseWrittenDate` with the strict parser (owner review; affects the court-prep workspace).
2. Connect `m2c` claim classification and `m2d` relationships to the analyzer only after a paid comparison shows the
   deterministic relationship results agree with the model's contradictions.
3. Decide whether the deterministic `m2b` chronology should replace the model's chronology ordering (needs labelled test documents).
