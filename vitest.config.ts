import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
          // The suite drives thousands of requests; at the default `info` each
          // one writes a JSON line that vitest then intercepts and re-emits.
          // That buries the test output that IS the oracle, and the suite runs
          // against a 29s hard kill. A test that needs the lines asks for them
          // explicitly (see tests/unit/api/observability-correlation.test.ts).
          LOG_LEVEL: "silent",
        },
      },
    }),
  ],
  test: {
    name: "worker",
    // Keep Worker-backed integration tests and the one unit suite that builds
    // a D1 schema here. Worker-free unit tests run in vitest.node.config.ts so
    // they do not pay for a Miniflare isolate per file.
    include: ["tests/integration/**/*.test.ts", "tests/unit/r2/uploads-routes.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 5_000,
    hookTimeout: 5_000,
    maxConcurrency: 8,
    passWithNoTests: false,
  },
});
