-- node: 11.02 — Persistence layer — full schema migration
-- Migration: 001_initial_schema
-- Creates all SIS platform tables with FK constraints, indexes, and timestamps.

-- ─── Utility ──────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Section 01 — Managed Application tables ─────────────────────────────────

-- node: 01.01.02 — Order-state manager
CREATE TABLE orders (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    status        TEXT        NOT NULL CHECK (status IN ('pending', 'attempted', 'confirmed', 'uncertain_outcome')),
    amount        NUMERIC(19,4) NOT NULL CHECK (amount > 0),
    currency      TEXT        NOT NULL,
    customer_id   TEXT        NOT NULL,
    metadata      JSONB       NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- node: 01.01.03 — Payment client attempts
CREATE TABLE payment_attempts (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id          UUID        NOT NULL REFERENCES orders(id),
    idempotency_key   TEXT,                         -- NULL in defect state (intentional bug)
    request_payload   JSONB       NOT NULL,
    status            TEXT        NOT NULL CHECK (status IN ('pending', 'success', 'timeout', 'error')),
    response_payload  JSONB,
    attempted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ
);
CREATE INDEX payment_attempts_order_id_idx ON payment_attempts(order_id);

-- node: 01.02.03 — Payment simulator persistence
CREATE TABLE payments (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    logical_id          TEXT        NOT NULL,       -- scoped to caller+orderId
    idempotency_key     TEXT        NOT NULL,
    caller_id           TEXT        NOT NULL,
    operation           TEXT        NOT NULL,
    amount              NUMERIC(19,4) NOT NULL CHECK (amount > 0),
    currency            TEXT        NOT NULL,
    request_fingerprint TEXT        NOT NULL,
    status              TEXT        NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
    result_payload      JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (caller_id, idempotency_key)
);
CREATE INDEX payments_logical_id_idx ON payments(logical_id);
CREATE INDEX payments_caller_id_idx ON payments(caller_id);

-- node: 01.03 — Fault injection configuration
CREATE TABLE fault_configs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    fault_type   TEXT        NOT NULL,
    config       JSONB       NOT NULL DEFAULT '{}',
    active       BOOLEAN     NOT NULL DEFAULT false,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Section 03 — Transport and Control tables ────────────────────────────────

-- node: 03.01 — Durable event queue
CREATE TABLE events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    topic           TEXT        NOT NULL,
    payload         JSONB       NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'claimed', 'acked', 'nacked', 'quarantined')),
    attempt_count   INTEGER     NOT NULL DEFAULT 0,
    max_attempts    INTEGER     NOT NULL DEFAULT 5,
    lease_token     UUID,
    lease_expires   TIMESTAMPTZ,
    error_message   TEXT,
    scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at      TIMESTAMPTZ,
    acked_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_status_scheduled_idx ON events(status, scheduled_at) WHERE status = 'pending';
CREATE INDEX events_topic_idx ON events(topic);

