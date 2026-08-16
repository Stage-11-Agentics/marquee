import { seed as agenda } from "../../../scripts/seed/agenda.ts";
import { seed as acceptedCore } from "../../../scripts/seed/accepted-core.ts";
import { seed as ugliness } from "../../../scripts/seed/ugliness.ts";
import { seed as outreach } from "../../../scripts/seed/outreach.ts";
import { seed as evaluations } from "../../../scripts/seed/evaluations.ts";
import { seed as event } from "../../../scripts/seed/event.ts";
import { seed as fieldLibrary } from "../../../scripts/seed/field-library.ts";
import { FROZEN_NOW } from "../../../scripts/seed/event.ts";
import { seed as pool } from "../../../scripts/seed/pool.ts";
import { seed as sponsors } from "../../../scripts/seed/sponsors.ts";
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
  outreach,
  sponsors,
  fieldLibrary,
].sort((left, right) =>
  left.order === right.order ? left.name.localeCompare(right.name) : left.order - right.order,
);

function referenceNumber(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^SUB-(\d+)$/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export type SubmissionReferenceStarts = ReadonlyMap<string, number>;

/** Return the committed high-water value represented by a set of seed rows. */
export function submissionReferenceHighWater(rows: readonly SeedRow[]): Map<string, number> {
  const highWater = new Map<string, number>();
  for (const row of rows) {
    if (row.table !== "submissions") continue;
    const eventId = String(row.row.event_id ?? "");
    const number = referenceNumber(row.row.reference_code);
    if (number === null) continue;
    highWater.set(eventId, Math.max(highWater.get(eventId) ?? 0, number));
  }
  return highWater;
}

/** Assign one deterministic sequence after every entity seeder has run. */
export function assignSubmissionReferenceCodes(
  rows: SeedRow[],
  startingSequences: SubmissionReferenceStarts = new Map(),
): void {
  const byEvent = new Map<string, SeedRow[]>();
  for (const row of rows) {
    if (row.table !== "submissions") continue;
    const eventId = String(row.row.event_id ?? "");
    byEvent.set(eventId, [...(byEvent.get(eventId) ?? []), row]);
  }
  for (const submissions of byEvent.values()) {
    submissions.sort((left, right) => {
      const createdDelta = Number(left.row.created_at ?? 0) - Number(right.row.created_at ?? 0);
      return createdDelta !== 0
        ? createdDelta
        : String(left.row.id ?? "").localeCompare(String(right.row.id ?? ""));
    });
    let next = Math.max(
      startingSequences.get(String(submissions[0]?.row.event_id ?? "")) ?? 0,
      ...submissions.map((row) => referenceNumber(row.row.reference_code) ?? 0),
    );
    for (const row of submissions) {
      if (referenceNumber(row.row.reference_code) !== null) continue;
      next += 1;
      row.row.reference_code = `SUB-${next}`;
    }
  }
}

/**
 * All current seed modules are synchronous. Keep that invariant explicit:
 * reset must not silently commit a partial seed if a future module becomes
 * asynchronous without changing this shared contract.
 */
export function buildDemoSeedRows(
  now: number = FROZEN_NOW,
  modules: readonly SeedModule[] = DEMO_SEED_MODULES,
  startingSequences: SubmissionReferenceStarts = new Map(),
): SeedRow[] {
  const context = makeContext(now);
  for (const module of modules) {
    const result = module.run(context);
    if (result && typeof result.then === "function") {
      throw new Error(`demo seed module ${module.name} must be synchronous`);
    }
  }
  assignSubmissionReferenceCodes(context.rows, startingSequences);
  return context.rows;
}
