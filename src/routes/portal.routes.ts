/**
 * Speaker portal API.
 *
 * The portal is a session surface, not a public projection. Ordinary handlers
 * narrow an authenticated principal to an event-scoped speaker membership;
 * the co-speaker surface instead repeats the exact invited participation
 * predicate on every read and write.
 */

import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import type { AuthContext, SessionAuth } from "../lib/auth/scope-resolution";
import { getAuth } from "../lib/auth/auth-middleware";
import { showsBuildingComparisonCount } from "../lib/venue-disclosure";
import { roomDisplayLabel } from "../lib/venues";
import {
  arrivalForSession,
  type ArrivalBuilding,
  type ArrivalProjection,
  type ArrivalSession,
} from "../lib/venue-geometry";
import { parseUploadOwnerConfig, policyFor } from "../lib/r2/policy";
import { listVersionsForOwners, type FileVersionList } from "../lib/files/versions";
import { readTaskFileConfig } from "../lib/task-template-config";
import { enqueueMailMessage } from "../jobs/mail/consumer";
import { enqueueBulkReminder } from "../jobs/mail/triggers";
import { firstName } from "../jobs/mail/merge-data";
import {
  isFieldApplicable,
  projectApplicableAnswers,
} from "../lib/form-conditions";
import { listFormFields, type FormFieldView } from "./forms.queries";
import { auditStatement, writeAudit } from "../lib/audit";
import { contentHistoryFor } from "../lib/history";
import {
  parseSocialLinks,
  personProfilePatchShape,
  personProfileUpdateStatement,
  resolvePersonProfile,
} from "../lib/person-profile";

const eventQuery = z.object({ eventId: z.string().min(1).optional() });
const taskParams = z.object({ taskId: z.string().min(1) });
const submissionParams = z.object({ submissionId: z.string().min(1) });
const participationParams = z.object({ participationId: z.string().min(1) });
const eventSubmissionParams = z.object({ eventId: z.string().min(1), submissionId: z.string().min(1) });

// The organizer roster (`speakers.routes.ts`) accepts the same fields through
// the same shape, so a field added on one surface cannot go missing on the other.
const profileBody = z.object({ ...personProfilePatchShape });

const coSpeakerProfileBody = z.object({
  bio: z.string().max(20_000).nullable().optional(),
  headshot_attachment_id: z.string().min(1).nullable().optional(),
}).strict();

const taskCompletionBody = z.object({
  acknowledged: z.boolean().optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
  attachment_id: z.string().min(1).optional(),
});

const talkBody = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().max(50_000).nullable().optional(),
});

const talkEditingBody = z.object({ enabled: z.boolean() });
const declineBody = z.object({ note: z.string().trim().max(10_000).nullable().optional() }).strict();

/** Statuses that still have a decision coming, so a wave date is worth showing. */
const AWAITING_DECISION = ["draft", "submitted", "in_review"];
/** Submitter drafts are unfinished work; Maybe has no promised decision date. */
const SUBMITTER_AWAITING_DECISION = ["submitted", "in_review"];

const portalResponseSchema = z
  .object({
    /**
     * Which seat the session holds. `speaker` carries tasks, handbook, and
     * schedule; `submitter` is a person who submitted an abstract and holds no
     * speaker role yet, and carries only their own submissions and their status.
     */
    seat: z.enum(["speaker", "submitter"]),
    event: z.any(),
    person: z.any(),
    submissions: z.array(z.any()),
    tasks: z.array(z.any()),
    handbook: z.object({ markdown: z.string() }),
    venue: z.object({ pinned_building_count: z.number().int().nonnegative() }),
    // Submitter seats expose only conferences reached through this person's
    // own submissions; speaker seats do not need this switcher.
    available_events: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  })
  .openapi("SpeakerPortal");

const taskResponseSchema = z.object({ task: z.any() }).openapi("SpeakerTaskCompletion");
const profileResponseSchema = z.object({ person: z.any() }).openapi("SpeakerProfile");
const coSpeakerResponseSchema = z.object({
  submission: z.any(),
  participation: z.any(),
  person: z.any(),
}).openapi("CoSpeakerSubmission");
const talkResponseSchema = z.object({ submission: z.any(), history: z.array(z.any()) }).openapi("SpeakerTalk");
const talkEditingResponseSchema = z.object({ enabled: z.boolean() }).openapi("SpeakerTalkEditing");

type EventProjection = {
  id: string;
  name: string;
  slug: string;
  starts_on: string;
  ends_on: string;
  timezone: string;
  status: string;
};

type SubmitterEventOption = Pick<EventProjection, "id" | "name">;

type PersonProjection = {
  id: string;
  name: string;
  email: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  social_links: string;
  headshot_attachment_id: string | null;
  updated_at: number;
};

type SubmissionProjection = {
  id: string;
  title: string;
  abstract: string | null;
  status: string;
  updated_at: number;
  format_name: string | null;
  wave_name: string | null;
  wave_decision_on: string | null;
  starts_at: number | null;
  duration_min: number | null;
  room_id: string | null;
  room_name: string | null;
  building_id: string | null;
  building_name: string | null;
  building_address: string | null;
  building_lat: number | null;
  building_lng: number | null;
  building_access_minutes: number | null;
  building_access_note: string | null;
  is_published: number | null;
  participation_id: string;
  participation_role: string;
  confirmation_status: "pending" | "confirmed" | "declined";
  confirmed_at: number | null;
  feedback_md: string | null;
  feedback_decision_id: string | null;
  feedback_decided_at: number | null;
  participations: Array<{
    id: string;
    role: string;
    confirmation_status: "pending" | "confirmed" | "declined";
    confirmed_at: number | null;
  }>;
  arrival?: ArrivalProjection;
};

type TaskProjection = {
  id: string;
  event_id: string;
  person_id: string;
  submission_id: string | null;
  submission_title: string | null;
  submission_status: string | null;
  template_id: string;
  title: string;
  kind: "acknowledge" | "file" | "form";
  description: string;
  due_at: number;
  status: "open" | "done";
  completed_at: number | null;
  cancelled_at: number | null;
  response_json: string | null;
  attachment_id: string | null;
  form_id: string | null;
  file_config: string | null;
};

const HANDBOOKS: Record<string, string> = {
  "aie-nyc-2026": `# Speaker handbook

## Before the conference

Bring the version of your talk you want the room to remember. Your conference contact will use the portal task list for the remaining details.

## On site

The final room and arrival notes will appear in the confirmed schedule. Keep your profile and talk description current.

[Conference site](https://marquee.stage11.dev/agenda)
`,
  default: `# Speaker handbook

## Before the conference

Keep your profile, headshot, and talk description current in this portal.

## On site

Your confirmed schedule will show the room and time when it is ready.

[Conference site](/agenda)
`,
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  const parsed = parseJson<unknown>(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function readStoredAnswer(row: { value_json: string | null; value_text: string | null }): unknown {
  if (row.value_json !== null) return parseJson<unknown>(row.value_json, row.value_text ?? "");
  return row.value_text ?? "";
}

function eventDateTime(event: EventProjection, startsAt: number | null): { day: string; date: string; time: string } | null {
  if (startsAt === null) return null;
  const date = new Date(startsAt);
  return {
    day: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: event.timezone }).format(date),
    date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: event.timezone }).format(date),
    time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: event.timezone }).format(date),
  };
}

