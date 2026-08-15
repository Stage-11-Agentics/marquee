/**
 * The one reader for `audit_log` when the rows are meant for a human.
 *
 * The portal grew a correct history projection first — it joins `people` so a
 * row reads "Priya Raman · 12 Aug · updated title" — while the admin record's
 * own query selected `actor_person_id` and never resolved it, so the organizer
 * History card rendered the literal string "user" (the `actor_kind` column).
 * Both now read through here, which is the only way the two surfaces can stay
 * honest about the same rows: an attribution bug fixed on one is fixed on both.
 *
 * Nothing in this file writes. History is append-only by construction — a
 * restore is a forward edit that adds a row (see `content/restore` in
 * `submission-record.routes.ts`), never an update or a delete of an old one.
 */
import { describeActivity, type ActivityLine } from "./activity-copy";
import { encodeKeysetCursor, type KeysetCursor } from "../api/pagination";

/**
 * The actions that describe a content change and can therefore be restored.
 *
 * `speaker_talk_updated` is the portal's own action and predates the organizer
 * editor. It is included deliberately: a speaker editing their title is the
 * same kind of fact as an organizer editing it, written with the same
 * before/after shape, and an organizer looking at the history of their session
 * should see — and be able to undo — both.
 */
export const CONTENT_ACTIONS = ["speaker_talk_updated", "content_updated", "content_restored"] as const;

export type ContentAction = (typeof CONTENT_ACTIONS)[number];

/** The before/after payload every content action writes. */
export interface ContentSnapshot {
  title?: string | null;
  /** The portal writes `description`; the organizer editor writes `abstract`. */
  abstract?: string | null;
  description?: string | null;
}

export interface HistoryEntry {
  id: string;
  action: string;
  actor_kind: string | null;
  actor_person_id: string | null;
  /** Null when the actor is not a person (a cron sweep, an import). */
  actor_name: string | null;
  created_at: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

interface HistoryRow {
  id: string;
  action: string;
  actor_kind: string | null;
  actor_person_id: string | null;
  actor_name: string | null;
  created_at: number;
  before_json: string | null;
  after_json: string | null;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function project(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    action: row.action,
    actor_kind: row.actor_kind,
    actor_person_id: row.actor_person_id,
    actor_name: row.actor_name,
    created_at: row.created_at,
    before: parseJson<Record<string, unknown> | null>(row.before_json, null),
    after: parseJson<Record<string, unknown> | null>(row.after_json, null),
  };
}

const SELECT = `SELECT audit.id, audit.action, audit.actor_kind, audit.actor_person_id,
    COALESCE(audit.actor_name, person.name) AS actor_name, audit.created_at, audit.before_json, audit.after_json
  FROM audit_log audit
  LEFT JOIN people person ON person.id = audit.actor_person_id`;

/** Newest first, tie-broken on the ULID so one batch's rows keep their write order. */
const ORDER = "ORDER BY audit.created_at DESC, audit.id DESC";

/**
 * Content edits only, for the version panel.
 *
 * `entityType` is a parameter rather than a hardcoded `'submission'` because
 * the speaker record carries the same panel over `people` rows.
 */
export async function contentHistoryFor(
  db: D1Database,
  eventId: string,
  entityType: string,
  entityId: string,
): Promise<HistoryEntry[]> {
  const placeholders = CONTENT_ACTIONS.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `${SELECT}
       WHERE audit.event_id = ? AND audit.entity_type = ? AND audit.entity_id = ?
         AND audit.action IN (${placeholders})
       ${ORDER}`,
    )
    .bind(eventId, entityType, entityId, ...CONTENT_ACTIONS)
    .all<HistoryRow>();
  return rows.results.map(project);
}

/**
 * Every audited action on one entity, for the record's History card.
 *
 * Wider than `contentHistoryFor` on purpose: scheduling, publishing, and
 * decisions belong in the same timeline. The caller decides which rows offer a
 * restore control — see `isRestorable`.
 */
