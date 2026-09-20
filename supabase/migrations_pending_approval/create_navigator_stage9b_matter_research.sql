-- Stage 9B: Matter Legal Research Candidates
-- Stores the deterministic connections between matter evidence/events and legal sources.

CREATE TABLE IF NOT EXISTS navigator_matter_legal_research_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id UUID NOT NULL REFERENCES navigator_matters(id) ON DELETE CASCADE,
    evidence_item_id UUID REFERENCES navigator_evidence_items(id) ON DELETE SET NULL,
    event_id UUID REFERENCES navigator_events(id) ON DELETE SET NULL,
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
    content_integrity_status TEXT NOT NULL DEFAULT 'NOT_CHECKED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure idempotence
CREATE UNIQUE INDEX navigator_matter_legal_research_idempotence_idx ON navigator_matter_legal_research_candidates (
    matter_id,
    COALESCE(evidence_item_id, '00000000-0000-0000-0000-000000000000'),
    COALESCE(event_id, '00000000-0000-0000-0000-000000000000'),
    legal_source_id,
    COALESCE(provision_id, '00000000-0000-0000-0000-000000000000'),
    retrieval_basis
);

-- Enforce authorization exclusively via server-side service architecture
ALTER TABLE navigator_matter_legal_research_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON navigator_matter_legal_research_candidates FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON navigator_matter_legal_research_candidates TO service_role;
