import assert from "node:assert/strict";
import test from "node:test";

import { getTransitConflicts, walkingMinutes } from "../../src/lib/venue-geometry.ts";
import { buildSeedRows } from "../../scripts/seed/index.ts";

const rows = await buildSeedRows();
const table = (name) => rows.filter((row) => row.table === name).map((row) => row.row);

test("AC-259 · the seeded agenda produces a live Transit conflict with walk, access, needed, and available minutes", () => {
  const buildings = table("buildings");
  const rooms = new Map(table("rooms").map((room) => [room.id, room]));
  const peopleBySubmission = new Map();
  for (const participation of table("participations")) {
    const people = peopleBySubmission.get(participation.submission_id) ?? [];
    people.push(participation.person_id);
    peopleBySubmission.set(participation.submission_id, people);
  }
  const agenda = table("agenda_items").filter((item) => item.kind === "session").map((item) => ({
    id: item.id,
    starts_at: item.starts_at,
    duration_min: item.duration_min,
    building_id: rooms.get(item.room_id)?.building_id ?? null,
    person_ids: peopleBySubmission.get(item.submission_id) ?? [],
  }));
  const conflicts = getTransitConflicts(agenda, buildings);
  assert.ok(conflicts.length > 0);
  assert.deepEqual(conflicts[0], {
    kind: "transit",
    label: "Transit",
    speaker_id: conflicts[0].speaker_id,
    from_building_id: "bld_sheraton",
    to_building_id: "bld_new-york-marriott-marquis",
    from_building: "Sheraton New York Times Square",
    to_building: "New York Marriott Marquis",
    walk_minutes: 9,
    access_minutes: 3,
    needed_minutes: 12,
    available_minutes: 0,
    message: "Transit — 9 min walk to New York Marriott Marquis, plus 3 min building access. Needs 12 min; has 0.",
  });
});

test("AC-259 · same-building, unpinned, and Online movement never produces Transit", () => {
  const buildings = [
    { id: "a", name: "A", lat: 40, lng: -74, access_minutes: 4 },
    { id: "b", name: "B", lat: null, lng: null, access_minutes: 20 },
    { id: "online", name: "Online", lat: null, lng: null, access_minutes: 0 },
  ];
  const base = { starts_at: 0, duration_min: 30, person_ids: ["speaker"] };
  assert.deepEqual(getTransitConflicts([
    { id: "same-a", ...base, building_id: "a" },
    { id: "same-b", ...base, building_id: "a" },
    { id: "unpinned", ...base, building_id: "b" },
    { id: "online", ...base, building_id: "online" },
  ], buildings), []);
  assert.equal(walkingMinutes(buildings[0], buildings[1]), null);
});
