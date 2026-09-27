-- Migration 005: evidence_bundles and evidence_records
-- node: 02.05
-- Evidence collection output with gap tracking and checksums

CREATE TABLE IF NOT EXISTS evidence_bundles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id         UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    source_manifest     TEXT[] NOT NULL DEFAULT '{}',
    evidence_record_ids UUID[] NOT NULL DEFAULT '{}',
    collection_gaps     JSONB NOT NULL DEFAULT '[]',
    artifact_checksums  JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evidence_bundles_incident_id_idx ON evidence_bundles(incident_id);

CREATE TABLE IF NOT EXISTS evidence_records (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_id            UUID NOT NULL REFERENCES evidence_bundles(id) ON DELETE CASCADE,
    evidence_type        TEXT NOT NULL
                            CHECK (evidence_type IN (
                                'log','trace','metric','business_state',
                                'source_file','git_diff','test_result','document'
                            )),
    source_ref           TEXT NOT NULL,
    content_hash         TEXT NOT NULL,
    content              JSONB NOT NULL,
    original_timestamp   TIMESTAMPTZ NOT NULL,
    collection_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    clock_order_uncertain BOOLEAN NOT NULL DEFAULT false,
    redacted             BOOLEAN NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evidence_records_bundle_id_idx ON evidence_records(bundle_id);
CREATE INDEX IF NOT EXISTS evidence_records_type_idx ON evidence_records(evidence_type);
CREATE INDEX IF NOT EXISTS evidence_records_content_hash_idx ON evidence_records(content_hash);
