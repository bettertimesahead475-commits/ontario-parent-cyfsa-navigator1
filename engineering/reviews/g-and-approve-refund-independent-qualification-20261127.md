# Independent check: Migration G grant and approve-versus-refund race (PR #191 at dd9993b)

Checked by a second Devin session, which did not write PR #191. Local disposable PostgreSQL 17 plus a real
PostgREST binary only. Nothing hosted was touched.

## G grants the minimum

`payments_service_role_review_update.sql` is one statement:
`grant update (status, approved_at) on table public.payments to service_role;`

Every server-side write to `payments` stays inside that grant:

| Caller | Write | Columns |
|---|---|---|
| `approvePayment` | `pending -> approved`, and its rollback `approved -> pending` | `status`, `approved_at` |
| reject | `pending -> rejected` | `status` |
| `request-access.ts` | INSERT only (existing grant, unchanged by G) | none updated |

No code path updates `amount`, `plan`, `firebase_uid` or `reference_number`, and none deletes from `payments`.

**Unauthorized approval:** `anon` and `authenticated` get no privilege from G. Approval needs the `service_role`
key, which only the server holds, behind the admin token check on `/api/admin/*`. A customer claim leaves a pending
order pending (harness test).

## Results

| Run | Result |
|---|---|
| `payment-schema-qualification.pg.test.ts` + `cloudflare-admin-api.test.ts` + `tests/security/authz-bypass.test.ts` | 243/243 pass |
| G widened to `(status, approved_at, amount)` | caught: 1 test fails |
| G widened to `service_role, authenticated` | caught: 1 test fails |
| G widened to the whole table | caught: 1 test fails |
| Post-insert refund recheck in `approvePayment` disabled | caught: the race test fails on P and on P+D |

Each mutation was reverted afterwards, and the working tree was confirmed clean.

## Approve-versus-refund: remaining window considered

A customer cannot redeem the approval's code between its insert and the recheck, because the code is only returned to
the admin after the recheck. A purchase claim in that window either lands before the refund's audit record, so the
refund revokes the session, or lands after it and gets `ORDER_CLOSED`. No remaining path to a working code or session on a
refunded order was found.

If the recheck's own expiry PATCH fails, approval returns an error and the code row stays unexpired. Nobody receives
that code, so it cannot be redeemed. Accepted.

## Verdict

G is minimum-privilege and does not allow unauthorized approval. The approve-versus-refund fix closes the race. This
check does not replace Claude's independent qualification, which the owner requires before G is applied.
