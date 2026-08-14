#!/usr/bin/env node

import assert from "node:assert/strict";

import { buildSeedRows } from "../seed/index.ts";
import { getTransitConflicts } from "../../src/lib/venue-geometry.ts";
import { emit, recordSpeedHarness, writeReport } from "./lib/command.mjs";
import { runSeedApiChecks, withLocalRuntime } from "./seed.ts";
import {
  classifySeedRun,
  exitCodeForSeedStatus,
  runWithHardLimit,
  SEED_BUDGET_MS,
  SEED_HARD_LIMIT_MS,
} from "./seed-verdict.mjs";

async function runSeedChecks() {
  const rows = await buildSeedRows();
  const table = (name) => rows.filter((row) => row.table === name).map((row) => row.row);
  const buildings = table("buildings");
  const rooms = new Map(table("rooms").map((room) => [room.id, room]));
  const agendas = table("agenda_items").filter((item) => item.kind === "session");
  const peopleBySubmission = new Map();
  for (const participation of table("participations")) {
    const current = peopleBySubmission.get(participation.submission_id) ?? [];
    current.push(participation.person_id);
    peopleBySubmission.set(participation.submission_id, current);
  }
  const agendaItems = agendas.map((item) => ({
    id: item.id,
    starts_at: item.starts_at,
    duration_min: item.duration_min,
    building_id: rooms.get(item.room_id)?.building_id ?? null,
    person_ids: peopleBySubmission.get(item.submission_id) ?? [],
  }));
  const pinned = buildings.filter((building) => building.lat !== null && building.lng !== null);
  const conflicts = getTransitConflicts(agendaItems, buildings);

  assert.ok(pinned.length >= 2, "seed needs at least two pinned buildings");
  assert.ok(buildings.some((building) => building.access_minutes > 0), "seed needs non-zero building access time");
  const online = buildings.find((building) => building.name === "Online");
  assert.ok(online, "seed must include Online");
  assert.equal(online.lat, null, "Online must remain unpinned");
  assert.equal(online.lng, null, "Online must remain unpinned");
  assert.ok(conflicts.length > 0, "seed must produce a live Transit conflict");
  assert.ok(conflicts.some((conflict) => conflict.kind === "transit"), "live seed conflict must be Transit");

  // Every seeded conflict is a person in two places at once. A room booked twice
  // is never deliberate, and nothing else would catch one: it is invisible in the
  // grid until an organizer reads two tiles stacked in one cell.
  const byRoom = new Map();
  for (const item of table("agenda_items")) {
    const current = byRoom.get(item.room_id) ?? [];
    current.push(item);
    byRoom.set(item.room_id, current);
  }
  const roomOverlaps = [];
  for (const [roomId, items] of byRoom) {
    const ordered = [...items].sort((left, right) => left.starts_at - right.starts_at);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous.starts_at + previous.duration_min * 60_000 > current.starts_at) {
        roomOverlaps.push(`${rooms.get(roomId)?.name ?? roomId}: ${previous.id} overlaps ${current.id}`);
      }
    }
  }
  assert.deepEqual(roomOverlaps, [], "seed must not double-book a room");

  const apiEvidence = await withLocalRuntime((runtime) => runSeedApiChecks(runtime));
  return {
    environment: {
      kind: "local-wrangler-dev",
      runtime: "wrangler dev/miniflare",
      deployed: false,
      seed: "scripts/seed/index.ts",
    },
    buildings: buildings.map(({ id, name, address, lat, lng, access_minutes }) => ({ id, name, address, lat, lng, access_minutes })),
    pinned_buildings: pinned.length,
    transit_conflicts: conflicts,
    api: apiEvidence,
  };
}

const execution = await runWithHardLimit(runSeedChecks, { hardLimitMs: SEED_HARD_LIMIT_MS });
const classification = classifySeedRun({
  elapsedMs: execution.elapsedMs,
  budgetMs: SEED_BUDGET_MS,
  timedOut: execution.timedOut,
});
const result = {
  command: "check:seed",
  ...classification,
  elapsedMs: execution.elapsedMs,
  budgetMs: SEED_BUDGET_MS,
  hardLimitMs: SEED_HARD_LIMIT_MS,
  ...(execution.value ?? {}),
};
const report = await writeReport("artifacts/checks/seed.json", result);
await recordSpeedHarness("check_seed", {
  observedMs: result.elapsedMs,
  budgetMs: result.budgetMs,
  verdict: result.verdict,
  source: "local check:seed wall clock",
  environment: "local worktree; not deployed evidence",
});
emit({ ...result, report });
if (result.status === "pass-over-budget") {
  process.stdout.write(
    `\n[check:seed] OVER BUDGET: ${result.elapsedMs}ms against a ${result.budgetMs}ms objective. ` +
    "Seed assertions passed; check machine load before treating this as a defect.\n",
  );
}
if (result.status === "timeout") {
  process.stderr.write(
    `[check:seed] HARD LIMIT: ${result.elapsedMs}ms against a ${result.hardLimitMs}ms hang detector. ` +
    "The seed check did not complete.\n",
  );
  process.exit(1);
}
const exitCode = exitCodeForSeedStatus(result.status);
if (exitCode !== 0) process.exitCode = exitCode;