-- node: 03.02 — Incident state machine
CREATE TABLE incidents (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint         TEXT        NOT NULL UNIQUE,   -- deduplication key
    status              TEXT        NOT NULL DEFAULT 'created'
                        CHECK (status IN (
                            'created', 'observing', 'diagnosing', 'reproducing',
                            'repairing', 'validating', 'review_ready',
                            'rejected', 'escalated', 'abstained'
                        )),
    title               TEXT        NOT NULL,
    failure_report      JSONB       NOT NULL,
    repository_path     TEXT        NOT NULL,
    actor_id            TEXT        NOT NULL,
    retry_count         INTEGER     NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- node: 03.02 — Incident state transition log
CREATE TABLE incident_transitions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id     UUID        NOT NULL REFERENCES incidents(id),
    from_status     TEXT        NOT NULL,
    to_status       TEXT        NOT NULL,
    actor_id        TEXT        NOT NULL,
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX incident_transitions_incident_idx ON incident_transitions(incident_id);

-- node: 03.03 — Task coordination
CREATE TABLE tasks (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id     UUID        NOT NULL REFERENCES incidents(id),
    task_type       TEXT        NOT NULL,
    depends_on      UUID[]      NOT NULL DEFAULT '{}',
    input_snapshot  JSONB       NOT NULL,
    output          JSONB,
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    attempt_count   INTEGER     NOT NULL DEFAULT 0,
    max_attempts    INTEGER     NOT NULL DEFAULT 3,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_incident_id_idx ON tasks(incident_id);

-- node: 03.04 — Authorization engine decisions
CREATE TABLE authorization_decisions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id     UUID        REFERENCES incidents(id),
    actor_id        TEXT        NOT NULL,
    permission_type TEXT        NOT NULL,    -- read | workspace_write | approved_command | network | approval
    resource        TEXT        NOT NULL,
    decision        TEXT        NOT NULL CHECK (decision IN ('allowed', 'denied')),
    reason          TEXT,
    -- IMPORTANT: denial record is written atomically BEFORE the denial is returned.
    -- This ensures no agent-generated instruction can bypass authorization (Rule 4).
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_decisions_incident_idx ON authorization_decisions(incident_id);
CREATE INDEX auth_decisions_actor_idx ON authorization_decisions(actor_id);

-- ─── Section 02 — Observation tables ─────────────────────────────────────────

-- node: 02.01.03 — Sensor health tracking
CREATE TABLE sensor_health (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sensor_id           TEXT        NOT NULL,
    source_type         TEXT        NOT NULL,
    last_success_at     TIMESTAMPTZ,
    last_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    consecutive_failures INTEGER    NOT NULL DEFAULT 0,
    last_error          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sensor_id)
);

-- node: 02.05.06 — Evidence bundles
CREATE TABLE evidence_bundles (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id     UUID        NOT NULL REFERENCES incidents(id),
    source_manifest JSONB       NOT NULL,
    collection_gaps JSONB       NOT NULL DEFAULT '[]',
    checksums       JSONB       NOT NULL DEFAULT '{}',
    artifact_path   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX evidence_bundles_incident_idx ON evidence_bundles(incident_id);

-- node: 02.05.06 — Individual evidence records within a bundle
CREATE TABLE evidence_records (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_id             UUID        NOT NULL REFERENCES evidence_bundles(id),
    record_type           TEXT        NOT NULL,   -- log | trace | metric | repository | document
    source_reference      JSONB       NOT NULL,   -- file, line, service, commit
    original_timestamp    TIMESTAMPTZ,
    collection_timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
    clock_order_uncertain BOOLEAN     NOT NULL DEFAULT false,
    content_hash          TEXT        NOT NULL,   -- SHA-256 for deduplication
    payload               JSONB       NOT NULL,   -- redacted content
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX evidence_records_bundle_idx ON evidence_records(bundle_id);
CREATE INDEX evidence_records_content_hash_idx ON evidence_records(content_hash);

-- ─── Section 04 — Diagnostic tables ──────────────────────────────────────────

-- node: 04.03 — Hypotheses
CREATE TABLE hypotheses (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id         UUID        NOT NULL REFERENCES incidents(id),
    title               TEXT        NOT NULL,
    description         TEXT        NOT NULL,
    evidence_refs       UUID[]      NOT NULL DEFAULT '{}',   -- references to evidence_records
    status              TEXT        NOT NULL DEFAULT 'Insufficient evidence'
                        CHECK (status IN (
                            'Supported',
                            'Contradicted',
                            'Reproduced within stated conditions',
                            'Insufficient evidence'
                        )),
    contradiction_refs  UUID[]      NOT NULL DEFAULT '{}',
    alternative_explanations JSONB NOT NULL DEFAULT '[]',
    experiment_requirements JSONB  NOT NULL DEFAULT '[]',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hypotheses_incident_idx ON hypotheses(incident_id);

-- ─── Section 06 — Reproduction tables ────────────────────────────────────────

-- node: 06.05 — Regression test artifacts
CREATE TABLE regression_tests (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id         UUID        NOT NULL REFERENCES incidents(id),
    hypothesis_id       UUID        REFERENCES hypotheses(id),
    test_file_content   TEXT        NOT NULL,
    content_hash        TEXT        NOT NULL,     -- SHA-256 of test file content
    baseline_failure_verified BOOLEAN NOT NULL DEFAULT false,
    -- Rule 15: generator throws if baseline_failure_verified is false at storage time
    execution_evidence  JSONB       NOT NULL DEFAULT '{}',
    reproduction_command TEXT       NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- node: 06.01 — Experiment specifications
CREATE TABLE experiments (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id             UUID        NOT NULL REFERENCES incidents(id),
    hypothesis_id           UUID        REFERENCES hypotheses(id),
    spec                    JSONB       NOT NULL,
    environment_manifest    JSONB,
    causal_conclusion       JSONB,
    status                  TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    worktree_path           TEXT,
    schema_name             TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Section 07 — Repair tables ───────────────────────────────────────────────

-- node: 07.01 — Repair candidates
CREATE TABLE repair_candidates (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id         UUID        NOT NULL REFERENCES incidents(id),
    hypothesis_id       UUID        REFERENCES hypotheses(id),
    regression_test_id  UUID        REFERENCES regression_tests(id),
    candidate_commit    TEXT,
    diff_artifact_path  TEXT,
    rationale           TEXT        NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'authorized', 'rejected', 'applied')),
    rejection_reason    TEXT,
    recovery_plan       JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Section 08 — Validation tables ──────────────────────────────────────────

-- node: 08.01 — Validation run identity binding
CREATE TABLE validation_runs (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id             UUID        NOT NULL REFERENCES incidents(id),
    repair_candidate_id     UUID        REFERENCES repair_candidates(id),
    identity_hash           TEXT        NOT NULL,   -- SHA-256 of commit+manifest+suite hashes
    candidate_commit        TEXT        NOT NULL,
    environment_manifest_hash TEXT      NOT NULL,
    acceptance_suite_hash   TEXT        NOT NULL,
    gate_results            JSONB       NOT NULL DEFAULT '[]',
    status                  TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'running', 'review_ready', 'rejected', 'infra_error')),
    limitations             TEXT[]      NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- node: 09.03 — Human approval records
CREATE TABLE approval_records (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id         UUID        NOT NULL REFERENCES incidents(id),
    validation_run_id   UUID        REFERENCES validation_runs(id),
    repair_candidate_id UUID        REFERENCES repair_candidates(id),
    approver_id         TEXT        NOT NULL,
    decision            TEXT        NOT NULL CHECK (decision IN ('approved', 'rejected', 'revise')),
    notes               TEXT,
    review_package_complete BOOLEAN NOT NULL DEFAULT false,
    -- Rule 23: approval_records entry required before protected file modification
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Section 10 — Knowledge tables ───────────────────────────────────────────

-- node: 10.01 — Verified knowledge records
CREATE TABLE knowledge_records (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id             UUID        REFERENCES incidents(id),
    evidence_bundle_id      UUID        REFERENCES evidence_bundles(id),
    validation_run_id       UUID        REFERENCES validation_runs(id),
    approval_record_id      UUID        REFERENCES approval_records(id),
    failure_signature       TEXT        NOT NULL,
    component               TEXT        NOT NULL,
    contract_ref            TEXT,
    repo_version            TEXT,
    successful_repair_ref   UUID        REFERENCES repair_candidates(id),
    rejected_repair_refs    UUID[]      NOT NULL DEFAULT '{}',
    tested_hypothesis_refs  UUID[]      NOT NULL DEFAULT '{}',
    status                  TEXT        NOT NULL DEFAULT 'candidate'
                            CHECK (status IN ('candidate', 'approved', 'superseded')),
    version                 INTEGER     NOT NULL DEFAULT 1,
    superseded_by           UUID        REFERENCES knowledge_records(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- node: 12.04 — Measurement events
CREATE TABLE measurement_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id     UUID        REFERENCES incidents(id),
    metric_name     TEXT        NOT NULL,
    value           NUMERIC,
    unit            TEXT,
    metadata        JSONB       NOT NULL DEFAULT '{}',
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX measurement_events_incident_idx ON measurement_events(incident_id);
CREATE INDEX measurement_events_metric_idx ON measurement_events(metric_name);

-- ─── Section 11 — Platform Infrastructure tables ─────────────────────────────

-- node: 11.06.02 — Workflow checkpoints
CREATE TABLE workflow_checkpoints (
    incident_id     UUID        NOT NULL,
    step_name       TEXT        NOT NULL,
    step_output     JSONB       NOT NULL DEFAULT '{}',
    saved_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (incident_id, step_name)
);
CREATE INDEX workflow_checkpoints_incident_idx ON workflow_checkpoints(incident_id);

-- ─── Updated-at trigger function ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'orders', 'payment_attempts', 'payments', 'fault_configs',
        'events', 'incidents', 'tasks',
        'sensor_health', 'evidence_bundles',
        'hypotheses', 'experiments', 'repair_candidates', 'validation_runs',
        'knowledge_records'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER set_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
            t, t
        );
    END LOOP;
END;
$$;
