import { describe, expect, test } from "vitest";

import {
  AGENDA_GRID_GRANULARITIES,
  AGENDA_GRID_OPTIONS,
  AGENDA_GRID_STORAGE_PREFIX,
  DEFAULT_AGENDA_GRID_GRANULARITY,
  agendaGridStorageKey,
  generateAgendaGridAxis,
  generateAgendaGridSlots,
  normalizeAgendaGridGranularity,
  readAgendaGridGranularity,
  writeAgendaGridGranularity,
} from "../../src/lib/agenda-grid";

interface FakeStorageOptions {
  values?: Record<string, string>;
  throwOn?: "get" | "set";
}

function fakeStorage({ values = {}, throwOn }: FakeStorageOptions = {}): { storage: Storage; values: Map<string, string> } {
  const stored = new Map(Object.entries(values));
  const storage = {
    getItem(key: string): string | null {
      if (throwOn === "get") throw new Error("private mode");
      return stored.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (throwOn === "set") throw new Error("quota exceeded");
      stored.set(key, value);
    },
  } as unknown as Storage;
  return { storage, values: stored };
}

describe("MRQ-157 · agenda grid logic", () => {
  test("CONTRACT · the builder exposes only 5, 15, and 30 minute settings with 15 as the default", () => {
    expect(AGENDA_GRID_GRANULARITIES).toEqual([5, 15, 30]);
    expect(DEFAULT_AGENDA_GRID_GRANULARITY).toBe(15);
    expect(AGENDA_GRID_OPTIONS).toEqual([
      { value: 5, label: "5 minutes" },
      { value: 15, label: "15 minutes" },
      { value: 30, label: "30 minutes" },
    ]);
    expect(normalizeAgendaGridGranularity("30")).toBe(30);
    expect(normalizeAgendaGridGranularity(5)).toBe(5);
    expect(normalizeAgendaGridGranularity("10")).toBe(15);
    expect(normalizeAgendaGridGranularity(7.5)).toBe(15);
    expect(normalizeAgendaGridGranularity(null)).toBe(15);
  });

  test("CONTRACT · placement targets cover the existing 09:00 through 21:00 working window at the selected snap", () => {
    const five = generateAgendaGridSlots(5);
    const fifteen = generateAgendaGridSlots(15);
    const thirty = generateAgendaGridSlots(30);

    expect(five).toHaveLength(144);
    expect(fifteen).toHaveLength(48);
    expect(thirty).toHaveLength(24);
    expect(five[0]).toMatchObject({ time: "09:00", minutes: 540, isHour: true });
    expect(five.at(-1)).toMatchObject({ time: "20:55", minutes: 1_255, isHour: false });
    expect(fifteen.map((slot) => slot.time).slice(0, 4)).toEqual(["09:00", "09:15", "09:30", "09:45"]);
    expect(fifteen.find((slot) => slot.time === "10:15")).toMatchObject({ minutes: 615, isHour: false });
    expect(thirty.find((slot) => slot.time === "10:30")).toMatchObject({ minutes: 630, isHour: false });
    expect(thirty.find((slot) => slot.time === "21:00")).toBeUndefined();
  });

  test("CONTRACT · the axis keeps twelve strong hour labels while snap targets densify into micro-ticks", () => {
    const fiveAxis = generateAgendaGridAxis(5);
    const fifteenAxis = generateAgendaGridAxis(15);
    const thirtyAxis = generateAgendaGridAxis(30);

    expect(fiveAxis).toHaveLength(12);
    expect(fiveAxis.map((row) => row.label)).toEqual([
      "09:00", "10:00", "11:00", "12:00", "13:00", "14:00",
      "15:00", "16:00", "17:00", "18:00", "19:00", "20:00",
    ]);
    expect(fiveAxis.every((row) => row.time === row.label)).toBe(true);
    expect(fiveAxis.every((row) => row.microTicks.length === 11)).toBe(true);
    expect(fifteenAxis.every((row) => row.microTicks.length === 3)).toBe(true);
    expect(thirtyAxis.every((row) => row.microTicks.length === 1)).toBe(true);
    expect(fiveAxis.flatMap((row) => row.microTicks).map((tick) => tick.time)).toContain("10:05");
    expect(fiveAxis.flatMap((row) => row.microTicks).map((tick) => tick.time)).not.toContain("10:00");
  });

  test("CONTRACT · the event-scoped builder setting round-trips through best-effort local storage", () => {
    const { storage, values } = fakeStorage();
    const eventA = "event-a";
    const eventB = "event-b";

    expect(agendaGridStorageKey(eventA)).toBe(`${AGENDA_GRID_STORAGE_PREFIX}event-a`);
    expect(readAgendaGridGranularity(eventA, storage)).toBe(15);
    expect(writeAgendaGridGranularity(eventA, 5, storage)).toBe(5);
    expect(writeAgendaGridGranularity(eventB, 30, storage)).toBe(30);
    expect(values.get(agendaGridStorageKey(eventA))).toBe("5");
    expect(values.get(agendaGridStorageKey(eventB))).toBe("30");
    expect(readAgendaGridGranularity(eventA, storage)).toBe(5);
    expect(readAgendaGridGranularity(eventB, storage)).toBe(30);
  });

  test("CONTRACT · malformed or unavailable storage falls back safely and never blocks the builder", () => {
    const malformed = fakeStorage({ values: { [agendaGridStorageKey("event")]: "7" } });
    expect(readAgendaGridGranularity("event", malformed.storage)).toBe(15);

    const throwingGet = fakeStorage({ throwOn: "get" });
    const throwingSet = fakeStorage({ throwOn: "set" });
    expect(() => readAgendaGridGranularity("event", throwingGet.storage)).not.toThrow();
    expect(readAgendaGridGranularity("event", throwingGet.storage)).toBe(15);
    expect(() => writeAgendaGridGranularity("event", 5, throwingSet.storage)).not.toThrow();
    expect(writeAgendaGridGranularity("event", 5, throwingSet.storage)).toBe(5);
  });
});