function statusLabel(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * The media origin is a Worker binding rather than an API binding, exactly as
 * `uploads.routes.ts` treats it.
 */
function portalMediaOrigin(context: import("hono").Context<ApiEnv>): string {
  return (context.env as unknown as { MEDIA_PUBLIC_ORIGIN?: string }).MEDIA_PUBLIC_ORIGIN ?? "";
}

function isSessionAuth(auth: AuthContext | null): auth is SessionAuth {
  return auth?.kind === "session";
}

function requireSession(context: import("hono").Context<ApiEnv>): SessionAuth {
  const auth = getAuth(context);
  if (!isSessionAuth(auth)) throw ApiError.forbidden("the speaker portal requires a browser session");
  return auth;
}

function requireUnscopedSpeakerSession(context: import("hono").Context<ApiEnv>): SessionAuth {
  const auth = requireSession(context);
  if (coSpeakerParticipationId(auth)) throw ApiError.forbidden("this co-speaker link is limited to its invited abstract");
  return auth;
}

function coSpeakerParticipationId(auth: SessionAuth): string | null {
  const hint = auth.roleHint;
  if (!hint?.startsWith("cospeaker_profile:")) return null;
  const participationId = hint.slice("cospeaker_profile:".length);
  return /^[A-Za-z0-9_-]+$/.test(participationId) ? participationId : null;
}

function requireCoSpeakerSession(context: import("hono").Context<ApiEnv>): { auth: SessionAuth; participationId: string } {
  const auth = requireSession(context);
  const participationId = coSpeakerParticipationId(auth);
  if (!participationId) throw ApiError.forbidden("this profile link is not scoped to a co-speaker participation");
  return { auth, participationId };
}

async function findSpeakerEvent(
  db: D1Database,
  auth: SessionAuth,
  requestedEventId?: string,
): Promise<EventProjection | null> {
  const predicate = requestedEventId ? "AND e.id = ?" : "";
  const bindings = requestedEventId ? [auth.personId, auth.orgId, requestedEventId] : [auth.personId, auth.orgId];
  return db
    .prepare(
      `SELECT e.id, e.name, e.slug, e.starts_on, e.ends_on, e.timezone, e.status
       FROM events e
       JOIN memberships m ON m.event_id = e.id AND m.person_id = ? AND m.org_id = ? AND m.role = 'speaker'
       WHERE 1 = 1 ${predicate}
       ORDER BY e.starts_on ASC, e.id ASC
       LIMIT 1`,
    )
    .bind(...bindings)
    .first<EventProjection>();
}

async function speakerEvent(
  db: D1Database,
  auth: SessionAuth,
  requestedEventId?: string,
): Promise<EventProjection> {
  const event = await findSpeakerEvent(db, auth, requestedEventId);
  if (!event) throw ApiError.notFound("conference not found");
  return event;
}

/**
 * The conference a person reaches through a submission rather than a speaker role.
 *
 * SPEC §10 (Amendment 15) rules the submitter and the speaker distinct, and rules
 * the fix for a submitter opening the portal to be one honest empty state rather
 * than a state-model change. So this resolver deliberately does *not* look at
 * `memberships`: it reaches the event through the `participations` row the public
 * form writes for whoever submitted (role `submitter`), which is exactly the seat
 * that holds no speaker role.
 */
async function findSubmitterEvent(
  db: D1Database,
  auth: SessionAuth,
  requestedEventId?: string,
): Promise<EventProjection | null> {
  const predicate = requestedEventId ? "AND e.id = ?" : "";
  const bindings = requestedEventId ? [auth.personId, auth.orgId, requestedEventId] : [auth.personId, auth.orgId];
  // A submitter with an older participation and a fresh public submission
  // means the newest/future conference. Keep this choice explicit for the
  // submitter seat instead of inheriting the speaker resolver's oldest-event
  // ordering or relying on database row order.
  return db
    .prepare(
      `SELECT DISTINCT e.id, e.name, e.slug, e.starts_on, e.ends_on, e.timezone, e.status
       FROM events e
       JOIN submissions s ON s.event_id = e.id
       JOIN participations p ON p.submission_id = s.id AND p.person_id = ?
       WHERE e.org_id = ? ${predicate}
       ORDER BY e.starts_on DESC, e.id DESC
       LIMIT 1`,
    )
    .bind(...bindings)
    .first<EventProjection>();
}

async function findSubmitterEvents(db: D1Database, auth: SessionAuth): Promise<SubmitterEventOption[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT e.id, e.name
       FROM events e
       JOIN submissions s ON s.event_id = e.id
       JOIN participations p ON p.submission_id = s.id AND p.person_id = ?
       WHERE e.org_id = ?
       ORDER BY e.starts_on DESC, e.id DESC`,
    )
    .bind(auth.personId, auth.orgId)
    .all<SubmitterEventOption>();
  return rows.results;
}

type SpeakerParticipationRow = {
  id: string;
  event_id: string;
  submission_id: string;
  submission_title: string;
  submission_status: string;
  person_id: string;
  person_name: string;
  person_email: string;
  role: string;
  confirmation_status: "pending" | "confirmed" | "declined";
  confirmed_at: number | null;
};

async function speakerParticipationFor(
  db: D1Database,
  auth: SessionAuth,
  participationId: string,
): Promise<SpeakerParticipationRow> {
  const scopedParticipationId = coSpeakerParticipationId(auth);
  const membershipJoin = scopedParticipationId
    ? ""
    : `JOIN memberships membership
         ON membership.event_id = submission.event_id
        AND membership.person_id = ?
        AND membership.role = 'speaker'`;
  const scopedPredicate = scopedParticipationId
    ? "AND participation.role = 'co_speaker' AND participation.id = ?"
    : "";
  const bindings = scopedParticipationId
    ? [auth.orgId, participationId, auth.personId, scopedParticipationId]
    : [auth.orgId, auth.personId, participationId, auth.personId];
  const row = await db
    .prepare(
      `SELECT participation.id, submission.event_id, participation.submission_id,
         submission.title AS submission_title, submission.status AS submission_status,
         participation.person_id, person.name AS person_name, person.email AS person_email,
         participation.role, participation.confirmation_status, participation.confirmed_at
       FROM participations participation
       JOIN submissions submission ON submission.id = participation.submission_id
       JOIN events conference ON conference.id = submission.event_id AND conference.org_id = ?
       ${membershipJoin}
       JOIN people person ON person.id = participation.person_id
       WHERE participation.id = ? AND participation.person_id = ? ${scopedPredicate}`,
    )
    .bind(...bindings)
    .first<SpeakerParticipationRow>();
  if (!row) throw ApiError.notFound("participation not found");
  return row;
}

function participationPayload(row: SpeakerParticipationRow): Record<string, unknown> {
  return {
    id: row.id,
    submission_id: row.submission_id,
    role: row.role,
    confirmation_status: row.confirmation_status,
    confirmed_at: row.confirmed_at,
  };
}

async function notifyProgramLeadsOfDecline(
  db: D1Database,
  queue: ApiEnv["Bindings"]["MAIL_QUEUE"],
  row: SpeakerParticipationRow,
  note: string | null,
  now: number,
): Promise<string[]> {
  const leads = await db
    .prepare(
      `SELECT DISTINCT person.id, person.name, person.email
       FROM memberships membership
       JOIN people person ON person.id = membership.person_id
       WHERE membership.event_id = ? AND membership.role IN ('program_lead', 'owner')
       ORDER BY person.id`,
    )
    .bind(row.event_id)
    .all<{ id: string; name: string; email: string }>();
  const reason = note ? ` Note from the speaker: ${note}` : "";
  const queued = await enqueueBulkReminder({
    db,
    eventId: row.event_id,
    templateKey: "custom",
    recipients: leads.results.map((lead) => ({
      entityId: row.id,
      personId: lead.id,
      toEmail: lead.email,
      data: {
        "speaker.first_name": firstName(lead.name),
        "speaker.name": lead.name,
        "speaker.email": lead.email,
        "submission.title": row.submission_title,
        "message.body": `${row.person_name} declined the ${row.role.replaceAll("_", " ")} role for ${row.submission_title}.${reason}`,
      },
    })),
    now,
  });
  const outboxIds: string[] = [];
  for (const item of queued) {
    if (!item.inserted) continue;
    outboxIds.push(item.id);
    await enqueueMailMessage(queue, item.id);
  }
  return outboxIds;
}

async function respondToParticipation(
  context: import("hono").Context<ApiEnv>,
  participationId: string,
  status: "confirmed" | "declined",
  note: string | null = null,
) {
  const auth = requireSession(context);
  const current = await speakerParticipationFor(context.env.DB, auth, participationId);
  const normalizedNote = note?.trim() || null;
  if (current.submission_status !== "accepted") {
    throw ApiError.conflict("role confirmation is available after the conference accepts the submission");
  }
  if (current.confirmation_status !== "pending") {
    if (current.confirmation_status === status) {
      return context.json({ participation: participationPayload(current), changed: false, notification_outbox_ids: [] }, 200);
    }
    throw ApiError.conflict("this role already has a different response");
  }

  const now = Date.now();
  const updated = await context.env.DB
    .prepare(
      `UPDATE participations
       SET confirmation_status = ?, confirmed_at = ?, updated_at = ?
       WHERE id = ? AND person_id = ? AND confirmation_status = 'pending'`,
    )
    .bind(status, status === "confirmed" ? now : null, now, current.id, auth.personId)
    .run();
  if (Number(updated.meta?.changes ?? 0) !== 1) {
    throw ApiError.conflict("this role changed before your response was saved");
  }

  await writeAudit(context.env.DB, {
    eventId: current.event_id,
    actorKind: "user",
    actorPersonId: auth.personId,
    action: `participation.${status}`,
    entityType: "submission",
    entityId: current.submission_id,
    before: { participation_id: current.id, role: current.role, confirmation_status: current.confirmation_status },
    after: { participation_id: current.id, role: current.role, confirmation_status: status, note: normalizedNote },
    now,
    requestId: context.get("requestId") ?? null,
  });

  const next = { ...current, confirmation_status: status, confirmed_at: status === "confirmed" ? now : null };
  const notificationOutboxIds = status === "declined"
    ? await notifyProgramLeadsOfDecline(context.env.DB, context.env.MAIL_QUEUE, next, normalizedNote, now)
    : [];
  return context.json({ participation: participationPayload(next), changed: true, notification_outbox_ids: notificationOutboxIds }, 200);
}

async function personFor(db: D1Database, personId: string): Promise<PersonProjection> {
  const person = await db
    .prepare(
      `SELECT id, name, email, title, company, bio, social_links, headshot_attachment_id, updated_at
       FROM people WHERE id = ?`,
    )
    .bind(personId)
    .first<PersonProjection>();
  if (!person) throw ApiError.notFound("speaker not found");
  return person;
}

type CoSpeakerSubmissionRow = {
  submission_id: string;
  submission_title: string;
  submission_abstract: string | null;
  submission_status: string;
  submission_updated_at: number;
  participation_id: string;
  participation_role: string;
  confirmation_status: "pending" | "confirmed" | "declined";
  confirmed_at: number | null;
  event_id: string;
};

async function coSpeakerSubmissionFor(
  db: D1Database,
  auth: SessionAuth,
  scopedParticipationId: string,
  submissionId: string,
): Promise<CoSpeakerSubmissionRow> {
  const row = await db
    .prepare(
      `SELECT participation.submission_id,
         submission.title AS submission_title, submission.abstract AS submission_abstract,
         submission.status AS submission_status, submission.updated_at AS submission_updated_at,
         participation.id AS participation_id, participation.role AS participation_role,
         participation.confirmation_status, participation.confirmed_at,
         submission.event_id
       FROM participations participation
       JOIN submissions submission ON submission.id = participation.submission_id
       JOIN events conference ON conference.id = submission.event_id AND conference.org_id = ?
       WHERE participation.id = ?
         AND participation.submission_id = ?
         AND participation.person_id = ?
         AND participation.role = 'co_speaker'`,
    )
    .bind(auth.orgId, scopedParticipationId, submissionId, auth.personId)
    .first<CoSpeakerSubmissionRow>();
  if (!row) throw ApiError.notFound("submission not found");
  return row;
}

function coSpeakerResponse(
  person: PersonProjection,
  submission: CoSpeakerSubmissionRow,
): Record<string, unknown> {
  return {
    submission: {
      id: submission.submission_id,
      title: submission.submission_title,
      abstract: submission.submission_abstract,
      status: submission.submission_status,
      updated_at: submission.submission_updated_at,
    },
    participation: {
      id: submission.participation_id,
      role: submission.participation_role,
      confirmation_status: submission.confirmation_status,
      confirmed_at: submission.confirmed_at,
    },
    person: {
      id: person.id,
      name: person.name,
      email: person.email,
      bio: person.bio,
      headshot_attachment_id: person.headshot_attachment_id,
      updated_at: person.updated_at,
    },
  };
}

async function updateCoSpeakerProfile(
  context: import("hono").Context<ApiEnv>,
  submissionId: string,
  body: z.infer<typeof coSpeakerProfileBody>,
) {
  const { auth, participationId } = requireCoSpeakerSession(context);
  const current = await coSpeakerSubmissionFor(context.env.DB, auth, participationId, submissionId);
  const person = await personFor(context.env.DB, auth.personId);
  if (body.bio === undefined && body.headshot_attachment_id === undefined) {
    throw ApiError.badRequest("Add a bio or choose a headshot before saving your profile.");
  }
  let headshot = person.headshot_attachment_id;
  if (body.headshot_attachment_id !== undefined) {
    if (body.headshot_attachment_id === null) {
      headshot = null;
    } else {
      const attachment = await context.env.DB
        .prepare(
          `SELECT id FROM attachments
           WHERE id = ? AND event_id = ? AND owner_type = 'person_headshot'
             AND owner_id = ? AND status = 'ready'`,
        )
        .bind(body.headshot_attachment_id, current.event_id, auth.personId)
        .first<{ id: string }>();
      if (!attachment) throw ApiError.unprocessable("Choose a ready headshot upload, then save your profile.", "headshot_attachment_id");
      headshot = attachment.id;
    }
  }
  const now = Date.now();
  await context.env.DB
    .prepare(
      `UPDATE people
       SET bio = ?, headshot_attachment_id = ?, last_write_source = 'marquee', updated_at = ?
       WHERE id = ? AND org_id = ?`,
    )
    .bind(body.bio === undefined ? person.bio : body.bio, headshot, now, auth.personId, auth.orgId)
    .run();
  return context.json(coSpeakerResponse(await personFor(context.env.DB, auth.personId), current), 200);
}

function arrivalBuildingFor(row: Pick<SubmissionProjection, "building_id" | "building_name" | "building_address" | "building_lat" | "building_lng" | "building_access_minutes" | "building_access_note">): ArrivalBuilding | null {
  if (!row.building_id || row.building_name === null || row.building_address === null || row.building_access_minutes === null) return null;
  return {
    id: row.building_id,
    name: row.building_name,
    address: row.building_address,
    lat: row.building_lat,
    lng: row.building_lng,
    access_minutes: row.building_access_minutes,
    access_note: row.building_access_note,
  };
}

function arrivalSessionFor(row: SubmissionProjection): ArrivalSession {
  return {
    id: row.id,
    starts_at: row.starts_at,
    duration_min: row.duration_min,
    room_name: row.room_name,
    building: arrivalBuildingFor(row),
  };
}

async function primaryBuildingFor(db: D1Database, eventId: string): Promise<ArrivalBuilding | null> {
  return db
    .prepare(
      `SELECT id, name, address, lat, lng, access_minutes, access_note
       FROM buildings WHERE event_id = ? ORDER BY position ASC, id ASC LIMIT 1`,
    )
    .bind(eventId)
    .first<ArrivalBuilding>();
}

async function pinnedBuildingCountFor(db: D1Database, eventId: string): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(DISTINCT id) AS pinned_count FROM buildings WHERE event_id = ? AND lat IS NOT NULL AND lng IS NOT NULL",
  ).bind(eventId).first<{ pinned_count: number | null }>();
  return Number(row?.pinned_count ?? 0);
}

async function listSubmissions(db: D1Database, event: EventProjection, personId: string): Promise<SubmissionProjection[]> {
  const rows = await db
    .prepare(
      `SELECT s.id, s.title, s.abstract, s.status, s.updated_at,
         format.name AS format_name, wave.name AS wave_name, wave.decision_on AS wave_decision_on,
         agenda.starts_at, agenda.duration_min, room.id AS room_id, room.name AS room_name,
         building.id AS building_id, building.name AS building_name, building.address AS building_address,
         building.lat AS building_lat, building.lng AS building_lng,
         building.access_minutes AS building_access_minutes, building.access_note AS building_access_note,
         agenda.is_published,
         participation.id AS participation_id, participation.role AS participation_role,
         participation.confirmation_status, participation.confirmed_at,
         decision.id AS feedback_decision_id, decision.feedback_md, decision.decided_at AS feedback_decided_at
       FROM submissions s
       JOIN participations participation
         ON participation.submission_id = s.id AND participation.person_id = ?
       LEFT JOIN formats format ON format.id = s.format_id AND format.event_id = s.event_id
       LEFT JOIN waves wave ON wave.id = s.wave_id AND wave.event_id = s.event_id
       LEFT JOIN agenda_items agenda
         ON agenda.submission_id = s.id AND agenda.event_id = s.event_id AND agenda.kind = 'session'
       LEFT JOIN rooms room ON room.id = agenda.room_id AND room.event_id = s.event_id
       LEFT JOIN buildings building ON building.id = room.building_id AND building.event_id = s.event_id
       LEFT JOIN submission_decisions decision ON decision.id = (
         SELECT latest.id FROM submission_decisions latest
         WHERE latest.submission_id = s.id AND latest.event_id = s.event_id
         ORDER BY latest.decided_at DESC, latest.id DESC LIMIT 1
       )
       WHERE s.event_id = ?
       ORDER BY s.updated_at DESC, s.id ASC`,
    )
    .bind(personId, event.id)
    .all<SubmissionProjection>();

  const grouped = new Map<string, SubmissionProjection>();
  for (const row of rows.results) {
    const current = grouped.get(row.id);
    if (current) {
      if (!current.participations.some((participation) => participation.id === row.participation_id)) {
        current.participations.push({
          id: row.participation_id,
          role: row.participation_role,
          confirmation_status: row.confirmation_status,
          confirmed_at: row.confirmed_at,
        });
      }
      continue;
    }
    grouped.set(row.id, {
      ...row,
      participations: [{
        id: row.participation_id,
        role: row.participation_role,
        confirmation_status: row.confirmation_status,
        confirmed_at: row.confirmed_at,
      }],
    });
  }
  return [...grouped.values()];
}

async function readSubmissionAnswers(
  db: D1Database,
  submissionId: string | null,
): Promise<Record<string, unknown>> {
  if (!submissionId) return {};
  const rows = await db
    .prepare(
      `SELECT field.key, answer.value_json, answer.value_text
       FROM submission_answers answer
       JOIN form_fields field ON field.id = answer.field_id
       WHERE answer.submission_id = ?`,
    )
    .bind(submissionId)
    .all<{ key: string; value_json: string | null; value_text: string | null }>();
  return Object.fromEntries(rows.results.map((row) => [row.key, readStoredAnswer(row)]));
}

function taskPayload(
  task: TaskProjection,
  fields: FormFieldView[],
  answers: Record<string, unknown>,
  versions: FileVersionList | null,
): Record<string, unknown> {
  if (task.kind === "acknowledge") {
    return { kind: task.kind, acknowledged: parseObject(task.response_json).acknowledged === true };
  }
  if (task.kind === "file") {
    const config = parseUploadOwnerConfig(task.file_config);
    const policy = policyFor("task_upload", config);
    const editedConfig = readTaskFileConfig(task.file_config);
    const accept = editedConfig?.accept ?? policy?.rules.map((rule) => rule.extension) ?? [];
    // The speaker needs to see WHAT they uploaded, not just that something
    // happened: a bare checkmark is indistinguishable from a lost file.
    return {
      kind: task.kind,
      attachment_id: task.attachment_id,
      accept,
      max_bytes: editedConfig?.maxBytes ?? policy?.maxBytes ?? null,
      versions: versions?.versions ?? [],
      latest: versions?.latest ?? null,
      version_count: versions?.version_count ?? 0,
      latest_source: versions?.latest_source ?? "pointer",
    };
  }
  const projection = projectApplicableAnswers(fields, answers);
  return {
    kind: task.kind,
    form_id: task.form_id,
    fields: fields
      .filter((field) => isFieldApplicable(field, answers))
      .map((field) => ({
        key: field.key,
        label: field.label,
        help_text: field.help_text,
        type: field.type,
        required: field.required,
        position: field.position,
        config: field.config,
        condition: field.condition,
        value: projection.answers[field.key] ?? null,
      })),
    answers: projection.answers,
  };
}

async function listTasks(db: D1Database, event: EventProjection, personId: string, mediaPublicOrigin: string): Promise<Record<string, unknown>[]> {
  const [rows, cancellationAudits] = await Promise.all([
    db
      .prepare(
        `SELECT task.id, task.event_id, task.person_id, task.submission_id,
           submission.title AS submission_title, submission.status AS submission_status,
           task.template_id, task.title, task.kind, task.description, task.due_at,
           task.status, task.completed_at, task.cancelled_at,
           task.response_json, task.attachment_id, template.form_id, template.file_config
         FROM speaker_tasks task
         JOIN task_templates template ON template.id = task.template_id AND template.event_id = task.event_id
         LEFT JOIN submissions submission ON submission.id = task.submission_id AND submission.event_id = task.event_id
         WHERE task.event_id = ? AND task.person_id = ?
         ORDER BY task.due_at ASC, task.id ASC`,
      )
      .bind(event.id, personId)
      .all<TaskProjection>(),
    db
      .prepare(
        `SELECT entity_id AS submission_id, after_json
         FROM audit_log
         WHERE event_id = ? AND entity_type = 'submission' AND action = 'submission.tasks_cancelled'
         ORDER BY created_at DESC, id DESC`,
      )
      .bind(event.id)
      .all<{ submission_id: string; after_json: string | null }>(),
  ]);
  const cancellationReasons = new Map<string, string>();
  for (const audit of cancellationAudits.results) {
    if (cancellationReasons.has(audit.submission_id)) continue;
    const reason = parseObject(audit.after_json).reason;
    if (typeof reason === "string" && reason.length > 0) cancellationReasons.set(audit.submission_id, reason);
  }

  // One batched read for every file task on the page rather than one per row.
  const versionsByTask = await listVersionsForOwners(
    db,
    "task_upload",
    rows.results.filter((task) => task.kind === "file").map((task) => task.id),
    mediaPublicOrigin,
  );

  return Promise.all(rows.results.map(async (task) => {
    const fields = task.kind === "form" && task.form_id ? await listFormFields(db, task.form_id) : [];
    const submissionAnswers = await readSubmissionAnswers(db, task.submission_id);
    const responseAnswers = task.kind === "form" ? parseObject(task.response_json) : {};
    const answers = { ...submissionAnswers, ...responseAnswers };
    const cancelled = task.cancelled_at !== null;
    const cancelledReason = task.submission_id
      ? cancellationReasons.get(task.submission_id)
        ?? (task.submission_status === "rejected" ? "This talk was rejected by the conference." : "This talk was withdrawn from the conference.")
      : "This task is no longer needed by the conference.";
    return {
      id: task.id,
      submission_id: task.submission_id,
      submission_title: task.submission_title,
      template_id: task.template_id,
      title: task.title,
      kind: task.kind,
      description: task.description,
      due_at: task.due_at,
      status: task.status,
      completed_at: task.completed_at,
      cancelled_at: task.cancelled_at,
      cancelled_reason: cancelled ? cancelledReason : null,
      overdue: !cancelled && task.status === "open" && task.due_at < Date.now(),
      payload: taskPayload(task, fields, answers, versionsByTask.get(task.id) ?? null),
    };
  }));
}

function submissionView(event: EventProjection, row: SubmissionProjection, showBuildingComparison: boolean): Record<string, unknown> {
  const dateTime = eventDateTime(event, row.starts_at);
  const waveName = row.wave_name ?? (row.wave_decision_on ? "Next wave" : null);
  const building = arrivalBuildingFor(row);
  const arrival = row.arrival ?? null;
  return {
    id: row.id,
    title: row.title,
    description: row.abstract,
    status: row.status,
    status_label: statusLabel(row.status),
    format: row.format_name ?? "—",
    wave: waveName,
    wave_decision_on: row.wave_decision_on,
    slot: dateTime
      ? {
          day: dateTime.day,
          date: dateTime.date,
          time: dateTime.time,
          starts_at: row.starts_at!,
          duration_min: row.duration_min,
          room: row.room_name && row.building_name
            ? roomDisplayLabel({ name: row.room_name }, { name: row.building_name }, showBuildingComparison)
            : row.room_name ?? "—",
          location: {
            room: row.room_name,
            building: building?.name ?? row.building_name,
            address: building?.address ?? null,
            access_note: building?.access_note ?? null,
            access_minutes: building?.access_minutes ?? 0,
            lat: building?.lat ?? null,
            lng: building?.lng ?? null,
          },
          show_building_comparison: showBuildingComparison,
          arrival: arrival
            ? {
                status: arrival.status,
                origin: arrival.origin
                  ? { id: arrival.origin.id, name: arrival.origin.name, address: arrival.origin.address }
                  : null,
                previous_session: arrival.previous_session
                  ? {
                      id: arrival.previous_session.id,
                      room: arrival.previous_session.room_name,
                      building: arrival.previous_session.building?.name ?? null,
                      starts_at: arrival.previous_session.starts_at,
                      duration_min: arrival.previous_session.duration_min,
                    }
                  : null,
                walk_minutes: arrival.walk_minutes,
                access_minutes: arrival.access_minutes,
                leave_by: arrival.leave_by,
              }
            : null,
          is_published: row.is_published === 1,
        }
      : null,
    decision_feedback: row.feedback_md
      ? { id: row.feedback_decision_id, markdown: row.feedback_md, decided_at: row.feedback_decided_at }
      : null,
    participations: row.participations,
    talk_editable: true,
  };
}

/**
 * The speaker's view of their own talk's history.
 *
 * Reads through the shared projection, which widens this from the portal's own
 * `speaker_talk_updated` rows to every content action — so an organizer editing
 * the talk from the record page shows up here, by name, rather than the speaker
 * finding their title silently changed with nothing to explain it.
 */
async function historyFor(db: D1Database, eventId: string, submissionId: string): Promise<Record<string, unknown>[]> {
  const entries = await contentHistoryFor(db, eventId, "submission", submissionId);
  return entries.map((entry) => ({
    id: entry.id,
    action: entry.action,
    actor_person_id: entry.actor_person_id,
    actor_name: entry.actor_name,
    created_at: entry.created_at,
    before: entry.before,
    after: entry.after,
  }));
}

async function talkIsEditable(db: D1Database, eventId: string, submissionId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT form.status AS form_status, form.closes_at, setting.value_json
       FROM submissions submission
       LEFT JOIN forms form ON form.id = submission.form_id AND form.event_id = submission.event_id
       LEFT JOIN event_settings setting
         ON setting.event_id = submission.event_id AND setting.key = ?
       WHERE submission.id = ? AND submission.event_id = ?`,
    )
    .bind(`speaker_talk_editing:${submissionId}`, submissionId, eventId)
    .first<{ form_status: string | null; closes_at: number | null; value_json: string | null }>();
  if (!row) return false;
  if (parseJson<{ enabled?: boolean }>(row.value_json, {}).enabled === true) return true;
  return row.form_status === "open" && (row.closes_at === null || row.closes_at > Date.now());
}

