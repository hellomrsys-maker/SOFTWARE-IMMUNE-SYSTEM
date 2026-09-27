-- Migration 014: reliability tables
-- node: 11.06
-- command_records: idempotent command deduplication
-- workflow_checkpoints: step-level restart recovery

CREATE TABLE IF NOT EXISTS command_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    command_id      TEXT NOT NULL UNIQUE,
    incident_id     UUID REFERENCES incidents(id) ON DELETE SET NULL,
    command_type    TEXT NOT NULL,
    result          JSONB,
    completed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS command_records_incident_id_idx ON command_records(incident_id);
CREATE INDEX IF NOT EXISTS command_records_command_type_idx ON command_records(command_type);

CREATE TABLE IF NOT EXISTS workflow_checkpoints (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id     UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    step_name       TEXT NOT NULL,
    step_index      INT NOT NULL,
    completed       BOOLEAN NOT NULL DEFAULT false,
    context         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(incident_id, step_name)
);

CREATE INDEX IF NOT EXISTS workflow_checkpoints_incident_id_idx ON workflow_checkpoints(incident_id);
CREATE INDEX IF NOT EXISTS workflow_checkpoints_step_index_idx ON workflow_checkpoints(incident_id, step_index);
