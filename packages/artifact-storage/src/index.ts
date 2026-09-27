/**
 * @file packages/artifact-storage/src/index.ts
 * @node 11.03
 * @description Artifact storage barrel export.
 */
export {
  ArtifactStorage,
  getArtifactStorage,
  resetArtifactStorageForTest,
} from "./storage.js";
export type { ArtifactType, ArtifactMeta, ArtifactStorageConfig } from "./storage.js";
