-- Migration 012: knowledge_records
-- node: 10
-- Incident memory with versioning and superseded markers

CREATE TABLE IF NOT EXISTS knowledge_records (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id           UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    status                TEXT NOT NULL DEFAULT 'candidate'
                              CHECK (status IN ('candidate','approved')),
    version               INT NOT NULL DEFAULT 1,
    superseded_by         UUID REFERENCES knowledge_records(id),
    original_symptom      TEXT NOT NULL,
    evidence_bundle_id    UUID REFERENCES evidence_bundles(id) ON DELETE SET NULL,
    tested_hypotheses     UUID[] NOT NULL DEFAULT '{}',
    successful_repair_id  UUID REFERENCES repair_candidates(id) ON DELETE SET NULL,
    rejected_repair_ids   UUID[] NOT NULL DEFAULT '{}',
    validation_run_id     UUID REFERENCES validation_runs(id) ON DELETE SET NULL,
    human_review_notes    TEXT,
    prevention_artifacts  TEXT[] NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_records_incident_id_idx ON knowledge_records(incident_id);
CREATE INDEX IF NOT EXISTS knowledge_records_status_idx ON knowledge_records(status);
