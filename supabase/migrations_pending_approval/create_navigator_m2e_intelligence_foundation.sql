-- Migration for M2-E Intelligence Foundation

CREATE TABLE navigator_evidence_gap_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id UUID NOT NULL REFERENCES navigator_matters(id),
  category TEXT NOT NULL CHECK (category IN (
    'SUPPORT_GAP', 'INDEPENDENCE_GAP', 'SOURCE_GAP', 'DATE_GAP', 
    'ACTOR_GAP', 'LOCATION_GAP', 'UNRESOLVED_CONFLICT', 
    'UNRESOLVED_CLAIM_EVOLUTION', 'ATTRIBUTION_GAP', 
    'EVIDENCE_QUALITY_REVIEW', 'UNANSWERED_QUESTION', 
    'HUMAN_REVIEW_REQUIRED'
  )),
  materiality TEXT NOT NULL CHECK (materiality IN ('LOW', 'MEDIUM', 'HIGH')),
  state TEXT NOT NULL CHECK (state IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED', 'SUPERSEDED')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  is_stale BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE navigator_evidence_gap_dependencies (
  finding_id UUID NOT NULL REFERENCES navigator_evidence_gap_findings(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN ('CLAIM', 'EVENT', 'RELATIONSHIP', 'ATTRIBUTION', 'SOURCE', 'ACTOR', 'LOCATION')),
  dependency_id TEXT NOT NULL,
  PRIMARY KEY (finding_id, dependency_type, dependency_id)
);

CREATE TABLE navigator_unanswered_questions (
  finding_id UUID PRIMARY KEY REFERENCES navigator_evidence_gap_findings(id) ON DELETE CASCADE,
  question TEXT NOT NULL
);

CREATE TABLE navigator_case_intelligence_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id UUID NOT NULL REFERENCES navigator_matters(id),
  snapshot_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE navigator_evidence_gap_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE navigator_evidence_gap_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE navigator_unanswered_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE navigator_case_intelligence_snapshots ENABLE ROW LEVEL SECURITY;
