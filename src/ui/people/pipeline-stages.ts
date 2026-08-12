/**
 * The six sourcing stages the board draws, restated for the client bundle.
 *
 * The server owns the same list in `lib/person-annotations.ts` and validates
 * against it; this copy exists because the browser must not pull a Worker module
 * into its bundle. `tests/node/people-annotations.test.mjs` asserts the two
 * never drift.
 */
export const PIPELINE_STAGES = [
  { id: "researching", name: "Researching", kind: "open" },
  { id: "identified", name: "Identified", kind: "open" },
  { id: "contacted", name: "Contacted", kind: "open" },
  { id: "interested", name: "Interested", kind: "open" },
  { id: "confirmed", name: "Confirmed", kind: "won" },
  { id: "declined", name: "Declined", kind: "lost" },
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGES)[number]["id"];
