import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import type { AgendaSession, AgendaSnapshot } from "../../src/api/agenda";
import { ConflictPanel, SessionTile } from "../../src/ui/agenda/AgendaPage";
import { TIME_SLOTS, TrackBoard, type TrackDay } from "../../src/ui/agenda/track-board";

const DAYS: readonly TrackDay[] = [
  { value: "2026-10-12", label: "Mon · Oct 12" },
  { value: "2026-10-13", label: "Tue · Oct 13" },
];
const START = Date.UTC(2026, 9, 12, 13);

const snapshot: AgendaSnapshot = {
  event: { id: "event", name: "Demo Conference", starts_on: "2026-10-12", ends_on: "2026-10-13", timezone: "UTC" },
  publication: { live: 0, not_yet_public: 0, candidates: [], public_agenda_url: "/agenda?event=event" },
  schedulable_statuses: ["accepted"],
  rooms: [{
    id: "room-main",
    name: "Room Main",
    label: "Room Main · Hall",
    capacity: 100,
    building: { id: "building-main", name: "Hall", address: "1 Conference Way", lat: null, lng: null, access_minutes: 0 },
    av_capabilities: [],
    notes: null,
  }],
  formats: [{ id: "format-stage", name: "Stage Talk", default_duration_min: 45, min_duration_min: 15, max_duration_min: 60 }],
  tracks: [
    { id: "track-agents", name: "Agents", color: "#db4c3f" },
    { id: "track-infra", name: "Infra", color: "#0b6a72" },
    { id: "track-evals", name: "Evals", color: "#8b5cf6" },
  ],
  sessions: [],
  unscheduled: [],
  conflicts: [],
};

function session(id: string, trackId: string, startsAt: number): AgendaSession {
  const track = snapshot.tracks.find((candidate) => candidate.id === trackId)!;
  return {
    id,
    submission_id: `submission-${id}`,
    kind: "session",
    title: `Session ${id}`,
    starts_at: startsAt,
    duration_min: 45,
    room_id: "room-main",
    room: "Room Main",
    building: "Hall",
    track_id: trackId,
    track: track.name,
    tracks: [{ ...track, is_primary: true }],
    speakers: [{ id: `speaker-${id}`, name: `Speaker ${id}`, company: null }],
    has_declined_participant: false,
    format_id: "format-stage",
    format: "Stage Talk",
    status: "scheduled",
    is_published: false,
    updated_at: startsAt,
    etag: `"${id}:${startsAt}"`,
  };
}

const agentsSession = session("agents-session", "track-agents", START);
const infraSession = session("infra-session", "track-infra", START + 24 * 60 * 60_000);
const sessions = [agentsSession, infraSession];

function boardMarkup(boardSessions: readonly AgendaSession[] = sessions): string {
  return renderToString(h(TrackBoard, {
    snapshot,
    sessions: boardSessions,
    days: DAYS,
    onDrop: () => undefined,
    renderTile: (item) => h("article", { class: "agenda-session-tile", "data-session-id": item.id }, item.title),
  }));
}

function laneMarkup(markup: string, trackId: string): string {
  const marker = `data-track-lane="${trackId}"`;
  const markerIndex = markup.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const start = markup.lastIndexOf("<section", markerIndex);
  const end = markup.indexOf("</section>", markerIndex);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return markup.slice(start, end + "</section>".length);
}

describe("MRQ-21 track agenda surface", () => {
  test("AC-81 · lane containers equal tracks and each session is nested in its own lane", () => {
    const markup = boardMarkup();
    expect((markup.match(/data-track-lane=/g) ?? [])).toHaveLength(snapshot.tracks.length);

    for (const track of snapshot.tracks) {
      const lane = laneMarkup(markup, track.id);
      expect((lane.match(/data-track-day-band=/g) ?? [])).toHaveLength(DAYS.length);
      expect((lane.match(/data-track-slot=/g) ?? [])).toHaveLength(DAYS.length * TIME_SLOTS.length);
      for (const item of sessions.filter((candidate) => candidate.track_id === track.id)) {
        expect(lane).toContain(`data-session-id="${item.id}"`);
      }
      for (const item of sessions.filter((candidate) => candidate.track_id !== track.id)) {
        expect(lane).not.toContain(`data-session-id="${item.id}"`);
      }
    }

    const filteredMarkup = boardMarkup([agentsSession]);
    expect((filteredMarkup.match(/data-track-lane=/g) ?? [])).toHaveLength(snapshot.tracks.length);
  });

  test("AC-78 · flagged tiles and the conflicts drawer expose one-click jump targets", () => {
    const tile = renderToString(h(SessionTile, {
      snapshot,
      session: agentsSession,
      onDragStart: () => undefined,
      onResize: () => undefined,
      onRoomOpen: () => undefined,
      conflicts: new Map([[agentsSession.id, "Conflict" as const]]),
    }));
    expect(tile).toContain("has-conflict");
    expect(tile).toContain("Conflict");

    const drawer = renderToString(h(ConflictPanel, {
      conflicts: [{ kind: "person", message: "A participant is double-booked.", session_ids: [agentsSession.id, infraSession.id], person_id: "speaker" }],
      sessions,
      onClose: () => undefined,
      onJump: () => undefined,
    }));
    expect(drawer).toContain(`data-conflict-jump="${agentsSession.id}"`);
    expect(drawer).toContain("Jump to Session");
  });
});
