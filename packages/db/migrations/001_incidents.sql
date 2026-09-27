-- Migration 001: incidents table
-- node: 03.02
-- Incident state machine records

CREATE TABLE IF NOT EXISTS incidents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint     TEXT NOT NULL UNIQUE,
    state           TEXT NOT NULL DEFAULT 'created'
                        CHECK (state IN (
                            'created','observing','diagnosing','reproducing',
                            'repairing','validating','review_ready',
                            'rejected','escalated','abstained'
                        )),
    repository_path TEXT NOT NULL,
    failure_report  TEXT NOT NULL,
    metadata        JSONB,
    active_repair_lease_id UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incidents_state_idx ON incidents(state);
CREATE INDEX IF NOT EXISTS incidents_created_at_idx ON incidents(created_at);
