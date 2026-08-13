import { describe, expect, test } from "vitest";

import type { AgendaRoom, AgendaSession } from "../../src/api/agenda";
import type { SubmissionParticipationRole, SubmissionSpeakerListItem } from "../../src/api/submissions";
import { deriveConflicts } from "../../src/routes/agenda.queries";

const ROLES: readonly SubmissionParticipationRole[] = [
  "speaker",
  "co_speaker",
  "moderator",
  "chairperson",
];

const room = (id: string): AgendaRoom => ({
  id,
  name: `Room ${id}`,
  label: `Room ${id} · Main Hall`,
  capacity: 100,
  building: { id: "building-main", name: "Main Hall", address: "1 Conference Way", lat: null, lng: null, access_minutes: 0 },
  av_capabilities: [],
  notes: null,
});

const participant = (id: string, role?: SubmissionParticipationRole): SubmissionSpeakerListItem => ({
  id,
  name: `Participant ${id}`,
  company: null,
  ...(role ? { role } : {}),
});

const session = (
  id: string,
  roomId: string,
  startsAt: number,
  participants: SubmissionSpeakerListItem[],
): AgendaSession => ({
  id,
  submission_id: `submission-${id}`,
  kind: "session",
  title: `Session ${id}`,
  starts_at: startsAt,
  duration_min: 45,
  room_id: roomId,
  room: `Room ${roomId}`,
  building: "Main Hall",
  track_id: "track-main",
  track: "Main",
  tracks: [{ id: "track-main", name: "Main", color: "#db4c3f", is_primary: true }],
  speakers: participants,
  has_declined_participant: participants.some((participant) => participant.confirmation_status === "declined"),
  format_id: "format-stage",
  format: "Stage Talk",
  status: "scheduled",
  is_published: false,
  updated_at: startsAt,
  etag: `"${id}:${startsAt}"`,
});

const rooms = [room("one"), room("two")];
const START = Date.UTC(2026, 9, 12, 13);

describe("MRQ-21 agenda conflict computation", () => {
  test("AC-76 · overlapping sessions in one room warn while separated sessions do not", () => {
    const overlapping = deriveConflicts([
      session("one", "one", START, [participant("person-room")]),
      session("two", "one", START + 15 * 60_000, [participant("person-other")]),
    ], rooms, "America/New_York");
    expect(overlapping).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "room", session_ids: ["one", "two"] }),
    ]));

    const separated = deriveConflicts([
      session("one", "one", START, [participant("person-room")]),
      session("two", "one", START + 60 * 60_000, [participant("person-other")]),
    ], rooms, "America/New_York");
    expect(separated.some((conflict) => conflict.kind === "room")).toBe(false);
  });

  test("AC-77 · every participation role raises a person conflict", () => {
    for (const role of ROLES) {
      const personId = `person-${role}`;
      const conflicts = deriveConflicts([
        session(`first-${role}`, "one", START, [participant(personId, role)]),
        session(`second-${role}`, "two", START, [participant(personId, role)]),
      ], rooms, "America/New_York");
      expect(conflicts.filter((conflict) => conflict.kind === "person" && conflict.person_id === personId)).toHaveLength(1);
    }
  });

  test("MRQ-164 · a Session whose only participant is its submitter is still double-booked", () => {
    const personId = "person-submitter-only";
    const conflicts = deriveConflicts([
      session("first", "one", START, [participant(personId, "co_speaker"), participant("person-lead", "speaker")]),
      // "+ Add session" records one participation, of role submitter. The tile
      // names this person, so the panel must too.
      session("second", "two", START, [participant(personId, "submitter")]),
    ], rooms, "America/New_York");
    expect(conflicts.filter((conflict) => conflict.kind === "person" && conflict.person_id === personId)).toHaveLength(1);
  });

  test("MRQ-164 · a submitter who is not presenting raises no conflict beside a real speaker", () => {
    const conflicts = deriveConflicts([
      session("first", "one", START, [participant("person-speaker", "speaker"), participant("person-desk", "submitter")]),
      session("second", "two", START, [participant("person-desk", "submitter"), participant("person-other", "speaker")]),
    ], rooms, "America/New_York");
    expect(conflicts.some((conflict) => conflict.kind === "person" && conflict.person_id === "person-desk")).toBe(false);
  });

  test("AC-77 · one person holding two roles still produces one person conflict", () => {
    const personId = "person-two-roles";
    const conflicts = deriveConflicts([
      session("first", "one", START, [participant(personId, "submitter"), participant(personId, "speaker")]),
      session("second", "two", START, [participant(personId, "chairperson")]),
    ], rooms, "America/New_York");
    expect(conflicts.filter((conflict) => conflict.kind === "person" && conflict.person_id === personId)).toHaveLength(1);
  });
});
