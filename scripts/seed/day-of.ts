/**
 * The day-of surfaces, walkable cold. The module runs late (order 75) because
 * it reads the schedule and the speaker tasks the earlier seeders wrote.
 *
 * Two links and a handful of arrivals, so the green room shows what a green
 * room looks like at 09:15 on day one rather than an empty grid: some speakers
 * marked in, one panel deliberately part-way ("1 of 2 here"), the rest still to
 * come.
 *
 * The demo tokens are fixed and published, exactly like the demo seats
 * (`organizer@demo.com` and its siblings): they open the seeded conference and
 * nothing else, and a judge with no account has to be able to reach these
 * surfaces in one step. Every real link is a 256-bit token minted at random and
 * stored as a hash — these two are hashes of known strings, and that is the
 * whole difference.
 */

import { seedId } from "../../src/lib/ids.ts";
import { EVENT_ID } from "./event.ts";
import type { SeedContext, SeedModule, SeedRow } from "./_sql.ts";

/** `sha256("demo-front-door")` — see SEED-DATA.md. */
const CHECKIN_TOKEN_HASH = "6630ecba8eeae1e8dfb0f3ce2f5c33a89caffd12fcbec1ba4fe492affb4edc2d";
/** `sha256("demo-green-room")`. */
const GREEN_ROOM_TOKEN_HASH = "f15adfff8ef07b4071e03cdc8eff1b0f2fcc1ae09d43f54049a2a5c725ae66b3";

const CHECKIN_LINK_ID = seedId("dof", "front-door");
const GREEN_ROOM_LINK_ID = seedId("dof", "green-room");
const VOLUNTEER_NAME = "Sam, front door";

/** Day one, 09:00 New York — the morning the arrivals belong to. */
const DAY_ONE_START = Date.UTC(2026, 9, 12, 13);
const DAY_ONE_END = Date.UTC(2026, 9, 13, 4);

function rowsOf(ctx: SeedContext, table: string): SeedRow["row"][] {
  return ctx.rows.filter((entry) => entry.table === table).map((entry) => entry.row);
}

function run(ctx: SeedContext): void {
  for (const [id, kind, name, hash] of [
    [GREEN_ROOM_LINK_ID, "green_room", "Green room", GREEN_ROOM_TOKEN_HASH],
    [CHECKIN_LINK_ID, "checkin", VOLUNTEER_NAME, CHECKIN_TOKEN_HASH],
  ] as const) {
    ctx.add("day_of_links", {
      id,
      event_id: EVENT_ID,
      kind,
      name,
      token_hash: hash,
      created_by_person_id: null,
      last_used_at: null,
      revoked_at: null,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }

  // Day one's sessions in the order they run, each with its speakers — read
  // from the rows the agenda and acceptance seeders have already added, so a
  // change to the schedule moves the arrivals with it instead of stranding
  // them on an agenda item that no longer exists.
  const dayOne = rowsOf(ctx, "agenda_items")
    .filter((item) =>
      item.kind === "session"
      && typeof item.starts_at === "number"
      && item.starts_at >= DAY_ONE_START
      && item.starts_at < DAY_ONE_END)
    .sort((left, right) => Number(left.starts_at) - Number(right.starts_at) || String(left.id).localeCompare(String(right.id)));
  const speakersBySubmission = new Map<string, string[]>();
  for (const participation of rowsOf(ctx, "participations")) {
    if (participation.role !== "speaker" && participation.role !== "co_speaker") continue;
    const submissionId = String(participation.submission_id);
    const list = speakersBySubmission.get(submissionId) ?? [];
    list.push(String(participation.person_id));
    speakersBySubmission.set(submissionId, list);
  }

  // One session's deck is in, so the board shows the whole range rather than a
  // column of the same word. The upload is an `attachments` row with no object
  // behind it, exactly as the seeded submission files are: the ledger derives
  // "current" from the newest ready upload when a task carries no pointer.
  const dayOneSubmissions = new Set(dayOne.map((item) => String(item.submission_id)));
  const firstSubmission = dayOne.length > 0 ? String(dayOne[0]!.submission_id) : null;
  for (const task of rowsOf(ctx, "speaker_tasks")) {
    if (task.kind !== "file" || firstSubmission === null) continue;
    if (String(task.submission_id) !== firstSubmission || !dayOneSubmissions.has(String(task.submission_id))) continue;
    ctx.add("attachments", {
      id: seedId("att", `task-upload-${task.id}`),
      event_id: EVENT_ID,
      owner_type: "task_upload",
      owner_id: String(task.id),
      r2_key: `task-uploads/${task.id}/keynote-deck.pdf`,
      filename: "keynote-deck.pdf",
      content_type: "application/pdf",
      size_bytes: 8_192,
      status: "ready",
      sha256: null,
      r2_etag: `seed-etag-${task.id}`,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }

  // The first two sessions are fully in; the third has one of its people here
  // and one still out, which is the state the per-session grain exists to show.
  const markedAt = DAY_ONE_START + 22 * 60_000;
  dayOne.slice(0, 3).forEach((item, index) => {
    const speakers = speakersBySubmission.get(String(item.submission_id)) ?? [];
    const arriving = index === 2 ? speakers.slice(0, 1) : speakers;
    arriving.forEach((personId, position) => {
      ctx.add("checkins", {
        id: seedId("chk", `${item.id}-${personId}`),
        event_id: EVENT_ID,
        agenda_item_id: String(item.id),
        person_id: personId,
        link_id: CHECKIN_LINK_ID,
        marked_by_name: VOLUNTEER_NAME,
        marked_at: markedAt + (index * 4 + position) * 60_000,
        created_at: ctx.now,
        updated_at: ctx.now,
      });
    });
  });
}

export const seed: SeedModule = { name: "day-of", order: 75, run };
