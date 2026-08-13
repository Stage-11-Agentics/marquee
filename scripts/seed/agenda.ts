/** Published agenda density, multi-track scheduled sessions, and conflicts. */

import { seedId } from "../../src/lib/ids.ts";
import { scheduledSessions } from "./accepted-core.ts";
import type { SeedContext, SeedModule, SeedRow } from "./_sql.ts";
import { EVENT_ID, TRACK_IDS } from "./event.ts";

function table(ctx: SeedContext, name: string): SeedRow["row"][] {
  return ctx.rows.filter((entry) => entry.table === name).map((entry) => entry.row);
}

const ROOM_IDS = [
  "metropolitan-ballroom", "central-park-ballroom", "new-york-ballroom", "expo-stage",
  "marquis-room-a", "marquis-room-b", "marquis-room-c", "marquis-room-d", "marquis-room-e",
].map((name) => seedId("rm", name));
const EXPO_ROOM_ID = ROOM_IDS[3]!;
const ONLINE_ROOM_ID = seedId("rm", "online");

/**
 * Where each scheduled session lands, by its position in the grid order
 * `scheduledSessions()` fixes. Day one opens on the two conflict pairs: the
 * first crosses Sheraton → Marriott so the seed carries a live Transit
 * conflict, the second is a same-building double-booking. Day two runs the five
 * parallel Workshop rooms, then the Expo Stage's Lightning block straight
 * through the mainstage coffee break, the two Online sessions in the virtual
 * room, and the remaining mainstage talks across the three ballrooms.
 */
function placement(index: number): { startsAt: number; roomId: string } {
  if (index < 4) {
    return {
      startsAt: Date.UTC(2026, 9, 12, index < 2 ? 13 : 14),
      roomId: [ROOM_IDS[0]!, ROOM_IDS[4]!, ROOM_IDS[2]!, ROOM_IDS[3]!][index]!,
    };
  }
  if (index < 9) return { startsAt: Date.UTC(2026, 9, 13, 17), roomId: ROOM_IDS[index]! };
  if (index < 14) return { startsAt: Date.UTC(2026, 9, 13, 18, (index - 9) * 15), roomId: EXPO_ROOM_ID };
  if (index < 16) return { startsAt: Date.UTC(2026, 9, 13, 18, (index - 14) * 30), roomId: ONLINE_ROOM_ID };
  const slot = index - 16;
  return {
    startsAt: Date.UTC(2026, 9, 13, 18, 30 + Math.floor(slot / 3) * 30),
    roomId: ROOM_IDS[slot % 3]!,
  };
}

function addConflictParticipation(
  ctx: SeedContext,
  sourceSubmissionId: string,
  targetSubmissionId: string,
  key: string,
): void {
  const source = table(ctx, "participations").find(
    (row) => row.submission_id === sourceSubmissionId && row.position === 0,
  );
  if (!source) throw new Error(`accepted conflict source ${sourceSubmissionId} has no lead speaker`);
  const targetRows = table(ctx, "participations").filter((row) => row.submission_id === targetSubmissionId);
  ctx.add("participations", {
    id: seedId("par", `agenda-conflict-${key}`),
    submission_id: targetSubmissionId,
    person_id: source.person_id,
    role: "moderator",
    position: targetRows.length,
    confirmation_status: "confirmed",
    confirmed_at: ctx.now,
    invited_at: ctx.now,
    created_at: ctx.now,
    updated_at: ctx.now,
  });
}

/**
 * Keep the organizer-facing confirmation states visible in the seeded agenda.
 * One person intentionally holds two roles on the same Session: the existing
 * moderator role is confirmed, while a reused speaker slot is declined. The
 * agenda's derived flag therefore inspects a second role even though the first
 * role is confirmed, while the record still shows both role responses. A
 * separate co-speaker slot is moved from a multi-speaker Session and remains
 * pending on that Session. Reusing slots keeps the seeded table cardinalities
 * stable for reset-demo's baseline contract.
 */
