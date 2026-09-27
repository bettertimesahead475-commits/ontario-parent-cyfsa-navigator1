# PHASE 7A — DATABASE REMEDIATION ARCHITECTURE PLAN (FINAL PLAN FREEZE)

> [!IMPORTANT]
> **Status:** FROZEN CHECKPOINT PLAN  
> **Repository:** `bettertimesahead475-commits/ontario-parent-cyfsa-navigator1`  
> **Branch:** `integration/audited-rebuild-main-site`  
> **Phase 6 Baseline SHA:** `f166b7f12f25352496ba82d1269e64d1efee5533`  
> **Phase 6 Tag:** `integration/phase-6-live-database-verification-v1`  
> **Production Supabase:** `qboidsfpjuxeqtfotryj` (`cyfsa-parent-platform.vercel.app`, `ACTIVE_HEALTHY`)  
> **Excluded Supabase:** `lrygsrwjjmonhzujckoq` (**NOT ACCESSED**)  
> **Execution Status:** `DATABASE MODIFIED: NO`, `MIGRATIONS APPLIED: 0`, `PRODUCTION CONFIGURATION MODIFIED: NO`, `WRITE-BASED E2E PERFORMED: NO`

---

## 1. Executive Summary & Historical Preservation

### Phase 7 Dependency-Discovery Correction to Phase 6
Phase 6 correctly recorded the directly identified runtime-required contracts based on its inspection scope. During Phase 7A, deeper runtime dependency tracing through the Stage 9B/9D legal-research persistence chain identified additional indirect prerequisites. Independent read-only Production verification subsequently confirmed those prerequisite objects are absent. The immutable Phase 6 checkpoint (`f166b7f12f25352496ba82d1269e64d1efee5533`) is preserved; Phase 7A expands the remediation scope.

### Independent Live Production Verification Results
An authorized read-only live Production metadata inspection (`qboidsfpjuxeqtfotryj`) has confirmed that **ALL SEVEN prerequisite objects are ABSENT live**:
* Checked: `7` | Present: `0` | Absent: `7`
* Verified Absent Tables:
  1. `navigator_legal_sources`
  2. `navigator_legal_source_versions`
  3. `navigator_legal_provisions`
  4. `navigator_legal_provision_versions`
  5. `navigator_evidence_items`
  6. `navigator_events`
  7. `navigator_matter_legal_research_candidates`

---

## 2. Minimum Current-Runtime Object Contract

The minimum current-runtime database object set consists strictly of the 13 objects required by active service code in `api/services/`:

1. `professional_profiles`
2. `professional_office_locations`, `professional_service_areas`, `professional_practice_areas`, `professional_profile_sources`
3. `professional_reviews`
4. `professional_work_product_versions`
5. `navigator_evidence_items`
6. `navigator_events`
7. `navigator_legal_sources`
8. `navigator_legal_source_versions`
9. `navigator_legal_provisions`
10. `navigator_legal_provision_versions`
11. `navigator_matter_legal_research_candidates`
12. `navigator_matter_research_runs`
13. `navigator_matter_research_run_results`

*Unused legacy tables (e.g. `navigator_legal_mappings`, `navigator_legal_source_snapshots`, `navigator_legal_provision_lineage`, `navigator_page_evidence`, `navigator_run_document_scope`, `navigator_m2a_intelligence`, `navigator_chronology_events`) are omitted from the active remediation set to prevent schema bloat.*

---

## 3. Final Remediation Strategy & Classification

### ORIGINAL MIGRATION USED AS-IS
* `create_professional_profiles.sql`
* `create_lawyer_directory_foundation.sql`
* `create_professional_reviews.sql`

### ORIGINAL MIGRATION REQUIRES HARDENING
* `create_professional_work_product_versions.sql`
  * **Required Hardening:** Add explicit `BEGIN; ... COMMIT;` transaction wrapper and explicit server-only privilege block:
    ```sql
    REVOKE ALL ON public.professional_work_product_versions FROM public, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_work_product_versions TO service_role;
    ```

