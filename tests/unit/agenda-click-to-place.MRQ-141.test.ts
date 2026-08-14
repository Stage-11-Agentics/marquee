import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import type { AgendaPoolItem, AgendaSession, AgendaSnapshot } from "../../src/api/agenda";
import { generateAgendaGridSlots } from "../../src/lib/agenda-grid";
import {
  agendaPlacementRequest,
  AgendaDayStatus,
  DayBoard,
  Pool,
  RoomBoard,
  SessionTile,
  WeekBoard,
} from "../../src/ui/agenda/AgendaPage";

const DAY = { value: "2026-10-12", label: "Mon · Oct 12" };
const START = Date.UTC(2026, 9, 12, 9);
const source = readFileSync(resolve(process.cwd(), "src/ui/agenda/AgendaPage.tsx"), "utf8");

const poolItem: AgendaPoolItem = {
  submission_id: "submission-pool",
  kind: "abstract",
  title: "Accessible placement",
  status: "accepted",
  format_id: "format-stage",
  format: "Stage Talk",
  default_duration_min: 45,
  min_duration_min: 15,
  max_duration_min: 60,
  speakers: [{ id: "person-pool", name: "Ada Ellery", company: null }],
  tracks: [{ id: "track-agents", name: "Agents", color: "#db4c3f", is_primary: true }],
  updated_at: START,
};

const snapshot: AgendaSnapshot = {
  event: { id: "event", name: "Demo Conference", starts_on: DAY.value, ends_on: DAY.value, timezone: "UTC" },
  schedule_window: { outside_window_session_count: 0 },
  publication: { live: 0, not_yet_public: 0, candidates: [], public_agenda_url: "/agenda?event=event" },
  schedulable_statuses: ["accepted"],
  rooms: [{
    id: "room-2a",
    name: "Room 2A",
    label: "Room 2A · Hall",
    capacity: 100,
    building: { id: "building-hall", name: "Hall", address: "1 Conference Way", lat: null, lng: null, access_minutes: 0 },
    av_capabilities: [],
    notes: null,
  }],
  formats: [{ id: "format-stage", name: "Stage Talk", default_duration_min: 45, min_duration_min: 15, max_duration_min: 60 }],
  tracks: [{ id: "track-agents", name: "Agents", color: "#db4c3f" }],
  sessions: [],
  unscheduled: [poolItem],
  conflicts: [],
};

const armed = { payload: { kind: "pool" as const, id: poolItem.submission_id }, title: poolItem.title };
const noop = () => undefined;

function scheduledSession(): AgendaSession {
  return {
    id: "agenda-session",
    submission_id: "submission-session",
    kind: "session",
    title: "Scheduled access",
    starts_at: START,
    duration_min: 45,
    room_id: "room-2a",
    room: "Room 2A",
    building: "Hall",
    track_id: "track-agents",
    track: "Agents",
    tracks: [{ id: "track-agents", name: "Agents", color: "#db4c3f", is_primary: true }],
    speakers: [{ id: "person-session", name: "Talia Moran", company: null }],
    has_declined_participant: false,
    format_id: "format-stage",
    format: "Stage Talk",
    status: "scheduled",
    is_published: false,
    updated_at: START,
    etag: '"agenda-session:1"',
  };
}

