/**
 * @file packages/config/src/index.ts
 * @node 00.02, 11.01, 11.04
 * @description Central configuration management. Reads and validates all environment variables.
 * No secrets appear in defaults. All configuration is explicit.
 */
import { z } from "zod";

// node: 11.04 — Sandbox config
const SandboxConfigSchema = z.object({
  dockerSocketPath: z.string().default("/var/run/docker.sock"),
  cpuQuota: z.coerce.number().int().positive().default(50_000),
  memoryLimitMb: z.coerce.number().int().positive().default(512),
  pidsLimit: z.coerce.number().int().positive().default(64),
  timeoutSeconds: z.coerce.number().int().positive().default(120),
});

// node: 11.03 — Artifact storage config
const ArtifactStorageConfigSchema = z.object({
  storagePath: z.string().default("./artifacts"),
  quotaMb: z.coerce.number().int().positive().default(2048),
});

// node: 04.04 — Bob integration config
const BobConfigSchema = z.object({
  integrationEnabled: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  apiToken: z.string().default(""),
  apiEndpoint: z.string().url().default("https://api.ibm.com/bob/v1"),
});

const AppConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  databaseUrl: z.string().min(1),
  managedAppDatabaseUrl: z.string().optional(),
  managedAppBaseUrl: z.string().url().default("http://localhost:3001"),
  controlApiPort: z.coerce.number().int().positive().default(3000),
  controlApiHost: z.string().default("0.0.0.0"),
  jwtSecret: z.string().min(1),
  workerConcurrency: z.coerce.number().int().positive().default(4),
  workerPollIntervalMs: z.coerce.number().int().positive().default(1000),
  sandbox: SandboxConfigSchema,
  artifactStorage: ArtifactStorageConfigSchema,
  bob: BobConfigSchema,
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (_config !== null) {
    return _config;
  }

  const result = AppConfigSchema.safeParse({
    nodeEnv: process.env["NODE_ENV"],
    logLevel: process.env["LOG_LEVEL"],
    databaseUrl: process.env["DATABASE_URL"],
    managedAppDatabaseUrl: process.env["MANAGED_APP_DATABASE_URL"],
    managedAppBaseUrl: process.env["MANAGED_APP_BASE_URL"],
    controlApiPort: process.env["CONTROL_API_PORT"],
    controlApiHost: process.env["CONTROL_API_HOST"],
    jwtSecret: process.env["JWT_SECRET"] ?? "change-me-dev-only",
    workerConcurrency: process.env["WORKER_CONCURRENCY"],
    workerPollIntervalMs: process.env["WORKER_POLL_INTERVAL_MS"],
    sandbox: {
      dockerSocketPath: process.env["DOCKER_SOCKET_PATH"],
      cpuQuota: process.env["SANDBOX_CPU_QUOTA"],
      memoryLimitMb: process.env["SANDBOX_MEMORY_LIMIT_MB"],
      pidsLimit: process.env["SANDBOX_PIDS_LIMIT"],
      timeoutSeconds: process.env["SANDBOX_TIMEOUT_SECONDS"],
    },
    artifactStorage: {
      storagePath: process.env["ARTIFACT_STORAGE_PATH"],
      quotaMb: process.env["ARTIFACT_STORAGE_QUOTA_MB"],
    },
    bob: {
      integrationEnabled: process.env["BOB_INTEGRATION_ENABLED"],
      apiToken: process.env["BOB_API_TOKEN"],
      apiEndpoint: process.env["BOB_API_ENDPOINT"],
    },
  });

  if (!result.success) {
    const missing = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw new Error(`Configuration validation failed: ${missing}`);
  }

  _config = result.data;
  return _config;
}

/** Reset cached config — for use in tests only */
export function resetConfigForTest(): void {
  _config = null;
}