export async function recordHistoryFor(
  db: D1Database,
  eventId: string,
  entityId: string,
): Promise<HistoryEntry[]> {
  const rows = await db
    .prepare(`${SELECT} WHERE audit.event_id = ? AND audit.entity_id = ? ${ORDER}`)
    .bind(eventId, entityId)
    .all<HistoryRow>();
  return rows.results.map(project);
}

/** A history row that has been read into a sentence — MRQ-211's third lens. */
export interface TimelineEntry extends HistoryEntry, ActivityLine {
  restorable: boolean;
}

/**
 * Lens three: the submission's timeline — "why is this talk in this state".
 *
 * Submitted, routed, reviewed, decided, reversed, re-accepted, mailed: every one
 * of those already writes an `audit_log` row, so this is the same rows
 * `recordHistoryFor` returns, read in the organizer's language and one page at
 * a time. Nothing is synthesised and nothing is stored twice; a moment missing
 * from the timeline is a writer that does not record, and is fixed at the
 * writer.
 *
 * Paged in SQL for the record most worth reading late in a conference — the one
 * that has been edited, re-decided, and re-mailed for six months (R7).
 */
export async function recordTimelinePage(
  db: D1Database,
  eventId: string,
  entityId: string,
  page: { limit: number; cursor: KeysetCursor | null },
): Promise<{ entries: TimelineEntry[]; total: number; nextCursor: string | null; hasMore: boolean }> {
  const cursorWhere = page.cursor
    ? " AND (audit.created_at < ? OR (audit.created_at = ? AND audit.id < ?))"
    : "";
  const cursorBindings = page.cursor
    ? [page.cursor.createdAt, page.cursor.createdAt, page.cursor.id]
    : [];
  const [count, rows] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS total FROM audit_log WHERE event_id = ? AND entity_id = ?")
      .bind(eventId, entityId)
      .first<{ total: number }>(),
    db
      .prepare(`${SELECT} WHERE audit.event_id = ? AND audit.entity_id = ?${cursorWhere} ${ORDER} LIMIT ?`)
      .bind(eventId, entityId, ...cursorBindings, page.limit)
      .all<HistoryRow>(),
  ]);
  const last = rows.results.at(-1);
  return {
    entries: rows.results.map((row) => {
      const entry = project(row);
      return {
        ...entry,
        ...describeActivity({ action: entry.action, before: entry.before, after: entry.after }),
        restorable: isRestorable(entry),
      };
    }),
    total: Number(count?.total ?? 0),
    nextCursor: rows.results.length >= page.limit && last ? encodeKeysetCursor(last) : null,
    hasMore: rows.results.length >= page.limit,
  };
}

export function isContentAction(action: string): action is ContentAction {
  return (CONTENT_ACTIONS as readonly string[]).includes(action);
}

/**
 * Read a content snapshot out of an audit payload, tolerating both field names.
 *
 * The portal stored the abstract under `description` before the organizer
 * editor existed. Rewriting those rows to normalise the key would be exactly
 * the history rewrite this feature promises never to do, so the reader accepts
 * either and the writer only ever emits the new shape.
 */
export function contentOf(payload: Record<string, unknown> | null): { title?: string; abstract?: string | null } | null {
  if (!payload) return null;
  const snapshot = payload as ContentSnapshot;
  const hasTitle = typeof snapshot.title === "string";
  const rawAbstract = "abstract" in snapshot ? snapshot.abstract : snapshot.description;
  const hasAbstract = typeof rawAbstract === "string" || rawAbstract === null;
  if (!hasTitle && !hasAbstract) return null;
  // A field the payload does not carry is ABSENT, not null. Collapsing the two
  // would let a title-only history row blank an abstract on restore — silent
  // data loss dressed as a restore, in the one feature that promises never to
  // lose anything.
  const restored: { title?: string; abstract?: string | null } = {};
  if (hasTitle) restored.title = snapshot.title as string;
  if (hasAbstract) restored.abstract = rawAbstract as string | null;
  return restored;
}

/** A row can be restored when it is a content action carrying a readable `before`. */
export function isRestorable(entry: HistoryEntry): boolean {
  return isContentAction(entry.action) && contentOf(entry.before) !== null;
}
