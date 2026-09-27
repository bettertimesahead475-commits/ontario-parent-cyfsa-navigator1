# PHASE 6 — LIVE DATABASE CONTRACT VERIFICATION & PREVIEW E2E READINESS

> [!IMPORTANT]
> **Status:** COMPLETED CHECKPOINT  
> **Repository:** `bettertimesahead475-commits/ontario-parent-cyfsa-navigator1`  
> **Branch:** `integration/audited-rebuild-main-site`  
> **Baseline SHA:** `31e4442ec4abbf4da1352607726f8ae75febf006`  
> **Production Supabase Project:** `qboidsfpjuxeqtfotryj` (`cyfsa-parent-platform.vercel.app`, Region: `ca-central-1`, Status: `ACTIVE_HEALTHY`)  
> **Excluded Supabase Project:** `lrygsrwjjmonhzujckoq` (**NOT ACCESSED**)  
> **Inspection Mode:** Authorized Read-Only Inspection  
> **Database Modifications:** `NONE` (`DATABASE MODIFIED: NO`, `MIGRATIONS APPLIED: 0`, `PRODUCTION CONFIG MODIFIED: NO`)

---

## 1. Executive Summary & Vercel Preview Identity

Independent authorized read-only inspection of Production (`qboidsfpjuxeqtfotryj`) and Vercel deployment metadata has verified that Stage 10 core tables and recipient-bound access lifecycle RPCs (contract `v4`) are active live in Production.

### Authoritative Vercel Identity
* **Vercel Project Name:** `cyfsanavigator`
* **Vercel Project ID:** `prj_wbNOXbsCWbj7vyu7JjxlXwt4WQpR`
* **Preview Deployment:** `dpl_9EveyHcNzmP4xkSAY2DPXfdaLaTZ`
* **Preview Git SHA:** `36f0258c60ef41c240a40aa52b91d91110b7428e`
* **Preview State:** `READY`
* **Preview Target Supabase Project:** `qboidsfpjuxeqtfotryj`
* **PREVIEW USES PRODUCTION DATABASE:** **YES**

> [!WARNING]
> Because the Vercel Preview environment targets the live Production Supabase instance (`qboidsfpjuxeqtfotryj`), **write-based Preview E2E testing was NOT performed** during Phase 6 to protect Production data integrity.

---

## 2. Verified Core Live Database Contract

The following core tables are confirmed present in the `public` schema with RLS enabled and verified constraints:

| Table Name | Schema | RLS Status | Verified Live Key / Foreign Key Constraints |
| :--- | :---: | :---: | :--- |
| `accounts` | `public` | Enabled | `id uuid PRIMARY KEY`, `firebase_uid text UNIQUE`, `primary_role text`, `email text`, `display_name text`, `status text`, `created_at`, `updated_at`. |
| `navigator_matters` | `public` | Enabled | `id uuid PRIMARY KEY`, `account_id uuid` (**FK `accounts.id`**), `client_id uuid` (**FK `clients.id`**), `title text`, `description text`. (*Uses `account_id`, NOT `owner_account_id`*). |
| `navigator_documents` | `public` | Enabled | `id uuid PRIMARY KEY`, `matter_id uuid` (**FK `navigator_matters.id`**), `display_name text`, `created_at`, `updated_at`. |
| `navigator_document_versions` | `public` | Enabled | `id uuid PRIMARY KEY`, `document_id uuid` (**FK `navigator_documents.id`**), `version_number int`, **`UNIQUE(document_id, version_number)`**. |
| `navigator_matter_members` | `public` | Enabled | `matter_id uuid` (**FK `navigator_matters.id`**), `account_id uuid` (**FK `accounts.id`**), **`UNIQUE(matter_id, account_id)`**, `role CHECK (OWNER / REVIEWER)`. |
| `navigator_matter_access_grants` | `public` | Enabled | `id uuid PRIMARY KEY`, `matter_id uuid` (**FK `navigator_matters.id`**), `grantor_account_id uuid` (**FK `accounts.id`**), `accepted_by_account_id uuid` (**FK `accounts.id`**), `revoked_by_account_id uuid` (**FK `accounts.id`**), `token_digest text` (**`UNIQUE`**, *NOT `invitation_digest`*), `recipient_email text CHECK`, `status CHECK (PENDING/ACCEPTED/REVOKED/EXPIRED)`, `capability CHECK (REVIEWER)`. |
| `navigator_matter_access_events` | `public` | Enabled | Audit log table, `event_sequence UNIQUE`, `UNIQUE(matter_id, idempotency_key)`. |
| `navigator_cases` | `public` | Enabled | Case management table with owner UID mapping. |
| `navigator_case_members` | `public` | Enabled | Case membership table with role check. |
| `navigator_paid_sessions` | `public` | Enabled | Paid session lifecycle table with active session constraints. |

