/**
 * Which conference a tab boots into, as a pure function.
 *
 * The interesting case is not precedence, it is validation: after a demo reset
 * sweeps the organization, both storages still name a conference that no longer
 * exists, and the reset ends in a full page reload straight back through this
 * resolver. A resolver that trusts what it is handed sends the whole session
 * into 404s under a conference nobody can see.
 */
import { expect, test } from "vitest";

import { resolveEventSelection } from "../../src/ui/shell/event-selection";

const EVENTS = [{ id: "evt_one" }, { id: "evt_two" }];

test("MRQ-129 · precedence takes the first candidate the list actually contains", () => {
  expect(resolveEventSelection(["evt_two", "evt_one"], EVENTS).eventId).toBe("evt_two");
  expect(resolveEventSelection([null, undefined, "evt_one"], EVENTS).eventId).toBe("evt_one");
});

test("MRQ-129 · a candidate the list does not contain is skipped and reported as stale", () => {
  const selection = resolveEventSelection(["evt_swept_away", "evt_two"], EVENTS);
  expect(selection.eventId).toBe("evt_two");
  expect(selection.stale).toEqual(["evt_swept_away"]);
});

test("MRQ-129 · every ghost is reported, and the first listed conference is the floor", () => {
  const selection = resolveEventSelection(["evt_gone", "evt_also_gone", "evt_gone"], EVENTS);
  expect(selection.eventId).toBe("evt_one");
  // Reported once each: the caller clears storages by value, not by count.
  expect(selection.stale).toEqual(["evt_gone", "evt_also_gone"]);
});

test("MRQ-129 · a seat that can read no conference gets null rather than a guess", () => {
  const selection = resolveEventSelection(["evt_one"], []);
  expect(selection.eventId).toBeNull();
  expect(selection.stale).toEqual(["evt_one"]);
});
