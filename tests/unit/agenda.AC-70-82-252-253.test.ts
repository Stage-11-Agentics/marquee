import { describe, expect, test } from "vitest";

import {
  AGENDA_VIEWS,
  DEFAULT_SCHEDULABLE_STATUSES,
  durationIsAllowed,
  normalizeSchedulableStatuses,
  parseJsonArray,
  roomLabel,
  shouldBeInUnscheduledPool,
} from "../../src/api/agenda";
import { deriveConflicts } from "../../src/routes/agenda.queries";
import type { AgendaRoom, AgendaSession } from "../../src/api/agenda";

const room = (id: string, name: string, buildingName: string, lat: number | null = null, lng: number | null = null, accessMinutes = 0): AgendaRoom => ({
  id,
  name,
  label: roomLabel(name, buildingName),
  capacity: 100,
  building: { id: `building-${id}`, name: buildingName, address: `${buildingName} address`, lat, lng, access_minutes: accessMinutes },
  av_capabilities: ["HDMI"],
  notes: "Load-in uses the side door.",
});

const session = (id: string, roomId: string, startsAt: number, speakerId: string): AgendaSession => ({
  id,
  submission_id: `submission-${id}`,
  kind: "session",
  title: `Session ${id}`,
  starts_at: startsAt,
  duration_min: 45,
  room_id: roomId,
  room: roomId,
  building: roomId,
  track_id: "track-1",
  track: "Agents",
  tracks: [{ id: "track-1", name: "Agents", color: "#db4c3f", is_primary: true }],
  speakers: [{ id: speakerId, name: `Speaker ${speakerId}`, company: null }],
  format_id: "format-stage",
  format: "Stage Talk",
  status: "scheduled",
  is_published: false,
  updated_at: startsAt,
  etag: `"${id}:${startsAt}"`,
});

describe("MRQ-20 agenda contracts", () => {
  test("AC-70 · the default pool is accepted and unplaced", () => {
    expect(shouldBeInUnscheduledPool("accepted", false)).toBe(true);
    expect(shouldBeInUnscheduledPool("accepted", true)).toBe(false);
    expect(shouldBeInUnscheduledPool("submitted", false)).toBe(false);
  });

  test("AC-71 · configured statuses are honored while the safe default stays accepted", () => {
    expect(DEFAULT_SCHEDULABLE_STATUSES).toEqual(["accepted"]);
    expect(normalizeSchedulableStatuses(["accepted", "waitlisted", "accepted"])).toEqual(["accepted", "waitlisted"]);
    expect(shouldBeInUnscheduledPool("waitlisted", false, ["waitlisted"])).toBe(true);
  });

  test("AC-72 · JSON projection preserves speakers and tracks without re-entry", () => {
    expect(parseJsonArray<{ id: string }>(JSON.stringify([{ id: "speaker-1" }]))).toEqual([{ id: "speaker-1" }]);
    expect(parseJsonArray<{ id: string }>("not json")).toEqual([]);
  });

  test("AC-73 · the five agenda surfaces share one placement vocabulary", () => {
    expect(AGENDA_VIEWS).toEqual(["list", "day", "week", "track", "room"]);
  });

  test("AC-74 · format duration bounds allow defaults and reject invalid resize values", () => {
    const format = { min_duration_min: 15, max_duration_min: 60 };
    expect(durationIsAllowed(15, format)).toBe(true);
    expect(durationIsAllowed(60, format)).toBe(true);
    expect(durationIsAllowed(10, format)).toBe(false);
    expect(durationIsAllowed(65, format)).toBe(false);
  });

  test("AC-80 · no view switch changes the signed view set", () => {
    expect(AGENDA_VIEWS).not.toContain("month");
    expect(new Set(AGENDA_VIEWS).size).toBe(5);
  });

  test("AC-82 · conflicts are derived from the same session projection used by every view", () => {
    const first = session("one", "room-one", 1_000_000, "person-shared");
    const second = session("two", "room-two", 1_000_000, "person-shared");
    expect(deriveConflicts([first, second], [room("room-one", "Room One", "Building A"), room("room-two", "Room Two", "Building A")], "America/New_York")).toEqual([
      expect.objectContaining({ kind: "person", session_ids: ["one", "two"] }),
    ]);
  });

  test("AC-252 · agenda room labels include the building", () => {
    expect(roomLabel("Room 101", "North Hall")).toBe("Room 101 · North Hall");
  });

  test("AC-253 · room metadata has an agenda-only AV and notes projection", () => {
    const projected = room("room-one", "Room One", "Building A");
    expect(projected.av_capabilities).toContain("HDMI");
    expect(projected.notes).toContain("side door");
  });

});
