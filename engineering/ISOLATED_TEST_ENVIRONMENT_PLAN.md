# Future isolated test environment (plan only; nothing provisioned)

Owner direction, 2026-11-27 15:01: Preview keeps its current credentials and stays not-ready. Development branches must not get
unrestricted access to the operational database or to paid AI credentials. This file records the target design. It must not be
provisioned, and no cost may be incurred, without separate owner approval.

## Why Preview cannot be used today

- Preview builds every branch (`preview_deployment_setting: all`).
- Preview's `STAGING_SUPABASE_URL` points at the operational ledger `nxfhvebzzobegubefcda`.
- Valid Preview keys would therefore give every agent branch the live service-role key and the paid Anthropic and Gemini keys.
- Root cause and evidence: `engineering/reviews/preview-analyzer-readiness-root-cause-20261127.md`.

## Target design

| Concern | Design |
|---|---|
| Database | A separate Supabase project holding synthetic data only, built from `supabase/migrations` and the release's pending migrations. The org is on the Free plan, which allows 2 active projects, and both slots are in use (`nxfh…`, `qboid…`; two more projects are paused). A third project needs a paid plan or a freed slot: owner decision. |
| Cloudflare | Either a second Pages project, or the existing project with Preview builds restricted to `release/rc-*` (`preview_deployment_setting: custom`). Preview variables point only at the test project. |
| AI keys | Separate Anthropic workspace and Gemini project keys with hard monthly spend limits set at the provider. Never the production keys. |
| Firebase | A test Firebase project, or the production project with test accounts only. No customer accounts. |
| Admin | A separate `ADMIN_SECRET` for Preview. The production value is never reused. |
| Email | Outbox flag off. If it is ever turned on, the allowlist holds test addresses only. |
| Data | Synthetic documents only. Each run is recorded in `TEST_REGISTER.md` with its cost. |

## Until then

- Releases are qualified with disposable PostgreSQL, the PostgREST harness (#188), mocked inference and `wrangler pages dev`.
- Paid acceptance, if authorized, runs once on production after deployment, with a test account, under the cap in the release approval checklist.
