#!/usr/bin/env node

import assert from "node:assert/strict";

import { buildSeedRows } from "../seed/index.ts";
import { getTransitConflicts } from "../../src/lib/venue-geometry.ts";
import { emit, recordSpeedHarness, writeReport } from "./lib/command.mjs";
import { runSeedApiChecks, withLocalRuntime } from "./seed.ts";

const startedAt = performance.now();
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
const elapsedMs = Math.round(performance.now() - startedAt);
const budgetMs = 30_000;

const result = {
  command: "check:seed",
  status: elapsedMs <= budgetMs ? "pass" : "fail",
  elapsedMs,
  budgetMs,
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
const report = await writeReport("artifacts/checks/seed.json", result);
await recordSpeedHarness("check_seed", {
  observedMs: elapsedMs,
  budgetMs,
  verdict: result.status,
  source: "local check:seed wall clock",
  environment: "local worktree; not deployed evidence",
});
emit({ ...result, report });
if (result.status === "fail") process.exitCode = 1;
