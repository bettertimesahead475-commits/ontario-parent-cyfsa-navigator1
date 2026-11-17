# Casework source integrity and requirements export

This change is a partial implementation of the Casework master prompt. It does not complete the automatic Analyzer-to-Casework pipeline.

## Implemented

- Analyzer requirement imports verify quotations against `navigator_document_pages` for an explicitly selected, ownership-validated document version and page. Browser `documentText` is ignored.
- The document lookup uses the existing `display_name` column. Version ownership follows the validated parent document; it does not query a nonexistent version `matter_id` column.
- Invalid, ambiguous, and impossible calendar dates are rejected. Inferred deadlines are accepted only when the submitted ISO value appears in the source quotation. Imported requirements remain PROPOSED.
- Stable primary keys include matter, document, version, page, quotation and normalized title. Concurrent imports and partial retries cannot overwrite human review. Similarly titled claims from different sources remain separate.
- Rejected candidates are counted, database read/write failures are reported as recoverable errors, and audit failures are reported for imports and exports. Sensitive database errors are not logged by these new paths.
- Dispute responses strip lawyer-only notes for parents. Parent updates cannot overwrite professional notes. Unknown membership roles are rejected.
- Requirement updates emit audit events containing field names and review transitions, without copying private notes.
- A matter-authorized requirements/compliance export includes recorded authority types, review/dispute states, deadlines, source/version/page references, original quotations, actions and evidence-link identifiers. Explicit field selection and formatting exclude lawyer-only notes. Pagination prevents truncation at the API row limit; authorization is checked again before returning data.
- The existing workspace provides a download button and describes the legacy manual import accurately: importing does not rescan a document.

## Main files

- `api/services/analyzerRequirementExtractor.ts`
- `api/services/caseActionWorkspace.ts`
- `api/services/caseworkExport.ts`
- `api/caseActionWorkspaceRoutes.ts`
- `src/components/CaseActionWorkspace.tsx`
- Regression tests in `api/services/analyzerRequirementExtractor.test.ts` and `api/services/caseActionWorkspace.test.ts`.

No schema migrations were created or applied.

## Verification

- `npm ci --ignore-scripts --cache /workspace/work/npm-cache --loglevel error` — passed. The initial install with the default home cache failed because that cache was not writable; retrying with a workspace cache succeeded.
- `npm test` — 263 test files passed, 13 skipped; 4,177 tests passed, 478 skipped. This full run preceded the final concurrency, partial-retry and pagination regression additions.
- `npm test -- api/services/analyzerRequirementExtractor.test.ts api/services/caseActionWorkspace.test.ts api/services/caseActionBatch4.test.ts` — final focused run: 47 tests passed across three files.
- `npm run lint` — passed.
- `npm run build` — passed; Vite reported bundle-size warnings.
- `git diff --check` — passed.

These are fixture/mocked service tests and local build checks, not verification against production customer data or a browser-driven end-to-end flow. No billable AI requests or customer scans were made.

## Deployment findings (read-only, 2026-11-17)

- Recovery branch: `genspark/forensic-analyzer-recovery` at `d1bbfcbeceaea07bb8108de5a6ec14eca29f0be5`.
- Cloudflare Pages project: `cyfsa-navigator-git-staging`.
- Configured production branch: `migration/cloudflare-staging-20261029`.
- Canonical deployment: `a84ece81a5bcaa20516106fb8632ad987565b48b`, URL `https://e62bcbbd.cyfsa-navigator-git-staging.pages.dev`.
- Git production deployments are disabled; preview branch deployments are enabled. Build command is `npx vite build`, output `dist`.
- Staging schema metadata confirms that `navigator_document_pages` is absent, document names use `display_name`, versions have no `matter_id`, and `navigator_events` lacks the actor/event-type/payload columns expected by the existing Casework audit writer.
- Production schema inspection failed with a database password-authentication error. No database writes were attempted.
- Existing Casework Express routes are not native Pages Functions. The generic Pages API bridge requires a separately configured backend origin; the inspected preview/production environment-variable name lists did not include `STAGING_API_ORIGIN`.

## Remaining work and release gates

The following master-prompt requirements remain unimplemented in this change:

1. Persist original uploads and source pages through one compatible, matter-scoped repository and retention policy; resolve the differences between the legacy page-evidence draft and the deployed reconciled schema.
2. Persist document/version/report/job associations and synchronization status; connect every successful single, bulk and recovered job completion to an automatic, deterministic import, including historical report migration.
3. Add the complete evidence register, consolidated timeline, two-sided contradiction links, missing-document workflow, full overview counts and original-document opening.
4. Complete finding review/correction history, source-preserving edits and comprehensive audit storage. Current staging lacks required audit columns.
5. Add timeline, evidence-index, contradiction and lawyer-brief exports. This change supplies only the requirements/compliance report.
6. Supply compatible Cloudflare API routing and verified staging configuration, with additive schema migrations and end-to-end integration/browser tests.
7. Reverify production schema access and apply a reviewed rollout before any production promotion.

The import intentionally fails closed with SOURCE_UNAVAILABLE when stored source pages are missing. Export history reports failure rather than claiming an audit row was saved. This branch is not ready for production promotion, and it must not be described as completing Casework.
