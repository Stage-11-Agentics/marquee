/**
 * The agenda's placement grid is a UI concern. The API accepts any
 * `starts_at` instant; this module only describes the times the builder offers
 * as targets and the lighter-weight axis that helps an operator read them.
 */

export const AGENDA_GRID_GRANULARITIES = [5, 15, 30] as const;
export type AgendaGridGranularity = (typeof AGENDA_GRID_GRANULARITIES)[number];

export const DEFAULT_AGENDA_GRID_GRANULARITY: AgendaGridGranularity = 15;
export const AGENDA_GRID_START_MINUTE = 9 * 60;
export const AGENDA_GRID_END_MINUTE = 21 * 60;
export const AGENDA_GRID_STORAGE_PREFIX = "marquee.agenda.granularity.";

export interface AgendaGridOption {
  value: AgendaGridGranularity;
  label: string;
}

export const AGENDA_GRID_OPTIONS: readonly AgendaGridOption[] = AGENDA_GRID_GRANULARITIES.map((value) => ({
  value,
  label: `${value} minutes`,
}));

export interface AgendaGridSlot {
  /** Conference-local wall-clock time, in HH:MM form. */
  time: string;
  /** Minutes after midnight in the conference-local wall clock. */
  minutes: number;
  /** Hour targets carry the readable gauge weight; the rest are micro targets. */
  isHour: boolean;
}

export interface AgendaGridMicroTick {
  /** Conference-local wall-clock time, in HH:MM form. */
  time: string;
  /** Minutes after midnight in the conference-local wall clock. */
  minutes: number;
}

export interface AgendaGridAxisRow {
  /** The only gutter label for this hour. */
  label: string;
  /** Hour target corresponding to the label. */
  time: string;
  /** Lighter sub-hour marks; never repeated as full gutter labels. */
  microTicks: readonly AgendaGridMicroTick[];
}

export interface AgendaGridPosition {
  /** The target row/column that contains the session's exact start. */
  slot: AgendaGridSlot;
  /** Minutes after the containing target, retained for a precise visual offset. */
  offsetMinutes: number;
  /** Fraction of the target interval after the containing target. */
  offsetRatio: number;
}

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isAgendaGridGranularity(value: number): value is AgendaGridGranularity {
  return (AGENDA_GRID_GRANULARITIES as readonly number[]).includes(value);
}

/** Invalid, missing, or legacy values are deliberately safe at the 15-minute default. */
export function normalizeAgendaGridGranularity(value: unknown): AgendaGridGranularity {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : NaN;
  return Number.isInteger(numeric) && isAgendaGridGranularity(numeric)
    ? numeric
    : DEFAULT_AGENDA_GRID_GRANULARITY;
}

export function agendaGridStorageKey(eventId: string): string {
  return `${AGENDA_GRID_STORAGE_PREFIX}${eventId}`;
}

/** Read an event's builder preference without making storage a prerequisite for the UI. */
export function readAgendaGridGranularity(eventId: string, storage: Storage | undefined = browserStorage()): AgendaGridGranularity {
  try {
    return normalizeAgendaGridGranularity(storage?.getItem(agendaGridStorageKey(eventId)));
  } catch {
    return DEFAULT_AGENDA_GRID_GRANULARITY;
  }
}

/** Persist the builder preference when possible; the current session still works in private mode. */
export function writeAgendaGridGranularity(
  eventId: string,
  value: unknown,
  storage: Storage | undefined = browserStorage(),
): AgendaGridGranularity {
  const normalized = normalizeAgendaGridGranularity(value);
  try {
    storage?.setItem(agendaGridStorageKey(eventId), String(normalized));
  } catch {
    // Storage is an enhancement, not the source of truth for agenda placements.
  }
  return normalized;
}

function formatAgendaGridTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function agendaGridMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * Locate an arbitrary stored start inside the selected target interval. The
 * API is not snapped, so a 10:20 record belongs in the 10:15 cell at 15-minute
 * resolution, with its five-minute offset retained for rendering.
 */
export function agendaGridPosition(
  time: string,
  slots: readonly AgendaGridSlot[] = generateAgendaGridSlots(),
): AgendaGridPosition | null {
  const minutes = agendaGridMinutes(time);
  if (minutes === null || !slots.length) return null;

  let index = -1;
  for (let candidate = 0; candidate < slots.length; candidate += 1) {
    if (slots[candidate]!.minutes > minutes) break;
    index = candidate;
  }
  if (index < 0) return null;

  const slot = slots[index]!;
  const next = slots[index + 1];
  const interval = next
    ? next.minutes - slot.minutes
    : index > 0
      ? slot.minutes - slots[index - 1]!.minutes
      : 60;
  const offsetMinutes = minutes - slot.minutes;
  if (offsetMinutes >= interval) return null;
  return { slot, offsetMinutes, offsetRatio: offsetMinutes / interval };
}

/**
 * Generate every target the builder may offer for one conference day.
 *
 * The end is exclusive: the existing twelve hourly targets cover 09:00–20:00,
 * so 5-minute mode intentionally has 12 * 60 / 5 = 144 targets, ending at
 * 20:55 rather than adding a 21:00 opening outside that working window.
 */
export function generateAgendaGridSlots(value: unknown = DEFAULT_AGENDA_GRID_GRANULARITY): AgendaGridSlot[] {
  const granularity = normalizeAgendaGridGranularity(value);
  const slots: AgendaGridSlot[] = [];
  for (let minutes = AGENDA_GRID_START_MINUTE; minutes < AGENDA_GRID_END_MINUTE; minutes += granularity) {
    slots.push({
      time: formatAgendaGridTime(minutes),
      minutes,
      isHour: minutes % 60 === 0,
    });
  }
  return slots;
}

/**
 * Keep the axis at twelve readable hour rows regardless of snap density.
 * Placement targets can therefore grow to 144 while the gutter stays a gauge:
 * one strong HH:00 label per hour and lighter metadata for the marks between.
 */
export function generateAgendaGridAxis(value: unknown = DEFAULT_AGENDA_GRID_GRANULARITY): AgendaGridAxisRow[] {
  const slots = generateAgendaGridSlots(value);
  const byHour = new Map<number, AgendaGridSlot[]>();
  for (const slot of slots) {
    const hour = Math.floor(slot.minutes / 60);
    const current = byHour.get(hour);
    if (current) current.push(slot);
    else byHour.set(hour, [slot]);
  }

  return [...byHour.entries()].map(([hour, hourSlots]) => {
    const hourSlot = hourSlots[0]!;
    return {
      label: hourSlot.time,
      time: hourSlot.time,
      microTicks: hourSlots.slice(1).map((slot) => ({ time: slot.time, minutes: slot.minutes })),
    };
  });
}
