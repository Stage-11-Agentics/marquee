#!/usr/bin/env node

import assert from "node:assert/strict";

import { buildSeedRows } from "../seed/index.ts";
import { getTransitConflicts } from "../../src/lib/venue-geometry.ts";
import { emit, writeReport } from "./lib/command.mjs";

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

const result = {
  command: "check:seed",
  status: "pass",
  buildings: buildings.map(({ id, name, address, lat, lng, access_minutes }) => ({ id, name, address, lat, lng, access_minutes })),
  pinned_buildings: pinned.length,
  transit_conflicts: conflicts,
};
const report = await writeReport("artifacts/checks/seed.json", result);
emit({ ...result, report });
