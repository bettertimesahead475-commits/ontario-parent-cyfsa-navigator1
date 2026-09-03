# ParentShield Legal-Content Audit — Fixes Applied (September 2026)

This branch (`audit-fixes-sept-2026`) implements the 7 priority fixes identified in the
September 2026 legal-content compliance audit. Each fix was committed individually;
see the commit log below for full rationale on each.

## Summary table

| # | Severity | File(s) | Old | New |
|---|----------|---------|-----|-----|
| 1 | High | `src/components/ChildDevelopmentTab.tsx` | `"Judges in Ontario are increasingly receptive to trauma-informed plans that establish concrete family stability." - Law Society of Ontario briefings.` | *(removed entirely — no source exists for this quote or attribution)* |
| 2 | High | `src/components/LegalTerminologyDrawer.tsx`, `src/components/ParentChatBot.tsx`, `src/components/DocumentAnalyzerTab.tsx`, `api/_server.ts` | "12 statutory risk thresholds" / "12 highly specific statutory categories" / "12 strict legal grounds" / "What 12 things must CAS prove?" / "The 12 Things CAS Must Prove" (12 mislabeled items) / "16 grounds defined under s. 74" | "17 statutory risk clauses" / "17 highly specific statutory clauses" / "17 strict legal clauses" / "What must CAS prove under s.74?" / "The 17 Clauses CAS Must Prove Under (Section 74)" (correctly lettered a–o incl. d.1/d.2) / "17 clauses defined under s. 74(2)" |
| 3 | High | `api/_server.ts` (`/api/search-connectors`) | `"You are a helpful legal assistant... offering actionable advice."`, no disclaimer | Rewrote to an educational-explanation-only prompt with a verified-citation allowlist; mandatory disclaimer now appended server-side to every response |
| 4 | Medium | `api/_server.ts` (`/api/extract-evidence`) | JSON schema had no `disclaimer` field (only report endpoint missing one) | Added the same `disclaimer` field/instruction used by `/api/analyze`, `/api/deep-scan`, `/api/case-timeline` |
| 5 | High | `api/_server.ts` (`/api/rag-query` family-advocate path), `src/components/ParentChatBot.tsx` | `"Coach them on how to communicate with CAS workers, what boundaries they should keep..."`, no disclaimer; footer read `"📚 Purely educational guidance portal · Jurisdiction: Ontario Compliant"` | Rewrote focus guideline to educational-only framing, redirecting situational questions to counsel; added `disclaimer` response field + system-prompt instruction; footer replaced with the same MANDATORY LEGAL EDUCATIONAL STATEMENT used in exported reports |
| 6 | Medium | `src/components/CYFSAGuideTab.tsx` | `"3 Free Document Uploads"` / `"upload up to 3 free documents"` | `"1 Free Document Review & 1 Free Evidence Extraction, then upgrade"` — matches actual backend grant in `checkAndConsumeFreeToolUse` |
| 7 | Medium | `src/components/FamilyCourtTab.tsx` | `"...24 hours prior to first hearing, and 7 business days for conference briefs under Rule 17."` / `"...cannot be used against you in a trial."` | Added `O. Reg. 114/99` (Family Law Rules) citation; hedged service-timing claim ("confirm the precise rule and subrule... with your lawyer or the court office"); softened confidentiality claim to "generally cannot be referred to later, subject to limited exceptions... confirm with your lawyer" |

## Commit log

```
b7931b1 Source Family Law Rules citations and hedge absolute claims
4664523 Correct free-tier documentation to match backend grants
9cb6e79 Add guardrails and disclaimer to OPA Coach free chat
00d7985 Add missing disclaimer field to extract-evidence reports
2cf8623 Add disclaimer guardrails to free search-connectors endpoint
78982f0 Correct CYFSA s.74 clause count from 12/16 to 17
9538a09 Remove fabricated LSO attribution
```

## Notes / follow-ups not in scope for this branch

- Fix 7's exact Family Law Rules subrule numbers could not be verified against a
  primary source (the Rules text isn't in this repo), so the specific day-counts were
  kept but hedged rather than replaced with an unverifiable exact subrule citation —
  consistent with how the rest of the app already handles unverified CYFSA
  subsections.
- The medium/low-severity items from the original audit not on this priority list
  (e.g. the affidavit-framing coaching language in `ChildDevelopmentTab.tsx`, the
  "7 business days" vs. "7 days" wording drift between `FamilyCourtTab.tsx` and
  `data.ts`, AI-capability marketing language in `CYFSAGuideTab.tsx`) remain open.
