import { expect, test } from "vitest";

import {
  arrivalForSession,
  buildingGeo,
  sessionLocation,
  walkingMinutes,
  type ArrivalBuilding,
} from "../../src/lib/venue-geometry";

const primary: ArrivalBuilding = {
  id: "building-primary",
  name: "Primary Hall",
  address: "1 Conference Way",
  lat: 40.7625,
  lng: -73.9814,
  access_minutes: 0,
  access_note: "Use the north lobby",
};

const annex: ArrivalBuilding = {
  id: "building-annex",
  name: "South Annex",
  address: "2 Conference Way",
  lat: 40.7586,
  lng: -73.9861,
  access_minutes: 3,
  access_note: "Use the south lobby",
};

test("AC-260 · arrival projection uses the previous same-day session and canonical walkingMinutes math", () => {
  const previousStarts = Date.parse("2026-08-12T15:00:00.000Z");
  const currentStarts = Date.parse("2026-08-12T17:00:00.000Z");
  const walk = walkingMinutes(primary, annex);
  const projection = arrivalForSession({
    current: { id: "current", starts_at: currentStarts, duration_min: 30, room_name: "Room 201", building: annex },
    previousSessions: [{ id: "previous", starts_at: previousStarts, duration_min: 30, room_name: "Room 101", building: primary }],
    primaryBuilding: primary,
    timezone: "UTC",
  });

  expect(projection).toMatchObject({
    status: "ready",
    origin: primary,
    previous_session: expect.objectContaining({ id: "previous" }),
    walk_minutes: walk,
    access_minutes: 3,
    leave_by: currentStarts - ((walk ?? 0) + 3) * 60_000,
  });
  expect(sessionLocation("Room 201", annex)).toBe("Room 201, South Annex, 2 Conference Way");
  expect(buildingGeo(annex)).toEqual({ lat: 40.7586, lng: -73.9861 });
});

test("AC-260 · arrival falls back to the primary building and stays honest when pins are missing", () => {
  const currentStarts = Date.parse("2026-08-12T17:00:00.000Z");
  const fallback = arrivalForSession({
    current: { id: "current", starts_at: currentStarts, duration_min: 30, room_name: "Room 101", building: primary },
    previousSessions: [{ id: "previous-day", starts_at: Date.parse("2026-08-11T15:00:00.000Z"), duration_min: 30, room_name: "Room 201", building: annex }],
    primaryBuilding: primary,
    timezone: "UTC",
  });
  expect(fallback).toMatchObject({ status: "ready", origin: primary, previous_session: null, walk_minutes: 0, leave_by: currentStarts });

  const unpinned = arrivalForSession({
    current: { id: "current", starts_at: currentStarts, duration_min: 30, room_name: "Room 201", building: { ...annex, lat: null, lng: null } },
    previousSessions: [],
    primaryBuilding: primary,
    timezone: "UTC",
  });
  expect(unpinned.status).toBe("unavailable");
  expect(unpinned.leave_by).toBeNull();
  expect(buildingGeo(unpinned.building)).toBeNull();
});
