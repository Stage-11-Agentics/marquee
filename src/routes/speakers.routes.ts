/**
 * The organizer's speaker roster and person CRUD.
 *
 * The roster is a *person* list, not a chase matrix: the organizer's mental
 * model is "who is speaking at my conference", and the outstanding-work view is
 * a question asked of that list (the onboarding board), not a parallel universe
 * with its own membership rules. Both read `speakers.queries.ts`.
 */
import type { Context } from "hono";
import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import { auditStatement } from "../lib/audit";
import { getAuth } from "../lib/auth/auth-middleware";
import {
  normalizeCustomFields,
  personProfilePatchShape,
  personProfileUpdateStatement,
  resolvePersonProfile,
  type PersonProfileColumns,
} from "../lib/person-profile";
import { speakerMembershipStatement } from "../lib/speaker-membership";
import { listSpeakerFiles } from "./speaker-files.queries";
import { getSpeaker, listSpeakers } from "./speakers.queries";

const eventParams = z.object({ eventId: z.string().min(1) });
const speakerParams = eventParams.extend({ personId: z.string().min(1) });

const rosterQuery = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["all", "pending", "invited", "confirmed", "declined"]).default("all"),
  track: z.string().trim().min(1).max(100).optional(),
});

const customFieldsSchema = z.record(z.string().min(1).max(80), z.string().max(2_000));

// No `headshot_attachment_id` on create: an upload is owned by a person, and
// the person does not exist yet. Accepting it here would have to either ignore
// the field or trust an id it cannot check. Attach it on the PATCH instead.
const { headshot_attachment_id: _headshotOnCreate, ...createProfileShape } = personProfilePatchShape;
const createBody = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  ...createProfileShape,
  custom_fields: customFieldsSchema.optional(),
  /** Records that the organizer has reached out, without pretending mail was sent. */
  invited: z.boolean().optional(),
}).strict();

const patchBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(320).optional(),
  ...personProfilePatchShape,
  custom_fields: customFieldsSchema.optional(),
  confirmation_status: z.enum(["pending", "invited", "confirmed", "declined"]).optional(),
}).strict();

const speakerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  title: z.string().nullable(),
  company: z.string().nullable(),
  bio: z.string().nullable(),
  headshot_attachment_id: z.string().nullable(),
  social_links: z.array(z.string()),
  custom_fields: z.record(z.string(), z.string()),
  status: z.enum(["pending", "invited", "confirmed", "declined"]),
  is_member: z.boolean(),
  sessions: z.array(z.object({
    participation_id: z.string(),
    submission_id: z.string(),
    title: z.string(),
    status: z.string(),
    role: z.string(),
    confirmation_status: z.enum(["pending", "confirmed", "declined"]),
  })),
  tracks: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
  task_total: z.number(),
  task_done: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
}).openapi("Speaker");

const rosterSchema = z.object({
  generated_at: z.number(),
  counts: z.record(z.string(), z.number()),
  tracks: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
  rows: z.array(speakerSchema),
  total: z.number(),
}).openapi("SpeakerRoster");

const speakerResponseSchema = z.object({ speaker: speakerSchema }).openapi("SpeakerResponse");

interface EventRow {
  id: string;
  org_id: string;
}

async function eventFor(db: D1Database, eventId: string): Promise<EventRow> {
  const event = await db.prepare("SELECT id, org_id FROM events WHERE id = ?").bind(eventId).first<EventRow>();
  if (!event) throw ApiError.notFound("event not found");
  return event;
}

/** Organizer edits are attributable: a roster that cannot say who changed a bio is not a record. */
async function actorPersonId(context: Context<ApiEnv>): Promise<string> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  if (auth.kind === "session") return auth.personId;
  const token = await context.env.DB
    .prepare("SELECT created_by FROM api_tokens WHERE id = ?")
    .bind(auth.tokenId)
    .first<{ created_by: string }>();
  if (!token?.created_by) throw ApiError.unauthenticated("the token issuer is no longer available");
  return token.created_by;
}

interface PersonRow extends PersonProfileColumns {
  id: string;
  name: string;
  email: string;
  headshot_attachment_id: string | null;
  custom_fields: string;
}

const PERSON_SELECT = `SELECT id, name, email, title, company, bio, social_links, custom_fields,
                              headshot_attachment_id
                       FROM people WHERE id = ? AND org_id = ?`;

/**
 * The organizer may only attach a headshot that belongs to the person being
 * edited. The check is here rather than in the shared normalizer because it is
 * authorization: a helper that took the id on trust would be a way to hang
 * someone else's photograph on a speaker.
 */
