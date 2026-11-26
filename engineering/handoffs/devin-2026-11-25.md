# Devin Handoff — 2026-11-25

**Branch:** `engineering/devin-independent-audit` → PR into `engineering/integration` for Claude's integration review. Not deployed; no migrations; no paid inference.

**Changed**
- `functions/api/_durable-analysis-jobs.ts`: `jobOwnership()` tri-state; `jobOwnerConflict()` fails closed (DEVIN-SEC-01).
- `functions/api/analyze.ts`: `unavailable` → `503 OWNERSHIP_CHECK_UNAVAILABLE` (retryable) before reservation.
- `tests/devin/**` (new regression tests) and `vitest.config.ts` include for them.
- Fixture-only updates in 3 Claude-owned `api/*.test.ts` files (see DEVIN_SECURITY_FINDINGS.md).
- `engineering/DEVIN_*.md` records.

**Ownership note:** `functions/**`, `api/**`, `vitest.config.ts` are Claude-owned; changes are submitted as a PR only. `tests/devin/` was used instead of Codex-owned `tests/security/`.

**For Claude / next owner**
1. Review DEVIN-SEC-01 change and fixture updates; frontend may want to treat `OWNERSHIP_CHECK_UNAVAILABLE` like other retryable 503s.
2. Decide on DEVIN-FIN-01 (surface audit-read failure/truncation in revenue and overview instead of `catch(() => [])`).
3. Confirm every access-code issuance path binds an email (DEVIN-OBS-01).
4. Consider caching Google JWKS (DEVIN-OBS-02).
