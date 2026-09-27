-- Migration 007: hypotheses
-- node: 04.03
-- Hypothesis adjudication state
-- CONSTRAINT: status must be one of exactly four permitted values

CREATE TABLE IF NOT EXISTS hypotheses (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id                     UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    claim                           TEXT NOT NULL,
    status                          TEXT NOT NULL DEFAULT 'Insufficient evidence'
                                        CHECK (status IN (
                                            'Supported',
                                            'Contradicted',
                                            'Reproduced within stated conditions',
                                            'Insufficient evidence'
                                        )),
    evidence_refs                   UUID[] NOT NULL DEFAULT '{}',
    contradicting_evidence_refs     UUID[] NOT NULL DEFAULT '{}',
    missing_evidence_types          TEXT[] NOT NULL DEFAULT '{}',
    alternative_explanations        TEXT[] NOT NULL DEFAULT '{}',
    experiment_requirements         TEXT[] NOT NULL DEFAULT '{}',
    is_duplicate                    BOOLEAN NOT NULL DEFAULT false,
    duplicate_of                    UUID REFERENCES hypotheses(id),
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hypotheses_incident_id_idx ON hypotheses(incident_id);
CREATE INDEX IF NOT EXISTS hypotheses_status_idx ON hypotheses(status);
