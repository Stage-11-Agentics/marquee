import { ApiError } from "../api/errors";
import { roleInSql, WORK_HOLDING_PARTICIPATION_ROLES } from "./participants";

export const FILE_COMMENT_OWNER_TYPE = "task_upload" as const;

export interface FileComment {
  id: string;
  event_id: string;
  owner_type: typeof FILE_COMMENT_OWNER_TYPE;
  owner_id: string;
  attachment_id: string | null;
  attachment_filename: string | null;
  attachment_version: number | null;
  author_person_id: string;
  author_name: string;
  author_role: string;
  body: string;
  created_at: number;
}

interface FileTaskRow {
  id: string;
  event_id: string;
  org_id: string;
  person_id: string;
}

interface FileCommentRow {
  id: string;
  event_id: string;
  owner_type: typeof FILE_COMMENT_OWNER_TYPE;
  owner_id: string;
  attachment_id: string | null;
  author_person_id: string;
  body: string;
  created_at: number;
  attachment_filename: string | null;
  attachment_version: number | null;
  author_name: string;
  author_role: string;
}

/** A commentable slot is a file task, not an individual attachment version. */
export async function fileTaskForEvent(
  db: D1Database,
  eventId: string,
  taskId: string,
): Promise<FileTaskRow> {
  const task = await db
    .prepare(
      `SELECT task.id, task.event_id, task.person_id, event.org_id
       FROM speaker_tasks task
       JOIN events event ON event.id = task.event_id
       WHERE task.id = ? AND task.event_id = ? AND task.kind = 'file'`,
    )
    .bind(taskId, eventId)
    .first<FileTaskRow>();
  if (!task) throw ApiError.notFound("deliverable not found");
  return task;
}

export async function fileTaskForSpeaker(
  db: D1Database,
  taskId: string,
  orgId: string,
  personId: string,
): Promise<FileTaskRow> {
  const task = await db
    .prepare(
      `SELECT task.id, task.event_id, task.person_id, event.org_id
       FROM speaker_tasks task
       JOIN events event ON event.id = task.event_id AND event.org_id = ?
       LEFT JOIN memberships membership
         ON membership.event_id = task.event_id
        AND membership.person_id = ?
        AND ${roleInSql("membership", WORK_HOLDING_PARTICIPATION_ROLES)}
       WHERE task.id = ? AND task.kind = 'file'
         AND (
           (task.person_id = ? AND membership.id IS NOT NULL)
           OR EXISTS (
             SELECT 1 FROM speaker_helpers helper
             WHERE helper.event_id = task.event_id
               AND helper.speaker_person_id = task.person_id
               AND helper.helper_person_id = ?
               AND helper.removed_at IS NULL
           )
         )`,
    )
    .bind(orgId, personId, taskId, personId, personId)
    .first<FileTaskRow>();
  if (!task) throw ApiError.notFound("deliverable not found");
  return task;
}

async function validateAttachment(
  db: D1Database,
  task: FileTaskRow,
  attachmentId: string | null | undefined,
): Promise<string | null> {
  if (attachmentId === undefined || attachmentId === null) return null;
  const attachment = await db
    .prepare(
      `SELECT id
       FROM attachments
       WHERE id = ? AND event_id = ? AND owner_type = ? AND owner_id = ? AND status = 'ready'`,
    )
    .bind(attachmentId, task.event_id, FILE_COMMENT_OWNER_TYPE, task.id)
    .first<{ id: string }>();
  if (!attachment) {
    throw ApiError.unprocessable("choose a ready version of this deliverable", "attachment_id");
  }
  return attachment.id;
}

async function validateAuthor(
  db: D1Database,
  task: FileTaskRow,
  authorPersonId: string,
): Promise<void> {
  const author = await db
    .prepare(
      `SELECT person.id
       FROM people person
       WHERE person.id = ? AND person.org_id = ?
         AND (
           EXISTS (
             SELECT 1 FROM memberships membership
             WHERE membership.person_id = person.id
               AND membership.org_id = person.org_id
               AND (membership.event_id = ? OR membership.event_id IS NULL)
           )
           OR EXISTS (
             SELECT 1 FROM speaker_helpers helper
             WHERE helper.event_id = ?
               AND helper.speaker_person_id = task.person_id
               AND helper.helper_person_id = person.id
               AND helper.removed_at IS NULL
           )
         )
       LIMIT 1`,
    )
    .bind(authorPersonId, task.org_id, task.event_id, task.event_id)
    .first<{ id: string }>();
  if (!author) throw ApiError.forbidden("comment author is not a member of this conference");
}

