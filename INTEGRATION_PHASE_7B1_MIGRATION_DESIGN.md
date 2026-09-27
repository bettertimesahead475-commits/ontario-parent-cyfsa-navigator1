# PHASE 7B1 — RECONCILED MIGRATION DESIGN & MANIFEST

> [!IMPORTANT]
> **Status:** PENDING INDEPENDENT REVIEW (SQL DESIGN ONLY — HARDENED CORRECTION PASS)  
> **Repository:** `bettertimesahead475-commits/ontario-parent-cyfsa-navigator1`  
> **Branch:** `integration/audited-rebuild-main-site`  
> **Authoritative Baseline SHA:** `f4ecf3bce225f2e464b5bc623ab9681ca594105c`  
> **Phase 7A Checkpoint Tag:** `integration/phase-7a-database-remediation-plan-v1`  
> **Production Supabase Project:** `qboidsfpjuxeqtfotryj` (`cyfsa-parent-platform.vercel.app`, `ACTIVE_HEALTHY`)  
> **Excluded Supabase Project:** `lrygsrwjjmonhzujckoq` (**NOT ACCESSED**)  
> **Execution Status:** `DATABASE MODIFIED: NO`, `MIGRATIONS APPLIED: 0`, `PRODUCTION CONFIG MODIFIED: NO`, `STAGING CREATED: NO`, `APPLICATION RUNTIME MODIFIED: NO`

---

## 1. Executive Summary & Design Scope

Phase 7B1 produces the exact reconciled SQL files required by the frozen Phase 7A database remediation architecture. Historical migration files are preserved unmodified as historical audit evidence. New pending-review SQL files have been created and hardened in `supabase/migrations_pending_approval/` following strict transactional, security, same-matter provenance, authority co-ownership, and cardinality standards.

---

## 2. Reconciled Migration Manifest

| Order | Migration File Name | Target Objects Created / Altered | Category / Status | Transaction Boundary | Security Model | Idempotency & Provenance Hardening |
| :---: | :--- | :--- | :---: | :---: | :---: | :--- |
| **1** | `create_professional_profiles.sql` | `public.professional_profiles` | **EXISTING APPROVED AS-IS** | `BEGIN...COMMIT` | RLS Enabled, `service_role` only | `CREATE TABLE` (Fails loudly on collision) |
| **2** | `create_lawyer_directory_foundation.sql` | `professional_office_locations`, `service_areas`, `practice_areas`, `sources` | **EXISTING APPROVED AS-IS** | `BEGIN...COMMIT` | RLS Enabled, `service_role` only | `CREATE TABLE` (Fails loudly on collision) |
| **3** | `create_professional_reviews.sql` | `public.professional_reviews` | **EXISTING APPROVED AS-IS** | `BEGIN...COMMIT` | RLS Enabled, `service_role` only | `CREATE TABLE` (Fails loudly on collision) |
| **4** | `phase7b_reconciled_professional_work_product_versions.sql` | `professional_work_product_versions` | **NEW HARDENED REPLACEMENT** | `BEGIN...COMMIT` | RLS Enabled, `service_role` only | `CREATE TABLE` (Explicit REVOKE/GRANT added) |
| **5** | `phase7b_reconciled_evidence_foundation.sql` | `navigator_evidence_items` | **NEW RECONCILED MIGRATION** | `BEGIN...COMMIT` | RLS Enabled, `service_role` only | `CREATE TABLE` (`CHECK(classification)`, `UNIQUE(id, matter_id)`) |
| **6** | `phase7b_reconciled_event_foundation.sql` | `navigator_events` | **NEW RECONCILED MIGRATION** | `BEGIN...COMMIT` | RLS Enabled, `service_role` only | `CREATE TABLE` (`CHECK(date_upper_bound >= date_lower_bound)`, `UNIQUE(id, matter_id)`) |
| **7** | `phase7b_reconciled_legal_authority_foundation.sql` | `navigator_legal_sources`, `_versions`, `_provisions` | **NEW RECONCILED MIGRATION** | `BEGIN...COMMIT` | RLS Enabled, `service_role` only | `CREATE TABLE` (Composite source uniqueness preserved) |
| **8** | `phase7b_reconciled_legal_corpus_versioning.sql` | `navigator_legal_provision_versions` | **NEW RECONCILED MIGRATION** | `BEGIN...COMMIT` | RLS Enabled, `service_role` only | `CREATE TABLE` (`UNIQUE(provision_id, version_id)`, SHA-256 hash) |
| **9** | `phase7b_reconciled_stage9b_candidates.sql` | `navigator_matter_legal_research_candidates` | **NEW RECONCILED MIGRATION** | `BEGIN...COMMIT` | RLS Enabled, `service_role` only | `CREATE TABLE` (Same-matter evidence/event FKs, source co-ownership FKs) |
| **10** | `phase7b_reconciled_stage9d_research.sql` | `navigator_matter_research_runs`, `_run_results`, `professional_reviews` check | **NEW RECONCILED MIGRATION** | `BEGIN...COMMIT` | RLS Enabled, `service_role` only | `CREATE TABLE` / ALTER check (Same-matter composite FKs) |

---

## 3. Detailed SQL Contract Review & Foreign Key Mapping

### 1. `phase7b_reconciled_professional_work_product_versions.sql`
* **Hardening:** Adds explicit `BEGIN; ... COMMIT;` transaction block and explicit server-only privilege block.

