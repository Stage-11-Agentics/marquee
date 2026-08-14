/**
 * The one writer for `audit_log`.
 *
 * Every audit row used to be a hand-written `INSERT` at its call site — seven
 * of them across four files, three of which built statements for a `batch()`
 * rather than running them. That shape is why the correlation column did not
 * exist for so long: adding a field meant finding all seven and getting the
 * bind order right in each. Now the column list lives here once, and a new
 * audit write cannot forget a field it never had to type.
 *
 * `auditStatement` exists alongside `writeAudit` because several callers must
 * compose the row into an existing `D1.batch()` — an audit row that lands in a
 * separate transaction from the change it describes is worse than no audit row,
 * because it reads as authoritative while being able to disagree with reality.
 */
import { newUlid } from "../api/ids";
import type { AuditActorKind } from "../db/schema";

export interface AuditEntry {
  /**
   * Null only for an action that belongs to the organization rather than to a
   * conference — see `src/lib/org-activity.ts`, which is where such writes go.
   * The schema refuses a row scoped to neither.
   */
  eventId: string | null;
  /**
   * The organization, when the action is an organization-level fact. Every
   * org-level writer sets it; an event-scoped writer may set it too when the
   * action also belongs in the org admin lens (an invite scoped to one
   * conference is both). Leaving it null keeps a row out of that lens, which
   * is the right answer for the ordinary content edit.
   */
  orgId?: string | null;
  actorKind: AuditActorKind;
  /** Null for `system` and `airtable` actors, which are not people. */
  actorPersonId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** Omit when the entity did not exist before (a creation). */
  before?: unknown;
  /** Omit when the entity no longer exists after (a deletion). */
  after?: unknown;
  /** Caller-supplied so every row in one operation shares a timestamp. */
  now: number;
  /**
   * The originating request, when there is one. Null is a true statement about
   * a cron sweep, never a dropped id: route handlers read it from the request
   * context, and queue consumers read it from the correlated message body.
   */
  requestId: string | null;
}

const COLUMNS =
  "(id, event_id, org_id, actor_person_id, actor_kind, action, entity_type, entity_id, before_json, after_json, created_at, request_id)";
const PLACEHOLDERS = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

/**
 * Build the row as a prepared statement, for composition into a `batch()`.
 *
 * The id is a ULID, not a random UUID: audit history is read in write order and
 * paginated on a stable secondary sort by id, which a v4 identifier cannot give.
 */
export function auditStatement(db: D1Database, entry: AuditEntry): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO audit_log\n  ${COLUMNS}\nVALUES ${PLACEHOLDERS}`)
    .bind(
      newUlid(entry.now),
      entry.eventId,
      entry.orgId ?? null,
      entry.actorPersonId,
      entry.actorKind,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.now,
      entry.requestId,
    );
}

/**
 * Compose a conditional audit row into a larger D1 batch: the caller supplies
 * only the `FROM … WHERE …` tail, so the row is emitted only when the write it
 * describes actually landed.
 *
 * The projected column list is built here rather than typed by the caller. It
 * used to be a literal row of eleven question marks at each call site, which
 * made the column count a fact three files had to agree on — and adding the
 * twelfth column would have silently misaligned every one of them.
 */
export function auditStatementFromSelect(
  db: D1Database,
  entry: AuditEntry,
  sourceSql: string,
  ...selectBindings: readonly unknown[]
): D1PreparedStatement {
  const projection = PLACEHOLDERS.slice(1, -1);
  return db
    .prepare(`INSERT INTO audit_log\n  ${COLUMNS}\nSELECT ${projection}\n${sourceSql}`)
    .bind(
      newUlid(entry.now),
      entry.eventId,
      entry.orgId ?? null,
      entry.actorPersonId,
      entry.actorKind,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.now,
      entry.requestId,
      ...selectBindings,
    );
}

/** Write one audit row immediately. Prefer `auditStatement` inside a `batch()`. */
export async function writeAudit(db: D1Database, entry: AuditEntry): Promise<void> {
  await auditStatement(db, entry).run();
}