function addConfirmationCoverage(ctx: SeedContext, accepted: SeedRow["row"][]): void {
  const submissionId = String(accepted[1]?.id ?? "");
  const targetRows = table(ctx, "participations").filter((row) => row.submission_id === submissionId);
  const confirmedModerator = targetRows.find(
    (row) => row.id === seedId("par", "agenda-conflict-one")
      && row.role === "moderator"
      && row.confirmation_status === "confirmed",
  );
  const declinedRole = targetRows.find((row) => row.position === 1 && row.role === "co_speaker");
  if (!confirmedModerator || !declinedRole) {
    throw new Error("agenda confirmation coverage needs the first conflict's moderator and speaker slots");
  }

  declinedRole.person_id = confirmedModerator.person_id;
  declinedRole.role = "speaker";
  declinedRole.confirmation_status = "declined";
  declinedRole.confirmed_at = null;
  declinedRole.invited_at = ctx.now;
  declinedRole.updated_at = ctx.now;

  // Keep a second declined response on the other conflict Session so the
  // organizer sees more than a single exceptional confirmation in the demo.
  const secondDeclinedRole = table(ctx, "participations").find(
    (row) => row.id === seedId("par", "agenda-conflict-two") && row.role === "moderator",
  );
  if (!secondDeclinedRole) throw new Error("agenda confirmation coverage needs a second declined role");
  secondDeclinedRole.confirmation_status = "declined";
  secondDeclinedRole.confirmed_at = null;
  secondDeclinedRole.invited_at = ctx.now;
  secondDeclinedRole.updated_at = ctx.now;

  const targetPeople = new Set(targetRows.map((row) => String(row.person_id)));
  const pendingSource = table(ctx, "participations").find((row) => {
    if (!accepted.some((submission) => String(submission.id) === String(row.submission_id))) return false;
    if (String(row.submission_id) === submissionId || row.role !== "co_speaker") return false;
    if (targetPeople.has(String(row.person_id))) return false;
    return table(ctx, "participations").filter((candidate) => candidate.submission_id === row.submission_id).length > 1;
  });
  if (!pendingSource) throw new Error("agenda confirmation coverage needs a distinct pending participant");

  pendingSource.submission_id = submissionId;
  pendingSource.role = "co_speaker";
  pendingSource.position = targetRows.length;
  pendingSource.confirmation_status = "pending";
  pendingSource.confirmed_at = null;
  pendingSource.invited_at = ctx.now;
  pendingSource.updated_at = ctx.now;
}

export function run(ctx: SeedContext): void {
  const acceptedById = new Map(
    table(ctx, "submissions").filter((row) => row.status === "accepted").map((row) => [String(row.id), row]),
  );
  const accepted = scheduledSessions().map((session) => {
    const submission = acceptedById.get(seedId("sub", session.slug));
    if (!submission) throw new Error(`scheduled session ${session.slug} is not an accepted submission`);
    return submission;
  });

  // AC-74: an item's duration defaults from its submission's format.
  const defaultDurations = new Map(
    table(ctx, "formats").map((row) => [String(row.id), Number(row.default_duration_min)]),
  );

  const trackIds = Object.values(TRACK_IDS);
  for (const submission of accepted.slice(0, 3)) {
    const primaryIndex = trackIds.indexOf(String(submission.primary_track_id));
    ctx.add("submission_tracks", {
      id: seedId("sbt", `${submission.id}-scheduled-secondary`),
      submission_id: submission.id,
      track_id: trackIds[(primaryIndex + 1) % trackIds.length]!,
      is_primary: 0,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }

  accepted.forEach((submission, index) => {
    const { startsAt, roomId } = placement(index);
    const duration = defaultDurations.get(String(submission.format_id));
    if (!duration) throw new Error(`scheduled submission ${submission.id} has no format duration`);
    ctx.add("agenda_items", {
      id: seedId("agi", String(submission.id)),
      event_id: EVENT_ID,
      submission_id: submission.id,
      kind: "session",
      title: null,
      starts_at: startsAt,
      duration_min: duration,
      room_id: roomId,
      track_id: submission.primary_track_id,
      // Leave one scheduled Session unpublished so the record exposes the
      // publish action while the remaining scheduled cards are public.
      is_published: index === accepted.length - 1 ? 0 : 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  });

  ctx.add("agenda_items", {
    id: seedId("agi", "mainstage-morning-break"),
    event_id: EVENT_ID,
    submission_id: null,
    kind: "break",
    title: "Mainstage coffee break",
    starts_at: Date.UTC(2026, 9, 13, 18),
    duration_min: 30,
    room_id: ROOM_IDS[0]!,
    track_id: TRACK_IDS.fin,
    is_published: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  });

  addConflictParticipation(ctx, String(accepted[0]!.id), String(accepted[1]!.id), "one");
  addConflictParticipation(ctx, String(accepted[2]!.id), String(accepted[3]!.id), "two");
  addConfirmationCoverage(ctx, accepted);
}

export const seed: SeedModule = { name: "agenda", order: 50, run };
