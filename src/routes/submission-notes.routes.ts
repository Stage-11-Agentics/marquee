/**
 * Internal notes on one submission.
 *
 * A submission is event-scoped, while its author is an organization-level
 * people row. The route therefore resolves the submission's event before it
 * authorizes the caller and never accepts an author id from the request.
 * Notes are append-only: this module deliberately exposes GET and POST only.
 */
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { ApiEnv } from "../api/runtime";
import { getAuth } from "../lib/auth/auth-middleware";
import { authHasRole, type AuthContext } from "../lib/auth/scope-resolution";

const submissionParams = z.object({ submissionId: z.string().min(1) });
const noteBody = z.object({
  body: z.string().trim().min(1).max(5_000),
}).strict();

const noteSchema = z.object({
  id: z.string(),
  submission_id: z.string(),
  body: z.string(),
  author_person_id: z.string(),
  author_name: z.string(),
  created_at: z.number().int(),
}).openapi("SubmissionNote");

const notesResponse = z.object({ notes: z.array(noteSchema) }).openapi("SubmissionNotes");
const noteResponse = z.object({ note: noteSchema }).openapi("SubmissionNoteResult");

interface SubmissionScope {
  id: string;
  event_id: string;
  org_id: string;
}

interface NoteRow {
  id: string;
  submission_id: string;
  body_md: string;
  author_person_id: string;
  author_name: string;
  created_at: number;
}

async function submissionScope(db: D1Database, submissionId: string): Promise<SubmissionScope> {
  const row = await db.prepare(
    `SELECT submission.id, submission.event_id, event.org_id
     FROM submissions submission
     JOIN events event ON event.id = submission.event_id
     WHERE submission.id = ?`,
  ).bind(submissionId).first<SubmissionScope>();
  if (!row) throw ApiError.notFound("submission not found");
  return row;
}

async function requireSubmissionStaff(
  context: Context<ApiEnv>,
  submissionId: string,
): Promise<{ auth: AuthContext; scope: SubmissionScope }> {
  const auth = getAuth(context);
  if (!auth) throw ApiError.unauthenticated();
  const scope = await submissionScope(context.env.DB, submissionId);
  if (!authHasRole(auth, "ops", scope.event_id)) {
    throw ApiError.forbidden("submission notes are limited to program staff for this conference");
  }
  return { auth, scope };
}

async function actorPersonId(db: D1Database, auth: AuthContext, orgId: string): Promise<string> {
  let personId: string | null = auth.kind === "session" ? auth.personId : auth.actingPersonId;
  if (auth.kind === "token" && !personId) {
    const token = await db.prepare("SELECT created_by FROM api_tokens WHERE id = ?")
      .bind(auth.tokenId)
      .first<{ created_by: string | null }>();
    personId = token?.created_by ?? null;
  }
  if (!personId) throw ApiError.unauthenticated("the authenticated seat has no people record");
  const person = await db.prepare("SELECT id FROM people WHERE id = ? AND org_id = ?")
    .bind(personId, orgId)
    .first<{ id: string }>();
  if (!person) throw ApiError.unauthenticated("the authenticated seat is no longer available");
  return person.id;
}

async function readNotes(db: D1Database, submissionId: string): Promise<NoteRow[]> {
  const result = await db.prepare(
    `SELECT note.id, note.submission_id, note.body_md, note.author_person_id,
            person.name AS author_name, note.created_at
     FROM submission_notes note
     JOIN people person ON person.id = note.author_person_id
     WHERE note.submission_id = ?
     ORDER BY note.created_at DESC, note.id DESC
     LIMIT 200`,
  ).bind(submissionId).all<NoteRow>();
  return result.results;
}

function serializedNote(row: NoteRow) {
  return {
    id: row.id,
    submission_id: row.submission_id,
    body: row.body_md,
    author_person_id: row.author_person_id,
    author_name: row.author_name,
    created_at: row.created_at,
  };
}

const listSubmissionNotes = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/submissions/{submissionId}/notes",
    operationId: "listSubmissionNotes",
    summary: "List internal notes on a submission",
    description: "Returns append-only notes for program staff. Notes are never exposed to speakers, public pages, or outbound messages.",
    tags: ["Submissions"],
    request: { params: submissionParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: jsonResponse(notesResponse, "Internal submission notes"),
      ...errorResponses([401, 403, 404, 429, 500]),
    },
  },
  async (context) => {
    const { submissionId } = context.req.valid("param");
    await requireSubmissionStaff(context, submissionId);
    return context.json({ notes: (await readNotes(context.env.DB, submissionId)).map(serializedNote) }, 200);
  },
);

const addSubmissionNote = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/submissions/{submissionId}/notes",
    operationId: "addSubmissionNote",
    summary: "Append an internal note to a submission",
    description: "Appends one staff-attributed note. There is no update or delete path, and the author comes from the authenticated seat.",
    tags: ["Submissions"],
    request: {
      params: submissionParams,
      body: { content: { "application/json": { schema: noteBody } } },
    },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      201: jsonResponse(noteResponse, "The appended internal submission note"),
      ...errorResponses([400, 401, 403, 404, 422, 429, 500]),
    },
  },
  async (context) => {
    const { submissionId } = context.req.valid("param");
    const { auth, scope } = await requireSubmissionStaff(context, submissionId);
    const authorPersonId = await actorPersonId(context.env.DB, auth, scope.org_id);
    const body = context.req.valid("json");
    const id = newUlid();
    const createdAt = Date.now();
    await context.env.DB.prepare(
      `INSERT INTO submission_notes (id, submission_id, author_person_id, body_md, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(id, submissionId, authorPersonId, body.body, createdAt).run();
    const row = await context.env.DB.prepare(
      `SELECT note.id, note.submission_id, note.body_md, note.author_person_id,
              person.name AS author_name, note.created_at
       FROM submission_notes note
       JOIN people person ON person.id = note.author_person_id
       WHERE note.id = ?`,
    ).bind(id).first<NoteRow>();
    if (!row) throw new Error("submission note disappeared after insert");
    return context.json({ note: serializedNote(row) }, 201);
  },
);

export const apiRoutes = [listSubmissionNotes, addSubmissionNote];
