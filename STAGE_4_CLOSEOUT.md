# Stage 4 Closeout

Stage 4 objective: establish trustworthy page-anchored document/evidence persistence before matter-wide intelligence.

Stage 4 is functionally complete. Remaining listed conditions are release-hardening requirements and do not block Stage 5 development.

## Implementation and security model

Implemented document routes/services, physical PDF page splitting with pdf-lib 1.17.1, deterministic quotes, document versions, page/run/evidence persistence, and legacy analyzer page metadata compatibility. No Stage 5 workspace or intelligence engine is included.
Firebase identity and inherited paid-session/rate/payload controls protect server operations. The SECURITY INVOKER RPC rechecks account, matter, client and OWNER membership with locks held through retrieval/mutation. RLS and restricted server ACLs deny anonymous/authenticated access. Evidence provenance is immutable; human review state remains separately updateable in the database.

## Migration and audit history

Base source: `22384a833cf7889493a0835c2b68af9726e1caf1`.
Artifact remains `supabase/migrations_pending_approval/create_navigator_page_evidence_foundation.sql`.
Final executed SHA256: `A6627314FDB2ADDB44835EFCD13FC14F6F5C50A7F9A7230C53CEC52E193D1520`.

Read-only audit/correction rounds strengthened explicit quote types/bounds, exact whitespace parity, hierarchy/current-run constraints, immutable source/run guards, document-first locking/revalidation and minimal ACLs. The final run-attribution correction introduced the shared active-evidence-run helper for direct INSERT and RPC completion, including empty completion arrays, while preserving terminal review updates. Detailed correction-era evidence remains in `PAGE_ANCHORED_FOUNDATION.md`.

Final approval was for isolated validation only. Migration executed once in one BEGIN/COMMIT transaction on `unfepurousallhocgehl`, 2026-09-13 14:22:33.831–14:22:34.020 UTC, with CA/hostname TLS verification. It succeeded. No production execution was authorized. No SQL is executed by this source-control closeout; do not replay the migration. Historical applied migration artifacts remain unchanged.

## Live isolated result

**PASS WITH CONDITIONS.** Three new tables, seven functions and five triggers installed; public columns 50→94, constraints 29→76, indexes 23→42. Installed function bodies matched the approved SQL. RLS enabled with no public policies. Anon/authenticated denied with 42501; service_role has only intended new-table operations. Source RPC lock_timeout is 5s.

Run attribution A–K passed: valid processing evidence run accepted; wrong page, extraction operation, completed/failed run, wrong version/matter/document, malformed/missing pageId and absent run rejected. Quote validation covered exact/normalized, all 25 whitespace characters, Unicode, invalid offsets, fabrication and ambiguity; 31 actual TypeScript/SQL comparison cases passed. Provenance changes failed; supported review changes passed. Real Supabase shapes and safe application 404/503 normalization passed.

## Concurrency and rollback

Independent backends 168588/168589 proved overlap using transaction timestamps and pg_blocking_pids. Identical uploads serialized to one active extraction; changed versions allocated sequentially; read/reassignment, suspension and OWNER removal were protected. Supplemental backends 169338/169340 verified actual client/matter ownership changes waited behind reads and were rolled back. Retry/stale completion, double extraction/evidence completion, and both evidence-insert/run-terminalization orders passed.

Real lock timeout: **5032 ms**, **55P03**. Later page/evidence INSERT failures (23514) left no partial rows or false completed states. Invalid later hierarchy (P0001) rolled back earlier evidence. Final fixture scope had zero incomplete versions, processing runs or page-count mismatches.

## Validation evidence and cleanup

Detailed local report: `C:\Users\User\Documents\Codex\2026-09-11\prior-conversation-with-codex-conversation-role\outputs\page-evidence-validation-report.md`, with adjacent schema/result JSON. This repository summary preserves the result if those local artifacts are unavailable to another developer. Database checks were performed in the preceding validation task, not rerun during closeout.
Rollback fixtures and non-immutable temporary records were removed. No helper trigger/function or bypass was left. Completed immutable fixtures remain in the disposable project:

- Account a691272d-34b6-4bc7-a73a-775b41c70e69; client 9d5fef65-d268-4488-b173-204fe6ce6407; matter b9605c56-ff34-47ec-9699-eced18a65208.
- Membership 8b3fd383-4b56-4533-8a52-330ec40adb02.
- Documents c1f5c926-cfbe-4eec-9db3-5d30003d7158, a508eab5-0296-450e-8128-0ee850abd706.
- Versions 9affa7d3-117c-4365-9bb2-3e8ede718f09, 32734031-528c-4158-8a95-41eff5008a4a.
- Pages b0349ce0-214c-4bf4-9d78-0eca763fef72, 0c04fe26-fc7a-4f1a-82a1-6c0670486783.
- Evidence 334d8d77-5dbd-4e2e-85fb-809a404ab8ce.
- Completed runs 95f08cef-6ff4-4be9-8295-4edc10df117b, e689fd00-d1b1-4837-94b4-7ac098a6ce89, 297ffb8f-fbd0-431c-9200-d9b452486aba, 6d282f60-a710-410b-bec2-e517808fafda, e463b8ec-8da3-40ac-a95b-136162af4b63.

Do not bypass immutability for cleanup or treat this disposable project as Production.

## Release conditions and next milestone

Dedicated Firebase-authenticated HTTP integration, dependency advisories and production hardening remain release conditions, not Stage 5 blockers. See HANDOFF.md for operational debt, historical security concerns requiring reassessment, and the staged roadmap. No blocking database defect was demonstrated; no source/SQL patch was indicated by live validation.
Next authorized planning target: Stage 5 matter-scoped Evidence Review workspace. No Stage 5 implementation is included here.

## Closeout verification

Fresh local targeted tests: 108/108 across three files. Full suite: 307/307 across nine files. Standalone `node node_modules/typescript/bin/tsc --noEmit --pretty false`: exit 0. `npm run build`: exit 0 with existing large-chunk warning. Normal-context `git diff --check`: exit 0. The elevated verification shell could not run its Git check; it was repeated successfully in the normal repository context. Standalone dependency audit result is recorded below after completion. No audit fix or source correction was performed.

Standalone npm audit: exit 1, 11 vulnerabilities (10 moderate, 1 high). No fix applied. Generated local audit cache was moved outside the repository and is not part of the milestone.
