/**
 * @file packages/bob-client/src/client.ts
 * @node 04.04
 * @description Dual-Mode Failsafe Client for IBM Bob API integration.
 *
 * ARCHITECTURE: This client operates in two modes:
 *
 * 1. PRODUCTION MODE (token-dependent):
 *    - Reads BOB_API_TOKEN from environment at runtime.
 *    - Makes real outbound HTTP REST requests with Bearer token.
 *
 * 2. SIMULATION MODE (automatic fallback):
 *    - Activated when BOB_API_TOKEN is missing OR when any live fetch fails.
 *    - Returns clean, locally simulated mock data structures that mirror real API shapes.
 *    - Emits console.warn when token is missing (visible in runtime logs).
 *    - Emits console.error when live fetch fails, including failure reason.
 *    - Never throws an unhandled exception. Never crashes the application.
 *
 * FEATURE FLAG:
 *    - BOB_INTEGRATION_ENABLED=false: uses stubs directly, no outbound calls attempted.
 *    - BOB_INTEGRATION_ENABLED=true + BOB_API_TOKEN set: attempts live call, falls back on failure.
 *    - BOB_INTEGRATION_ENABLED=true + BOB_API_TOKEN missing: simulation mode immediately.
 */
import type {
  BobInvestigateRequest,
  BobInvestigateResponse,
  BobRepairRequest,
  BobRepairResponse,
} from "./types.js";
import {
  simulateInvestigateResponse,
  simulateRepairResponse,
} from "./simulation.js";

export class BobClient {
  private readonly endpoint: string;
  private readonly token: string | undefined;
  private readonly integrationEnabled: boolean;

  constructor() {
    this.endpoint = process.env["BOB_API_ENDPOINT"] ?? "https://api.ibm.com/bob/v1";
    this.token = process.env["BOB_API_TOKEN"] || undefined;
    const flagValue = process.env["BOB_INTEGRATION_ENABLED"];
    this.integrationEnabled = flagValue === "true";
  }

  /** @node 04.04.01, 04.44.02, 04.44.03 — Investigate using Bob */
  async investigate(request: BobInvestigateRequest): Promise<BobInvestigateResponse> {
    // Feature flag check — when off, use stubs without attempting outbound call
    if (!this.integrationEnabled) {
      // Explicit notice — never silently degrade (Rule 3)
      console.warn(
        "[bob-client] BOB_INTEGRATION_ENABLED is false — using simulation mode. " +
        "Set BOB_INTEGRATION_ENABLED=true and BOB_API_TOKEN to enable live Bob integration.",
      );
      return simulateInvestigateResponse(request);
    }

    // Token check — warn explicitly if missing
    if (!this.token) {
      console.warn(
        "[bob-client] BOB_API_TOKEN is not set — falling back to simulation mode. " +
        "Provide a valid BOB_API_TOKEN environment variable to enable live Bob API calls.",
      );
      return simulateInvestigateResponse(request);
    }

    // Attempt live API call with robust error handling
    try {
      const response = await fetch(`${this.endpoint}/investigate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.token}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "(unreadable body)");
        // Emit console.error with failure reason — visible in runtime logs
        console.error(
          `[bob-client] Live Bob API call failed (HTTP ${response.status}) — ` +
          `falling back to simulation mode. Reason: ${errorText}`,
        );
        return simulateInvestigateResponse(request);
      }

      const data = await response.json() as BobInvestigateResponse;
      return { ...data, simulation_mode: false };

    } catch (err: unknown) {
      // Catch any fetch error (network error, timeout, etc.) — never rethrow
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[bob-client] Live Bob API fetch error — falling back to simulation mode. ` +
        `Failure reason: ${reason}`,
      );
      return simulateInvestigateResponse(request);
    }
  }

  /** @node 04.44.04 — Request repair assistance from Bob */
  async requestRepair(request: BobRepairRequest): Promise<BobRepairResponse> {
    if (!this.integrationEnabled) {
      console.warn(
        "[bob-client] BOB_INTEGRATION_ENABLED is false — using simulation mode for repair.",
      );
      return simulateRepairResponse(request);
    }

    if (!this.token) {
      console.warn(
        "[bob-client] BOB_API_TOKEN is not set — falling back to simulation mode for repair.",
      );
      return simulateRepairResponse(request);
    }

    try {
      const response = await fetch(`${this.endpoint}/repair`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.token}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "(unreadable body)");
        console.error(
          `[bob-client] Live Bob repair API call failed (HTTP ${response.status}) — ` +
          `falling back to simulation mode. Reason: ${errorText}`,
        );
        return simulateRepairResponse(request);
      }

      const data = await response.json() as BobRepairResponse;
      return { ...data, simulation_mode: false };

    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[bob-client] Live Bob repair API fetch error — falling back to simulation mode. ` +
        `Failure reason: ${reason}`,
      );
      return simulateRepairResponse(request);
    }
  }
}

// Singleton instance
let _client: BobClient | null = null;
export function getBobClient(): BobClient {
  if (_client === null) {
    _client = new BobClient();
  }
  return _client;
}
