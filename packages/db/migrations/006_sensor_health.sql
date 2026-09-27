-- Migration 006: sensor_health
-- node: 02.01.03
-- Sensor health tracking: last collection, latency, failure count

CREATE TABLE IF NOT EXISTS sensor_health (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sensor_type             TEXT NOT NULL UNIQUE,
    last_successful_at      TIMESTAMPTZ,
    last_collection_latency_ms BIGINT,
    failed_collection_count INT NOT NULL DEFAULT 0,
    missing_source_notified BOOLEAN NOT NULL DEFAULT false,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sensor_health_type_idx ON sensor_health(sensor_type);
