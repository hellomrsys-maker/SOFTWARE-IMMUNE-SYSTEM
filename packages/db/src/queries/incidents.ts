/**
 * @file packages/db/src/queries/incidents.ts
 * @node 03.02
 * @description Typed query functions for the incidents table.
 */
import type pg from "pg";
import { query, withTransaction } from "../pool.js";
import type { Incident, IncidentState, CreateIncidentInput } from "@sis/shared";
import { VALID_TRANSITIONS } from "@sis/shared";
import { randomUUID } from "crypto";
import { sha256 } from "@sis/shared";

export async function createIncident(
  input: CreateIncidentInput,
  pool?: pg.Pool,
): Promise<Incident> {
  const fingerprint = sha256(
    `${input.repository_path}|${input.failure_report}`,
  );
  const { rows } = await query<Incident>(
    `INSERT INTO incidents (id, fingerprint, state, repository_path, failure_report, metadata)
     VALUES ($1, $2, 'created', $3, $4, $5)
     ON CONFLICT (fingerprint) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [randomUUID(), fingerprint, input.repository_path, input.failure_report, JSON.stringify(input.metadata ?? {})],
    pool,
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create incident");
  return row;
}

export async function getIncidentById(id: string, pool?: pg.Pool): Promise<Incident | null> {
  const { rows } = await query<Incident>(
    "SELECT * FROM incidents WHERE id = $1",
    [id],
    pool,
  );
  return rows[0] ?? null;
}

export async function listIncidents(
  limit = 20,
  offset = 0,
  pool?: pg.Pool,
): Promise<Incident[]> {
  const { rows } = await query<Incident>(
    "SELECT * FROM incidents ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset],
    pool,
  );
  return rows;
}

/** @node 03.02.02 — Validates transition against the hardcoded allowed-transition table */
export async function transitionIncidentState(
  id: string,
  newState: IncidentState,
  actorId: string,
  pool?: pg.Pool,
): Promise<Incident> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<Incident>(
      "SELECT * FROM incidents WHERE id = $1 FOR UPDATE",
      [id],
    );
    const incident = rows[0];
    if (!incident) throw new Error(`Incident ${id} not found`);

    const allowed = VALID_TRANSITIONS[incident.state];
    if (!allowed.includes(newState)) {
      throw new Error(
        `Invalid transition: ${incident.state} → ${newState} for incident ${id}`,
      );
    }

    const { rows: updated } = await client.query<Incident>(
      "UPDATE incidents SET state = $1, updated_at = now() WHERE id = $2 RETURNING *",
      [newState, id],
    );
    const updatedRow = updated[0];
    if (!updatedRow) throw new Error("Failed to update incident state");
    return updatedRow;
  }, pool);
}

export async function setRepairLease(
  incidentId: string,
  leaseId: string | null,
  pool?: pg.Pool,
): Promise<void> {
  await query(
    "UPDATE incidents SET active_repair_lease_id = $1, updated_at = now() WHERE id = $2",
    [leaseId, incidentId],
    pool,
  );
}
