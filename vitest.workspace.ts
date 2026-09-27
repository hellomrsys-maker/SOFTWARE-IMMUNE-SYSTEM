import { defineWorkspace } from 'vitest/config';

// node: vitest.workspace — enumerates all package test configs
export default defineWorkspace([
  'packages/*/vitest.config.ts',
  'apps/*/vitest.config.ts',
  'platform/*/vitest.config.ts',
]);
