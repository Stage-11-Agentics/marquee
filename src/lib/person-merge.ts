import { newUlid } from "../api/ids";
import { auditStatement } from "./audit";
import { foldTags, currentCard, type PersonEventRow } from "./person-annotations";
import type { AuditActorKind, PersonRow } from "../db/schema";

type Row = Record<string, unknown> & { id?: string };
type JsonObject = Record<string, unknown>;
type MovementOutcome = "moved" | "deduped" | "dropped";

export interface PersonMergeActor {
  actorKind: AuditActorKind;
  actorPersonId: string | null;
  requestId: string | null;
}

export class PersonMergeError extends Error {
  constructor(
    readonly code:
      | "invalid_merge"
      | "alias_conflict"
      | "already_merged"
      | "undo_blocked"
      | "merge_import_blocked"
      | "undo_partial",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PersonMergeError";
  }
}

export interface MergeInput {
  firstPersonId: string;
  secondPersonId: string;
  survivorPersonId?: string;
}

export interface MergeFieldDecision {
  field: string;
  survivor_value: unknown;
  retired_value: unknown;
  result: unknown;
  source: "survivor" | "retired" | "union" | "forced";
  collision: boolean;
  reason?: "filled" | "union" | "shape_conflict" | "survivor_kept" | "forced";
}

export interface MovementReceipt {
  table: string;
  primary_key: string;
  from: Row;
  to: Row | null;
  snapshot: Row;
  outcome: MovementOutcome;
  reason: string;
}

export interface PersonMergeSummary {
  moved: number;
  deduped: number;
  dropped: number;
  aliases_created: number;
  aliases_repointed: number;
  collisions: number;
  references: Record<string, number>;
}

export interface PersonMergePreview {
  org_id: string;
  retired: PersonRow;
  survivor: PersonRow;
  default_survivor_id: string;
  fields: MergeFieldDecision[];
  collisions: Array<{
    table: string;
    key: string;
    kept_id: string | null;
    retired_id: string;
    outcome: "moved" | "deduped";
    reason: string;
  }>;
  movements: MovementReceipt[];
  summary: PersonMergeSummary;
  continuity: string;
  event_scope: string[];
  can_undo: true;
}

interface MergePlan extends PersonMergePreview {
  merge_id: string;
  survivor_before: PersonRow;
  survivor_after: PersonRow;
  alias_id: string;
  alias_email: string;
  alias_changes: MovementReceipt[];
  operations: Operation[];
  synthetic_events: Row[];
  retired_headshot_id: string | null;
  dropped_headshot_ids: string[];
}

interface Operation {
  sql: string;
  bindings: readonly unknown[];
}

const SIMPLE_MOVES: ReadonlyArray<{ table: string; columns: string[] }> = [
  { table: "auth_sessions", columns: ["person_id"] },
  { table: "magic_links", columns: ["person_id"] },
  { table: "api_tokens", columns: ["created_by", "acts_as_person_id"] },
  { table: "outbox", columns: ["person_id"] },
  { table: "submissions", columns: ["submitter_person_id", "decided_by_person_id"] },
  { table: "submission_decisions", columns: ["decided_by_person_id"] },
  { table: "comparisons", columns: ["reviewer_person_id"] },
  { table: "round_promotions", columns: ["promoted_by"] },
  { table: "speaker_tasks", columns: ["person_id", "completed_by_person_id"] },
  { table: "speaker_helpers", columns: ["added_by"] },
  { table: "file_comments", columns: ["author_person_id"] },
  { table: "person_events", columns: ["person_id", "actor_person_id"] },
  { table: "person_lists", columns: ["created_by"] },
  { table: "mirror_credentials", columns: ["set_by_person_id"] },
];

const COLLISION_MOVES: ReadonlyArray<{
  table: string;
  column: string;
  key: (row: Row) => string;
}> = [
  { table: "memberships", column: "person_id", key: (row) => `${row.event_id ?? "org"}|${row.role}` },
  { table: "form_admins", column: "person_id", key: (row) => String(row.form_id) },
  { table: "saved_views", column: "person_id", key: (row) => `${row.event_id}|${row.name}` },
  { table: "participations", column: "person_id", key: (row) => `${row.submission_id}|${row.role}` },
  { table: "committee_members", column: "person_id", key: (row) => String(row.committee_id) },
  { table: "reviewer_track_scopes", column: "person_id", key: (row) => `${row.event_id}|${row.track_id}` },
  { table: "speaker_helpers", column: "speaker_person_id", key: (row) => `${row.event_id}|${row.helper_person_id}` },
  { table: "speaker_helpers", column: "helper_person_id", key: (row) => `${row.event_id}|${row.speaker_person_id}` },
  { table: "round_assignments", column: "reviewer_person_id", key: (row) => `${row.round_id}|${row.submission_id}` },
  { table: "evaluations", column: "reviewer_person_id", key: (row) => `${row.round_id}|${row.submission_id}` },
  { table: "event_attendances", column: "person_id", key: (row) => `${row.event_id}|${row.source}` },
];

function operation(sql: string, ...bindings: unknown[]): Operation {
  return { sql, bindings };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseJson(raw: unknown, field: string): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new PersonMergeError("invalid_merge", `${field} contains malformed JSON`, { field });
  }
}

function jsonText(value: unknown): string {
  return JSON.stringify(value);
}

function blank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim().length === 0);
}

function scalarDecision(field: string, survivor: unknown, retired: unknown): MergeFieldDecision {
  if (blank(survivor) && !blank(retired)) {
    return { field, survivor_value: survivor, retired_value: retired, result: retired, source: "retired", collision: false, reason: "filled" };
  }
  const collision = !blank(survivor) && !blank(retired) && survivor !== retired;
  return { field, survivor_value: survivor, retired_value: retired, result: survivor, source: "survivor", collision, reason: "survivor_kept" };
}

function jsonBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonDecision(field: string, survivorRaw: unknown, retiredRaw: unknown): MergeFieldDecision {
  const survivor = parseJson(survivorRaw, field);
  const retired = parseJson(retiredRaw, field);
  if (jsonBlank(survivor) && !jsonBlank(retired)) {
    return { field, survivor_value: survivor, retired_value: retired, result: retired, source: "retired", collision: false, reason: "filled" };
  }
  const stringArrays = field === "social_links"
    && Array.isArray(survivor)
    && Array.isArray(retired)
    && survivor.every((value) => typeof value === "string")
    && retired.every((value) => typeof value === "string");
  if (stringArrays) {
    const result = [...(survivor as string[])];
    const seen = new Set(result.map((value) => value.trim()));
    for (const value of retired as string[]) {
      if (seen.has(value.trim())) continue;
      seen.add(value.trim());
      result.push(value);
    }
    return { field, survivor_value: survivor, retired_value: retired, result, source: "union", collision: JSON.stringify(survivor) !== JSON.stringify(result), reason: "union" };
  }
  if (field === "custom_fields" && isObject(survivor) && isObject(retired)) {
    const result: JsonObject = {};
    for (const key of Object.keys(survivor)) {
      const survivorValue = survivor[key];
      const retiredValue = retired[key];
      result[key] = jsonBlank(survivorValue) && !jsonBlank(retiredValue) ? retiredValue : survivorValue;
    }
    for (const key of Object.keys(retired).filter((key) => !Object.prototype.hasOwnProperty.call(survivor, key)).sort()) {
      result[key] = retired[key];
    }
    const collision = Object.keys(survivor).some((key) => Object.prototype.hasOwnProperty.call(retired, key)
      && !jsonBlank(survivor[key]) && !jsonBlank(retired[key])
      && JSON.stringify(survivor[key]) !== JSON.stringify(retired[key]));
    return { field, survivor_value: survivor, retired_value: retired, result, source: "union", collision, reason: "union" };
  }
  const collision = JSON.stringify(survivor) !== JSON.stringify(retired) && !jsonBlank(retired) && !jsonBlank(survivor);
  return { field, survivor_value: survivor, retired_value: retired, result: survivor, source: "survivor", collision, reason: collision ? "shape_conflict" : "survivor_kept" };
}

