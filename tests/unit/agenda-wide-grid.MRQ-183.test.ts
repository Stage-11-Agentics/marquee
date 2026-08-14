import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import type { AgendaConflict, AgendaRoom, AgendaSession, AgendaSnapshot } from "../../src/api/agenda";
import type { AgendaGridSlot } from "../../src/lib/agenda-grid";
import {
  ConflictCounter,
  DayBoard,
  SessionTile,
  conflictDetailsBySession,
  orderedAgendaRooms,
} from "../../src/ui/agenda/AgendaPage";

const START = Date.UTC(2026, 9, 12, 10);
const slot: AgendaGridSlot = { time: "10:00", minutes: 600, isHour: true };

const building = {
  id: "building-main",
  name: "Hall",
  address: "1 Conference Way",
  lat: null,
  lng: null,
  access_minutes: 0,
};

function room(id: string, position: number): AgendaRoom {
  return {
    id,
    name: `Room ${id}`,
    label: `Room ${id} · Hall`,
    position,
    capacity: 100,
    building,
    av_capabilities: [],
    notes: null,
  };
}

const rooms = [room("oldest", 0), room("second", 1), room("middle", 2), room("latest", 3), room("newest", 10)];

const snapshot: AgendaSnapshot = {
  event: { id: "event", name: "Demo Conference", starts_on: "2026-10-12", ends_on: "2026-10-12", timezone: "UTC" },
  publication: { live: 0, not_yet_public: 0, candidates: [], public_agenda_url: "/agenda?event=event" },
  schedulable_statuses: ["accepted"],
  rooms,
  formats: [{ id: "format-stage", name: "Stage Talk", default_duration_min: 45, min_duration_min: 15, max_duration_min: 60 }],
  tracks: [{ id: "track-main", name: "Main", color: "#0b6a72" }],
  sessions: [],
  unscheduled: [],
  conflicts: [],
};

function session(id: string, title: string, roomId: string, speakerId: string, speakerName: string): AgendaSession {
  return {
    id,
    submission_id: `submission-${id}`,
    kind: "session",
    title,
    starts_at: START,
    duration_min: 45,
    room_id: roomId,
    room: `Room ${roomId}`,
    building: "Hall",
    track_id: "track-main",
    track: "Main",
    tracks: [{ id: "track-main", name: "Main", color: "#0b6a72", is_primary: true }],
    speakers: [{ id: speakerId, name: speakerName, company: null }],
    has_declined_participant: false,
    format_id: "format-stage",
    format: "Stage Talk",
    status: "scheduled",
    is_published: false,
    updated_at: START,
    etag: `"${id}:${START}"`,
  };
}

const firstSession = session("session-a", "Opening keynote", "oldest", "person-priya", "Priya Raman");
const counterpartSession = session("session-b", "Platform deep dive", "second", "person-priya", "Priya Raman");
const personConflict: AgendaConflict = {
  kind: "person",
  message: "Priya Raman is double-booked across two Sessions.",
  session_ids: [firstSession.id, counterpartSession.id],
  person_id: "person-priya",
};

const tileHandlers = {
  onDragStart: () => undefined,
  onResize: () => undefined,
  onMove: () => undefined,
  onUnplace: () => undefined,
  onRoomOpen: () => undefined,
};

describe("MRQ-183 agenda builder contracts", () => {
  test("CONTRACT · conflict badges name the person and counterpart and mark both Sessions", () => {
    const conflictsBySession = conflictDetailsBySession([personConflict]);
    expect(conflictsBySession.get(firstSession.id)).toEqual([personConflict]);
    expect(conflictsBySession.get(counterpartSession.id)).toEqual([personConflict]);

    const focused = renderToString(h(SessionTile, {
      snapshot: { ...snapshot, sessions: [firstSession, counterpartSession], conflicts: [personConflict] },
      session: firstSession,
      sessions: [firstSession, counterpartSession],
      conflicts: new Map([[firstSession.id, "Conflict" as const], [counterpartSession.id, "Conflict" as const]]),
      conflictsBySession,
      conflictFocus: firstSession.id,
      ...tileHandlers,
    }));
    const counterpart = renderToString(h(SessionTile, {
      snapshot: { ...snapshot, sessions: [firstSession, counterpartSession], conflicts: [personConflict] },
      session: counterpartSession,
      sessions: [firstSession, counterpartSession],
      conflicts: new Map([[firstSession.id, "Conflict" as const], [counterpartSession.id, "Conflict" as const]]),
      conflictsBySession,
      conflictFocus: firstSession.id,
      ...tileHandlers,
    }));

    expect(focused).toContain("Conflict · Priya Raman · with Platform deep dive");
    expect(focused).toContain("is-conflict-focus");
    expect(focused).toContain("Platform deep dive");
    expect(counterpart).toContain("is-conflict-counterpart");
    expect(counterpart).toContain("Opening keynote");
  });

  test("CONTRACT · eleven-room grids lead with the newest room and keep the time axis in the markup", () => {
    expect(orderedAgendaRooms(rooms).map((candidate) => candidate.id)).toEqual([
      "newest",
      "latest",
      "middle",
      "second",
      "oldest",
    ]);

    const markup = renderToString(h(DayBoard, {
      snapshot,
      sessions: [],
      day: "2026-10-12",
      slots: [slot],
      onDrop: () => undefined,
      onPlace: () => undefined,
      armedPlacement: null,
      placementBusy: false,
      conflicts: new Map(),
      ...tileHandlers,
    }));
    const roomHeads = [...markup.matchAll(/data-room-head="([^"]+)"/g)].map((match) => match[1]);
    expect(roomHeads).toEqual(["newest", "latest", "middle", "second", "oldest"]);
    expect(markup).toContain('data-room-order="newest-first"');
    expect(markup).toContain("wide-grid-content");
    expect(markup).toContain("5</strong><span>rooms · newest first · scroll for more");
    expect(markup).toContain("agenda-time tabular");
  });

  test("CONTRACT · the conflict counter is an explicit door into live detection", () => {
    const markup = renderToString(h(ConflictCounter, { count: 7, open: false, onOpen: () => undefined }));
    expect(markup).toContain('data-conflict-counter="true"');
    expect(markup).toContain('aria-controls="agenda-conflicts-panel"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Open live agenda conflict details");
    expect(markup).toContain(">7</span> conflicts");
  });
});
