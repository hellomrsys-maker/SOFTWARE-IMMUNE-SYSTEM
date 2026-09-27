-- Migration 014: schema_migrations (runner state table)
-- node: 11.02
-- Tracks which migrations have been applied (hand-rolled runner)

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
