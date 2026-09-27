-- Migration 004: authorization_decisions
-- node: 03.04, 03.04.07
-- All authorization decisions — approvals and denials.
-- Denial records are persisted BEFORE the denial is returned to the caller.
-- This table cannot be modified by any model-generated instruction.

CREATE TABLE IF NOT EXISTS authorization_decisions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id     UUID REFERENCES incidents(id) ON DELETE SET NULL,
    actor_id        TEXT NOT NULL,
    action          TEXT NOT NULL
                        CHECK (action IN ('read','workspace_write','execute_command','network_access','approve')),
    resource        TEXT NOT NULL,
    decision        TEXT NOT NULL CHECK (decision IN ('allowed','denied')),
    reason          TEXT NOT NULL,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_decisions_incident_id_idx ON authorization_decisions(incident_id);
CREATE INDEX IF NOT EXISTS auth_decisions_actor_id_idx ON authorization_decisions(actor_id);
CREATE INDEX IF NOT EXISTS auth_decisions_decision_idx ON authorization_decisions(decision);