function rowKey(row: Row): string {
  if (typeof row.id === "string") return row.id;
  return Object.entries(row).filter(([key]) => key.endsWith("_id") || key === "person_id").map(([key, value]) => `${key}=${String(value)}`).sort().join("|");
}

function changedColumns(before: Row, after: Row): string[] {
  return Object.keys(before).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function addMovement(
  movements: MovementReceipt[],
  table: string,
  before: Row,
  after: Row | null,
  outcome: MovementOutcome,
  reason: string,
): MovementReceipt {
  const movement = { table, primary_key: rowKey(before), from: clone(before), to: after ? clone(after) : null, snapshot: clone(before), outcome, reason };
  movements.push(movement);
  return movement;
}

async function person(db: D1Database, orgId: string, id: string): Promise<PersonRow> {
  const row = await db.prepare("SELECT * FROM people WHERE id = ? AND org_id = ?").bind(id, orgId).first<PersonRow>();
  if (!row) throw new PersonMergeError("invalid_merge", "both people must belong to this organization");
  return row;
}

async function rowsFor(db: D1Database, table: string, where: string, ...bindings: unknown[]): Promise<Row[]> {
  const rows = await db.prepare(`SELECT * FROM ${table} WHERE ${where}`).bind(...bindings).all<Row>();
  return rows.results;
}

type EventScopeQuery = {
  sql: string;
  bindings: (personId: string) => readonly unknown[];
};

// Keep each source query independent. A single UNION here used to make the
// SQL statement grow with every new person-referencing table and eventually
// hit SQLite's compound-SELECT term limit. D1 can execute these bounded
// queries concurrently; the set union belongs in application code instead.
const EVENT_SCOPE_QUERIES: readonly EventScopeQuery[] = [
  {
    sql: "SELECT event_id FROM memberships WHERE person_id = ? AND event_id IS NOT NULL",
    bindings: (personId) => [personId],
  },
  {
    sql: "SELECT submission.event_id FROM participations participation JOIN submissions submission ON submission.id = participation.submission_id WHERE participation.person_id = ?",
    bindings: (personId) => [personId],
  },
  {
    sql: "SELECT event_id FROM submissions WHERE submitter_person_id = ?",
    bindings: (personId) => [personId],
  },
  {
    sql: "SELECT event_id FROM speaker_tasks WHERE person_id = ? OR completed_by_person_id = ?",
    bindings: (personId) => [personId, personId],
  },
  {
    sql: "SELECT event_id FROM speaker_helpers WHERE speaker_person_id = ? OR helper_person_id = ? OR added_by = ?",
    bindings: (personId) => [personId, personId, personId],
  },
  {
    sql: "SELECT sponsorship.event_id FROM sponsorship_contacts contact JOIN sponsorships sponsorship ON sponsorship.id = contact.sponsorship_id WHERE contact.person_id = ?",
    bindings: (personId) => [personId],
  },
];

async function eventScope(db: D1Database, personId: string): Promise<string[]> {
  const results = await Promise.all(EVENT_SCOPE_QUERIES.map(({ sql, bindings }) =>
    db.prepare(sql).bind(...bindings(personId)).all<{ event_id: string }>(),
  ));
  return [...new Set(results.flatMap((result) => result.results.map((row) => row.event_id).filter(Boolean)))].sort();
}

function isPersonId(value: unknown, id: string): boolean {
  return value === id;
}

async function processSimpleMoves(
  db: D1Database,
  retiredId: string,
  survivorId: string,
  movements: MovementReceipt[],
  operations: Operation[],
): Promise<void> {
  for (const move of SIMPLE_MOVES) {
    const predicates = move.columns.map((column) => `${column} = ?`).join(" OR ");
    const rows = await rowsFor(db, move.table, predicates, ...move.columns.map(() => retiredId));
    for (const row of rows) {
      const after = clone(row);
      for (const column of move.columns) if (isPersonId(row[column], retiredId)) after[column] = survivorId;
      const changed = changedColumns(row, after);
      if (changed.length === 0) continue;
      operations.push(operation(
        `UPDATE ${move.table} SET ${changed.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
        ...changed.map((column) => after[column]),
        row.id,
      ));
      addMovement(movements, move.table, row, after, "moved", "person identity merge");
    }
  }
}

async function processCollisionMoves(
  db: D1Database,
  retiredId: string,
  survivorId: string,
  movements: MovementReceipt[],
  collisions: PersonMergePreview["collisions"],
  operations: Operation[],
): Promise<void> {
  for (const move of COLLISION_MOVES) {
    const [retiredRows, survivorRows] = await Promise.all([
      rowsFor(db, move.table, `${move.column} = ?`, retiredId),
      rowsFor(db, move.table, `${move.column} = ?`, survivorId),
    ]);
    const survivorByKey = new Map(survivorRows.map((row) => [move.key(row), row]));
    for (const row of retiredRows) {
      const key = move.key(row);
      const kept = survivorByKey.get(key);
      if (kept) {
        operations.push(operation(`DELETE FROM ${move.table} WHERE id = ?`, row.id));
        addMovement(movements, move.table, row, null, "deduped", `survivor-owned collision (${key})`);
        collisions.push({ table: move.table, key, kept_id: String(kept.id), retired_id: String(row.id), outcome: "deduped", reason: "survivor-owned whole row wins" });
        continue;
      }
      const after = clone(row);
      after[move.column] = survivorId;
      if (move.table === "speaker_helpers" && after.speaker_person_id === after.helper_person_id) {
        // A relationship between the two identities collapses into an
        // impossible self-seat when either side is re-pointed. Drop it as a
        // deduped reference so the migration CHECK remains unreachable and
        // undo can restore the original row from this receipt.
        operations.push(operation(`DELETE FROM ${move.table} WHERE id = ?`, row.id));
        addMovement(movements, move.table, row, null, "deduped", "helper relationship collapsed into a self-reference during merge");
        collisions.push({ table: move.table, key, kept_id: null, retired_id: String(row.id), outcome: "deduped", reason: "self helper relationship cannot survive identity merge" });
        continue;
      }
      operations.push(operation(`UPDATE ${move.table} SET ${move.column} = ? WHERE id = ?`, survivorId, row.id));
      addMovement(movements, move.table, row, after, "moved", `retired-only row (${key})`);
      collisions.push({ table: move.table, key, kept_id: null, retired_id: String(row.id), outcome: "moved", reason: "retired-only row moved" });
    }
  }
}

async function processListMemberships(
  db: D1Database,
  retiredId: string,
  survivorId: string,
  movements: MovementReceipt[],
  collisions: PersonMergePreview["collisions"],
  operations: Operation[],
): Promise<void> {
  const [retiredRows, survivorRows] = await Promise.all([
    rowsFor(db, "person_list_members", "person_id = ?", retiredId),
    rowsFor(db, "person_list_members", "person_id = ?", survivorId),
  ]);
  const survivorLists = new Map(survivorRows.map((row) => [String(row.list_id), row]));
  for (const row of retiredRows) {
    const key = String(row.list_id);
    const kept = survivorLists.get(key);
    if (kept) {
      operations.push(operation("DELETE FROM person_list_members WHERE list_id = ? AND person_id = ?", row.list_id, retiredId));
      addMovement(movements, "person_list_members", row, null, "deduped", `survivor-owned list membership (${key})`);
      collisions.push({ table: "person_list_members", key, kept_id: `${kept.list_id}:${kept.person_id}`, retired_id: `${row.list_id}:${row.person_id}`, outcome: "deduped", reason: "survivor-owned list membership wins" });
    } else {
      const after = clone(row);
      after.person_id = survivorId;
      operations.push(operation("UPDATE person_list_members SET person_id = ? WHERE list_id = ? AND person_id = ?", survivorId, row.list_id, retiredId));
      addMovement(movements, "person_list_members", row, after, "moved", `retired-only list membership (${key})`);
      collisions.push({ table: "person_list_members", key, kept_id: null, retired_id: `${row.list_id}:${row.person_id}`, outcome: "moved", reason: "retired-only list membership moved" });
    }
  }
}

async function processScheduleClaims(
  db: D1Database,
  retiredId: string,
  survivorId: string,
  movements: MovementReceipt[],
  operations: Operation[],
): Promise<void> {
  const rows = await rowsFor(db, "schedule_claims", "person_id = ?", retiredId);
  for (const row of rows) {
    const after = clone(row);
    after.person_id = survivorId;
    operations.push(operation(
      "UPDATE schedule_claims SET person_id = ?, updated_at = ? WHERE code = ?",
      survivorId,
      Date.now(),
      row.code,
    ));
    addMovement(movements, "schedule_claims", row, after, "moved", "retired-only schedule claim moved");
  }
}

async function processCalendarInvites(
  db: D1Database,
  retiredId: string,
  survivorId: string,
  movements: MovementReceipt[],
  collisions: PersonMergePreview["collisions"],
  operations: Operation[],
): Promise<void> {
  const [retiredRows, survivorRows] = await Promise.all([
    rowsFor(db, "calendar_invites", "person_id = ?", retiredId),
    rowsFor(db, "calendar_invites", "person_id = ?", survivorId),
  ]);
  for (const row of retiredRows) {
    const kept = survivorRows.find((candidate) => candidate.submission_id === row.submission_id || candidate.uid === row.uid);
    if (kept) {
      operations.push(operation("DELETE FROM calendar_invites WHERE id = ?", row.id));
      addMovement(movements, "calendar_invites", row, null, "deduped", kept.uid === row.uid
        ? `survivor-owned calendar uid collision (${String(row.uid)})`
        : `survivor-owned invite collision (${String(row.submission_id)})`);
      collisions.push({
        table: "calendar_invites",
        key: kept.uid === row.uid ? `uid:${String(row.uid)}` : `submission:${String(row.submission_id)}`,
        kept_id: String(kept.id),
        retired_id: String(row.id),
        outcome: "deduped",
        reason: "survivor-owned whole invite wins; uid is unchanged",
      });
      continue;
    }
    const after = clone(row);
    after.person_id = survivorId;
    operations.push(operation("UPDATE calendar_invites SET person_id = ? WHERE id = ?", survivorId, row.id));
    addMovement(movements, "calendar_invites", row, after, "moved", "retired-only invite moved without changing uid");
    collisions.push({ table: "calendar_invites", key: `submission:${String(row.submission_id)}`, kept_id: null, retired_id: String(row.id), outcome: "moved", reason: "retired-only invite moved; uid preserved" });
  }
}

async function processSponsorshipContacts(
  db: D1Database,
  retiredId: string,
  survivorId: string,
  movements: MovementReceipt[],
  collisions: PersonMergePreview["collisions"],
  operations: Operation[],
): Promise<void> {
  const [retiredRows, survivorRows] = await Promise.all([
    rowsFor(db, "sponsorship_contacts", "person_id = ?", retiredId),
    rowsFor(db, "sponsorship_contacts", "person_id = ?", survivorId),
  ]);
  for (const row of retiredRows) {
    const kept = survivorRows.find((candidate) => candidate.sponsorship_id === row.sponsorship_id);
    if (kept) {
      operations.push(operation("DELETE FROM sponsorship_contacts WHERE id = ?", row.id));
      addMovement(movements, "sponsorship_contacts", row, null, "deduped", `survivor-owned sponsorship contact (${String(row.sponsorship_id)})`);
      collisions.push({ table: "sponsorship_contacts", key: String(row.sponsorship_id), kept_id: String(kept.id), retired_id: String(row.id), outcome: "deduped", reason: "survivor-owned whole contact wins" });
      if (Number(row.is_primary) === 1 && Number(kept.is_primary) === 0) {
        const keptAfter = clone(kept);
        keptAfter.is_primary = 1;
        // Delete the retired primary first; the partial unique index then
        // permits the retained survivor contact to become the sole primary.
        operations.push(operation("UPDATE sponsorship_contacts SET is_primary = ?, updated_at = ? WHERE id = ? AND is_primary = 0", 1, Date.now(), kept.id));
        addMovement(movements, "sponsorship_contacts", kept, keptAfter, "moved", "retained contact promoted to preserve one primary");
      }
      continue;
    }
    const after = clone(row);
    after.person_id = survivorId;
    operations.push(operation("UPDATE sponsorship_contacts SET person_id = ? WHERE id = ?", survivorId, row.id));
    addMovement(movements, "sponsorship_contacts", row, after, "moved", "retired-only sponsorship contact moved");
    collisions.push({ table: "sponsorship_contacts", key: String(row.sponsorship_id), kept_id: null, retired_id: String(row.id), outcome: "moved", reason: "retired-only contact moved" });
  }
}

async function processForms(
  db: D1Database,
  orgId: string,
  retiredId: string,
  survivorId: string,
  movements: MovementReceipt[],
  operations: Operation[],
): Promise<void> {
  const rows = await db.prepare(
    "SELECT * FROM forms WHERE event_id IN (SELECT id FROM events WHERE org_id = ?) AND json_valid(admin_notify_person_ids)",
  ).bind(orgId).all<Row>();
  for (const row of rows.results) {
    const before = parseJson(row.admin_notify_person_ids, "forms.admin_notify_person_ids");
    if (!Array.isArray(before) || !before.some((value) => value === retiredId)) continue;
    const afterValues = [...new Set(before.map((value) => value === retiredId ? survivorId : value))];
    const after = clone(row);
    after.admin_notify_person_ids = jsonText(afterValues);
    operations.push(operation("UPDATE forms SET admin_notify_person_ids = ?, updated_at = ? WHERE id = ?", after.admin_notify_person_ids, Date.now(), row.id));
    addMovement(movements, "forms", row, after, "moved", "admin notification JSON identity");
  }
}

async function processImportRows(
  db: D1Database,
  orgId: string,
  retiredId: string,
  survivorId: string,
  movements: MovementReceipt[],
  operations: Operation[],
): Promise<void> {
  const rows = await db.prepare(
    `SELECT import_rows.*
       FROM import_rows
       JOIN imports ON imports.id = import_rows.import_id
       JOIN events ON events.id = imports.event_id
      WHERE import_rows.target_id = ?
        AND import_rows.entity IN ('person', 'speaker')
        AND events.org_id = ?`,
  ).bind(retiredId, orgId).all<Row>();
  for (const row of rows.results) {
    const after = clone(row);
    after.target_id = survivorId;
    operations.push(operation("UPDATE import_rows SET target_id = ?, updated_at = ? WHERE id = ?", survivorId, Date.now(), row.id));
    addMovement(movements, "import_rows", row, after, "moved", `entity=${String(row.entity)} import manifest retained`);
  }
}

async function processAuditSubjects(
  db: D1Database,
  orgId: string,
  retiredId: string,
  survivorId: string,
  movements: MovementReceipt[],
  operations: Operation[],
): Promise<void> {
  const rows = await db.prepare(
    "SELECT * FROM audit_log WHERE org_id = ? AND (actor_person_id = ? OR (entity_type = 'person' AND entity_id = ?))",
  ).bind(orgId, retiredId, retiredId).all<Row>();
  for (const row of rows.results) {
    const after = clone(row);
    const changed: string[] = [];
    if (row.actor_person_id === retiredId) {
      after.actor_person_id = survivorId;
      changed.push("actor_person_id");
    }
    if (row.entity_type === "person" && row.entity_id === retiredId) {
      after.entity_id = survivorId;
      changed.push("entity_id");
    }
    if (changed.length === 0) continue;
    operations.push(operation(`UPDATE audit_log SET ${changed.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`, ...changed.map((column) => after[column]), row.id));
    addMovement(movements, "audit_log", row, after, "moved", changed.includes("entity_id") ? "person subject history re-pointed" : "person actor re-pointed");
  }
}

async function processMirrorRows(
  db: D1Database,
  retiredId: string,
  survivorId: string,
  movements: MovementReceipt[],
  operations: Operation[],
): Promise<void> {
  const rows = await db.prepare(
    "SELECT * FROM mirror_outbox WHERE table_name IN ('people', 'person') AND row_id = ?",
  ).bind(retiredId).all<Row>();
  for (const row of rows.results) {
    if (row.op === "delete") {
      // A queued delete for the retired identity cannot be retargeted to the
      // survivor. Keep its complete snapshot in the receipt and let the
      // unsuppressed people DELETE trigger emit the correct retired delete.
      operations.push(operation("DELETE FROM mirror_outbox WHERE id = ?", row.id));
      addMovement(movements, "mirror_outbox", row, null, "dropped", "retired delete re-emitted by merge trigger");
      continue;
    }
    const after = clone(row);
    after.row_id = retiredId === row.row_id ? survivorId : row.row_id;
    const payload = parseJson(row.payload, "mirror_outbox.payload");
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const nextPayload = clone(payload as JsonObject);
      if (nextPayload.marquee_id === retiredId) nextPayload.marquee_id = survivorId;
      after.payload = jsonText(nextPayload);
    }
    operations.push(operation("UPDATE mirror_outbox SET row_id = ?, payload = ?, updated_at = ? WHERE id = ?", after.row_id, after.payload, Date.now(), row.id));
    addMovement(movements, "mirror_outbox", row, after, "moved", "queued person identity retargeted to survivor");
  }
}

async function processAliases(
  db: D1Database,
  orgId: string,
  retiredId: string,
  survivorId: string,
  movements: MovementReceipt[],
  operations: Operation[],
): Promise<MovementReceipt[]> {
  const rows = await db.prepare("SELECT * FROM person_aliases WHERE org_id = ? AND person_id = ? ORDER BY created_at ASC, id ASC")
    .bind(orgId, retiredId).all<Row>();
  const changes: MovementReceipt[] = [];
  for (const row of rows.results) {
    const [aliasCollision, primaryCollision] = await Promise.all([
      db.prepare("SELECT id FROM person_aliases WHERE org_id = ? AND lower(email) = ? AND id <> ?")
        .bind(orgId, String(row.email).trim().toLowerCase(), row.id).first<{ id: string }>(),
      db.prepare("SELECT id FROM people WHERE org_id = ? AND lower(email) = ? AND id NOT IN (?, ?)")
        .bind(orgId, String(row.email).trim().toLowerCase(), retiredId, survivorId).first<{ id: string }>(),
    ]);
    if (aliasCollision || primaryCollision) {
      throw new PersonMergeError("alias_conflict", `Alias email conflict: ${row.email}`, {
        email: row.email,
        ...(aliasCollision ? { alias_id: aliasCollision.id } : {}),
        ...(primaryCollision ? { person_id: primaryCollision.id } : {}),
      });
    }
    const after = clone(row);
    after.person_id = survivorId;
    operations.push(operation("UPDATE person_aliases SET person_id = ?, updated_at = ? WHERE id = ?", survivorId, Date.now(), row.id));
    changes.push(addMovement(movements, "person_aliases", row, after, "moved", "chained alias flattened to current survivor"));
  }
  return changes;
}

async function processHeadshots(
  db: D1Database,
  retired: PersonRow,
  survivorAfter: PersonRow,
  movements: MovementReceipt[],
  operations: Operation[],
): Promise<{ retiredHeadshotId: string | null; droppedHeadshotIds: string[] }> {
  const retiredHeadshotId = retired.headshot_attachment_id;
  const droppedHeadshotIds: string[] = [];
  const attachments = await db.prepare(
    "SELECT * FROM attachments WHERE owner_type = 'person_headshot' AND owner_id = ? ORDER BY created_at ASC, id ASC",
  ).bind(retired.id).all<Row>();
  if (attachments.results.length === 0) return { retiredHeadshotId, droppedHeadshotIds };

  let survivorAttachmentId = survivorAfter.headshot_attachment_id;
  for (const attachment of attachments.results) {
    const isPrimaryRetiredAttachment = attachment.id === retiredHeadshotId;
    if (!survivorAttachmentId && isPrimaryRetiredAttachment) {
      survivorAttachmentId = String(attachment.id);
      survivorAfter.headshot_attachment_id = survivorAttachmentId;
      const after = clone(attachment);
      after.owner_id = survivorAfter.id;
      operations.push(operation("UPDATE attachments SET owner_id = ?, updated_at = ? WHERE id = ?", survivorAfter.id, Date.now(), attachment.id));
      addMovement(movements, "attachments", attachment, after, "moved", "blank survivor headshot filled");
      continue;
    }
    if (!survivorAttachmentId && !isPrimaryRetiredAttachment) {
      survivorAttachmentId = String(attachment.id);
      survivorAfter.headshot_attachment_id = survivorAttachmentId;
      const after = clone(attachment);
      after.owner_id = survivorAfter.id;
      operations.push(operation("UPDATE attachments SET owner_id = ?, updated_at = ? WHERE id = ?", survivorAfter.id, Date.now(), attachment.id));
      addMovement(movements, "attachments", attachment, after, "moved", "orphaned retired headshot adopted");
      continue;
    }
    if (String(attachment.id) === survivorAttachmentId) {
      if (attachment.owner_id === retired.id) {
        const after = clone(attachment);
        after.owner_id = survivorAfter.id;
        operations.push(operation("UPDATE attachments SET owner_id = ?, updated_at = ? WHERE id = ?", survivorAfter.id, Date.now(), attachment.id));
        addMovement(movements, "attachments", attachment, after, "moved", "shared headshot owner moved to survivor");
      }
      continue;
    }
    operations.push(operation("DELETE FROM attachments WHERE id = ?", attachment.id));
    addMovement(movements, "attachments", attachment, null, "dropped", "survivor-owned headshot retained; R2 object untouched");
    droppedHeadshotIds.push(String(attachment.id));
  }
  return { retiredHeadshotId, droppedHeadshotIds };
}

async function appendAnnotationReassertions(
  db: D1Database,
  orgId: string,
  survivorId: string,
  retiredId: string,
  now: number,
  movements: MovementReceipt[],
  operations: Operation[],
): Promise<Row[]> {
  const rows = await db.prepare("SELECT * FROM person_events WHERE org_id = ? AND (person_id = ? OR person_id = ?) ORDER BY created_at ASC, id ASC")
    .bind(orgId, survivorId, retiredId).all<PersonEventRow>();
  const tags = foldTags(rows.results);
  const card = currentCard(rows.results);
  const synthetic: Row[] = [];
  for (const tag of tags) {
    const row: Row = {
      id: newUlid(now), org_id: orgId, person_id: survivorId, kind: "tag", value_json: jsonText({ tag, op: "add" }),
      actor_person_id: null, target_event_id: null, next_touch_on: null, created_at: now,
    };
    synthetic.push(row);
    operations.push(operation(
      `INSERT INTO person_events (id, org_id, person_id, kind, value_json, actor_person_id, target_event_id, next_touch_on, created_at) VALUES (?, ?, ?, 'tag', ?, NULL, NULL, NULL, ?)`,
      row.id, orgId, survivorId, row.value_json, now,
    ));
    addMovement(movements, "person_events", row, null, "dropped", "merge reassertion");
  }
  if (card) {
    const row: Row = {
      id: newUlid(now), org_id: orgId, person_id: survivorId, kind: "stage", value_json: rows.results.find((candidate) => candidate.id === card.id)?.value_json ?? jsonText({ stage: card.stage, score: card.score, rationale: card.rationale }),
      actor_person_id: null, target_event_id: card.target_event_id, next_touch_on: card.next_touch_on, created_at: now,
    };
    synthetic.push(row);
    operations.push(operation(
      `INSERT INTO person_events (id, org_id, person_id, kind, value_json, actor_person_id, target_event_id, next_touch_on, created_at) VALUES (?, ?, ?, 'stage', ?, NULL, ?, ?, ?)`,
      row.id, orgId, survivorId, row.value_json, row.target_event_id, row.next_touch_on, now,
    ));
    addMovement(movements, "person_events", row, null, "dropped", "merge reassertion");
  }
  return synthetic;
}

function summaryFor(movements: readonly MovementReceipt[], aliasChanges: readonly MovementReceipt[], collisions: PersonMergePreview["collisions"]): PersonMergeSummary {
  const summary: PersonMergeSummary = {
    moved: movements.filter((movement) => movement.outcome === "moved").length,
    deduped: movements.filter((movement) => movement.outcome === "deduped").length,
    dropped: movements.filter((movement) => movement.outcome === "dropped").length,
    aliases_created: 1,
    aliases_repointed: aliasChanges.length,
    collisions: collisions.length,
    references: {},
  };
  for (const movement of movements) summary.references[movement.table] = (summary.references[movement.table] ?? 0) + 1;
  return summary;
}

async function buildPlan(
  db: D1Database,
  orgId: string,
  input: MergeInput,
  now: number,
): Promise<MergePlan> {
  if (input.firstPersonId === input.secondPersonId) throw new PersonMergeError("invalid_merge", "Choose two different people to merge");
  const first = await person(db, orgId, input.firstPersonId);
  const second = await person(db, orgId, input.secondPersonId);
  if (first.kind !== second.kind) throw new PersonMergeError("invalid_merge", "People of different kinds cannot be merged", { first_kind: first.kind, second_kind: second.kind });
  const [firstEventIds, secondEventIds] = await Promise.all([eventScope(db, first.id), eventScope(db, second.id)]);
  const defaultSurvivorId = firstEventIds.length >= secondEventIds.length ? first.id : second.id;
  const survivorId = input.survivorPersonId ?? defaultSurvivorId;
  if (survivorId !== first.id && survivorId !== second.id) throw new PersonMergeError("invalid_merge", "The survivor must be one of the selected people");
  const survivorBefore = survivorId === first.id ? first : second;
  const retired = survivorId === first.id ? second : first;

  const aliasEmail = retired.email.trim().toLowerCase();
  const [existingAlias, activeCollision] = await Promise.all([
    db.prepare("SELECT id FROM person_aliases WHERE org_id = ? AND lower(email) = ?")
      .bind(orgId, aliasEmail).first<{ id: string }>(),
    db.prepare("SELECT id FROM people WHERE org_id = ? AND lower(email) = ? AND id NOT IN (?, ?)")
      .bind(orgId, aliasEmail, first.id, second.id).first<{ id: string }>(),
  ]);
  if (existingAlias || activeCollision) {
    throw new PersonMergeError(
      "alias_conflict",
      "The retired email is already active in this organization: " + aliasEmail,
      {
        email: aliasEmail,
        ...(existingAlias ? { alias_id: existingAlias.id } : {}),
        ...(activeCollision ? { person_id: activeCollision.id } : {}),
      },
    );
  }

  const fields = [
    { field: "id", survivor_value: survivorBefore.id, retired_value: retired.id, result: survivorBefore.id, source: "survivor" as const, collision: false, reason: "survivor_kept" as const },
    { field: "org_id", survivor_value: survivorBefore.org_id, retired_value: retired.org_id, result: survivorBefore.org_id, source: "survivor" as const, collision: false, reason: "survivor_kept" as const },
    scalarDecision("email", survivorBefore.email, retired.email),
    scalarDecision("name", survivorBefore.name, retired.name),
    scalarDecision("title", survivorBefore.title, retired.title),
    scalarDecision("company", survivorBefore.company, retired.company),
    scalarDecision("bio", survivorBefore.bio, retired.bio),
    scalarDecision("company_id", survivorBefore.company_id, retired.company_id),
    jsonDecision("custom_fields", survivorBefore.custom_fields, retired.custom_fields),
    jsonDecision("social_links", survivorBefore.social_links, retired.social_links),
    scalarDecision("headshot_attachment_id", survivorBefore.headshot_attachment_id, retired.headshot_attachment_id),
    { field: "do_not_contact", survivor_value: survivorBefore.do_not_contact, retired_value: retired.do_not_contact, result: Number(survivorBefore.do_not_contact) || Number(retired.do_not_contact) ? 1 : 0, source: "union" as const, collision: survivorBefore.do_not_contact !== retired.do_not_contact },
    scalarDecision("is_demo", survivorBefore.is_demo, retired.is_demo),
    scalarDecision("kind", survivorBefore.kind, retired.kind),
    { field: "last_write_source", survivor_value: survivorBefore.last_write_source, retired_value: retired.last_write_source, result: "marquee", source: "forced" as const, collision: survivorBefore.last_write_source !== "marquee" || retired.last_write_source !== "marquee", reason: "forced" as const },
    scalarDecision("created_at", survivorBefore.created_at, retired.created_at),
    { field: "updated_at", survivor_value: survivorBefore.updated_at, retired_value: retired.updated_at, result: now, source: "forced" as const, collision: survivorBefore.updated_at !== now || retired.updated_at !== now, reason: "forced" as const },
  ];
  const survivorAfter = clone(survivorBefore);
  for (const field of fields) {
    if (field.field === "email" || field.field === "headshot_attachment_id") continue;
    if (field.field === "custom_fields" || field.field === "social_links") (survivorAfter as unknown as Row)[field.field] = jsonText(field.result);
    else (survivorAfter as unknown as Row)[field.field] = field.result;
  }
  survivorAfter.last_write_source = "marquee";
  survivorAfter.updated_at = now;

  const movements: MovementReceipt[] = [];
  const collisions: PersonMergePreview["collisions"] = [];
  const operations: Operation[] = [];
  const aliasChanges = await processAliases(db, orgId, retired.id, survivorId, movements, operations);
  await processCollisionMoves(db, retired.id, survivorId, movements, collisions, operations);
  await processCalendarInvites(db, retired.id, survivorId, movements, collisions, operations);
  await processSponsorshipContacts(db, retired.id, survivorId, movements, collisions, operations);
  await processListMemberships(db, retired.id, survivorId, movements, collisions, operations);
  await processScheduleClaims(db, retired.id, survivorId, movements, operations);
  await processSimpleMoves(db, retired.id, survivorId, movements, operations);
  // Nullable reviewer override is not part of a reviewer collision key.
  const overrides = await rowsFor(db, "evaluations", "override_person_id = ? AND reviewer_person_id <> ?", retired.id, retired.id);
  for (const row of overrides) {
    const after = clone(row);
    after.override_person_id = survivorId;
    operations.push(operation("UPDATE evaluations SET override_person_id = ? WHERE id = ?", survivorId, row.id));
    addMovement(movements, "evaluations", row, after, "moved", "nullable override actor re-pointed");
  }
  await processForms(db, orgId, retired.id, survivorId, movements, operations);
  await processImportRows(db, orgId, retired.id, survivorId, movements, operations);
  await processAuditSubjects(db, orgId, retired.id, survivorId, movements, operations);
  await processMirrorRows(db, retired.id, survivorId, movements, operations);
  const headshots = await processHeadshots(db, retired, survivorAfter, movements, operations);
  const headshotDecision = fields.find((field) => field.field === "headshot_attachment_id");
  if (headshotDecision) {
    headshotDecision.result = survivorAfter.headshot_attachment_id;
    headshotDecision.reason = headshotDecision.result !== headshotDecision.survivor_value ? "filled" : "survivor_kept";
  }

  // Update the survivor only after all decisions have been computed. The
  // retired pointer is cleared before any dropped attachment is removed.
  const survivorChanged = changedColumns(survivorBefore as unknown as Row, survivorAfter as unknown as Row).filter((column) => column !== "id" && column !== "org_id" && column !== "created_at");
  if (survivorChanged.length > 0) {
    operations.unshift(operation(
      `UPDATE people SET ${survivorChanged.map((column) => `${column} = ?`).join(", ")} WHERE id = ? AND org_id = ?`,
      ...survivorChanged.map((column) => (survivorAfter as unknown as Row)[column]), survivorId, orgId,
    ));
  }
  if (retired.headshot_attachment_id) {
    operations.push(operation("UPDATE people SET headshot_attachment_id = NULL, updated_at = ? WHERE id = ?", now, retired.id));
  }

  const syntheticEvents = await appendAnnotationReassertions(db, orgId, survivorId, retired.id, now, movements, operations);
  const eventIds = firstEventIds;
  const mergeId = newUlid(now);
  const activityId = newUlid(now);
  const summary = summaryFor(movements, aliasChanges, collisions);
  const continuity = first.email === second.email
    ? `Old sign-in links continue to ${survivorBefore.name} (${survivorBefore.email}).`
    : `Old sign-in links and portal access for ${retired.email} continue to ${survivorBefore.name} (${survivorBefore.email}).`;
  return {
    org_id: orgId,
    retired,
    survivor: survivorAfter,
    default_survivor_id: defaultSurvivorId,
    fields,
    collisions,
    movements,
    summary,
    continuity,
    event_scope: eventIds,
    can_undo: true,
    survivor_before: survivorBefore,
    survivor_after: survivorAfter,
    merge_id: mergeId,
    // The primary alias is the durable public continuation key. Keeping it
    // equal to the receipt id makes CAS undo/delete exact and avoids a second
    // identity for the same operation.
    alias_id: mergeId,
    alias_email: aliasEmail,
    alias_changes: aliasChanges,
    operations,
    synthetic_events: syntheticEvents,
    retired_headshot_id: headshots.retiredHeadshotId,
    dropped_headshot_ids: headshots.droppedHeadshotIds,
  };
}

export async function previewPersonMerge(
  db: D1Database,
  orgId: string,
  input: MergeInput,
  now = Date.now(),
): Promise<PersonMergePreview> {
  return buildPlan(db, orgId, input, now);
}

async function alreadyMerged(db: D1Database, orgId: string, retiredId: string): Promise<Row | null> {
  return db.prepare(
    "SELECT * FROM person_merges WHERE org_id = ? AND retired_person_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
  ).bind(orgId, retiredId).first<Row>();
}

function receiptInsert(db: D1Database, plan: MergePlan, mergeId: string, idempotencyKey: string, now: number, activityId: string): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO person_merges
      (id, org_id, idempotency_key, retired_person_id, survivor_person_id, status,
       retired_snapshot_json, survivor_before_json, survivor_after_json,
       summary_json, alias_changes_json, movement_receipts_json, event_scope_json,
       activity_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'clean', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    mergeId,
    plan.org_id,
    idempotencyKey,
    plan.retired.id,
    plan.survivor.id,
    JSON.stringify(plan.retired),
    JSON.stringify(plan.survivor_before),
    JSON.stringify(plan.survivor_after),
    JSON.stringify(plan.summary),
    JSON.stringify(plan.alias_changes),
    JSON.stringify(plan.movements),
    JSON.stringify(plan.event_scope),
    activityId,
    now,
    now,
  );
}

function activityInsert(db: D1Database, plan: MergePlan, actor: PersonMergeActor, now: number, activityId: string): D1PreparedStatement {
  return auditStatement(db, {
    id: activityId,
    eventId: null,
    orgId: plan.org_id,
    actorKind: actor.actorKind,
    actorPersonId: actor.actorPersonId,
    action: "person.merged",
    entityType: "person",
    entityId: plan.survivor.id,
    before: { retired_person_id: plan.retired.id, retired_name: plan.retired.name },
    after: { merge_id: plan.merge_id, summary: plan.summary, undo: true },
    now,
    requestId: actor.requestId,
  });
}

export interface PersonMergeExecuteResult {
  merge_id: string;
  status: "clean" | "undone" | "undo_blocked";
  retired_person_id: string;
  survivor_person_id: string;
  summary: PersonMergeSummary;
  continuity: string;
  can_undo: boolean;
}

export async function executePersonMerge(
  db: D1Database,
  orgId: string,
  input: MergeInput & { idempotencyKey: string },
  actor: PersonMergeActor,
  now = Date.now(),
): Promise<PersonMergeExecuteResult> {
  const replay = await db.prepare("SELECT * FROM person_merges WHERE org_id = ? AND idempotency_key = ?")
    .bind(orgId, input.idempotencyKey).first<Row>();
  if (replay) return resultFromReceipt(replay);
  const plan = await buildPlan(db, orgId, input, now);
  const prior = await alreadyMerged(db, orgId, plan.retired.id);
  if (prior) throw new PersonMergeError("already_merged", "This person has already been merged; use the existing receipt", { merge_id: prior.id, survivor_person_id: prior.survivor_person_id });

  const activityId = newUlid(now);
  const mergeId = plan.merge_id;
  const statements: D1PreparedStatement[] = [
    receiptInsert(db, plan, mergeId, input.idempotencyKey, now, activityId),
    ...plan.operations.map((item) => db.prepare(item.sql).bind(...item.bindings)),
    db.prepare(
      `DELETE FROM people WHERE id = ? AND org_id = ? AND ${personDeleteGuardPredicate()}`,
    ).bind(plan.retired.id, orgId),
    db.prepare(
      `INSERT INTO person_aliases (id, org_id, email, person_id, merge_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(plan.alias_id, orgId, plan.alias_email, plan.survivor.id, mergeId, now, now),
    activityInsert(db, plan, actor, now, activityId),
  ];
  // A receipt alias id doubles as the receipt id for a compact durable link.
  await db.batch(statements);
  return {
    merge_id: mergeId,
    status: "clean",
    retired_person_id: plan.retired.id,
    survivor_person_id: plan.survivor.id,
    summary: plan.summary,
    continuity: plan.continuity,
    can_undo: true,
  };
}

function personDeleteGuardPredicate(): string {
  // The migration trigger is authoritative. Keeping the explicit predicate in
  // the final DELETE makes the batch self-documenting and catches drift in a
  // test harness that disables triggers.
  return [
    "NOT EXISTS (SELECT 1 FROM memberships WHERE memberships.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM auth_sessions WHERE auth_sessions.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM magic_links WHERE magic_links.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM api_tokens WHERE api_tokens.created_by = people.id OR api_tokens.acts_as_person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM form_admins WHERE form_admins.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM outbox WHERE outbox.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM submissions WHERE submissions.submitter_person_id = people.id OR submissions.decided_by_person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM submission_decisions WHERE submission_decisions.decided_by_person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM saved_views WHERE saved_views.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM participations WHERE participations.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM committee_members WHERE committee_members.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM reviewer_track_scopes WHERE reviewer_track_scopes.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM round_assignments WHERE round_assignments.reviewer_person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM evaluations WHERE evaluations.reviewer_person_id = people.id OR evaluations.override_person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM comparisons WHERE comparisons.reviewer_person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM round_promotions WHERE round_promotions.promoted_by = people.id)",
    "NOT EXISTS (SELECT 1 FROM speaker_tasks WHERE speaker_tasks.person_id = people.id OR speaker_tasks.completed_by_person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM speaker_helpers WHERE speaker_helpers.speaker_person_id = people.id OR speaker_helpers.helper_person_id = people.id OR speaker_helpers.added_by = people.id)",
    "NOT EXISTS (SELECT 1 FROM calendar_invites WHERE calendar_invites.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM audit_log WHERE audit_log.actor_person_id = people.id OR (audit_log.entity_type = 'person' AND audit_log.entity_id = people.id))",
    "NOT EXISTS (SELECT 1 FROM file_comments WHERE file_comments.author_person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM person_events WHERE person_events.person_id = people.id OR person_events.actor_person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM person_lists WHERE person_lists.created_by = people.id)",
    "NOT EXISTS (SELECT 1 FROM person_list_members WHERE person_list_members.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM event_attendances WHERE event_attendances.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM schedule_claims WHERE schedule_claims.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM sponsorship_contacts WHERE sponsorship_contacts.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM mirror_credentials WHERE mirror_credentials.set_by_person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM person_aliases WHERE person_aliases.person_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM forms WHERE json_valid(forms.admin_notify_person_ids) AND EXISTS (SELECT 1 FROM json_each(forms.admin_notify_person_ids) WHERE json_each.value = people.id))",
    "NOT EXISTS (SELECT 1 FROM attachments WHERE attachments.owner_type = 'person_headshot' AND attachments.owner_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM people other WHERE other.id <> people.id AND people.headshot_attachment_id IS NOT NULL AND other.headshot_attachment_id = people.headshot_attachment_id)",
    "NOT EXISTS (SELECT 1 FROM import_rows JOIN imports ON imports.id = import_rows.import_id JOIN events ON events.id = imports.event_id WHERE import_rows.target_id = people.id AND import_rows.entity IN ('person', 'speaker') AND events.org_id = people.org_id)",
    "NOT EXISTS (SELECT 1 FROM mirror_outbox WHERE mirror_outbox.table_name IN ('people', 'person') AND mirror_outbox.row_id = people.id)",
    "NOT EXISTS (SELECT 1 FROM audit_log WHERE audit_log.entity_type = 'person' AND audit_log.entity_id = people.id)",
  ].join(" AND ");
}

function resultFromReceipt(row: Row): PersonMergeExecuteResult {
  const summary = JSON.parse(String(row.summary_json)) as PersonMergeSummary;
  const status = row.status === "undone" || row.status === "undo_blocked" ? row.status : "clean";
  return {
    merge_id: String(row.id),
    status,
    retired_person_id: String(row.retired_person_id),
    survivor_person_id: String(row.survivor_person_id),
    summary,
    continuity: `Old sign-in links continue to the current survivor (${String(row.survivor_person_id)}).`,
    can_undo: status === "clean",
  };
}

function equalRow(left: Row | null, right: Row): boolean {
  if (!left) return false;
  for (const key of Object.keys(right)) if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false;
  return true;
}

function insertRow(db: D1Database, table: string, row: Row): D1PreparedStatement {
  const columns = Object.keys(row);
  return db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).bind(...columns.map((column) => row[column]));
}

async function undoMovement(
  db: D1Database,
  movement: MovementReceipt,
  receiptId: string,
  operations: D1PreparedStatement[],
  skipped: Array<{ table: string; primary_key: string; reason: string }>,
  preInserted: ReadonlySet<string>,
): Promise<void> {
  if (movement.outcome === "dropped" && movement.table === "person_events" && movement.reason === "merge reassertion") {
    const currentSynthetic = await db.prepare("SELECT * FROM person_events WHERE id = ? AND person_id = ?")
      .bind(movement.from.id, movement.from.person_id).first<Row>();
    if (!currentSynthetic || !equalRow(currentSynthetic, movement.from)) {
      skipped.push({ table: movement.table, primary_key: movement.primary_key, reason: "changed_since_merge" });
    } else {
      operations.push(db.prepare("DELETE FROM person_events WHERE id = ? AND person_id = ?").bind(movement.from.id, movement.from.person_id));
    }
    return;
  }
  const current = movement.outcome === "dropped"
    ? null
    : movement.table === "person_list_members"
      ? await db.prepare("SELECT * FROM person_list_members WHERE list_id = ? AND person_id = ?").bind(movement.to?.list_id, movement.to?.person_id).first<Row>()
      : movement.table === "schedule_claims"
        ? await db.prepare("SELECT * FROM schedule_claims WHERE code = ?").bind(movement.from.code).first<Row>()
      : await db.prepare(`SELECT * FROM ${movement.table} WHERE id = ?`).bind(movement.from.id).first<Row>();
  if (movement.outcome === "moved") {
    if (!current || !movement.to || !equalRow(current, movement.to)) {
      skipped.push({ table: movement.table, primary_key: movement.primary_key, reason: "changed_since_merge" });
      return;
    }
    const changes = changedColumns(movement.from, movement.to);
    if (movement.table === "person_list_members") {
      operations.push(db.prepare("UPDATE person_list_members SET person_id = ? WHERE list_id = ? AND person_id = ?").bind(movement.from.person_id, movement.from.list_id, movement.to.person_id));
    } else if (movement.table === "person_aliases") {
      operations.push(db.prepare("UPDATE person_aliases SET person_id = ?, updated_at = ? WHERE id = ? AND person_id = ?").bind(movement.from.person_id, Date.now(), movement.from.id, movement.to.person_id));
    } else if (movement.table === "schedule_claims") {
      const columns = changes.filter((column) => column !== "code" && column !== "created_at");
      if (columns.length > 0) operations.push(db.prepare(`UPDATE schedule_claims SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE code = ?`).bind(...columns.map((column) => movement.from[column]), movement.from.code));
    } else {
      const id = movement.from.id;
      const columns = changes.filter((column) => column !== "id" && column !== "created_at");
      if (columns.length > 0) operations.push(db.prepare(`UPDATE ${movement.table} SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`).bind(...columns.map((column) => movement.from[column]), id));
    }
    return;
  }
  const existing = movement.table === "person_list_members"
    ? await db.prepare("SELECT * FROM person_list_members WHERE list_id = ? AND person_id = ?").bind(movement.from.list_id, movement.from.person_id).first<Row>()
    : movement.table === "schedule_claims"
      ? await db.prepare("SELECT * FROM schedule_claims WHERE code = ?").bind(movement.from.code).first<Row>()
    : await db.prepare(`SELECT * FROM ${movement.table} WHERE id = ?`).bind(movement.from.id).first<Row>();
  if (existing) {
    skipped.push({ table: movement.table, primary_key: movement.primary_key, reason: "key_occupied_since_merge" });
    return;
  }
  if (preInserted.has(`${movement.table}:${movement.from.id ?? movement.primary_key}`)) return;
  operations.push(insertRow(db, movement.table, movement.from));
}

export interface PersonMergeUndoResult {
  merge_id: string;
  status: "undone" | "undo_blocked";
  restored: number;
  skipped: number;
  skipped_rows: Array<{ table: string; primary_key: string; reason: string }>;
  reason?: string;
}

export async function undoPersonMerge(
  db: D1Database,
  orgId: string,
  mergeId: string,
  actor: PersonMergeActor,
  now = Date.now(),
): Promise<PersonMergeUndoResult> {
  const receipt = await db.prepare("SELECT * FROM person_merges WHERE id = ? AND org_id = ?").bind(mergeId, orgId).first<Row>();
  if (!receipt) throw new PersonMergeError("invalid_merge", "merge receipt not found");
  if (receipt.status === "undone" || receipt.status === "undo_blocked") {
    return {
      merge_id: mergeId,
      status: receipt.status as "undone" | "undo_blocked",
      restored: Number((JSON.parse(String(receipt.undo_result_json ?? "{}")) as JsonObject).restored ?? 0),
      skipped: Number((JSON.parse(String(receipt.undo_result_json ?? "{}")) as JsonObject).skipped ?? 0),
      skipped_rows: ((JSON.parse(String(receipt.undo_result_json ?? "{}")) as JsonObject).skipped_rows ?? []) as Array<{ table: string; primary_key: string; reason: string }>,
      ...(receipt.undo_reason ? { reason: String(receipt.undo_reason) } : {}),
    };
  }
  const laterMerge = await db.prepare(
    "SELECT id FROM person_merges WHERE org_id = ? AND retired_person_id = ? AND created_at > ? AND status <> 'undone' LIMIT 1",
  ).bind(orgId, receipt.survivor_person_id, receipt.created_at).first<{ id: string }>();
  if (laterMerge) {
    const result: PersonMergeUndoResult = { merge_id: mergeId, status: "undo_blocked", restored: 0, skipped: 0, skipped_rows: [], reason: "survivor_remerged" };
    await db.prepare("UPDATE person_merges SET status = 'undo_blocked', undo_reason = ?, undo_result_json = ?, updated_at = ? WHERE id = ?")
      .bind(result.reason, JSON.stringify(result), now, mergeId).run();
    throw new PersonMergeError("undo_blocked", "Undo is blocked because the survivor was merged again", result);
  }

  const retired = JSON.parse(String(receipt.retired_snapshot_json)) as PersonRow;
  const survivorBefore = JSON.parse(String(receipt.survivor_before_json)) as PersonRow;
  const survivorAfter = JSON.parse(String(receipt.survivor_after_json)) as PersonRow;
  const movements = JSON.parse(String(receipt.movement_receipts_json)) as MovementReceipt[];
  const operations: D1PreparedStatement[] = [];
  const preInserted = new Set<string>();
  for (const movement of movements.filter((candidate) => candidate.outcome === "dropped" && candidate.table === "attachments")) {
    const currentAttachment = await db.prepare("SELECT id FROM attachments WHERE id = ?").bind(movement.from.id).first<{ id: string }>();
    if (!currentAttachment) {
      preInserted.add(`attachments:${movement.from.id ?? movement.primary_key}`);
      operations.push(insertRow(db, "attachments", movement.from));
    }
  }
  const skippedRows: Array<{ table: string; primary_key: string; reason: string }> = [];
  const existingRetired = await db.prepare("SELECT * FROM people WHERE id = ? AND org_id = ?").bind(retired.id, orgId).first<Row>();
  if (!existingRetired) operations.push(insertRow(db, "people", retired as unknown as Row));
  else if (!equalRow(existingRetired, retired as unknown as Row)) skippedRows.push({ table: "people", primary_key: retired.id, reason: "retired_identity_reused" });

  // Reverse the receipt. Besides being the natural inverse of the merge, this
  // matters for partial unique indexes: a retained contact can be promoted to
  // primary only after the retired primary is restored to its pre-merge state.
  for (const movement of [...movements].reverse()) await undoMovement(db, movement, mergeId, operations, skippedRows, preInserted);
  const currentSurvivor = await db.prepare("SELECT * FROM people WHERE id = ? AND org_id = ?").bind(receipt.survivor_person_id, orgId).first<Row>();
  if (currentSurvivor && equalRow(currentSurvivor, survivorAfter as unknown as Row)) {
    const columns = changedColumns(survivorBefore as unknown as Row, survivorAfter as unknown as Row).filter((column) => column !== "id" && column !== "org_id" && column !== "created_at");
    if (columns.length > 0) operations.push(db.prepare(`UPDATE people SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ? AND org_id = ?`).bind(...columns.map((column) => (survivorBefore as unknown as Row)[column]), receipt.survivor_person_id, orgId));
  } else if (currentSurvivor) {
    skippedRows.push({ table: "people", primary_key: String(receipt.survivor_person_id), reason: "survivor_changed_since_merge" });
  }
  operations.push(db.prepare("DELETE FROM person_aliases WHERE id = ? AND org_id = ? AND person_id = ? AND merge_id = ?").bind(mergeId, orgId, receipt.survivor_person_id, mergeId));
  const result: PersonMergeUndoResult = { merge_id: mergeId, status: "undone", restored: 1, skipped: skippedRows.length, skipped_rows: skippedRows };
  operations.push(db.prepare(
    "UPDATE person_merges SET status = 'undone', undo_result_json = ?, undo_reason = NULL, updated_at = ? WHERE id = ? AND org_id = ? AND status = 'clean'",
  ).bind(JSON.stringify(result), now, mergeId, orgId));
  operations.push(auditStatement(db, {
    eventId: null,
    orgId,
    actorKind: actor.actorKind,
    actorPersonId: actor.actorPersonId,
    action: "person.merge_undone",
    entityType: "person",
    entityId: String(receipt.survivor_person_id),
    before: { merge_id: mergeId },
    after: result,
    now,
    requestId: actor.requestId,
  }));
  await db.batch(operations);
  return result;
}

export async function activeMergeForImportedPerson(
  db: D1Database,
  orgId: string,
  personId: string,
): Promise<{ mergeId: string; survivorId: string } | null> {
  const row = await db.prepare(
    `SELECT id, survivor_person_id AS survivorId
       FROM person_merges
      WHERE org_id = ? AND status = 'clean'
        AND (retired_person_id = ? OR survivor_person_id = ?)
      ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).bind(orgId, personId, personId).first<{ id: string; survivorId: string }>();
  return row ? { mergeId: row.id, survivorId: row.survivorId } : null;
}