---

## 3. Stage 10 Live Recipient-Bound Contract (`v4`)

* **STAGE 10 LIVE CONTRACT:** `COMPLETE`

The recipient-bound access lifecycle functions have been verified live in Production with strict security definer boundaries:

* **Active Lifecycle Contract Version:** `navigator_matter_access_lifecycle_contract_v4()` returning `'navigator_matter_access_lifecycle_v4'`
* **Verified RPC Functions:**
  * `create_recipient_bound_matter_grant(p_firebase_uid text, p_matter_id uuid, p_token_digest text, p_expires_in_days integer, p_recipient_email text)`
  * `accept_recipient_bound_matter_grant(p_firebase_uid text, p_token_digest text, p_verified_email text, p_email_verified boolean)`
  * `revoke_matter_grant(p_firebase_uid text, p_grant_id uuid)`
  * `create_navigator_matter_with_owner(p_firebase_uid text, p_primary_role text, p_client_id uuid, p_title text, p_description text, p_email text)`
  * `create_navigator_case_with_owner(p_owner_uid text, p_title text, p_description text)`
* **RPC Execution Privileges:**
  * `service_role EXECUTE:` **YES**
  * `anon EXECUTE:` **NO**
  * `authenticated EXECUTE:` **NO**
  * `SECURITY DEFINER:` **YES**
  * `search_path:` `public, pg_temp`

---

## 4. Final 28-Migration Classification

All 28 repository migration files in `supabase/migrations_pending_approval/` have been classified against verified live metadata and application runtime dependencies using the standard categories:
* **A** — LIVE CONTRACT PRESENT / EFFECTIVELY APPLIED
* **B** — LIVE CONTRACT PARTIALLY PRESENT
* **C** — LIVE CONTRACT ABSENT / REQUIRED (Pre-release database remediation required)
* **D** — NOT REQUIRED BY INTEGRATED APPLICATION
* **E** — SUPERSEDED BY LATER CONTRACT
* **F** — UNSAFE / REQUIRES MANUAL REVIEW
* **G** — CANNOT DETERMINE READ-ONLY

