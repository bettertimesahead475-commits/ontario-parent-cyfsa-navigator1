# Devin phase-two handoff — 2026-11-25

- **Branch / PR:** `engineering/devin-phase-two-audit` → `engineering/integration`. PR #137 untouched.
- **Fixed (needs Claude review, Claude-owned files):** `shared/quoteVerification.ts`, `shared/citationVerification.ts`,
  `api/services/analyzerSections.ts`, `api/services/analyzerRequirementExtractor.ts`, `vitest.config.ts` (adds
  `tests/devin/**`, same line as PR #137 — take either).
- **Open for Claude/Codex:** DEVIN-P2-04 (`pageSources.verifyQuote` + pending SQL `navigator_quote_hits` need the same
  word-boundary rule, changed together); strengthen the DLQ lease test in `api/cloudflare-analyzer-queue-worker.test.ts`.
- **Details:** `engineering/DEVIN_PHASE2_AUDIT_REGISTER.md`.
- **Next:** adversarial corpus for chronology/contradiction prompts, Worker-restart and refresh drills, real-model
  evaluation once inference is authorised.
