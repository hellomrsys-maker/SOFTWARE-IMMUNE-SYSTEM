import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "artifact-storage-legacy",
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
