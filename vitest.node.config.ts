import { defineConfig } from "vitest/config";

/** Unit tests that exercise no Workers runtime or Cloudflare binding. */
export default defineConfig({
  test: {
    name: "node",
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["tests/unit/r2/uploads-routes.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    environment: "node",
    // A hang detector, not a speed gate. Under fleet contention a correct test
    // can legitimately take many seconds; failing it there reports the machine,
    // not the code. Suite speed is measured by the budget objective in
    // scripts/checks/run-test.mjs, which warns rather than failing.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    maxConcurrency: 8,
    passWithNoTests: false,
  },
});
