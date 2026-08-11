import { defineConfig } from "vitest/config";

/**
 * One run, one scheduler.
 *
 * The suite is two projects with genuinely different runtimes: Worker-backed
 * tests need a Miniflare isolate per file, Worker-free unit tests must not pay
 * for one. That split is worth keeping — it is what makes the unit half cheap.
 *
 * What is not worth keeping is running them as two separate Vitest processes.
 * Each one sized its own worker pool to the whole machine, so the suite
 * oversubscribed the box by a factor of two against itself before any other
 * agent's build was even counted. Declaring them as projects of a single run
 * gives both halves one pool, one concurrency budget, one Vite server and its
 * shared transform cache, and one exit path — without changing what either
 * project includes or how it is isolated.
 */
export default defineConfig({
  test: {
    projects: ["vitest.worker.config.ts", "vitest.node.config.ts"],
  },
});
