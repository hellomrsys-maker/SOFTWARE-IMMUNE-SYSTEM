/**
 * @file packages/logger/src/index.ts
 * @node 11.05
 * @description Structured JSON logging using pino. Never uses console.log in production paths.
 * All log output is structured JSON for machine parsing and human review.
 */
import pino from "pino";

export type Logger = pino.Logger;
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

let _root: pino.Logger | null = null;

export function createLogger(name: string, level: LogLevel = "info"): pino.Logger {
  if (_root === null) {
    _root = pino({
      level: process.env["LOG_LEVEL"] ?? level,
      base: { pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
  return _root.child({ component: name });
}

// Pre-built loggers for key subsystems
export const logger = {
  platform: createLogger("platform"),
  worker: createLogger("worker"),
  controlApi: createLogger("control-api"),
  observation: createLogger("observation"),
  diagnostic: createLogger("diagnostic"),
  reproduction: createLogger("reproduction"),
  repair: createLogger("repair"),
  validation: createLogger("validation"),
  knowledge: createLogger("knowledge"),
  sandbox: createLogger("sandbox"),
  bobClient: createLogger("bob-client"),
};
