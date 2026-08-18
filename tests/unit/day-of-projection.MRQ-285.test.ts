import { expect, test } from "vitest";

import {
  defaultRunOfShowDay,
  isRunOfShowDay,
  phoneFromCustomFields,
  telHref,
  type RunOfShow,
  type RunOfShowEvent,
  type SessionSlides,
} from "../../src/lib/day-of/run-of-show";
import { slidesBoard } from "../../src/lib/day-of/slides-board";

/**
 * MRQ-285 · the pure edges of the day-of projection.
 *
 * The database-backed grain lives in the integration test beside it. What is
 * here is the arithmetic a crew member reads off a phone: which day the surface
 * opens on, whether a name has a number worth dialling, and whether a count on
 * a chip can ever disagree with the list that clicking it produces.
 */

const EVENT: RunOfShowEvent = {
  id: "evt_unit",
  name: "Northbound 2027",
  slug: "northbound-2027",
  timezone: "America/Los_Angeles",
  starts_on: "2027-05-12",
  ends_on: "2027-05-14",
};

/** Local noon on a given day in the conference's timezone. */
function noonPacific(date: string): number {
  return Date.parse(`${date}T19:00:00Z`);
}

test("CONTRACT · MRQ-285 — the surface opens on the conference's own today, and on day one when the show is not running", () => {
  expect(defaultRunOfShowDay(EVENT, noonPacific("2027-05-13"))).toBe("2027-05-13");
  // Months early and a year late both land on a day that has something on it.
  // An empty Tuesday in March reads as broken rather than as early.
  expect(defaultRunOfShowDay(EVENT, noonPacific("2027-03-02"))).toBe("2027-05-12");
  expect(defaultRunOfShowDay(EVENT, noonPacific("2028-01-09"))).toBe("2027-05-14");

  expect(isRunOfShowDay(EVENT, "2027-05-12")).toBe(true);
  expect(isRunOfShowDay(EVENT, "2027-05-14")).toBe(true);
  expect(isRunOfShowDay(EVENT, "2027-05-15")).toBe(false);
});

test("CONTRACT · MRQ-285 — a phone number is found by meaning, and a name without one gets no dead link", () => {
  expect(phoneFromCustomFields(JSON.stringify({ "Mobile phone": "+1 (415) 555-0142" }))).toBe("+1 (415) 555-0142");
  expect(phoneFromCustomFields(JSON.stringify({ cell: "415-555-0142" }))).toBe("415-555-0142");
  expect(phoneFromCustomFields(JSON.stringify({ "Contact Phone": 4155550142 }))).toBe("4155550142");
  // Nothing to dial is an ordinary answer, not an error.
  expect(phoneFromCustomFields(JSON.stringify({ "T-shirt size": "M" }))).toBeNull();
  expect(phoneFromCustomFields(JSON.stringify({ phone: "   " }))).toBeNull();
  expect(phoneFromCustomFields(null)).toBeNull();
  expect(phoneFromCustomFields("not json")).toBeNull();
  expect(phoneFromCustomFields(JSON.stringify(["+1 415 555 0142"]))).toBeNull();
});

test("CONTRACT · MRQ-285 — tel: keeps the digits and a leading plus, and nothing a dialer would choke on", () => {
  expect(telHref("+1 (415) 555-0142")).toBe("tel:+14155550142");
  expect(telHref("415.555.0142 ext 3")).toBe("tel:41555501423");
  expect(telHref("+44 20 7946 0018")).toBe("tel:+442079460018");
});

function slides(state: SessionSlides["state"]): SessionSlides {
  return { state, filename: null, uploaded_at: null, owed: [], expected: 1, received: 0 };
}

function snapshot(): RunOfShow {
  const session = (id: string, startsAt: number, state: SessionSlides["state"]) => ({
    id,
    title: id,
    submission_id: `sub_${id}`,
    room_id: "room_a",
    starts_at: startsAt,
    ends_at: startsAt + 3_600_000,
    is_break: false,
    speakers: [],
    arrived_count: 0,
    expected_count: 0,
    slides: slides(state),
  });
  return {
    event: EVENT,
    day: "2027-05-12",
    days: [],
    is_today: false,
    generated_at: 0,
    rooms: [
      {
        id: "room_a",
        name: "Broadway",
        building_name: "Pier 27",
        capacity: 400,
        av_capabilities: [],
        notes: null,
        current_session_id: null,
        next_session_id: null,
        sessions: [
          session("early", 1_000, "received"),
          session("late", 5_000, "overdue"),
          session("middling", 3_000, "missing"),
          session("finished", 7_000, "done_without_file"),
          session("unasked", 9_000, "not_requested"),
          { ...session("coffee", 2_000, "not_requested"), is_break: true },
        ],
      },
    ],
    counts: { sessions: 5, speakers: 0, arrived: 0, slides_received: 1, slides_missing: 3, slides_overdue: 1 },
  };
}

test("CONTRACT · MRQ-285 — a count on a chip always matches the set that clicking it produces", () => {
  const all = slidesBoard(snapshot());
  // The break is not a row: it owes nothing, so nobody chases it.
  expect(all.rows.map((row) => row.session_id)).toEqual(["early", "middling", "late", "finished", "unasked"]);
  expect(all.counts).toEqual({ all: 5, received: 1, missing: 3, overdue: 1 });

  for (const state of ["received", "missing", "overdue"] as const) {
    const filtered = slidesBoard(snapshot(), { state });
    expect(filtered.rows).toHaveLength(all.counts[state]);
    // Counts are taken before the filter, so they do not move as the operator
    // clicks between chips — the numbers on screen stay where they were.
    expect(filtered.counts).toEqual(all.counts);
  }

  // "Missing" is everything still owed, overdue included: the AV desk wants one
  // list of what is not in, not two lists that have to be added up.
  expect(slidesBoard(snapshot(), { state: "missing" }).rows.map((row) => row.session_id))
    .toEqual(["middling", "late", "finished"]);
  // A session nobody was asked for a deck for is not chased as missing.
  expect(slidesBoard(snapshot(), { state: "missing" }).rows.map((row) => row.session_id)).not.toContain("unasked");
});
