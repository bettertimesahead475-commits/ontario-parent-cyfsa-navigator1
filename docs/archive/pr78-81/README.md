# Archived documentation from closed PRs #78–#81

These documents were written on the stacked branches feat/integrate-69-chain, feat/post-audit-remediation, feat/staging-readiness and feat/security-hardening-prep. Those branches predate the production fixes on main (including the payment idempotency fix in #89 and the customer redaction fixes in #87 and #88), so the code on them must not be merged.

They are kept here only as reference for their findings and requirements. Nothing in this directory is applied, and nothing in it changes production permissions or the database.

Specifically:
- The SQL proposals (including revoke_api_role_grants.sql and the evidence schema proposals) remain only on their branches. They have not been applied and need separate written approval, with a tested rollback, before any use.
- Verdicts in these documents describe the stale stack, not current main.
