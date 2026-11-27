# PR #191 settlement guard: proposed explicit form, 2026-11-27

Head reviewed: `dd9993b` (branch `devin/1795810535-approve-vs-refund` / PR #191). Devin owns the file `functions/api/admin/[[path]].ts`; this is a proposal, not an edit.

## Current behaviour (correct, but implicit)

- `settlementOf` returns `string | undefined` (`undefined` = no settlement record).
- Call sites use `.catch(() => null)`, so a read failure becomes `null`.
- Guard: `if (settled === 'refunded' || settled === null)` fails closed on refund or on unreadable history, and proceeds on `undefined`.

Result: behaviour is correct at both call sites (approval ~line 514, reissue ~line 570). The risk is that `null` is a sentinel the declared type cannot express. If a later change returns `null` for "no record", every ordinary approval is cancelled, and the type checker will not catch it.

## Proposed explicit form

```ts
type SettlementRead = string | undefined | 'unreadable';
const settled: SettlementRead = await settlementOf(env, reference, fetcher).catch(() => 'unreadable' as const);
if (settled === 'refunded' || settled === 'unreadable') {
  // cancel the code, as today
  // codeCancelled: settled === 'refunded' ? 'refunded' : 'refund-history-unreadable'
}
```

Apply the same change to both call sites. Acceptance: (1) an approval with no settlement record proceeds; (2) a refund record cancels with 409 `PAYMENT_REFUNDED`; (3) a thrown read cancels with 503 `ADMIN_AUDIT_UNAVAILABLE`; (4) unit tests cover all three branches. Behaviour is unchanged; only readability and type safety change.

## Status

- Not applied to Devin's branch (file owned by Devin). Devin to apply or decline.
- The concurrency behaviour itself (approve racing refund) still needs PostgreSQL 16 with two connections: **NOT TESTED** on this machine (no PostgreSQL, Docker or PostgREST).
