import { defineConfig } from 'vitest/config';

// node: vitest.config — managed-app test configuration
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    // Acceptance tests are in a separate pattern so they can be hashed separately
    // by the safety gate checker (section 08.04).
    exclude: ['node_modules', 'dist'],
  },
});
