/**
 * The slides board: the day's sessions in the order they will happen, and
 * whether the deck is in.
 *
 * The files library answers "what has this conference been sent", one row per
 * deliverable and one deliverable per person. That is the right shape three
 * weeks out and the wrong one on the morning of the show, when the unit that
 * matters is the SESSION — a panel of three with two decks in is one talk that
 * is not ready, not two-thirds of a chase. So this is a projection of the run
 * of show rather than a second files query: same ledger, same "current" (the
 * owner pointer), re-cut by what the AV desk is standing in front of.
 *
 * Counts are taken before the state filter, so the number on a chip always
 * matches the set that clicking it produces — the same rule the files page
 * follows.
 */
import type { RunOfShow, SessionSlides, SlidesOwed } from "./run-of-show";

export const SLIDES_BOARD_STATES = ["all", "received", "missing", "overdue"] as const;
export type SlidesBoardState = (typeof SLIDES_BOARD_STATES)[number];

export interface SlidesBoardRow {
  session_id: string;
  title: string;
  submission_id: string | null;
  room_id: string;
  room_name: string;
  starts_at: number;
  ends_at: number;
  speakers: { person_id: string; name: string }[];
  slides: SessionSlides;
  /** Who "ask again" would reach, and about which session. Empty once the decks are in. */
  owed: SlidesOwed[];
}

export interface SlidesBoardSnapshot {
  event: RunOfShow["event"];
  day: string;
  days: RunOfShow["days"];
  generated_at: number;
  rooms: { id: string; name: string }[];
  rows: SlidesBoardRow[];
  counts: Record<SlidesBoardState, number>;
}

export interface SlidesBoardQuery {
  roomId?: string;
  state?: SlidesBoardState;
}

function matchesState(slides: SessionSlides, state: SlidesBoardState): boolean {
  if (state === "all") return true;
  if (state === "received") return slides.state === "received";
  if (state === "overdue") return slides.state === "overdue";
  // "Missing" is everything still owed, overdue included — the AV desk wants
  // one list of what is not in, not two that have to be added up.
  return slides.state === "missing" || slides.state === "overdue" || slides.state === "done_without_file";
}

export function slidesBoard(runOfShow: RunOfShow, query: SlidesBoardQuery = {}): SlidesBoardSnapshot {
  const rooms = runOfShow.rooms.map((room) => ({ id: room.id, name: room.name }));
  const scoped = runOfShow.rooms
    .filter((room) => query.roomId === undefined || room.id === query.roomId)
    .flatMap((room) =>
      room.sessions
        .filter((session) => !session.is_break)
        .map((session): SlidesBoardRow => ({
          session_id: session.id,
          title: session.title,
          submission_id: session.submission_id,
          room_id: room.id,
          room_name: room.name,
          starts_at: session.starts_at,
          ends_at: session.ends_at,
          speakers: session.speakers.map((speaker) => ({ person_id: speaker.person_id, name: speaker.name })),
          slides: session.slides,
          owed: session.slides.owed,
        })));

  const byState = (state: SlidesBoardState): number =>
    scoped.filter((row) => matchesState(row.slides, state)).length;

  const state = query.state ?? "all";
  return {
    event: runOfShow.event,
    day: runOfShow.day,
    days: runOfShow.days,
    generated_at: runOfShow.generated_at,
    rooms,
    rows: scoped
      .filter((row) => matchesState(row.slides, state))
      .sort((left, right) => left.starts_at - right.starts_at || left.room_name.localeCompare(right.room_name)),
    counts: {
      all: scoped.length,
      received: byState("received"),
      missing: byState("missing"),
      overdue: byState("overdue"),
    },
  };
}