describe("CONTRACT · MRQ-141 click-to-place", () => {
  test("CONTRACT · MRQ-142 · the builder keeps a named empty-day status beside the day selector", () => {
    const emptyDay = renderToString(h(AgendaDayStatus, {
      snapshot: { ...snapshot, event: { ...snapshot.event, ends_on: "2026-10-14" }, sessions: [scheduledSession()] },
      day: "2026-10-14",
    }));
    expect(emptyDay).toContain("Nothing scheduled on this day yet");
    expect(emptyDay).toContain("place a Session here from the unscheduled pool");
  });

  test("CONTRACT · one request builder preserves the pool POST and scheduled PATCH placement writes", () => {
    const poolRequest = agendaPlacementRequest(snapshot, armed.payload, { day: DAY.value, time: "10:00", roomId: "room-2a" }, "event");
    expect(poolRequest).toMatchObject({ path: "/api/v1/events/event/agenda/items", route: "/api/v1/events/{eventId}/agenda/items" });
    expect(JSON.parse(String(poolRequest?.init.body))).toMatchObject({
      submission_id: "submission-pool",
      room_id: "room-2a",
      track_id: "track-agents",
      starts_at: Date.UTC(2026, 9, 12, 10),
    });

    const session = scheduledSession();
    const moveRequest = agendaPlacementRequest({ ...snapshot, sessions: [session] }, { kind: "session", id: session.id }, { day: DAY.value, time: "11:00", roomId: "room-2a" }, "event");
    expect(moveRequest).toMatchObject({ path: "/api/v1/events/event/agenda/items/agenda-session", route: "/api/v1/events/{eventId}/agenda/items/{itemId}" });
    expect(moveRequest?.init.headers).toEqual({ "If-Match": session.etag });
    expect(JSON.parse(String(moveRequest?.init.body))).toEqual({ starts_at: Date.UTC(2026, 9, 12, 11), room_id: "room-2a" });
  });

  test("CONTRACT · drag and armed activation both call the shared placement operation", () => {
    expect(source).toMatch(/const request = agendaPlacementRequest\(current, payload, target, eventId\)/);
    expect(source).toMatch(/await place\(payload, \{ day: targetDay, time: targetTime, roomId, trackId \}\)/);
    expect(source).toMatch(/void place\(armedPlacement\.payload, target\)/);
  });

  test("CONTRACT · armed day week and room slots render named native placement buttons", () => {
    const day = renderToString(h(DayBoard, {
      snapshot,
      sessions: [],
      day: DAY.value,
      onDrop: noop,
      onPlace: noop,
      armedPlacement: armed,
      placementBusy: false,
      onDragStart: noop,
      onResize: noop,
      onMove: noop,
      onUnplace: noop,
      onRoomOpen: noop,
      conflicts: new Map(),
    }));
    const week = renderToString(h(WeekBoard, {
      snapshot,
      sessions: [],
      days: [DAY],
      onDrop: noop,
      onPlace: noop,
      armedPlacement: armed,
      placementBusy: false,
      onDragStart: noop,
      onResize: noop,
      onMove: noop,
      onUnplace: noop,
      onRoomOpen: noop,
      conflicts: new Map(),
    }));
    const room = renderToString(h(RoomBoard, {
      snapshot,
      sessions: [],
      days: [DAY],
      onDrop: noop,
      onPlace: noop,
      armedPlacement: armed,
      placementBusy: false,
      onDragStart: noop,
      onResize: noop,
      onMove: noop,
      onUnplace: noop,
      onRoomOpen: noop,
      conflicts: new Map(),
    }));

    for (const markup of [day, week, room]) {
      expect(markup).toContain('type="button"');
      expect(markup).toContain('aria-label="Place at 10:00 · Room 2A"');
    }
  });

  test("CONTRACT · selected click slots expose :15 targets while odd stored starts remain visible", () => {
    const fiveSlots = generateAgendaGridSlots(5);
    const armedDay = renderToString(h(DayBoard, {
      snapshot,
      sessions: [],
      day: DAY.value,
      slots: fiveSlots,
      onDrop: noop,
      onPlace: noop,
      armedPlacement: armed,
      placementBusy: false,
      onDragStart: noop,
      onResize: noop,
      onMove: noop,
      onUnplace: noop,
      onRoomOpen: noop,
      conflicts: new Map(),
    }));
    expect(armedDay).toContain('aria-label="Place at 10:15 · Room 2A"');
    expect(armedDay).toContain('aria-label="Place at 10:20 · Room 2A"');

    const odd = scheduledSession();
    odd.starts_at = Date.UTC(2026, 9, 12, 10, 20);
    const oddDay = renderToString(h(DayBoard, {
      snapshot: { ...snapshot, unscheduled: [], sessions: [odd] },
      sessions: [odd],
      day: DAY.value,
      slots: generateAgendaGridSlots(15),
      onDrop: noop,
      onPlace: noop,
      armedPlacement: null,
      placementBusy: false,
      onDragStart: noop,
      onResize: noop,
      onMove: noop,
      onUnplace: noop,
      onRoomOpen: noop,
      conflicts: new Map(),
    }));
    expect(oddDay).toContain('data-session-id="agenda-session"');
    expect(oddDay).toContain("Scheduled access · 10:20");
    expect(oddDay).toMatch(/class="agenda-session-position" style="top:[^%]+%;"/);

    const armedOddDay = renderToString(h(DayBoard, {
      snapshot: { ...snapshot, sessions: [odd] },
      sessions: [odd],
      day: DAY.value,
      slots: generateAgendaGridSlots(15),
      onDrop: noop,
      onPlace: noop,
      armedPlacement: armed,
      placementBusy: false,
      onDragStart: noop,
      onResize: noop,
      onMove: noop,
      onUnplace: noop,
      onRoomOpen: noop,
      conflicts: new Map(),
    }));
    expect(armedOddDay).toContain('data-session-id="agenda-session"');
    expect(armedOddDay).not.toContain('aria-label="Place at 10:15 · Room 2A"');
  });

  test("CONTRACT · pool selection and scheduled tiles expose the non-mouse controls", () => {
    const pool = renderToString(h(Pool, {
      snapshot,
      query: "",
      setQuery: noop,
      track: "",
      onDragStart: noop,
      onDrop: noop,
      onArm: noop,
      armedPlacement: armed,
    }));
    const tile = renderToString(h(SessionTile, {
      snapshot,
      session: scheduledSession(),
      onDragStart: noop,
      onResize: noop,
      onMove: noop,
      onUnplace: noop,
      onRoomOpen: noop,
      conflicts: new Map(),
    }));

    expect(pool).toContain('aria-label="Placing Accessible placement"');
    expect(pool).toContain('aria-pressed="true"');
    expect(tile).toContain(">Move…</button>");
    expect(tile).toContain(">Unplace</button>");
  });
});