| # | Migration File Name | Expected Contract | Live Evidence | Runtime Dependency | Class | Reason |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| 1 | `create_accounts_foundation.sql` | `public.accounts` | Recorded in ledger `20260909232624`; table & constraints live. | [api/services/accounts.ts](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/api/services/accounts.ts) | **A** | Recorded in migration history ledger and verified live. |
| 2 | `create_case_ownership_foundation.sql` | `navigator_cases`, `navigator_case_members` | Recorded in ledger `20260909233412`; tables live. | Case management endpoints | **A** | Recorded in migration history ledger and verified live. |
| 3 | `create_lawyer_directory_foundation.sql` | `professional_office_locations`, `professional_service_areas`, `professional_practice_areas`, `professional_profile_sources` | Live Object Not Present | [api/services/lawyerDirectory.ts](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/api/services/lawyerDirectory.ts) queries these tables directly. | **C** | Live object absent and actively required by integrated lawyer directory runtime. |
| 4 | `create_navigator_case_ownership_foundation.sql` | `navigator_cases`, `create_navigator_case_with_owner` | Recorded in ledger `20260909233412`; RPC live. | Case creation endpoints | **A** | Recorded in migration history ledger and verified live. |
| 5 | `create_navigator_evidence_review.sql` | `navigator_evidence_review_items`, `navigator_chronology_events` | Live Object Not Present | Not queried in `api/`; runtime uses `professional_reviews`. | **E** | Superseded by later `professional_reviews` contract. |
| 6 | `create_navigator_legal_authority_foundation.sql` | `legal_corpus_documents`, `legal_corpus_chunks` | Live Object Not Present | Static/JSON datasets used; no runtime DB queries. | **D** | Not required by integrated application runtime. |
| 7 | `create_navigator_legal_corpus_versioning.sql` | Legal corpus versioning columns | Live Object Not Present | Static/JSON datasets used; no runtime DB queries. | **D** | Not required by integrated application runtime. |
| 8 | `create_navigator_m2a_intelligence_foundation.sql` | `navigator_m2a_intelligence` | Live Object Not Present | No runtime DB queries in `api/`. | **D** | Not required by integrated application runtime. |
| 9 | `create_navigator_m2c_claims_foundation.sql` | `navigator_claims_allegations`, `navigator_contradictions`, `navigator_corroborations`, `navigator_evidence_gaps` | Live Object Not Present | Runtime writes review findings to `professional_reviews`. | **E** | Superseded by later `professional_reviews` contract. |
| 10 | `create_navigator_m2d_intelligence_foundation.sql` | M2D relationship tables | Live Object Not Present | No runtime DB queries in `api/`. | **D** | Not required by integrated application runtime. |
| 11 | `create_navigator_m2e_intelligence_foundation.sql` | M2E monitoring views | Live Object Not Present | No runtime DB queries in `api/`. | **D** | Not required by integrated application runtime. |
| 12 | `create_navigator_matters_foundation.sql` | `navigator_matters`, `navigator_matter_members`, `create_navigator_matter_with_owner` | Recorded in ledger `20260910001952`; verified live with `account_id`. | [api/services/matters.ts](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/api/services/matters.ts) | **A** | Recorded in migration history ledger and verified live. |
| 13 | `create_navigator_matter_access_event_log.sql` | `navigator_matter_access_events` | Unrecorded in ledger; table & audit constraints verified live. | [api/services/matterAccessEvents.ts](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/api/services/matterAccessEvents.ts) | **A** | LIVE CONTRACT PRESENT / EFFECTIVELY APPLIED despite missing ledger entry. |
| 14 | `create_navigator_matter_access_grants.sql` | `navigator_matter_access_grants` | Unrecorded in ledger; table (`token_digest`, `recipient_email`) verified live. | [api/services/professionalMatterAccess.ts](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/api/services/professionalMatterAccess.ts) | **A** | LIVE CONTRACT PRESENT / EFFECTIVELY APPLIED despite missing ledger entry. |
| 15 | `create_navigator_matter_access_lifecycle_audit_v3.sql` | v3 lifecycle RPCs | Unrecorded in ledger; function verified live. | Superseded by v4 recipient-bound lifecycle RPCs. | **E** | Superseded by v4 recipient-bound migration. |
| 16 | `create_navigator_matter_access_lifecycle_recipient_v4.sql` | v4 recipient-bound lifecycle RPCs | Unrecorded in ledger; RPCs & SECURITY DEFINER settings verified live. | [api/services/professionalMatterAccess.ts](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/api/services/professionalMatterAccess.ts) | **A** | LIVE CONTRACT PRESENT / EFFECTIVELY APPLIED despite missing ledger entry. |
| 17 | `create_navigator_official_form_registry.sql` | `official_form_manifest`, `official_form_fields` | Live Object Not Present | Runtime uses local manifest in `officialFormSourceManifest.ts`. | **D** | Not required by integrated application runtime. |
| 18 | `create_navigator_page_evidence_foundation.sql` | `navigator_page_evidence` | Live Object Not Present | No runtime DB queries in `api/`. | **D** | Not required by integrated application runtime. |
| 19 | `create_navigator_paid_sessions.sql` | `navigator_paid_sessions` | Recorded in ledger `20260909231618`; table live with RLS. | Session management endpoints | **A** | Recorded in migration history ledger and verified live. |
| 20 | `create_navigator_stage9a_legal_source_extensions.sql` | Stage 9A source extensions | Live Object Not Present | No runtime DB queries in `api/`. | **D** | Not required by integrated application runtime. |
| 21 | `create_navigator_stage9b_matter_research.sql` | `navigator_research_queries`, `navigator_research_results` | Live Object Not Present | Runtime uses `navigator_matter_research_runs`. | **D** | Not required by integrated application runtime. |
| 22 | `create_navigator_stage9d1_research_foundation.sql` | `navigator_matter_research_runs` | Live Object Not Present | [api/services/matterResearchRuns.ts](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/api/services/matterResearchRuns.ts) queries this table. | **C** | Live object absent and actively required by legal research runs runtime. |
| 23 | `create_professional_profiles.sql` | `professional_profiles` | Live Object Not Present | [api/services/professionalProfiles.ts](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/api/services/professionalProfiles.ts) & `lawyerDirectory.ts` query it. | **C** | Live object absent and actively required by professional profile runtime. |
| 24 | `create_professional_reviews.sql` | `professional_reviews` | Live Object Not Present | [api/services/professionalWorkspace.ts](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/api/services/professionalWorkspace.ts) & `professionalOutputs.ts` query it. | **C** | Live object absent and actively required by professional review workspace. |
| 25 | `create_professional_work_product_versions.sql` | `professional_work_product_versions` | Live Object Not Present | [api/services/litigationWorkProduct.ts](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/api/services/litigationWorkProduct.ts) queries it. | **C** | Live object absent and actively required by work product versioning. |
| 26 | `enable_rls_free_usage_gmail_stale.sql` | RLS on `free_usage`, `gmail_processed_messages`, `stale_payment_alerts` | Recorded in ledger `20260909144539`; RLS verified live. | Free usage & email agent security | **A** | Recorded in migration history ledger and verified live. |
| 27 | `read_navigator_owned_matter.sql` | RPC `read_navigator_owned_matter` | Unrecorded in ledger; RPC verified live. | [api/services/matters.ts](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/api/services/matters.ts) | **A** | LIVE CONTRACT PRESENT / EFFECTIVELY APPLIED despite missing ledger entry. |
| 28 | `remediate_navigator_matter_access_grants_lifecycle.sql` | Stage 7B v2 remediation functions | Unrecorded in ledger | Superseded by v4 recipient-bound lifecycle RPCs. | **E** | Superseded by v4 recipient-bound migration. |