/**
 * Read a thread in creation order. The attachment version is calculated from
 * the immutable ready-upload history, so a v1 tag remains readable after the
 * task pointer moves to v2.
 */
export async function listFileComments(
  db: D1Database,
  eventId: string,
  taskId: string,
): Promise<FileComment[]> {
  await fileTaskForEvent(db, eventId, taskId);
  const result = await db
    .prepare(
      `SELECT comment.id, comment.event_id, comment.owner_type, comment.owner_id,
              comment.attachment_id, comment.author_person_id, comment.body, comment.created_at,
              person.name AS author_name,
              COALESCE(
                (SELECT membership.role
                 FROM memberships membership
                 WHERE membership.person_id = comment.author_person_id
                   AND membership.org_id = event.org_id
                   AND membership.event_id = comment.event_id
                 ORDER BY CASE membership.role
                   WHEN 'owner' THEN 5
                   WHEN 'program_lead' THEN 4
                   WHEN 'ops' THEN 3
                   WHEN 'reviewer' THEN 2
                   WHEN 'speaker' THEN 1
                   ELSE 0
                 END DESC, membership.id ASC
                 LIMIT 1),
                (SELECT membership.role
                 FROM memberships membership
                 WHERE membership.person_id = comment.author_person_id
                   AND membership.org_id = event.org_id
                   AND membership.event_id IS NULL
                 ORDER BY CASE membership.role
                   WHEN 'owner' THEN 5
                   WHEN 'program_lead' THEN 4
                   WHEN 'ops' THEN 3
                   WHEN 'reviewer' THEN 2
                   WHEN 'speaker' THEN 1
                   ELSE 0
                 END DESC, membership.id ASC
                 LIMIT 1),
                'speaker'
              ) AS author_role,
              attachment.filename AS attachment_filename,
              attachment.version AS attachment_version
       FROM file_comments comment
       JOIN events event ON event.id = comment.event_id
       JOIN people person ON person.id = comment.author_person_id
       LEFT JOIN (
         SELECT id, owner_type, owner_id, filename,
                ROW_NUMBER() OVER (PARTITION BY owner_type, owner_id ORDER BY created_at, id) AS version
         FROM attachments
         WHERE status = 'ready'
       ) attachment
         ON attachment.id = comment.attachment_id
        AND attachment.owner_type = comment.owner_type
        AND attachment.owner_id = comment.owner_id
       WHERE comment.event_id = ? AND comment.owner_type = ? AND comment.owner_id = ?
       ORDER BY comment.created_at ASC, comment.id ASC`,
    )
    .bind(eventId, FILE_COMMENT_OWNER_TYPE, taskId)
    .all<FileCommentRow>();
  return result.results.map((comment) => ({
    id: comment.id,
    event_id: comment.event_id,
    owner_type: comment.owner_type,
    owner_id: comment.owner_id,
    attachment_id: comment.attachment_id,
    attachment_filename: comment.attachment_filename,
    attachment_version: comment.attachment_version,
    author_person_id: comment.author_person_id,
    author_name: comment.author_name,
    author_role: comment.author_role,
    body: comment.body,
    created_at: comment.created_at,
  }));
}

export async function addFileComment(
  db: D1Database,
  input: {
    eventId: string;
    taskId: string;
    authorPersonId: string;
    body: string;
    attachmentId?: string | null;
  },
): Promise<FileComment> {
  const task = await fileTaskForEvent(db, input.eventId, input.taskId);
  const body = input.body.trim();
  if (!body) throw ApiError.unprocessable("a comment cannot be blank", "body");
  if (body.length > 10_000) throw ApiError.unprocessable("a comment is too long", "body");
  const attachmentId = await validateAttachment(db, task, input.attachmentId);
  await validateAuthor(db, task, input.authorPersonId);

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await db
    .prepare(
      `INSERT INTO file_comments
         (id, event_id, owner_type, owner_id, attachment_id, author_person_id, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.eventId, FILE_COMMENT_OWNER_TYPE, input.taskId, attachmentId, input.authorPersonId, body, createdAt)
    .run();

  const comments = await listFileComments(db, input.eventId, input.taskId);
  const created = comments.find((comment) => comment.id === id);
  if (!created) throw new Error("comment was written but could not be read back");
  return created;
}
