import { describe, expect, test } from "vitest";

import type { AgendaPoolItem, AgendaSession, AgendaSnapshot } from "../../src/api/agenda";
import { roomLabel } from "../../src/api/agenda";
import { autoPlaceSummary, MAX_AUTO_PLACEMENTS, planAutoPlacements } from "../../src/lib/auto-place";
import { autoPlaceSlots } from "../../src/ui/agenda/AgendaPage";

const HOUR = 3_600_000;
/** 2026-05-04T09:00 in New York, the first slot the board offers on day one. */
const NINE_AM = Date.UTC(2026, 4, 4, 13, 0);

const rooms = [
  { id: "room-a", name: "Hall A" },
  { id: "room-b", name: "Hall B" },
];

const slots = [
  { day: "2026-05-04", time: "09:00", starts_at: NINE_AM },
  { day: "2026-05-04", time: "10:00", starts_at: NINE_AM + HOUR },
  { day: "2026-05-04", time: "11:00", starts_at: NINE_AM + 2 * HOUR },
];

function poolItem(id: string, overrides: Partial<AgendaPoolItem> = {}): AgendaPoolItem {
  return {
    submission_id: id,
    kind: "abstract",
    title: `Talk ${id}`,
    status: "accepted",
    format_id: "format-stage",
    format: "Stage Talk",
    default_duration_min: 45,
    min_duration_min: 30,
    max_duration_min: 60,
    speakers: [{ id: `person-${id}`, name: `Speaker ${id}`, company: null }],
    tracks: [{ id: "track-1", name: "Agents", color: "#db4c3f", is_primary: true }],
    updated_at: 1,
    ...overrides,
  };
}

function placedSession(id: string, roomId: string, startsAt: number, speakerId = `person-${id}`): AgendaSession {
  return {
    id,
    submission_id: `submission-${id}`,
    kind: "session",
    title: `Placed ${id}`,
    starts_at: startsAt,
    duration_min: 45,
    room_id: roomId,
    room: roomId,
    building: "Main",
    track_id: "track-1",
    track: "Agents",
    tracks: [{ id: "track-1", name: "Agents", color: "#db4c3f", is_primary: true }],
    speakers: [{ id: speakerId, name: `Speaker ${speakerId}`, company: null }],
    has_declined_participant: false,
    format_id: "format-stage",
    format: "Stage Talk",
    status: "scheduled",
    is_published: false,
    updated_at: startsAt,
    etag: `"${id}:${startsAt}"`,
  };
}

