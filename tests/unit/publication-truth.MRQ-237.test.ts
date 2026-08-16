import { describe, expect, test } from "vitest";

import {
  PUBLICATION_REASON_CODES,
  classifyPublicationFact,
  type PublicationAgendaItemFact,
  type PublicationSubmissionFact,
} from "../../src/lib/publication-truth";

const open = { eventId: "event-1", publicBoundaryOpen: true };

function item(overrides: Partial<PublicationAgendaItemFact> = {}): PublicationAgendaItemFact {
  return {
    id: "agenda-1",
    eventId: "event-1",
    kind: "session",
    startsAt: 1_700_000_000_000,
    durationMin: 30,
    roomId: "room-1",
    isPublished: false,
    updatedAt: 11,
    roomEventId: "event-1",
    buildingEventId: "event-1",
    ...overrides,
  };
}

function fact(overrides: Partial<PublicationSubmissionFact> = {}): PublicationSubmissionFact {
  return {
    id: "submission-1",
    eventId: "event-1",
    kind: "session",
    title: "A truthful Session",
    status: "accepted",
    submissionIsPublished: false,
    submissionUpdatedAt: 10,
    agendaItems: [item()],
    ...overrides,
  };
}

describe("MRQ-237 publication truth partition", () => {
  test("CONTRACT · MRQ-237 · every wire reason code is closed and represented", () => {
    expect(PUBLICATION_REASON_CODES).toEqual([
      "READY_TO_PUBLISH",
      "ALREADY_PUBLISHED",
      "POST_PUBLISH_REVERSED",
      "WRONG_KIND",
      "FOREIGN_EVENT",
      "UNKNOWN_ID",
      "STALE_SELECTION",
      "MALFORMED_SLOT",
      "MISSING_AGENDA_ITEM",
      "MISSING_DATE_TIME",
      "MISSING_DURATION",
      "MISSING_ROOM",
      "FOREIGN_ROOM",
      "NOT_ACCEPTED",
      "PUBLIC_BOUNDARY_CLOSED",
      "PRIVACY_EXCLUDED",
    ]);
  });

  test("CONTRACT · MRQ-237 · the pure classifier partitions unscheduled, withheld, ready, live, and anomaly states", () => {
    expect(classifyPublicationFact(null, open).classification).toBe("UNKNOWN_ID");
    expect(classifyPublicationFact(fact({ kind: "abstract", agendaItems: [] }), open).classification).toBe("WRONG_KIND");
    expect(classifyPublicationFact(fact({ agendaItems: [] }), open)).toMatchObject({
      classification: "ACCEPTED_UNSCHEDULED",
      primaryReasonCode: "MISSING_AGENDA_ITEM",
    });
    expect(classifyPublicationFact(fact({ status: "rejected", agendaItems: [] }), open)).toMatchObject({
      classification: "UNSCHEDULED_WITHHELD",
      primaryReasonCode: "NOT_ACCEPTED",
    });
    expect(classifyPublicationFact(fact(), open)).toMatchObject({
      classification: "READY_TO_PUBLISH",
      primaryReasonCode: "READY_TO_PUBLISH",
    });
    expect(classifyPublicationFact(fact({ agendaItems: [item({ isPublished: true })] }), open)).toMatchObject({
      classification: "PUBLIC_LIVE",
      primaryReasonCode: "ALREADY_PUBLISHED",
    });
    expect(classifyPublicationFact(fact({ status: "withdrawn", agendaItems: [item({ isPublished: true })] }), open)).toMatchObject({
      classification: "BOARD_ANOMALY",
      primaryReasonCode: "POST_PUBLISH_REVERSED",
    });
  });

  test("CONTRACT · MRQ-237 · malformed slots and a closed public boundary remain named rather than silently publishable", () => {
    expect(classifyPublicationFact(fact({ agendaItems: [item({ startsAt: null })] }), open)).toMatchObject({
      classification: "EXISTING_ITEM_MALFORMED",
      primaryReasonCode: "MALFORMED_SLOT",
    });
    expect(classifyPublicationFact(fact({ agendaItems: [item({ roomEventId: "other-event" })] }), open)).toMatchObject({
      classification: "EXISTING_ITEM_MALFORMED",
      primaryReasonCode: "MALFORMED_SLOT",
      reasonCodes: expect.arrayContaining(["FOREIGN_ROOM"]),
    });
    expect(classifyPublicationFact(fact(), { ...open, publicBoundaryOpen: false })).toMatchObject({
      classification: "EXISTING_ITEM_WITHHELD",
      primaryReasonCode: "PUBLIC_BOUNDARY_CLOSED",
    });
    expect(classifyPublicationFact(fact({ agendaItems: [item({ isPublished: true })] }), { ...open, publicBoundaryOpen: false }).classification)
      .toBe("PUBLISHED_NOT_PUBLIC");
  });

  test("CONTRACT · MRQ-237 · named reason details retain the fixed precedence", () => {
    expect(classifyPublicationFact(fact({ eventId: "other-event" }), open)).toMatchObject({
      classification: "FOREIGN_EVENT",
      primaryReasonCode: "FOREIGN_EVENT",
    });
    expect(classifyPublicationFact(fact({ kind: "abstract" }), open).primaryReasonCode).toBe("WRONG_KIND");
    expect(classifyPublicationFact(fact({ agendaItems: [] }), open).reasonCodes).toContain("MISSING_AGENDA_ITEM");
    expect(classifyPublicationFact(fact({ agendaItems: [item({ startsAt: null })] }), open).reasonCodes)
      .toEqual(expect.arrayContaining(["MALFORMED_SLOT", "MISSING_DATE_TIME"]));
    expect(classifyPublicationFact(fact({ agendaItems: [item({ durationMin: 0 })] }), open).reasonCodes)
      .toEqual(expect.arrayContaining(["MALFORMED_SLOT", "MISSING_DURATION"]));
    expect(classifyPublicationFact(fact({ agendaItems: [item({ roomId: null })] }), open).reasonCodes)
      .toEqual(expect.arrayContaining(["MALFORMED_SLOT", "MISSING_ROOM"]));
    expect(classifyPublicationFact(fact({ agendaItems: [item({ buildingEventId: "other-event" })] }), open).reasonCodes)
      .toEqual(expect.arrayContaining(["MALFORMED_SLOT", "FOREIGN_ROOM"]));
    expect(classifyPublicationFact(fact({ status: "rejected" }), open).primaryReasonCode).toBe("NOT_ACCEPTED");
    expect(classifyPublicationFact(fact(), { ...open, publicBoundaryOpen: false }).primaryReasonCode)
      .toBe("PUBLIC_BOUNDARY_CLOSED");
    expect(classifyPublicationFact(fact({ status: "withdrawn", agendaItems: [item({ isPublished: true })] }), open).reasonCodes)
      .toEqual(expect.arrayContaining(["POST_PUBLISH_REVERSED", "PRIVACY_EXCLUDED"]));
  });
});
