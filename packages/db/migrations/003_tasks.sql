-- Migration 003: tasks
-- node: 03.03
-- Task coordination records

CREATE TABLE IF NOT EXISTS tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id     UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    task_type       TEXT NOT NULL,
    depends_on      UUID[] NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','completed','failed','cancelled','timed_out')),
    input_snapshot  JSONB,
    output          JSONB,
    attempt_count   INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 3,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    deadline_at     TIMESTAMPTZ,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_incident_id_idx ON tasks(incident_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
