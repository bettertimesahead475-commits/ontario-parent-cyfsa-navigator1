# T-14: adversarial security tests (Agent A, 2026-11-27)

Base: `engineering/integration` at `8623990`. Production named by the lead: `82dfe65`.
Scope: Pages Functions and analyzer services, mocked Firebase key set and in-memory Supabase double
(`tests/security/_firebase.ts`, `tests/security/_supabase.ts`). No real data, no real accounts, $0 inference.

## Result

**No vulnerability found.** Every test passes on the current code; no production code changed.
`tests/security/**/*.test.ts` was added to `vitest.config.ts` `include` (needed: the directory was not collected).

Tokens are signed with locally generated RSA keys and checked by the real `verifyFirebaseRequest`
(signature, `alg`, `kid`, `aud`, `iss`, `sub`, `exp`/`iat`), not a mocked verifier.

| File | Tests | What it proves |
|---|---:|---|
| `authz-bypass.test.ts` | 155 | 12 bad tokens (none, Basic, malformed, expired, other project, other issuer, `alg=none`, HS256, attacker key under Google's `kid`, tampered `sub`, future `iat`, empty `sub`) × 12 user/admin routes → 401 with zero outbound requests, zero credit RPCs, zero inference. Forged `kid` burst forces at most one key refresh. All 21 admin routes: anonymous 401, signed-in non-admin 403, before any request. Unverified admin email, look-alike email and uid outside `ADMIN_UIDS` → 403. `gemini-models` and job-status `x-admin-secret` refused when unset or mismatched. |
| `idor.test.ts` | 23 | Another user's job id (ledger, legacy storage, `-rN` retry) → 403, report object never read. Another user's job id as `X-Analysis-Id` on `/api/analyze` and `/api/deep-scan` → 409 `ANALYSIS_ID_CONFLICT` before any credit, inference or write. Another user's paid session → free usage only / FCA 403. Another account's matter → FCA 404 (read, generate, add source) with no object read or write; foreign-owned stored assessment → 404. Professional workspace: another matter → 403 before any case-file table; another matter's evidence id under own matter → 404. |
| `upload-abuse.test.ts` | 33 | Content-Length and base64 over 20 MB → 413; non-JSON/missing/non-string payloads → 400; EXE/ELF/OLE/mismatched type or extension → 415; DOCX bomb (50 MB part, 200 KB zip) → 413 in < 5 s; 201-page PDF → 413 `TOO_MANY_PAGES`; path-like filenames are only echoed as a ≤255-char label; transcribe: oversize 413, non-audio MIME 415; FCA: body over 150 KB → 413, path-like source filename never enters the storage key. |
| `prompt-injection.test.ts` | 9 | Injected `</document>` variants are neutralized in all six section prompts; a model that "obeys" and marks fabricated quotes EXACT/verified/CRITICAL is re-checked and capped; verifier verdicts for invented or duplicated ids and a self-declared "completed" status count for nothing; the verifier cannot raise severity; forged body fields (`uid`, `ownerBypass`, `credits`, `tier`, `limit`) and injected text cannot change who is charged or the free limit. |

Mutation checks (each reverted): removing the job owner check fails 2 IDOR tests; removing the workspace
`account_id` membership filter fails 5; letting the verifier raise severity fails 1.

## Observations (not vulnerabilities; lead's call)

1. A reused foreign analysis id returns **409**, not 403/404. It discloses only that the id exists, which
   requires already knowing a 128-bit-entropy id; no data or write.
2. Disabling only the DOCX declared-size check is still caught by the inflated-size check (`_document-extraction.ts:332`),
   so the bomb test cannot prove "without inflating"; it proves refusal within 5 s.
3. `/api/transcribe` echoes the client filename into `Transcript - <name>.pdf` without length bound or separator
   stripping. It is a client-side download label only (never a server path); hardening is optional.
4. S-09 still stands: `/api/analyze/job/:id` and `/api/admin/gemini-models` accept `x-admin-secret` when
   `ADMIN_SECRET` is configured.

## Other checks

- `npm audit`: 0 vulnerabilities (all and `--omit=dev`).
- Secret scan of new files: placeholders only.
- Existing adversarial suites re-run: `api/cloudflare-security-hardening.test.ts`, `tests/devin/adversarial-corpus.test.ts`.
