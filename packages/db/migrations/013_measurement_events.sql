-- Migration 013: measurement_events
-- node: 12.04
-- Timing and effort records for system evaluation

CREATE TABLE IF NOT EXISTS measurement_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id      UUID REFERENCES incidents(id) ON DELETE CASCADE,
    metric_name      TEXT NOT NULL,
    metric_value     NUMERIC NOT NULL,
    unit             TEXT NOT NULL,
    context          JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS measurement_events_incident_id_idx ON measurement_events(incident_id);
CREATE INDEX IF NOT EXISTS measurement_events_metric_name_idx ON measurement_events(metric_name);
