/**
 * @file packages/bob-client/tests/client.test.ts
 * @node 04.44
 * @description Tests for the Dual-Mode Failsafe Client.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BobClient } from "../src/client.js";

describe("BobClient — Dual-Mode Failsafe Client", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    Object.assign(process.env, originalEnv);
    vi.restoreAllMocks();
  });

  describe("Feature flag off (BOB_INTEGRATION_ENABLED=false)", () => {
    beforeEach(() => {
      process.env["BOB_INTEGRATION_ENABLED"] = "false";
      delete process.env["BOB_API_TOKEN"];
    });

    it("returns simulation mode response without making any fetch call", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const client = new BobClient();
      const result = await client.investigate({
        task_type: "repository",
        evidence_bundle: {
          incident_id: "test-incident",
          evidence_records: [],
          source_manifest: [],
          collection_gaps: [],
        },
      });
      expect(result.simulation_mode).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("simulation response has all required fields", async () => {
      const client = new BobClient();
      const result = await client.investigate({
        task_type: "runtime",
        evidence_bundle: {
          incident_id: "test",
          evidence_records: [],
          source_manifest: [],
          collection_gaps: [],
        },
      });
      expect(result.task_id).toBeDefined();
      expect(result.findings).toBeInstanceOf(Array);
      expect(result.candidate_hypotheses).toBeInstanceOf(Array);
      expect(result.simulation_notice).toContain("simulation");
    });
  });

  describe("Token missing (BOB_INTEGRATION_ENABLED=true, no token)", () => {
    beforeEach(() => {
      process.env["BOB_INTEGRATION_ENABLED"] = "true";
      delete process.env["BOB_API_TOKEN"];
    });

    it("falls back to simulation without crashing", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const warnSpy = vi.spyOn(console, "warn");
      const client = new BobClient();
      const result = await client.investigate({
        task_type: "repository",
        evidence_bundle: {
          incident_id: "test",
          evidence_records: [],
          source_manifest: [],
          collection_gaps: [],
        },
      });
      expect(result.simulation_mode).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("BOB_API_TOKEN"));
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("Live fetch fails (BOB_INTEGRATION_ENABLED=true, token set)", () => {
    beforeEach(() => {
      process.env["BOB_INTEGRATION_ENABLED"] = "true";
      process.env["BOB_API_TOKEN"] = "test-token-not-real";
    });

    it("falls back to simulation on network error without throwing", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      const errorSpy = vi.spyOn(console, "error");
      const client = new BobClient();
      const result = await client.investigate({
        task_type: "repository",
        evidence_bundle: {
          incident_id: "test",
          evidence_records: [],
          source_manifest: [],
          collection_gaps: [],
        },
      });
      expect(result.simulation_mode).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
    });

    it("falls back to simulation on 401 HTTP error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      }));
      const errorSpy = vi.spyOn(console, "error");
      const client = new BobClient();
      const result = await client.investigate({
        task_type: "repository",
        evidence_bundle: {
          incident_id: "test",
          evidence_records: [],
          source_manifest: [],
          collection_gaps: [],
        },
      });
      expect(result.simulation_mode).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("HTTP 401"));
    });

    it("falls back to simulation on 500 HTTP error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      }));
      const client = new BobClient();
      const result = await client.investigate({
        task_type: "repository",
        evidence_bundle: {
          incident_id: "test",
          evidence_records: [],
          source_manifest: [],
          collection_gaps: [],
        },
      });
      expect(result.simulation_mode).toBe(true);
    });

    it("returns real response when live fetch succeeds", async () => {
      const mockResponse = {
        task_id: "live-task-id",
        task_type: "repository",
        status: "completed" as const,
        findings: [],
        candidate_hypotheses: [],
        discriminating_tests: [],
        next_actions: [],
        simulation_mode: false,
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      }));
      const client = new BobClient();
      const result = await client.investigate({
        task_type: "repository",
        evidence_bundle: {
          incident_id: "test",
          evidence_records: [],
          source_manifest: [],
          collection_gaps: [],
        },
      });
      expect(result.simulation_mode).toBe(false);
      expect(result.task_id).toBe("live-task-id");
    });
  });
});