type SubmitterSubmissionRow = {
  id: string;
  title: string;
  status: string;
  submitted_at: number | null;
  updated_at: number;
  format_name: string | null;
  wave_name: string | null;
  wave_decision_on: string | null;
  participation_role: string;
  form_slug: string | null;
};

/**
 * What the portal owes a person who submitted an abstract and holds no speaker
 * role: the truth, not a 404. Their own submissions, their status, and the date
 * a decision is expected — nothing that belongs to a speaker seat (no tasks, no
 * handbook, no schedule), because they do not hold one yet.
 */
async function submitterSnapshot(db: D1Database, auth: SessionAuth, event: EventProjection) {
  const [person, availableEvents] = await Promise.all([
    personFor(db, auth.personId),
    findSubmitterEvents(db, auth),
  ]);
  const rows = await db
    .prepare(
      // One row per submission, never per participation. The public form writes
      // this person *two* participations on their own abstract — `submitter` and
      // `speaker` (SPEC §10: the two are the same person until two addresses
      // ship) — so a join here would show every abstract twice.
      `SELECT s.id, s.title, s.status, s.submitted_at, s.updated_at,
         format.name AS format_name, wave.name AS wave_name, wave.decision_on AS wave_decision_on,
         form.slug AS form_slug,
         (SELECT p.role FROM participations p
           WHERE p.submission_id = s.id AND p.person_id = ?
           ORDER BY CASE p.role WHEN 'submitter' THEN 0 ELSE 1 END, p.position ASC, p.id ASC
           LIMIT 1) AS participation_role
       FROM submissions s
       LEFT JOIN formats format ON format.id = s.format_id AND format.event_id = s.event_id
       LEFT JOIN waves wave ON wave.id = s.wave_id AND wave.event_id = s.event_id
       LEFT JOIN forms form ON form.id = s.form_id AND form.event_id = s.event_id AND form.status = 'open'
       WHERE s.event_id = ?
         AND EXISTS (SELECT 1 FROM participations p WHERE p.submission_id = s.id AND p.person_id = ?)
       ORDER BY s.updated_at DESC, s.id ASC`,
    )
    .bind(auth.personId, event.id, auth.personId)
    .all<SubmitterSubmissionRow>();
  const submissions = [...rows.results];
  // A submitted or in-review abstract not yet assigned to a wave still
  // deserves a real "you will hear by" date. Drafts are unfinished work, so
  // they must not inherit a decision date from the next wave.
  if (submissions.some((row) => row.wave_name === null && SUBMITTER_AWAITING_DECISION.includes(row.status))) {
    const nextWave = await db
      .prepare(
        `SELECT name AS wave_name, decision_on AS wave_decision_on FROM waves
         WHERE event_id = ? AND sent_at IS NULL ORDER BY position ASC, id ASC LIMIT 1`,
      )
      .bind(event.id)
      .first<{ wave_name: string; wave_decision_on: string }>();
    if (nextWave) {
      for (const row of submissions) {
        if (row.wave_name === null && SUBMITTER_AWAITING_DECISION.includes(row.status)) {
          row.wave_name = nextWave.wave_name;
          row.wave_decision_on = nextWave.wave_decision_on;
        }
      }
    }
  }
  return {
    seat: "submitter" as const,
    event,
    available_events: availableEvents,
    person: { id: person.id, name: person.name, email: person.email },
    submissions: submissions.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      format: row.format_name,
      submitted_at: row.submitted_at,
      updated_at: row.updated_at,
      wave_name: row.wave_name,
      wave_decision_on: row.wave_decision_on,
      role: row.participation_role,
      // Only set while the form is still open — an expired call is not a way back.
      form_slug: row.form_slug,
    })),
    tasks: [] as never[],
    handbook: { markdown: "" },
    venue: { pinned_building_count: 0 },
  };
}

