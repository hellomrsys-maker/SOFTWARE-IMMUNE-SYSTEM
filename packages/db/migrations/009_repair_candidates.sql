-- Migration 009: repair_candidates
-- node: 07

CREATE TABLE IF NOT EXISTS repair_candidates (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id                     UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    hypothesis_id                   UUID NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
    status                          TEXT NOT NULL DEFAULT 'proposed'
                                        CHECK (status IN ('proposed','authorized','applied','rejected','reverted')),
    diff_content                    TEXT NOT NULL,
    rationale                       TEXT NOT NULL,
    evidence_citations              UUID[] NOT NULL DEFAULT '{}',
    changed_files                   TEXT[] NOT NULL DEFAULT '{}',
    candidate_commit                TEXT,
    recovery_notes                  TEXT NOT NULL DEFAULT '',
    irreversible_effects            TEXT[] NOT NULL DEFAULT '{}',
    -- node: 07.05 — Code revert does NOT reverse a completed payment
    revert_does_not_reverse_payments BOOLEAN NOT NULL DEFAULT true,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS repair_candidates_incident_id_idx ON repair_candidates(incident_id);
CREATE INDEX IF NOT EXISTS repair_candidates_status_idx ON repair_candidates(status);
