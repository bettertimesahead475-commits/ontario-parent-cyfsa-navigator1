# Analyzer V2 rebuild

Base: `b93fcd480863a90d008305855c90e36cc19f62df`

This branch rebuilds the document analyzer without changing Production.

## Pipeline

`AUTHENTICATING -> VERIFYING_ACCESS -> EXTRACTING -> ANALYZING -> VALIDATING -> COMPLETE`

## Non-negotiable contracts

- Firebase identity is server-verified; never trust a client UID.
- Existing paid-session and free-use controls remain fail-closed.
- Extract a document once and reuse the extracted text for fast/deep analysis, case chat, timeline, and Forms & Files handoff.
- Every failure returns a machine-readable stage/code and a safe user message.
- Never count a failed provider/validation attempt as a completed analysis.
- No raw document text, tokens, or secrets in telemetry.
- Fast and Deep modes share extraction but have separate analysis budgets.
- AI output must validate before it becomes a completed report.
- Legal citations must be evidence/source traceable; unverified citations must be marked rather than invented.
- Production promotion requires Preview end-to-end verification with a real signed-in account.

## Donor sources

Use the uploaded integrated ParentShield implementation, `_server.ts`, `DocumentAnalyzerTab.tsx`, `DocumentAnalyzerTab_v2.txt`, and `schema.sql` as reference donors. Transplant architecture selectively; do not overwrite current security, entitlement, lifecycle, or production configuration.