async function portalSnapshot(db: D1Database, auth: SessionAuth, mediaPublicOrigin: string, requestedEventId?: string) {
  const speakerSeat = await findSpeakerEvent(db, auth, requestedEventId);
  if (!speakerSeat) {
    const submitterSeat = await findSubmitterEvent(db, auth, requestedEventId);
    if (submitterSeat) return submitterSnapshot(db, auth, submitterSeat);
    throw ApiError.notFound("conference not found");
  }
  const event = speakerSeat;
  const person = await personFor(db, auth.personId);
  const [submissionRows, tasks, primaryBuilding, pinnedBuildingCount] = await Promise.all([
    listSubmissions(db, event, auth.personId),
    listTasks(db, event, auth.personId, mediaPublicOrigin),
    primaryBuildingFor(db, event.id),
    pinnedBuildingCountFor(db, event.id),
  ]);
  const showBuildingComparison = showsBuildingComparisonCount(pinnedBuildingCount);
  const submissions = [...submissionRows];
  const sessions = submissions.map(arrivalSessionFor);
  for (const row of submissions) {
    row.arrival = arrivalForSession({
      current: arrivalSessionFor(row),
      previousSessions: sessions,
      primaryBuilding,
      timezone: event.timezone,
    });
  }
  if (submissions.some((row) => row.wave_name === null && AWAITING_DECISION.includes(row.status))) {
    const nextWave = await db
      .prepare(
        `SELECT name AS wave_name, decision_on AS wave_decision_on FROM waves
         WHERE event_id = ? AND sent_at IS NULL ORDER BY position ASC, id ASC LIMIT 1`,
      )
      .bind(event.id)
      .first<{ wave_name: string; wave_decision_on: string }>();
    if (nextWave) {
      for (const row of submissions) {
        if (row.wave_name === null && AWAITING_DECISION.includes(row.status)) {
          row.wave_name = nextWave.wave_name;
          row.wave_decision_on = nextWave.wave_decision_on;
        }
      }
    }
  }
  const submissionViews = await Promise.all(submissions.map(async (row) => {
    const [history, talk_editable] = await Promise.all([
      historyFor(db, event.id, row.id),
      talkIsEditable(db, event.id, row.id),
    ]);
    return { ...submissionView(event, row, showBuildingComparison), history, talk_editable };
  }));
  return {
    seat: "speaker" as const,
    event,
    person: {
      id: person.id,
      name: person.name,
      email: person.email,
      title: person.title,
      company: person.company,
      bio: person.bio,
      social_links: parseSocialLinks(person.social_links),
      headshot_attachment_id: person.headshot_attachment_id,
      updated_at: person.updated_at,
    },
    submissions: submissionViews,
    tasks,
    handbook: { markdown: HANDBOOKS[event.slug] ?? HANDBOOKS.default },
    venue: { pinned_building_count: pinnedBuildingCount },
  };
}