### NEW RECONCILED MIGRATIONS REQUIRED
* Reconciled evidence foundation (`navigator_evidence_items`)
* Reconciled event foundation (`navigator_events`)
* Reconciled legal authority foundation (`navigator_legal_sources`, `_source_versions`, `_provisions`)
* Reconciled legal corpus versioning (`navigator_legal_provision_versions`)
* Reconciled Stage 9B candidate foundation (`navigator_matter_legal_research_candidates`)
* Reconciled Stage 9D research foundation (`navigator_matter_research_runs`, `_run_results`, review type check update)

### DO NOT DEPLOY AS-IS
* `create_navigator_page_evidence_foundation.sql`
* `create_navigator_m2a_intelligence_foundation.sql`
* `create_navigator_legal_authority_foundation.sql`
* `create_navigator_legal_corpus_versioning.sql`
* `create_navigator_stage9b_matter_research.sql`
* `create_navigator_stage9d1_research_foundation.sql`

---

## 4. Legal & Structural Provenance Invariants

The remediation architecture strictly preserves all platform legal trust invariants:
* Matter isolation (every matter-scoped table carries `matter_id uuid REFERENCES navigator_matters(id)` with same-matter composite FKs)
* Evidence identity (`navigator_evidence_items(id, matter_id)`)
* Event identity and event date precision (`date_lower_bound`, `date_upper_bound`, `date_precision`)
* Legal-source identity (`navigator_legal_sources(id)`)
* Legal-source version identity (`navigator_legal_source_versions(id, legal_source_id)`)
* Effective-date resolution semantics
* Legal-provision identity (`navigator_legal_provisions(id, legal_source_id)`)
* Legal-provision version identity and exact legal text/hash integrity (`text_sha256`)
* Verification state (`VERIFIED` checks)
* Source provenance URLs
* Candidate identity and candidate-to-matter identity (`navigator_matter_legal_research_candidates(id, matter_id)`)
* Research-run identity (`navigator_matter_research_runs(id, matter_id)`)
* Research-result-to-candidate identity (`candidate_id FK`)
* Professional review state (`professional_reviews.review_state`)

---

## 5. Final Topological Dependency Order

The 14-step dependency sequence derived strictly from FK and runtime constraints:

1. `professional_profiles`
2. `lawyer_directory` child tables (`professional_office_locations`, `service_areas`, `practice_areas`, `sources`)
3. `professional_reviews`
4. `professional_work_product_versions` (with security hardening block)
5. `navigator_evidence_items` (`UNIQUE(id, matter_id)`)
6. `navigator_events` (`UNIQUE(id, matter_id)`)
7. `navigator_legal_sources`
8. `navigator_legal_source_versions` (`UNIQUE(id, legal_source_id)`)
9. `navigator_legal_provisions` (`UNIQUE(id, legal_source_id)`)
10. `navigator_legal_provision_versions`
11. `navigator_matter_legal_research_candidates` (`UNIQUE(id, matter_id)`)
12. `navigator_matter_research_runs` (`UNIQUE(id, matter_id)`)
13. `navigator_matter_research_run_results`
14. `professional_reviews` constraint extension (`LEGAL_RESEARCH_RESULT`)

*Note: Phase 7B may combine logically related objects into fewer reconciled migration files provided this dependency order and transactional safety are strictly preserved.*

---

## 6. Staging Gate & Phase 7B Boundary

### Staging Gate
* Current Vercel Preview uses Production Supabase: **YES** (`qboidsfpjuxeqtfotryj`)
* **PRODUCTION DATABASE SUITABLE FOR FIRST WRITE-BASED E2E: NO**
* **DEDICATED STAGING REQUIRED: YES**
* Phase 7B must design/configure an isolated staging environment before any write-based E2E certification. No staging project is created during Phase 7A.

### Phase 7B Boundary Statement
Phase 7B is authorized to begin after this checkpoint is independently verified. Its scope is restricted to **RECONCILED MIGRATION DESIGN + ISOLATED STAGING PREPARATION**. Phase 7B does NOT authorize Production deployment. Production application requires a separate explicit gate after migration review, staging execution, security advisor audit, write-based staging E2E certification, and rollback/forward-fix verification.

---

## 7. Final Checkpoint Audit Statement

```text
DATABASE MODIFIED: NO
MIGRATIONS APPLIED: 0
PRODUCTION CONFIGURATION MODIFIED: NO
PROVENANCE FKS REMOVED: NO
READY FOR PHASE 7B: YES
```