describe("MRQ-148 · one-action assisted placement", () => {
  test("CONTRACT · an empty grid seats every unscheduled Session in a real slot and room", () => {
    const plan = planAutoPlacements({
      sessions: [],
      rooms,
      unscheduled: [poolItem("one"), poolItem("two"), poolItem("three")],
      slots,
    });

    expect(plan.placements).toHaveLength(3);
    expect(plan.remaining).toBe(0);
    for (const placement of plan.placements) {
      expect(slots.some((slot) => slot.starts_at === placement.starts_at)).toBe(true);
      expect(rooms.some((room) => room.id === placement.room_id)).toBe(true);
      expect(placement.duration_min).toBe(45);
      expect(placement.track_id).toBe("track-1");
    }
    // Two rooms in the first slot, then the next slot: no room is double-booked.
    const keys = plan.placements.map((placement) => `${placement.starts_at}:${placement.room_id}`);
    expect(new Set(keys).size).toBe(3);
  });

  test("CONTRACT · an occupied room at that time is skipped rather than double-booked", () => {
    const plan = planAutoPlacements({
      sessions: [placedSession("existing", "room-a", NINE_AM)],
      rooms,
      unscheduled: [poolItem("one")],
      slots,
    });

    expect(plan.placements).toHaveLength(1);
    expect(plan.placements[0]).toMatchObject({ room_id: "room-b", starts_at: NINE_AM });
  });

  test("CONTRACT · a speaker already on stage is not booked against themselves", () => {
    const plan = planAutoPlacements({
      sessions: [placedSession("existing", "room-a", NINE_AM, "person-one")],
      rooms,
      unscheduled: [poolItem("one")],
      slots,
    });

    expect(plan.placements).toHaveLength(1);
    // Hall B is free at 09:00, but the speaker is not — so the pass moves on an hour.
    expect(plan.placements[0]).toMatchObject({ starts_at: NINE_AM + HOUR });
  });

  test("CONTRACT · Sessions that cannot be seated are counted, not silently dropped", () => {
    const plan = planAutoPlacements({
      sessions: [],
      rooms: [rooms[0]!],
      unscheduled: [poolItem("one"), poolItem("two"), poolItem("three"), poolItem("four")],
      slots,
    });

    expect(plan.placements).toHaveLength(3);
    expect(plan.remaining).toBe(1);
    expect(autoPlaceSummary(plan)).toBe("Auto-placed 3 Sessions into open slots · 1 still unscheduled · review and adjust");
  });

  test("CONTRACT · one pass is capped so a click cannot fire an unbounded write storm", () => {
    const manySlots = Array.from({ length: 40 }, (_, index) => ({
      day: "2026-05-04",
      time: `slot-${index}`,
      starts_at: NINE_AM + index * HOUR,
    }));
    const plan = planAutoPlacements({
      sessions: [],
      rooms,
      unscheduled: Array.from({ length: 40 }, (_, index) => poolItem(`item-${index}`)),
      slots: manySlots,
    });

    expect(plan.placements).toHaveLength(MAX_AUTO_PLACEMENTS);
    expect(plan.remaining).toBe(40 - MAX_AUTO_PLACEMENTS);
  });

  test("CONTRACT · the copy never claims a model did the work", () => {
    const summary = autoPlaceSummary(planAutoPlacements({ sessions: [], rooms, unscheduled: [poolItem("one")], slots }));
    expect(summary).toContain("Auto-placed 1 Session");
    expect(summary.toLowerCase()).not.toContain("ai");
    expect(summary.toLowerCase()).not.toContain("intelligen");
  });

  test("CONTRACT · an empty pool reports honestly instead of pretending to work", () => {
    const plan = planAutoPlacements({ sessions: [], rooms, unscheduled: [], slots });
    expect(plan.placements).toHaveLength(0);
    expect(autoPlaceSummary(plan)).toBe("Nothing to auto-place · every schedulable Session is already on the agenda");
  });

  test("CONTRACT · slots come from the conference's own days and grid times, in board order", () => {
    const snapshot = {
      event: { id: "event-1", name: "AIE", starts_on: "2026-05-04", ends_on: "2026-05-05", timezone: "America/New_York" },
      schedule_window: { outside_window_session_count: 0 },
      publication: { live: 0, not_yet_public: 0, candidates: [], public_agenda_url: "/agenda" },
      schedulable_statuses: ["accepted"],
      rooms: [{
        id: "room-a",
        name: "Hall A",
        label: roomLabel("Hall A", "Main"),
        capacity: 100,
        building: { id: "building-1", name: "Main", address: "1 Main", lat: null, lng: null, access_minutes: 0 },
        av_capabilities: [],
        notes: null,
      }],
      formats: [],
      tracks: [],
      sessions: [],
      unscheduled: [],
      conflicts: [],
    } satisfies AgendaSnapshot;

    const built = autoPlaceSlots(snapshot);

    // Forty-eight 15-minute grid targets across both conference days, earliest first.
    expect(built).toHaveLength(96);
    expect(built[0]).toMatchObject({ day: "2026-05-04", time: "09:00", starts_at: NINE_AM });
    expect(built[48]).toMatchObject({ day: "2026-05-05", time: "09:00" });
    for (let index = 1; index < built.length; index += 1) {
      expect(built[index]!.starts_at).toBeGreaterThan(built[index - 1]!.starts_at);
    }
  });
});
