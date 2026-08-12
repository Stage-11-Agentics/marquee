import type { AgendaPoolItem, AgendaSession } from "../api/agenda";
import { conflictParticipants } from "./conflicts";

/**
 * Assisted placement: fill open room × time openings with unscheduled Sessions.
 *
 * This is deterministic arithmetic over the grid the organizer already sees —
 * no model, no ranking, no optimiser. It exists so the first pass of a schedule
 * costs one click instead of forty drags; the organizer then moves what it got
 * wrong. Every placement it proposes is a placement they could have dragged,
 * which is why the caller writes them through the ordinary placement route.
 */

/** A candidate opening in the grid: a conference-local day and time, resolved to an instant. */
export interface AutoPlaceSlot {
  day: string;
  time: string;
  starts_at: number;
}

export interface AutoPlaceRoom {
  id: string;
  name: string;
}

export interface AutoPlacement {
  submission_id: string;
  title: string;
  starts_at: number;
  duration_min: number;
  room_id: string;
  room: string;
  track_id: string | null;
  day: string;
  time: string;
}

export interface AutoPlacePlan {
  placements: AutoPlacement[];
  /** Pool Sessions the pass could not seat — no opening, or the per-pass cap. */
  remaining: number;
}

/**
 * One click should not fire an unbounded write storm at the placement route.
 * A capped pass keeps the action fast and re-runnable; the copy says how many
 * landed so a second click is an obvious next step rather than a mystery.
 */
export const MAX_AUTO_PLACEMENTS = 20;

interface Interval {
  start: number;
  end: number;
}

function overlaps(left: Interval, right: Interval): boolean {
  return left.start < right.end && right.start < left.end;
}

function endOf(startsAt: number, durationMin: number): number {
  return startsAt + durationMin * 60_000;
}

function primaryTrackId(item: AgendaPoolItem): string | null {
  return item.tracks.find((track) => track.is_primary)?.id ?? item.tracks[0]?.id ?? null;
}

/**
 * Plan a one-action pass over the grid.
 *
 * Openings are scanned in the order given — slot by slot, room by room — and
 * the pool is consumed in its own order, so the same snapshot always yields the
 * same plan. Room double-booking and speaker double-booking are both avoided
 * because they are cheap to check here; richer conflicts (transit, capacity)
 * stay the conflict panel's job, exactly as they are for a manual drag.
 */
export function planAutoPlacements({
  sessions,
  rooms,
  unscheduled,
  slots,
  limit = MAX_AUTO_PLACEMENTS,
}: {
  sessions: readonly AgendaSession[];
  rooms: readonly AutoPlaceRoom[];
  unscheduled: readonly AgendaPoolItem[];
  slots: readonly AutoPlaceSlot[];
  limit?: number;
}): AutoPlacePlan {
  const roomBusy = new Map<string, Interval[]>();
  const personBusy = new Map<string, Interval[]>();
  const addBusy = (index: Map<string, Interval[]>, key: string, interval: Interval): void => {
    const existing = index.get(key);
    if (existing) existing.push(interval);
    else index.set(key, [interval]);
  };
  const isFree = (index: Map<string, Interval[]>, key: string, interval: Interval): boolean =>
    !(index.get(key) ?? []).some((busy) => overlaps(busy, interval));

  for (const session of sessions) {
    const interval = { start: session.starts_at, end: endOf(session.starts_at, session.duration_min) };
    addBusy(roomBusy, session.room_id, interval);
    for (const participant of conflictParticipants(session.speakers)) {
      addBusy(personBusy, participant.id, interval);
    }
  }

  const placements: AutoPlacement[] = [];
  let remaining = 0;

  for (const item of unscheduled) {
    if (placements.length >= limit) {
      remaining += 1;
      continue;
    }
    const people = conflictParticipants(item.speakers).map((participant) => participant.id);
    let seated = false;
    for (const slot of slots) {
      if (seated) break;
      const interval = { start: slot.starts_at, end: endOf(slot.starts_at, item.default_duration_min) };
      if (people.some((personId) => !isFree(personBusy, personId, interval))) continue;
      for (const room of rooms) {
        if (!isFree(roomBusy, room.id, interval)) continue;
        addBusy(roomBusy, room.id, interval);
        for (const personId of people) addBusy(personBusy, personId, interval);
        placements.push({
          submission_id: item.submission_id,
          title: item.title,
          starts_at: slot.starts_at,
          duration_min: item.default_duration_min,
          room_id: room.id,
          room: room.name,
          track_id: primaryTrackId(item),
          day: slot.day,
          time: slot.time,
        });
        seated = true;
        break;
      }
    }
    if (!seated) remaining += 1;
  }

  return { placements, remaining };
}

/** Say what the pass actually did, in the organizer's terms and without overclaiming. */
export function autoPlaceSummary(plan: AutoPlacePlan): string {
  const placed = plan.placements.length;
  if (!placed) {
    return plan.remaining
      ? "No open slot fits the unscheduled Sessions · free a room or time and try again"
      : "Nothing to auto-place · every schedulable Session is already on the agenda";
  }
  const noun = placed === 1 ? "Session" : "Sessions";
  const tail = plan.remaining ? ` · ${plan.remaining} still unscheduled` : "";
  return `Auto-placed ${placed} ${noun} into open slots${tail} · review and adjust`;
}