async function resolveHeadshot(
  db: D1Database,
  personId: string,
  current: string | null,
  next: string | null | undefined,
): Promise<string | null> {
  if (next === undefined) return current;
  if (next === null) return null;
  const attachment = await db
    .prepare(
      `SELECT id FROM attachments
       WHERE id = ? AND owner_type = 'person_headshot' AND owner_id = ? AND status = 'ready'`,
    )
    .bind(next, personId)
    .first<{ id: string }>();
  if (!attachment) throw ApiError.unprocessable("that headshot upload is not ready for this speaker", "headshot_attachment_id");
  return attachment.id;
}

const listRoster = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/speakers",
    operationId: "listEventSpeakers",
    summary: "List the conference speaker roster",
    description:
      "Every speaker of the conference — organizer-added, submitted, imported, or accepted — with search, status, and track filters.",
    tags: ["Speakers"],
    request: { params: eventParams, query: rosterQuery },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(rosterSchema, "Speaker roster"), ...errorResponses([400, 401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const query = context.req.valid("query");
    await eventFor(context.env.DB, eventId);
    return context.json(
      await listSpeakers(context.env.DB, eventId, { search: query.q, status: query.status, track: query.track }),
      200,
    );
  },
);

const readSpeaker = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/speakers/{personId}",
    operationId: "getEventSpeaker",
    summary: "Read one speaker record",
    description: "The full organizer-side speaker record: profile, logistics fields, sessions, and roster status.",
    tags: ["Speakers"],
    request: { params: speakerParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(speakerResponseSchema, "Speaker record"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId, personId } = context.req.valid("param");
    await eventFor(context.env.DB, eventId);
    const speaker = await getSpeaker(context.env.DB, eventId, personId);
    if (!speaker) throw ApiError.notFound("speaker not found");
    return context.json({ speaker }, 200);
  },
);

/**
 * The media origin is a Worker binding rather than an API binding, exactly as
 * `uploads.routes.ts` and `files.routes.ts` treat it.
 */
function mediaOrigin(context: Context<ApiEnv>): string {
  return (context.env as unknown as { MEDIA_PUBLIC_ORIGIN?: string }).MEDIA_PUBLIC_ORIGIN ?? "";
}

function mediaSigningSecret(context: Context<ApiEnv>): string {
  return (context.env as unknown as { UPLOAD_TOKEN_SECRET: string }).UPLOAD_TOKEN_SECRET;
}

const readSpeakerFiles = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/speakers/{personId}/files",
    operationId: "listEventSpeakerFiles",
    summary: "List everything one speaker has sent the conference",
    description:
      "The speaker's profile photo and every requested deliverable, each with filename, upload date, size, and full version history. Version numbers and the current version are derived from the owner's latest-pointer, never stored. Every returned file URL is a short-lived signed capability on the separate media origin; it expires after 15 minutes and is invalidated when its attachment or owning participation is revoked.",
    tags: ["Speakers", "Files"],
    request: { params: speakerParams },
    policy: { auth: { kind: "grants", grants: ["program:read"] }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(z.unknown(), "Speaker files"), ...errorResponses([401, 403, 404, 429, 500]) },
  },
  async (context) => {
    const { eventId, personId } = context.req.valid("param");
    await eventFor(context.env.DB, eventId);
    const speaker = await getSpeaker(context.env.DB, eventId, personId);
    if (!speaker) throw ApiError.notFound("speaker not found");
    return context.json({ data: await listSpeakerFiles(context.env.DB, eventId, personId, mediaOrigin(context), mediaSigningSecret(context)) }, 200);
  },
);

