-- Migration 011: approval_records
-- node: 09.03
-- Human review decisions with invalidation support

CREATE TABLE IF NOT EXISTS approval_records (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id          UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    repair_candidate_id  UUID NOT NULL REFERENCES repair_candidates(id) ON DELETE CASCADE,
    validation_run_id    UUID NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    reviewer_id          TEXT NOT NULL,
    decision             TEXT NOT NULL CHECK (decision IN ('approved','rejected','revision_requested')),
    notes                TEXT,
    -- node: 09.03 — Approval applies to tested commit; changes after approval invalidate it
    approved_commit      TEXT NOT NULL,
    invalidated          BOOLEAN NOT NULL DEFAULT false,
    invalidated_reason   TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approval_records_incident_id_idx ON approval_records(incident_id);
CREATE INDEX IF NOT EXISTS approval_records_repair_candidate_id_idx ON approval_records(repair_candidate_id);
