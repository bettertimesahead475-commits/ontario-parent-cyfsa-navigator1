CREATE TABLE professional_work_product_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id UUID NOT NULL REFERENCES navigator_matters(id) ON DELETE CASCADE,
    reviewer_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    work_product_type TEXT NOT NULL CHECK (work_product_type = 'CASE_BRIEF'),
    version_number INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status = 'FINALIZED'),
    snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finalized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(matter_id, reviewer_account_id, work_product_type, version_number)
);

ALTER TABLE professional_work_product_versions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_prof_wp_versions_matter_reviewer ON professional_work_product_versions(matter_id, reviewer_account_id);
