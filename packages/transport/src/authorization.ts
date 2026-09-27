/**
 * @node 03.04 — Authorization Engine
 *
 * Provides five permission checks:
 *   checkRead    — read a resource
 *   checkWrite   — write to a workspace path
 *   checkCommand — execute an approved command
 *   checkNetwork — make an external network request
 *   checkApproval — verify human approval exists
 *
 * CRITICAL INVARIANT (Operating Restriction §00.04.05):
 *   The denial audit record is written to the DB BEFORE the denial is returned.
 *   This ensures every authorization decision is durable and auditable, and
 *   no agent-generated instruction can bypass the authorization engine.
 *
 * The approved-command registry is loaded from configuration (never from model output).
 *
 * Limitation: the approved-command registry is loaded at construction time only;
 * a restart is required to pick up registry changes.
 */

import type { Pool } from 'pg';
import pino, { type Logger } from 'pino';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PermissionType = 'read' | 'workspace_write' | 'approved_command' | 'network' | 'approval';
export type Decision = 'allowed' | 'denied';

export interface AuthorizationDecision {
  id: string;
  incidentId: string | null;
  actorId: string;
  permissionType: PermissionType;
  resource: string;
  decision: Decision;
  reason: string | null;
  createdAt: Date;
}

export interface AuthorizationConfig {
  /** Approved command strings (exact match). Loaded from config — never from model output. */
  approvedCommands: string[];
  /** Glob patterns for workspace paths the repair agent is allowed to write */
  allowedWritePaths: string[];
  /** Allowed network hostnames */
  allowedNetworkHosts: string[];
}

// ─── AuthorizationEngine ──────────────────────────────────────────────────────

/**
 * @node 03.04 — AuthorizationEngine
 *
 * All denial paths write the denial record to DB before returning the denial.
 */
export class AuthorizationEngine {
  private readonly logger: Logger;

  constructor(
    private readonly db: Pool,
    private readonly config: AuthorizationConfig,
    logger?: Logger,
  ) {
    this.logger = logger ?? pino().child({ component: 'authorization-engine', node: '03.04' });
  }

  /**
   * @node 03.04.01 — Check read permission.
   *
   * Currently allows all reads; reserved for future fine-grained access control.
   */
  async checkRead(
    actorId: string,
    resource: string,
    incidentId?: string,
  ): Promise<AuthorizationDecision> {
    return this.record(actorId, 'read', resource, incidentId ?? null, 'allowed', null);
  }

  /**
   * @node 03.04.02 — Check workspace write permission.
   *
   * Allows writes only to paths matching the `allowedWritePaths` patterns.
   * Denial is written to DB BEFORE returning.
   */
  async checkWrite(
    actorId: string,
    resource: string,
    incidentId?: string,
  ): Promise<AuthorizationDecision> {
    const allowed = this.config.allowedWritePaths.some((pattern) =>
      matchesPattern(resource, pattern),
    );

    if (!allowed) {
      const reason = `Path "${resource}" is not in the allowed write paths list`;
      // CRITICAL: write denial record BEFORE returning denial (§00.04.05)
      const decision = await this.record(actorId, 'workspace_write', resource, incidentId ?? null, 'denied', reason);
      this.logger.warn({ actorId, resource, incidentId }, `Write denied: ${reason}`);
      return decision;
    }

    return this.record(actorId, 'workspace_write', resource, incidentId ?? null, 'allowed', null);
  }

  /**
   * @node 03.04.03 — Check approved-command permission.
   *
   * Commands must match exactly an entry in the approved-commands registry.
   * The registry is loaded from configuration — never from model output.
   * Denial is written to DB BEFORE returning.
   */
  async checkCommand(
    actorId: string,
    command: string,
    incidentId?: string,
  ): Promise<AuthorizationDecision> {
    const approved = this.config.approvedCommands.includes(command);

    if (!approved) {
      const reason = `Command "${command}" is not in the approved-command registry`;
      // CRITICAL: write denial record BEFORE returning denial (§00.04.05)
      const decision = await this.record(actorId, 'approved_command', command, incidentId ?? null, 'denied', reason);
      this.logger.warn({ actorId, command, incidentId }, `Command denied: ${reason}`);
      return decision;
    }

    return this.record(actorId, 'approved_command', command, incidentId ?? null, 'allowed', null);
  }

