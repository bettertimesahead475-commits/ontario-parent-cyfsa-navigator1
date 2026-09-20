-- Stage 9B: Matter Legal Research Candidates
-- Stores the deterministic connections between matter evidence and legal sources.

CREATE TABLE IF NOT EXISTS navigator_matter_legal_research_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id UUID NOT NULL REFERENCES navigator_matters(id) ON DELETE CASCADE,
    evidence_item_id UUID REFERENCES navigator_evidence_items(id) ON DELETE SET NULL,
    evidence_classification TEXT,
    legal_source_id UUID NOT NULL REFERENCES navigator_legal_sources(id),
    legal_source_version_id UUID REFERENCES navigator_legal_source_versions(id),
    provision_id UUID REFERENCES navigator_legal_provisions(id),
    authority_identifier TEXT,
    reason_for_relevance TEXT NOT NULL,
    retrieval_basis TEXT NOT NULL,
    effective_date_context TEXT,
    source_provenance TEXT,
    confidence NUMERIC,
    review_state TEXT NOT NULL DEFAULT 'UNREVIEWED',
    content_integrity_status TEXT NOT NULL DEFAULT 'NOT_CHECKED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE navigator_matter_legal_research_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Matter members can read research candidates"
ON navigator_matter_legal_research_candidates
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM navigator_matter_members m
    WHERE m.matter_id = navigator_matter_legal_research_candidates.matter_id
      AND m.account_id = auth.uid()
  )
);

CREATE POLICY "Matter owners and reviewers can manage research candidates"
ON navigator_matter_legal_research_candidates
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM navigator_matter_members m
    WHERE m.matter_id = navigator_matter_legal_research_candidates.matter_id
      AND m.account_id = auth.uid()
      AND m.role IN ('OWNER', 'REVIEWER')
  )
);
