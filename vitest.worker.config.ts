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
          // Media links are signed inside Worker-backed integration tests too;
          // this binding keeps SELF.fetch fixtures deterministic without ever
          // putting a production secret in wrangler vars.
          UPLOAD_TOKEN_SECRET: "worker-test-upload-token-secret",
          RESEND_WEBHOOK_SECRET: "whsec_dGVzdC13ZWJob29rLXNlY3JldA==",
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
    // These route tests call the Hono app with a minimal ASSETS binding and do
    // not need cloudflare:test, D1, R2, or SELF. Keep the boundary explicit so
    // a future integration glob cannot silently put them back on Miniflare.
    exclude: [
      "tests/integration/not-found.test.ts",
      "tests/integration/site-alias.test.ts",
    ],
    setupFiles: ["./tests/setup.ts"],
    // A hang detector, not a speed gate. Under fleet contention a correct test
    // can legitimately take many seconds; failing it there reports the machine,
    // not the code. Suite speed is measured by the budget objective in
    // scripts/checks/run-test.mjs, which warns rather than failing.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    maxConcurrency: 8,
    // Vitest 4 moved the old poolOptions knobs to the project level. Keep
    // file scheduling explicit for the four-vCPU CI runner; the hosted
    // verbose reporter timestamps are the proof that files overlap.
    fileParallelism: true,
    maxWorkers: 4,
    passWithNoTests: false,
  },
});