async function taskFor(db: D1Database, auth: SessionAuth, taskId: string): Promise<TaskProjection> {
  const task = await db
    .prepare(
      `SELECT task.id, task.event_id, task.person_id, task.submission_id, task.template_id,
         submission.title AS submission_title, submission.status AS submission_status,
         task.title, task.kind, task.description, task.due_at, task.status, task.completed_at, task.cancelled_at,
         task.response_json, task.attachment_id, template.form_id, template.file_config
       FROM speaker_tasks task
       JOIN events conference ON conference.id = task.event_id AND conference.org_id = ?
       JOIN task_templates template ON template.id = task.template_id AND template.event_id = task.event_id
       LEFT JOIN submissions submission ON submission.id = task.submission_id AND submission.event_id = task.event_id
       JOIN memberships membership ON membership.event_id = task.event_id
         AND membership.person_id = task.person_id AND membership.role = 'speaker'
       WHERE task.id = ? AND task.person_id = ?`,
    )
    .bind(auth.orgId, taskId, auth.personId)
    .first<TaskProjection>();
  if (!task) throw ApiError.notFound("task not found");
  if (task.cancelled_at !== null) throw ApiError.conflict("this task was cancelled because the talk is no longer active");
  return task;
}

async function completeTask(
  db: D1Database,
  auth: SessionAuth,
  task: TaskProjection,
  body: z.infer<typeof taskCompletionBody>,
): Promise<Record<string, unknown>> {
  const now = Date.now();
  let response: Record<string, unknown> = parseObject(task.response_json);
  let attachmentId: string | null = task.attachment_id;

  if (task.kind === "acknowledge") {
    if (body.acknowledged !== true) throw ApiError.unprocessable("acknowledgement is required", "acknowledged");
    response = { acknowledged: true };
  } else if (task.kind === "file") {
    if (!body.attachment_id) throw ApiError.unprocessable("a completed upload is required", "attachment_id");
    const attachment = await db
      .prepare(
        `SELECT id FROM attachments
         WHERE id = ? AND event_id = ? AND owner_type = 'task_upload' AND owner_id = ? AND status = 'ready'`,
      )
      .bind(body.attachment_id, task.event_id, task.id)
      .first<{ id: string }>();
    if (!attachment) throw ApiError.unprocessable("the upload is not ready for this task", "attachment_id");
    attachmentId = attachment.id;
    response = { attachment_id: attachment.id };
  } else {
    if (!task.form_id) throw ApiError.conflict("this form task has no form definition");
    const fields = await listFormFields(db, task.form_id);
    const existing = await readSubmissionAnswers(db, task.submission_id);
    const rawAnswers = body.answers ?? {};
    const merged = { ...existing, ...rawAnswers };
    const projection = projectApplicableAnswers(fields, merged);
    if (projection.issues.length > 0) {
      throw ApiError.unprocessable("complete the visible required fields", projection.issues[0]?.fieldKey, projection.issues);
    }
    if (task.submission_id) {
      const statements = [];
      const applicable = new Set(projection.answers ? Object.keys(projection.answers) : []);
      for (const field of fields) {
        if (!isFieldApplicable(field, merged)) {
          statements.push(db.prepare("DELETE FROM submission_answers WHERE submission_id = ? AND field_id = ?").bind(task.submission_id, field.id));
          continue;
        }
        const value = projection.answers[field.key];
        if (value === undefined) {
          statements.push(db.prepare("DELETE FROM submission_answers WHERE submission_id = ? AND field_id = ?").bind(task.submission_id, field.id));
          continue;
        }
        const answer = JSON.stringify(value);
        statements.push(db.prepare(
          `INSERT INTO submission_answers (id, submission_id, field_id, value_text, value_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        ).bind(crypto.randomUUID(), task.submission_id, field.id, typeof value === "string" ? value : null, answer, now, now));
      }
      // The schema has no natural unique key for answers. Remove the old row
      // for each field before inserting the canonical current value.
      for (const field of fields) {
        if (applicable.has(field.key)) {
          statements.unshift(db.prepare("DELETE FROM submission_answers WHERE submission_id = ? AND field_id = ?").bind(task.submission_id, field.id));
        }
      }
      if (statements.length > 0) await db.batch(statements);
    }
    response = projection.answers as Record<string, unknown>;
  }

  const result = await db
    .prepare(
      `UPDATE speaker_tasks
       SET status = 'done', completed_at = ?, response_json = ?, attachment_id = ?, last_write_source = 'marquee', updated_at = ?
       WHERE id = ? AND event_id = ? AND person_id = ? AND cancelled_at IS NULL`,
    )
    .bind(now, JSON.stringify(response), attachmentId, now, task.id, task.event_id, auth.personId)
    .run();
  if (Number(result?.meta?.changes ?? 0) !== 1) {
    throw ApiError.conflict("this task was cancelled before completion");
  }

  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    status: "done",
    completed_at: now,
    attachment_id: attachmentId,
    response,
  };
}

async function editableTalk(
  db: D1Database,
  auth: SessionAuth,
  submissionId: string,
): Promise<{ eventId: string; submission: { id: string; title: string; abstract: string | null; updated_at: number }; formStatus: string | null; closesAt: number | null; override: boolean }> {
  const row = await db
    .prepare(
      `SELECT submission.id, submission.event_id, submission.title, submission.abstract, submission.updated_at,
         form.status AS form_status, form.closes_at
       FROM submissions submission
       JOIN events conference ON conference.id = submission.event_id AND conference.org_id = ?
       JOIN participations participation ON participation.submission_id = submission.id AND participation.person_id = ?
       LEFT JOIN forms form ON form.id = submission.form_id AND form.event_id = submission.event_id
       JOIN memberships membership ON membership.event_id = submission.event_id
         AND membership.person_id = ? AND membership.role = 'speaker'
       WHERE submission.id = ?`,
    )
    .bind(auth.orgId, auth.personId, auth.personId, submissionId)
    .first<{
      id: string;
      event_id: string;
      title: string;
      abstract: string | null;
      updated_at: number;
      form_status: string | null;
      closes_at: number | null;
    }>();
  if (!row) throw ApiError.notFound("submission not found");
  const setting = await db
    .prepare("SELECT value_json FROM event_settings WHERE event_id = ? AND key = ?")
    .bind(row.event_id, `speaker_talk_editing:${row.id}`)
    .first<{ value_json: string }>();
  return {
    eventId: row.event_id,
    submission: { id: row.id, title: row.title, abstract: row.abstract, updated_at: row.updated_at },
    formStatus: row.form_status,
    closesAt: row.closes_at,
    override: parseJson<{ enabled?: boolean }>(setting?.value_json, {}).enabled === true,
  };
}

function talkEditingOpen(current: Awaited<ReturnType<typeof editableTalk>>): boolean {
  if (current.override) return true;
  return current.formStatus === "open" && (current.closesAt === null || current.closesAt > Date.now());
}

async function updateProfile(context: import("hono").Context<ApiEnv>, body: z.infer<typeof profileBody>) {
  const auth = requireUnscopedSpeakerSession(context);
  await speakerEvent(context.env.DB, auth);
  const current = await personFor(context.env.DB, auth.personId);
  let headshot = current.headshot_attachment_id;
  if (body.headshot_attachment_id !== undefined) {
    if (body.headshot_attachment_id === null) {
      headshot = null;
    } else {
      const attachment = await context.env.DB
        .prepare(
          `SELECT id FROM attachments
           WHERE id = ? AND owner_type = 'person_headshot' AND owner_id = ? AND status = 'ready'`,
        )
        .bind(body.headshot_attachment_id, auth.personId)
        .first<{ id: string }>();
      if (!attachment) throw ApiError.unprocessable("the headshot upload is not ready for this speaker", "headshot_attachment_id");
      headshot = attachment.id;
    }
  }
  const now = Date.now();
  // The organizer roster writes the same person through the same normalizer:
  // two of them is how the speaker's bio comes back different on the screen
  // that did not save it.
  await personProfileUpdateStatement(
    context.env.DB,
    auth.personId,
    resolvePersonProfile(current, body),
    headshot,
    now,
  ).run();
  const person = await personFor(context.env.DB, auth.personId);
  return context.json({
    person: {
      id: person.id,
      name: person.name,
      email: person.email,
      title: person.title,
      company: person.company,
      bio: person.bio,
      social_links: parseSocialLinks(person.social_links),
      headshot_attachment_id: person.headshot_attachment_id,
      updated_at: person.updated_at,
    },
  }, 200);
}

const getCoSpeakerSubmission = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/me/co-speaker/submissions/{submissionId}",
    operationId: "getCoSpeakerSubmission",
    summary: "Read the one submission attached to a co-speaker link",
    description: "Returns exactly the submission named by the co-speaker participation scope, never the person's wider speaker portal.",
    tags: ["Speaker portal"],
    request: { params: submissionParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(coSpeakerResponseSchema, "Co-speaker submission"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { auth, participationId } = requireCoSpeakerSession(context);
    const submission = await coSpeakerSubmissionFor(context.env.DB, auth, participationId, context.req.valid("param").submissionId);
    return context.json(coSpeakerResponse(await personFor(context.env.DB, auth.personId), submission), 200);
  },
);

const updateCoSpeakerSubmissionProfile = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/me/co-speaker/submissions/{submissionId}/profile",
    operationId: "updateCoSpeakerSubmissionProfile",
    summary: "Update a co-speaker bio or headshot",
    description: "Updates only the linked co-speaker's profile fields; submission title and abstract remain read-only on this surface.",
    tags: ["Speaker portal"],
    request: { params: submissionParams, body: { content: { "application/json": { schema: coSpeakerProfileBody } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(coSpeakerResponseSchema, "Updated co-speaker profile"), ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => updateCoSpeakerProfile(context, context.req.valid("param").submissionId, context.req.valid("json")),
);

const getPortal = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/me/portal",
    operationId: "getSpeakerPortal",
    summary: "Read the authenticated speaker portal",
    description: "Returns only the current session's own conference status, submissions, tasks, profile, schedule, and handbook. A session holding no speaker role but carrying a submission answers with `seat: \"submitter\"` and that person's submissions alone.",
    tags: ["Speaker portal"],
    request: { query: eventQuery },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(portalResponseSchema, "Speaker portal snapshot"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const auth = requireUnscopedSpeakerSession(context);
    const query = context.req.valid("query");
    return context.json(await portalSnapshot(context.env.DB, auth, portalMediaOrigin(context), query.eventId), 200);
  },
);

const participationResponseSchema = z.object({
  participation: z.object({
    id: z.string(),
    submission_id: z.string(),
    role: z.string(),
    confirmation_status: z.enum(["pending", "confirmed", "declined"]),
    confirmed_at: z.number().nullable(),
  }),
  changed: z.boolean(),
  notification_outbox_ids: z.array(z.string()),
});

const confirmParticipation = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/me/participations/{participationId}/confirm",
    operationId: "confirmSpeakerParticipation",
    summary: "Confirm one speaker role",
    description: "Confirms exactly one authenticated speaker participation; other roles on the same submission remain independent.",
    tags: ["Speaker portal"],
    request: { params: participationParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(participationResponseSchema, "Confirmed speaker role"), ...errorResponses([401, 403, 404, 409, 429, 500]) },
  },
  async (context) => {
    const { participationId } = context.req.valid("param");
    return respondToParticipation(context, participationId, "confirmed");
  },
);

const declineParticipation = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/me/participations/{participationId}/decline",
    operationId: "declineSpeakerParticipation",
    summary: "Decline one speaker role",
    description: "Declines exactly one authenticated speaker participation, notifies program leads, and flags the agenda through the derived participation state.",
    tags: ["Speaker portal"],
    request: { params: participationParams, body: { content: { "application/json": { schema: declineBody } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(participationResponseSchema, "Declined speaker role"), ...errorResponses([401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const { participationId } = context.req.valid("param");
    const body = context.req.valid("json");
    return respondToParticipation(context, participationId, "declined", body.note ?? null);
  },
);

const completeSpeakerTask = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/me/tasks/{taskId}/complete",
    operationId: "completeSpeakerTask",
    summary: "Complete an authenticated speaker task",
    description: "Validates the actual acknowledge, form, or verified file payload before marking the speaker task done.",
    tags: ["Speaker portal"],
    request: { params: taskParams, body: { content: { "application/json": { schema: taskCompletionBody } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(taskResponseSchema, "Completed speaker task"), ...errorResponses([401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const auth = requireUnscopedSpeakerSession(context);
    const task = await taskFor(context.env.DB, auth, context.req.valid("param").taskId);
    return context.json({ task: await completeTask(context.env.DB, auth, task, context.req.valid("json")) }, 200);
  },
);

const updateSpeakerProfile = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/me/profile",
    operationId: "updateSpeakerProfile",
    summary: "Update the authenticated speaker profile",
    description: "Updates the session speaker's public profile and optional ready headshot attachment.",
    tags: ["Speaker portal"],
    request: { body: { content: { "application/json": { schema: profileBody } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(profileResponseSchema, "Updated speaker profile"), ...errorResponses([401, 403, 404, 422, 429, 500]) },
  },
  async (context) => updateProfile(context, context.req.valid("json")),
);

const updateSpeakerTalk = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/me/submissions/{submissionId}/talk",
    operationId: "updateSpeakerTalk",
    summary: "Update an authenticated speaker talk",
    description: "Updates the speaker's own talk title and description while the conference form is open or an organizer override is active, recording immutable history.",
    tags: ["Speaker portal"],
    request: { params: submissionParams, body: { content: { "application/json": { schema: talkBody } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(talkResponseSchema, "Updated speaker talk"), ...errorResponses([401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const auth = requireUnscopedSpeakerSession(context);
    const { submissionId } = context.req.valid("param");
    const body = context.req.valid("json");
    if (body.title === undefined && body.description === undefined) {
      throw ApiError.badRequest("title or description is required");
    }
    const current = await editableTalk(context.env.DB, auth, submissionId);
    if (!talkEditingOpen(current)) throw ApiError.forbidden("talk editing is closed for this conference");
    const next = {
      title: body.title ?? current.submission.title,
      description: body.description === undefined ? current.submission.abstract : body.description,
    };
    if (next.title === current.submission.title && next.description === current.submission.abstract) {
      return context.json({ submission: { ...current.submission, ...next }, history: await historyFor(context.env.DB, current.eventId, submissionId) }, 200);
    }
    const now = Date.now();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE submissions SET title = ?, abstract = ?, search_blob = ?, last_saved_at = ?, last_write_source = 'marquee', updated_at = ?
         WHERE id = ? AND event_id = ?`,
      ).bind(next.title, next.description, `${next.title} ${next.description ?? ""}`.toLowerCase(), now, now, submissionId, current.eventId),
      auditStatement(context.env.DB, {
        eventId: current.eventId,
        actorKind: "user",
        actorPersonId: auth.personId,
        action: "speaker_talk_updated",
        entityType: "submission",
        entityId: submissionId,
        before: { title: current.submission.title, description: current.submission.abstract },
        after: next,
        now,
        requestId: context.get("requestId") ?? null,
      }),
    ]);
    return context.json({
      submission: { ...current.submission, ...next, updated_at: now },
      history: await historyFor(context.env.DB, current.eventId, submissionId),
    }, 200);
  },
);

const updateSpeakerTalkEditing = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/submissions/{submissionId}/talk-editing",
    operationId: "updateSpeakerTalkEditing",
    summary: "Control speaker talk editing",
    description: "Allows program staff to reopen or close speaker title and description editing for one conference submission.",
    tags: ["Speaker portal"],
    request: { params: eventSubmissionParams, body: { content: { "application/json": { schema: talkEditingBody } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(talkEditingResponseSchema, "Talk editing setting"), ...errorResponses([401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId, submissionId } = context.req.valid("param");
    const exists = await context.env.DB
      .prepare("SELECT id FROM submissions WHERE id = ? AND event_id = ?")
      .bind(submissionId, eventId)
      .first<{ id: string }>();
    if (!exists) throw ApiError.notFound("submission not found");
    const { enabled } = context.req.valid("json");
    const now = Date.now();
    await context.env.DB.prepare(
      `INSERT INTO event_settings (id, event_id, key, value_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ).bind(`speaker-talk-editing-${submissionId}`, eventId, `speaker_talk_editing:${submissionId}`, JSON.stringify({ enabled }), now, now).run();
    return context.json({ enabled }, 200);
  },
);

export const apiRoutes = [
  getCoSpeakerSubmission,
  updateCoSpeakerSubmissionProfile,
  getPortal,
  confirmParticipation,
  declineParticipation,
  completeSpeakerTask,
  updateSpeakerProfile,
  updateSpeakerTalk,
  updateSpeakerTalkEditing,
];