  /**
   * @node 03.04.04 — Check network access permission.
   *
   * Only allows connections to hosts in the allowedNetworkHosts list.
   * Denial is written to DB BEFORE returning.
   */
  async checkNetwork(
    actorId: string,
    host: string,
    incidentId?: string,
  ): Promise<AuthorizationDecision> {
    const allowed = this.config.allowedNetworkHosts.includes(host);

    if (!allowed) {
      const reason = `Host "${host}" is not in the allowed network hosts list`;
      // CRITICAL: write denial record BEFORE returning denial (§00.04.05)
      const decision = await this.record(actorId, 'network', host, incidentId ?? null, 'denied', reason);
      this.logger.warn({ actorId, host, incidentId }, `Network denied: ${reason}`);
      return decision;
    }

    return this.record(actorId, 'network', host, incidentId ?? null, 'allowed', null);
  }

  /**
   * @node 03.04.05 — Check human approval exists for a repair candidate.
   *
   * Queries `approval_records` for an approved entry matching the incident and
   * repair candidate.  Denial is written to DB BEFORE returning.
   */
  async checkApproval(
    actorId: string,
    incidentId: string,
    repairCandidateId: string,
  ): Promise<AuthorizationDecision> {
    const result = await this.db.query<{ id: string }>(
      `SELECT id FROM approval_records
       WHERE incident_id = $1
         AND repair_candidate_id = $2
         AND decision = 'approved'
       LIMIT 1`,
      [incidentId, repairCandidateId],
    );

    if (!result.rows[0]) {
      const reason = `No approved approval_record for incident ${incidentId} / candidate ${repairCandidateId}`;
      // CRITICAL: write denial record BEFORE returning denial (§00.04.05)
      const decision = await this.record(actorId, 'approval', `repair:${repairCandidateId}`, incidentId, 'denied', reason);
      this.logger.warn({ actorId, incidentId, repairCandidateId }, `Approval denied: ${reason}`);
      return decision;
    }

    return this.record(actorId, 'approval', `repair:${repairCandidateId}`, incidentId, 'allowed', null);
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  /**
   * @node 03.04.06 — Write authorization decision to DB and return it.
   *
   * For denials: this write MUST complete before the caller returns the denial.
   */
  private async record(
    actorId: string,
    permissionType: PermissionType,
    resource: string,
    incidentId: string | null,
    decision: Decision,
    reason: string | null,
  ): Promise<AuthorizationDecision> {
    const result = await this.db.query<{
      id: string;
      actor_id: string;
      permission_type: PermissionType;
      resource: string;
      incident_id: string | null;
      decision: Decision;
      reason: string | null;
      created_at: Date;
    }>(
      `INSERT INTO authorization_decisions
         (incident_id, actor_id, permission_type, resource, decision, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [incidentId, actorId, permissionType, resource, decision, reason],
    );
    const row = result.rows[0];
    if (!row) throw new Error('AuthorizationEngine: failed to write decision record');
    return {
      id: row.id,
      incidentId: row.incident_id,
      actorId: row.actor_id,
      permissionType: row.permission_type,
      resource: row.resource,
      decision: row.decision,
      reason: row.reason,
      createdAt: row.created_at,
    };
  }
}

// ─── Pattern matching ─────────────────────────────────────────────────────────

/**
 * @node 03.04.02 — Simple glob-style pattern matching for paths.
 *
 * Supports '*' (any chars within one segment) and '**' (any chars across segments).
 */
function matchesPattern(path: string, pattern: string): boolean {
  // Exact match
  if (path === pattern) return true;
  // Simple prefix match with /**
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return path.startsWith(prefix);
  }
  // Regex conversion for simple glob
  const regex = new RegExp(
    '^' + pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*') + '$',
  );
  return regex.test(path);
}
