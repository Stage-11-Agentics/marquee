import { expect, test } from "vitest";

import {
  SCHEDULE_CREATE_LIMIT,
  checkScheduleCreateLimit,
  computeOverlaps,
  resolveSessionIds,
  timingSafeEqual,
} from "../../src/lib/public-schedules";
import type { PublicSession } from "../../src/lib/public-site";

const at = (id: string, startsAt: number, durationMin: number): PublicSession => ({
  id,
  slug: `${id}-slug`,
  title: id,
  abstract: null,
  status: "accepted",
  day: "Tue, Oct 13",
  date: "2026-10-13",
  time: "09:00",
  endTime: "09:45",
  startsAt,
  durationMin,
  roomId: "room",
  room: "Room",
  building: null,
  buildingAddress: null,
  roomLabel: "Room",
  format: null,
  tracks: [],
  speakers: [],
});

const HOUR = 3_600_000;

test("CONTRACT · MRQ-132 touching sessions are a plan, not a conflict", () => {
  const first = at("a", HOUR * 10, 45);
  const abutting = at("b", HOUR * 10 + 45 * 60_000, 45);
  const clashing = at("c", HOUR * 10 + 30 * 60_000, 45);
  expect(computeOverlaps([first, abutting])).toEqual([]);
  expect(computeOverlaps([first, clashing])).toEqual([["a", "c"]]);
  // Pairs come back in a stable order so a diff of two answers means something.
  expect(computeOverlaps([first, clashing, abutting])).toEqual([["a", "c"], ["c", "b"]]);
});

test("CONTRACT · MRQ-132 ids and slugs both resolve, duplicates collapse, and strangers are named", () => {
  const sessions = [at("a", HOUR, 30), at("b", HOUR * 2, 30)];
  const result = resolveSessionIds(sessions, ["a", "b-slug", "a", "ghost"]);
  expect(result.resolved).toEqual(["a", "b"]);
  expect(result.unknown).toEqual(["ghost"]);
});

test("CONTRACT · MRQ-132 the write-key comparison does not leak on length or content", () => {
  expect(timingSafeEqual("abc", "abc")).toBe(true);
  expect(timingSafeEqual("abc", "abd")).toBe(false);
  expect(timingSafeEqual("abc", "abcd")).toBe(false);
});

test("CONTRACT · MRQ-132 schedule creation is capped per IP, and an absent cache does not refuse service", async () => {
  const store = new Map<string, string>();
  const cache = {
    get: async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null),
    put: async (key: string, value: string) => { store.set(key, value); },
  };
  const now = Date.UTC(2026, 9, 13, 12, 30);
  for (let attempt = 0; attempt < SCHEDULE_CREATE_LIMIT; attempt += 1) {
    expect((await checkScheduleCreateLimit(cache, "203.0.113.7", now)).allowed).toBe(true);
  }
  const refused = await checkScheduleCreateLimit(cache, "203.0.113.7", now);
  expect(refused.allowed).toBe(false);
  expect(refused.retryAfterSeconds).toBeGreaterThan(0);

  // Another caller is unaffected, and the next window is a clean slate.
  expect((await checkScheduleCreateLimit(cache, "198.51.100.4", now)).allowed).toBe(true);
  expect((await checkScheduleCreateLimit(cache, "203.0.113.7", now + 3_600_000)).allowed).toBe(true);

  // A missing binding means no ceiling, not a broken endpoint.
  expect((await checkScheduleCreateLimit(undefined, "203.0.113.7", now)).allowed).toBe(true);
});