### 2. `phase7b_reconciled_evidence_foundation.sql`
* **Schema:** `navigator_evidence_items(id uuid PRIMARY KEY, matter_id uuid FK -> navigator_matters(id) ON DELETE CASCADE, classification text CHECK, created_at, updated_at)`. `UNIQUE(id, matter_id)`.
* **Hardening:** Adds explicit `CHECK (classification IN ('FACT', 'ALLEGATION', 'OPINION', 'PROFESSIONAL_ASSESSMENT', 'INFERENCE', 'UNVERIFIED_CLAIM', 'UNKNOWN'))` matching `shared/evidenceReview.ts`.

### 3. `phase7b_reconciled_event_foundation.sql`
* **Schema:** `navigator_events(id uuid PRIMARY KEY, matter_id uuid FK -> navigator_matters(id) ON DELETE CASCADE, date_lower_bound timestamptz, date_upper_bound timestamptz, date_precision text CHECK)`. `UNIQUE(id, matter_id)`.
* **Hardening:** Adds explicit `CHECK (date_lower_bound IS NULL OR date_upper_bound IS NULL OR date_upper_bound >= date_lower_bound)`.

### 4. `phase7b_reconciled_legal_authority_foundation.sql`
* **Schema:** `navigator_legal_sources`, `navigator_legal_source_versions`, `navigator_legal_provisions`.
* **Hardening:** Preserves `navigator_legal_version_source_identity UNIQUE(id, legal_source_id)` and `navigator_legal_provision_source_identity UNIQUE(id, legal_source_id)`.

### 5. `phase7b_reconciled_legal_corpus_versioning.sql`
* **Schema:** `navigator_legal_provision_versions` (`exact_text`, `normalized_text`, `text_sha256`).
* **Hardening:** Adds `UNIQUE (provision_id, legal_source_version_id)` guaranteeing the database structurally enforces runtime `.maybeSingle()` cardinality expectations in `legalSources.ts` and `matterLegalResearch.ts`. Preserves dual source-co-ownership composite FKs to `navigator_legal_provisions` and `navigator_legal_source_versions`.

### 6. `phase7b_reconciled_stage9b_candidates.sql`
* **Schema:** `navigator_matter_legal_research_candidates`.
* **Hardening:**
  1. Same-matter evidence FK: `(evidence_item_id, matter_id) REFERENCES navigator_evidence_items(id, matter_id) ON DELETE SET NULL (evidence_item_id)`. Prevents cross-matter evidence references while setting only `evidence_item_id` to NULL on delete.
  2. Same-matter event FK: `(event_id, matter_id) REFERENCES navigator_events(id, matter_id) ON DELETE SET NULL (event_id)`. Prevents cross-matter event references while setting only `event_id` to NULL on delete.
  3. Source-version co-ownership FK: `(legal_source_version_id, legal_source_id) REFERENCES navigator_legal_source_versions(id, legal_source_id)`. Guarantees version belongs to `legal_source_id`.
  4. Provision-source co-ownership FK: `(provision_id, legal_source_id) REFERENCES navigator_legal_provisions(id, legal_source_id)`. Guarantees provision belongs to `legal_source_id`.

### 7. `phase7b_reconciled_stage9d_research.sql`
* **Schema:** `navigator_matter_research_runs`, `navigator_matter_research_run_results`, and `professional_reviews.finding_type` check constraint extension (`LEGAL_RESEARCH_RESULT`).
* **Hardening:** Preserves same-matter composite FKs `(research_run_id, matter_id)` and `(candidate_id, matter_id)` referencing runs and candidates.

---

## 4. Static SQL Safety Review & Verification Queries

### Static Safety Audit Results
* **Destructive Data Operations (`DROP TABLE`, `TRUNCATE`, `DELETE`):** **NONE**
* **Existing Table Alterations:** Single safe `ALTER TABLE public.professional_reviews` to extend `finding_type` check constraint to include `'LEGAL_RESEARCH_RESULT'`.
* **SECURITY DEFINER Functions Added:** **NONE**
* **Browser Access Granted (`anon`/`authenticated`):** **NONE**
* **RLS Enabled:** **100% of new tables**
* **Server-Only Privileges:** `REVOKE ALL FROM public, anon, authenticated; GRANT SELECT, INSERT, UPDATE, DELETE TO service_role;` applied to all tables.

---

## 5. Isolated Staging Architecture Plan

> [!CAUTION]
> **Production Supabase (`qboidsfpjuxeqtfotryj`) MUST NOT be used for first write-based E2E certification.**

### Staging Environment Requirements
1. **Isolated Supabase Project:** A new, separate Supabase project (e.g. `cyfsa-staging-xxxx`) must be provisioned.
2. **Schema Mirroring:** Apply Production baseline schema (`20260910001952` + Stage 10 v4 RPCs) + Phase 7B remediation sequence to Staging.
3. **Zero Production Data:** Staging must contain no Production user accounts or matters.
4. **Isolated Vercel Preview Configuration:** Vercel Preview environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) will be pointed at Staging during write-based E2E certification.
5. **Clean Reset Support:** Staging allows full automated cleanup/reset between E2E test runs.

---

## 6. Repository Health & Verification

* **TypeScript Typecheck:** `npm run typecheck` / build checks passed.
* **Test Suite:** Existing test suite verified cleanly.
* **Build Verification:** Production Vite build verified.

---

## 7. Final Checkpoint Audit Statement

```text
DATABASE MODIFIED: NO
MIGRATIONS APPLIED: 0
PRODUCTION CONFIG MODIFIED: NO
APPLICATION RUNTIME MODIFIED: NO
STAGING CREATED: NO
READY FOR INDEPENDENT SQL REVIEW: YES
```