### Reconciliation Summary
* **A (LIVE CONTRACT PRESENT / EFFECTIVELY APPLIED):** `10`
* **B (LIVE CONTRACT PARTIALLY PRESENT):** `0`
* **C (LIVE CONTRACT ABSENT / REQUIRED):** `5`
* **D (NOT REQUIRED BY INTEGRATED APPLICATION):** `9`
* **E (SUPERSEDED BY LATER CONTRACT):** `4`
* **F (UNSAFE / REQUIRES MANUAL REVIEW):** `0`
* **G (CANNOT DETERMINE READ-ONLY):** `0`
* **Total Migrations:** `28`

---

## 5. Absent Runtime-Required Contracts & Stage Status

### Absent Runtime-Required Database Contracts (Category C)
The following 5 database migration suites are currently absent from Production but actively queried by application service endpoints:
1. `create_lawyer_directory_foundation.sql` (`professional_office_locations`, `professional_service_areas`, `professional_practice_areas`, `professional_profile_sources`)
2. `create_professional_profiles.sql` (`professional_profiles`)
3. `create_professional_reviews.sql` (`professional_reviews`)
4. `create_professional_work_product_versions.sql` (`professional_work_product_versions`)
5. `create_navigator_stage9d1_research_foundation.sql` (`navigator_matter_research_runs`)

### Overall Stage Contracts Status
* **STAGE 10 LIVE CONTRACT:** `COMPLETE`  
  All Stage 10 core tables and v4 recipient-bound RPCs are verified live with SECURITY DEFINER privileges.
* **STAGE 11 LIVE CONTRACT:** `PARTIAL`  
  Application integration routes and frontend components are functional, but underlying persistent tables (`professional_profiles`, `professional_reviews`, `professional_work_product_versions`) are absent in Production.
* **ANALYZER LIVE CONTRACT:** `PARTIAL`  
  Document analyzer runtime operates using live `navigator_documents` / `navigator_document_versions` tables, but `navigator_matter_research_runs` is absent in Production.

