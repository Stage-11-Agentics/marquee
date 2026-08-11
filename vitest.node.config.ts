import { defineConfig } from "vitest/config";

/** Unit tests that exercise no Workers runtime or Cloudflare binding. */
export default defineConfig({
  test: {
    name: "node",
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["tests/unit/r2/uploads-routes.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    environment: "node",
    testTimeout: 5_000,
    hookTimeout: 5_000,
    maxConcurrency: 8,
    passWithNoTests: false,
  },
});
