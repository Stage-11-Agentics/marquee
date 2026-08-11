import { seed as agenda } from "../../../scripts/seed/agenda.ts";
import { seed as acceptedCore } from "../../../scripts/seed/accepted-core.ts";
import { seed as ugliness } from "../../../scripts/seed/ugliness.ts";
import { seed as evaluations } from "../../../scripts/seed/evaluations.ts";
import { seed as event } from "../../../scripts/seed/event.ts";
import { FROZEN_NOW } from "../../../scripts/seed/event.ts";
import { seed as pool } from "../../../scripts/seed/pool.ts";
import { seed as submissionContent } from "../../../scripts/seed/submission-content.ts";
import { makeContext, type SeedModule, type SeedRow } from "../../../scripts/seed/_sql.ts";

/**
 * The manifest is the single source of shipped demo data. The CLI verifies
 * that the sibling seed files match this list; reset uses this same list
 * directly so a Worker never imports the Node-only CLI orchestrator.
 */
export const DEMO_SEED_MODULES: readonly SeedModule[] = [
  event,
  acceptedCore,
  pool,
  evaluations,
  submissionContent,
  agenda,
  ugliness,
].sort((left, right) =>
  left.order === right.order ? left.name.localeCompare(right.name) : left.order - right.order,
);

/**
 * All current seed modules are synchronous. Keep that invariant explicit:
 * reset must not silently commit a partial seed if a future module becomes
 * asynchronous without changing this shared contract.
 */
export function buildDemoSeedRows(
  now: number = FROZEN_NOW,
  modules: readonly SeedModule[] = DEMO_SEED_MODULES,
): SeedRow[] {
  const context = makeContext(now);
  for (const module of modules) {
    const result = module.run(context);
    if (result && typeof result.then === "function") {
      throw new Error(`demo seed module ${module.name} must be synchronous`);
    }
  }
  return context.rows;
}
