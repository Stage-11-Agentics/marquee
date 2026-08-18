import { defineConfig } from "vitest/config";

/** Unit tests that exercise no Workers runtime or Cloudflare binding. */
export default defineConfig({
  // Without this the project transpiles JSX against React and a `.tsx` import
  // fails on `react/jsx-dev-runtime`, which reads as a missing dependency
  // rather than a missing setting. UI components are the half of the product a
  // human actually looks at; they should be unit-testable without paying for a
  // Miniflare isolate to render them.
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  test: {
    name: "node",
    // The two route-contract files below inject their only binding (ASSETS)
    // themselves and are deliberately Worker-free; all other integration
    // tests either use cloudflare:test, SELF, or a real D1 fixture.
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/not-found.test.ts",
      "tests/integration/site-alias.test.ts",
    ],
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
    // Run the inexpensive node project before the more expensive Worker
    // project, whose separate group can use the runner's four CPUs fully.
    sequence: { groupOrder: 0 },
    fileParallelism: true,
    maxWorkers: 2,
    passWithNoTests: false,
  },
});
