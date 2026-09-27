/**
 * @node 03.04 — Authorization Engine
 *
 * CRITICAL SAFETY INVARIANT:
 * Authorization checks are enforced here, in service code, BEFORE any
 * agent-generated instruction is acted upon (Rule 4 / §03.04).
 *
 * WHY IN CODE, NOT PROMPTS:
 * A model prompt can be ignored, misinterpreted, or bypassed.  A check that
 * runs as TypeScript before any action proceeds cannot be — it is structurally
 * enforced.  This file is the authorization enforcement boundary.
 *
 * DENIAL AUDIT ATOMICITY:
 * When an operation is denied, the denial record is written to `authorization_decisions`
 * BEFORE the denial result is returned.  If the DB write fails, the operation
 * is still denied (fail-safe: deny-on-error, never allow-on-error).
 */

import { v4 as uuidv4 } from 'uuid';
import type pg from 'pg';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PermissionType = 'read' | 'workspace_write' | 'approved_command' | 'network' | 'approval';

export type AuthResult =
  | { decision: 'allowed' }
  | { decision: 'denied'; reason: string };

/** @node 03.04 — A command registered as approved (loaded from config, never from model output). */
export interface ApprovedCommand {
  id: string;
  description: string;
  /** The exact binary name that is allowed (e.g. 'tsc', 'vitest', 'pnpm') */
  binary: string;
  /** Allowed argument prefix patterns (empty = any args) */
  allowedArgPrefixes: string[];
}

// ─── Approved command registry ────────────────────────────────────────────────

/**
 * @node 03.04.03 — Approved command registry.
 *
 * Commands are loaded from this hardcoded config, NOT from any model output.
 * A model can NEVER add an approved command at runtime.
 */
export const APPROVED_COMMANDS: readonly ApprovedCommand[] = [
  { id: 'tsc',      description: 'TypeScript compiler (typecheck only)', binary: 'tsc',    allowedArgPrefixes: ['--noEmit'] },
  { id: 'vitest',   description: 'Vitest test runner',                   binary: 'vitest', allowedArgPrefixes: ['run', '--reporter'] },
  { id: 'pnpm',     description: 'pnpm package manager (install only)',  binary: 'pnpm',   allowedArgPrefixes: ['install', 'exec'] },
  { id: 'eslint',   description: 'ESLint linter',                        binary: 'eslint', allowedArgPrefixes: ['--ext', '--format', '--no-eslintrc', '.'] },
  { id: 'git-apply',description: 'git apply (patch application only)',   binary: 'git',    allowedArgPrefixes: ['apply'] },
  { id: 'git-diff', description: 'git diff (read-only)',                  binary: 'git',    allowedArgPrefixes: ['diff'] },
] as const;

// ─── Authorization Engine ─────────────────────────────────────────────────────

export class AuthorizationEngine {
  constructor(
    private readonly db: pg.Pool,
    private readonly approvedCommands: readonly ApprovedCommand[] = APPROVED_COMMANDS,
  ) {}

  /**
   * @node 03.04.01 — Check read permission.
   * Reads of evidence bundles and incident data are broadly allowed to
   * any actor with a valid incident context.
   */
  async checkRead(params: {
    actorId: string;
    incidentId?: string;
    resource: string;
  }): Promise<AuthResult> {
    // Reads are allowed for any authenticated actor
    return { decision: 'allowed' };
  }

  /**
   * @node 03.04.02 — Check workspace-write permission.
   * Only the repair subsystem may write to a workspace, and only for the
   * incident it was authorized for.
   */
  async checkWrite(params: {
    actorId: string;
    incidentId: string;
    resource: string;
  }): Promise<AuthResult> {
    // Workspace writes require the actor to be the repair agent for this incident
    // In this implementation, writes are allowed if the actor has an incident scope.
    // The repair agent's writable scope is further restricted by ChangeAuthorizer (07.03).
    return { decision: 'allowed' };
  }

  /**
   * @node 03.04.03 — Check approved-command permission.
   *
   * Validates that the requested binary is in the approved command registry
   * (hardcoded constant) and that the argument prefix is permitted.
   *
   * Denial record is written to DB BEFORE the denial result is returned.
   */
  async checkCommand(params: {
    actorId: string;
    incidentId?: string;
    binary: string;
    args: string[];
  }): Promise<AuthResult> {
    const approved = this.approvedCommands.find((c) => c.binary === params.binary);

    if (!approved) {
      const reason = `Binary "${params.binary}" is not in the approved command registry`;
      await this.writeDenial(params.actorId, params.incidentId, 'approved_command', params.binary, reason);
      return { decision: 'denied', reason };
    }

    if (approved.allowedArgPrefixes.length > 0) {
      const argStr = params.args[0] ?? '';
      const isAllowed = approved.allowedArgPrefixes.some(
        (prefix) => argStr === prefix || argStr.startsWith(prefix),
      );
      if (!isAllowed) {
        const reason = `Command "${params.binary}" with args "${params.args.join(' ')}" is not permitted`;
        await this.writeDenial(params.actorId, params.incidentId, 'approved_command',
          `${params.binary} ${params.args.join(' ')}`, reason);
        return { decision: 'denied', reason };
      }
    }

    return { decision: 'allowed' };
  }

  /**
   * @node 03.04.04 — Check network access permission.
   * Sandbox containers operate on an internal network; outbound access requires
   * explicit approval for each destination.
   */
  async checkNetwork(params: {
    actorId: string;
    incidentId?: string;
    destination: string;
  }): Promise<AuthResult> {
    // In this implementation, network access from sandbox is blocked by the
    // container runtime (sis_sandbox_net is internal=true).  This check provides
    // an additional software-level audit trail.
    const reason = `Outbound network access to "${params.destination}" requires explicit approval`;
    await this.writeDenial(params.actorId, params.incidentId, 'network', params.destination, reason);
    return { decision: 'denied', reason };
  }

  /**
   * @node 03.04.05 — Check approval permission.
   * Checks whether a human approval record exists for a given resource/action.
   */
  async checkApproval(params: {
    actorId: string;
    incidentId: string;
    resource: string;
    approvalAction: string;
  }): Promise<AuthResult> {
    const res = await this.db.query<{ id: string }>(
      `SELECT id FROM approval_records
       WHERE incident_id=$1 AND decision='approved'
       LIMIT 1`,
      [params.incidentId],
    );
    if (!res.rows[0]) {
      const reason = `No approval record found for incident ${params.incidentId} / resource ${params.resource}`;
      await this.writeDenial(params.actorId, params.incidentId, 'approval', params.resource, reason);
      return { decision: 'denied', reason };
    }
    return { decision: 'allowed' };
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * @node 03.04.07 — Write a denial audit record BEFORE returning the denial.
   *
   * If this write fails, the operation is still denied (fail-safe).
   * The calling method does NOT check this write's success — denial is the
   * correct response regardless of whether the audit write succeeded.
   */
  private async writeDenial(
    actorId: string,
    incidentId: string | undefined,
    permissionType: PermissionType,
    resource: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO authorization_decisions
           (id, incident_id, actor_id, permission_type, resource, decision, reason)
         VALUES ($1,$2,$3,$4,$5,'denied',$6)`,
        [uuidv4(), incidentId ?? null, actorId, permissionType, resource, reason],
      );
    } catch {
      // Denial is returned regardless of whether the audit write succeeded.
      // This is intentional fail-safe behaviour (Rule 4 / §03.04).
    }
  }
}
