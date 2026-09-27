/**
 * @file packages/sandbox-manager/src/index.ts
 * @node 11.04
 * @description Sandbox manager barrel export.
 */
export {
  SandboxManager,
  getSandboxManager,
  resetSandboxManagerForTest,
} from "./manager.js";
export type { SandboxOptions, SandboxResult } from "./manager.js";