---

## 6. Production Security Advisor Audit

### 1. Server-Only RLS Architecture (18 Tables with RLS Enabled / 0 User Policies)
* **Tables:** `access_codes`, `accounts`, `clients`, `cyfsa_300rule_access_codes`, `free_tool_usage`, `free_usage`, `gmail_processed_messages`, `navigator_case_members`, `navigator_cases`, `navigator_document_versions`, `navigator_documents`, `navigator_matter_access_events`, `navigator_matter_access_grants`, `navigator_matter_members`, `navigator_matters`, `navigator_paid_sessions`, `stale_payment_alerts`, `submissions`.
* **Architecture Evaluation:** This application uses a server-only API gateway architecture (Express/Vercel serverless functions). Direct PostgREST requests from browser clients fail closed because zero user policies exist. Server-side service calls execute securely via `service_role` credentials or SECURITY DEFINER RPCs.

### 2. Legacy GraphQL Exposure (`pg_graphql_anon_table_exposed`: 20 WARN Findings)
* **Tables:** `access_codes`, `analysis_results`, `audit_log`, `case_exports`, `cases`, `cyfsa_300rule_access_codes`, `document_walkthroughs`, `documents`, `free_tool_usage`, `free_usage`, `gmail_processed_messages`, `lawyer_leads`, `lawyer_profiles`, `parent_profiles`, `payments`, `reflection_conversations`, `stale_payment_alerts`, `submissions`, `timeline_events`, `users`.
* **Classification:** **PRE-RELEASE SECURITY REVIEW REQUIRED**. Postgres `anon` role holds `SELECT` privileges on these legacy public tables. A pre-remediation audit in Phase 7 must determine whether any legacy frontend feature relies on anon SELECT before revoking grants.

---

## 7. Preview Safety & Smoke Check Protocol

### Prohibited Write-Based E2E Actions
Because Vercel Preview deployment (`dpl_9EveyHcNzmP4xkSAY2DPXfdaLaTZ`) targets the Production Supabase instance (`qboidsfpjuxeqtfotryj`), the following actions were **PROHIBITED and NOT PERFORMED**:
* Test user creation
* Matter creation
* Document uploads
* Grant creation or invitation acceptances
* Professional review writes
* Work product version writes
* Research job executions

### Safe Preview Smoke Checks Allowed
* Public static route rendering (homepage, pricing, statutory guide, CYFSA guide, child development guide, charter rights tab, family court tab)
* Privacy notice route rendering ([PrivacyNoticeTab.tsx](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/src/components/PrivacyNoticeTab.tsx))
* Sign-in page UI loading ([SignUpTab.tsx](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/src/components/SignUpTab.tsx) / [RequireAuth.tsx](file:///C:/Users/User/.gemini/antigravity/scratch/ontario-parent-cyfsa-navigator1/src/components/RequireAuth.tsx))
* Protected route unauthenticated redirect verification
* Analyzer UI layout rendering without database writes
* Professional workspace UI route rendering without review writes
* Invitation UI rendering with mock token without acceptance writes

---

## 8. Handoff to Phase 7 — Controlled Database Remediation

Phase 7 must execute the following remediation roadmap:
1. **Controlled Remediation Plan**: Plan the safe deployment of the 5 Category C migrations (`create_lawyer_directory_foundation.sql`, `create_professional_profiles.sql`, `create_professional_reviews.sql`, `create_professional_work_product_versions.sql`, `create_navigator_stage9d1_research_foundation.sql`).
2. **Dependency & Order Analysis**: Establish deployment order and check column compatibility before executing SQL against Production.
3. **Preview-Safe Database Testing Strategy**: Configure isolated staging environment or test-scoped fixtures for write-based E2E verification.
4. **Legacy GraphQL Exposure Review**: Perform pre-remediation audit of `anon` SELECT grants on the 20 legacy tables.
5. **Post-Remediation Preview E2E Certification**: Execute full E2E certification once staging isolation is active.

---

## 9. Final Checkpoint Audit Statement

```text
DATABASE MODIFIED: NO
MIGRATIONS APPLIED: 0
PRODUCTION CONFIG MODIFIED: NO
```
