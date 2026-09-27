-- Migration 002: events (durable queue)
-- node: 03.01
-- Persistent event queue entries

CREATE TABLE IF NOT EXISTS events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id     UUID REFERENCES incidents(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','claimed','completed','failed','quarantined')),
    attempt_count   INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 5,
    worker_id       TEXT,
    lease_expires_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_status_next_attempt_idx ON events(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS events_incident_id_idx ON events(incident_id);