const createSpeaker = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/events/{eventId}/speakers",
    operationId: "createEventSpeaker",
    summary: "Add a speaker to the conference roster",
    description:
      "Creates or re-uses the person by email within the organization and records their speaker membership of this conference.",
    tags: ["Speakers"],
    request: { params: eventParams, body: { content: { "application/json": { schema: createBody } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 201: jsonResponse(speakerResponseSchema, "Created speaker"), ...errorResponses([400, 401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const body = context.req.valid("json");
    const event = await eventFor(context.env.DB, eventId);
    const actor = await actorPersonId(context);
    const now = Date.now();
    const email = body.email.toLowerCase();

    // People are org-scoped and an organizer typing a known address means the
    // same human, not a second record — the duplicate roster row is the thing
    // that makes a conference chase one person twice.
    const existing = await context.env.DB
      .prepare("SELECT id, name, email, title, company, bio, social_links, custom_fields, headshot_attachment_id FROM people WHERE org_id = ? AND lower(email) = ?")
      .bind(event.org_id, email)
      .first<PersonRow>();

    const personId = existing?.id ?? newUlid(now);
    // Add-speaker is an add, never an erase. When the email resolves to someone
    // the organization already knows, a field left blank on the form means "I
    // did not retype this", not "delete what the speaker wrote in their portal".
    // Without this, re-adding an accepted speaker by name and email wiped their
    // title, company, and bio org-wide.
    const profilePatch = existing
      ? Object.fromEntries(Object.entries(body).filter(([, value]) => value !== null && value !== undefined))
      : body;
    const resolved = resolvePersonProfile(
      existing ?? { title: null, company: null, bio: null, social_links: "[]", custom_fields: "{}" },
      profilePatch,
    );
    const customFields = normalizeCustomFields(body.custom_fields, existing?.custom_fields ?? "{}");
    const statements: D1PreparedStatement[] = [];

    if (existing) {
      statements.push(
        context.env.DB
          .prepare("UPDATE people SET name = ?, last_write_source = 'marquee', updated_at = ? WHERE id = ?")
          .bind(body.name, now, personId),
        // The headshot is not part of the create contract (see `createBody`), so
        // the existing pointer is carried through untouched rather than resolved.
        personProfileUpdateStatement(
          context.env.DB,
          personId,
          resolved,
          existing.headshot_attachment_id,
          now,
          customFields,
        ),
      );
    } else {
      statements.push(
        context.env.DB
          .prepare(
            `INSERT INTO people
               (id, org_id, email, name, title, company, bio, headshot_attachment_id, social_links,
                custom_fields, is_demo, last_write_source, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, 'marquee', ?, ?)`,
          )
          .bind(
            personId,
            event.org_id,
            body.email,
            body.name,
            resolved.title,
            resolved.company,
            resolved.bio,
            resolved.socialLinksJson,
            customFields,
            now,
            now,
          ),
      );
    }

    statements.push(
      speakerMembershipStatement(context.env.DB, {
        orgId: event.org_id,
        eventId,
        personId,
        now,
        invitedAt: body.invited ? now : null,
      }),
      auditStatement(context.env.DB, {
        eventId,
        actorKind: "user",
        actorPersonId: actor,
        action: existing ? "speaker_roster_linked" : "speaker_created",
        entityType: "person",
        entityId: personId,
        before: existing ? { name: existing.name, title: existing.title, company: existing.company, bio: existing.bio } : undefined,
        after: { name: body.name, email: body.email, title: resolved.title, company: resolved.company, bio: resolved.bio },
        now,
        requestId: context.get("requestId") ?? null,
      }),
    );

    await context.env.DB.batch(statements);
    const speaker = await getSpeaker(context.env.DB, eventId, personId);
    if (!speaker) throw new Error("the created speaker did not resolve onto the roster");
    return context.json({ speaker }, 201);
  },
);

const patchSpeaker = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/events/{eventId}/speakers/{personId}",
    operationId: "updateEventSpeaker",
    summary: "Edit a speaker record",
    description:
      "Organizer-side edit of the speaker profile, logistics fields, and roster status. Status writes through to every session role so the badge and the per-session chips cannot disagree.",
    tags: ["Speakers"],
    request: { params: speakerParams, body: { content: { "application/json": { schema: patchBody } } } },
    policy: { auth: { kind: "grants", grants: ["program:write"] }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(speakerResponseSchema, "Updated speaker"), ...errorResponses([400, 401, 403, 404, 422, 429, 500]) },
  },
  async (context) => {
    const { eventId, personId } = context.req.valid("param");
    const body = context.req.valid("json");
    const event = await eventFor(context.env.DB, eventId);
    const before = await getSpeaker(context.env.DB, eventId, personId);
    if (!before) throw ApiError.notFound("speaker not found");
    const person = await context.env.DB.prepare(PERSON_SELECT).bind(personId, event.org_id).first<PersonRow>();
    if (!person) throw ApiError.notFound("speaker not found");

    const actor = await actorPersonId(context);
    const now = Date.now();
    if (body.email !== undefined && body.email.toLowerCase() !== person.email.toLowerCase()) {
      // Case-insensitive, because `createSpeaker` resolves identity with
      // `lower(email)`. An exact-match check let `Dana@…` slip past a stored
      // `dana@…` and created two people sharing one address, after which the
      // create path picks between the duplicates arbitrarily.
      const taken = await context.env.DB
        .prepare("SELECT id FROM people WHERE org_id = ? AND lower(email) = ? AND id <> ?")
        .bind(event.org_id, body.email.toLowerCase(), personId)
        .first<{ id: string }>();
      if (taken) throw ApiError.unprocessable("another person in this organization already uses that email", "email");
    }
    const resolved = resolvePersonProfile(person, body);
    const customFields = normalizeCustomFields(body.custom_fields, person.custom_fields);
    const headshot = await resolveHeadshot(context.env.DB, personId, person.headshot_attachment_id, body.headshot_attachment_id);
    const statements: D1PreparedStatement[] = [
      personProfileUpdateStatement(context.env.DB, personId, resolved, headshot, now, customFields),
    ];
    if (body.name !== undefined || body.email !== undefined) {
      statements.push(
        context.env.DB
          .prepare("UPDATE people SET name = ?, email = ?, last_write_source = 'marquee', updated_at = ? WHERE id = ?")
          .bind(body.name ?? person.name, body.email ?? person.email, now, personId),
      );
    }

    if (body.confirmation_status !== undefined) {
      // The override is a statement about the conference AND about every session
      // the person holds. Writing only one of them is how two screens start
      // disagreeing about the same speaker.
      const stored = body.confirmation_status === "invited" ? "pending" : body.confirmation_status;
      const invitedAt = body.confirmation_status === "pending" ? null : now;
      const confirmedAt = body.confirmation_status === "confirmed" ? now : null;
      statements.push(
        speakerMembershipStatement(context.env.DB, { orgId: event.org_id, eventId, personId, now }),
        context.env.DB
          .prepare(
            // Confirming a speaker invited in May must not restamp the
            // invitation as today, or the two stores disagree about when it
            // happened in a design whose premise is that they cannot. The
            // membership row is often minted by this very request, so it has
            // nothing of its own to preserve — it inherits the earliest real
            // invitation from the sessions before falling back to now.
            `UPDATE memberships
             SET confirmation_status = ?, confirmed_at = ?,
                 invited_at = ${invitedAt === null ? "NULL" : `COALESCE(
                   invited_at,
                   (SELECT MIN(part.invited_at) FROM participations part
                     WHERE part.person_id = ?
                       AND part.role IN ('speaker', 'co_speaker')
                       AND part.submission_id IN (SELECT id FROM submissions WHERE event_id = ?)),
                   ?
                 )`}, updated_at = ?
             WHERE event_id = ? AND person_id = ? AND role = 'speaker'`,
          )
          .bind(...[
            stored,
            confirmedAt,
            ...(invitedAt === null ? [] : [personId, eventId, invitedAt]),
            now,
            eventId,
            personId,
          ]),
        context.env.DB
          .prepare(
            // Setting a speaker back to Pending has to clear the invitation
            // too. `COALESCE` would preserve an earlier `invited_at`, and the
            // rollup reads pending + invited_at as "Invited" — so the badge
            // would come back Invited in the very response to setting Pending,
            // while the membership row said otherwise.
            `UPDATE participations
             SET confirmation_status = ?, confirmed_at = ?,
                 invited_at = ${invitedAt === null ? "NULL" : "COALESCE(invited_at, ?)"}, updated_at = ?
             WHERE person_id = ?
               AND role IN ('speaker', 'co_speaker')
               AND submission_id IN (SELECT id FROM submissions WHERE event_id = ?)`,
          )
          .bind(...[stored, confirmedAt, ...(invitedAt === null ? [] : [invitedAt]), now, personId, eventId]),
      );
    }

    statements.push(
      auditStatement(context.env.DB, {
        eventId,
        actorKind: "user",
        actorPersonId: actor,
        action: "speaker_updated",
        entityType: "person",
        entityId: personId,
        before: {
          name: before.name,
          email: before.email,
          title: before.title,
          company: before.company,
          bio: before.bio,
          status: before.status,
          custom_fields: before.custom_fields,
        },
        after: {
          name: body.name ?? before.name,
          email: body.email ?? before.email,
          title: resolved.title,
          company: resolved.company,
          bio: resolved.bio,
          status: body.confirmation_status ?? before.status,
          custom_fields: JSON.parse(customFields) as Record<string, string>,
        },
        now,
        requestId: context.get("requestId") ?? null,
      }),
    );

    await context.env.DB.batch(statements);
    const speaker = await getSpeaker(context.env.DB, eventId, personId);
    if (!speaker) throw new Error("the updated speaker did not resolve onto the roster");
    return context.json({ speaker }, 200);
  },
);

export const apiRoutes = [listRoster, readSpeaker, readSpeakerFiles, createSpeaker, patchSpeaker];
