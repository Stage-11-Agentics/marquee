/**
 * "Create next year's conference from this one" — the read side and the
 * statement builder. The route owns the single `db.batch()` that commits them.
 *
 * The read phase is deliberately outside that batch: D1 gives no snapshot
 * across a read and a later write, so a concurrent edit to the source
 * conference during a copy yields a copy of a slightly-earlier state. That is
 * acceptable for a once-a-year action and it is stated rather than implied
 * away — what the batch does guarantee is that the new conference arrives whole
 * or not at all.
 */
import { ApiError } from "../../api/errors";
import { newUlid } from "../../api/ids";
import {
  COPY_SET_KEYS,
  COPY_TABLES,
  DEFAULT_COPY_SELECTION,
  type CopySelection,
  type CopySetKey,
  type CopyTable,
} from "./copy-manifest";

export type CopyCounts = Partial<Record<string, number>>;

export interface CopyPrerequisites {
  /**
   * Sets a chosen set cannot travel without. Empty when the source conference
   * happens not to trip the dependency, which is why it is measured rather
   * than asserted.
   */
  requires: Partial<Record<CopySetKey, CopySetKey[]>>;
  reasons: Partial<Record<CopySetKey, string>>;
}

export interface CopyPlan extends CopyPrerequisites {
  event: { id: string; name: string };
  counts: CopyCounts;
  /** Templates declined because they carry a fixed calendar deadline. */
  taskTemplatesSkippedFixedDue: number;
}

export interface CopyResult {
  statements: D1PreparedStatement[];
  counts: CopyCounts;
  taskTemplatesSkippedFixedDue: number;
}

function whereFor(table: CopyTable): string {
  return table.scope.kind === "event"
    ? "event_id = ?"
    : `${table.scope.column} IN (${table.scope.sql})`;
}

function selectFor(table: CopyTable): string {
  const active = activePredicate(table.table);
  return `SELECT * FROM ${table.table} WHERE ${whereFor(table)}${active} ORDER BY ${table.orderBy}`;
}

function activePredicate(table: string): string {
  return ["tracks", "tags", "levels", "form_fields", "routing_rules"].includes(table)
    ? " AND deleted_at IS NULL"
    : "";
}

export function resolveSelection(requested: CopySelection | undefined): Record<CopySetKey, boolean> {
  const selection = { ...DEFAULT_COPY_SELECTION };
  for (const key of COPY_SET_KEYS) {
    const value = requested?.[key];
    if (typeof value === "boolean") selection[key] = value;
  }
  return selection;
}

/**
 * The two dependencies the schema and the submit path impose, measured against
 * this particular source conference.
 *
 * They are not preferences. Copying forms whose fields bind to formats or
 * tracks BY NAME (`0010_bound_form_options`) without those tables yields a form
 * over an empty dropdown that cannot be submitted; copying a `kind = 'form'`
 * task template without its form violates
 * `CHECK (kind <> 'form' OR form_id IS NOT NULL)`, which rolls back the entire
 * batch — a 500 on a checkbox combination the screen itself offered.
 */
export async function readPrerequisites(db: D1Database, sourceEventId: string): Promise<CopyPrerequisites> {
  const [bound, levelsBound, rules, formTasks] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS total FROM form_fields
       WHERE form_id IN (SELECT id FROM forms WHERE event_id = ?)
         AND deleted_at IS NULL
         AND json_extract(config, '$.source') IS NOT NULL`,
    ).bind(sourceEventId).first<{ total: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS total FROM form_fields
       WHERE form_id IN (SELECT id FROM forms WHERE event_id = ?)
         AND deleted_at IS NULL AND json_extract(config, '$.source') = 'levels'`,
    ).bind(sourceEventId).first<{ total: number }>(),
    db.prepare("SELECT when_json FROM routing_rules WHERE event_id = ? AND deleted_at IS NULL ORDER BY position, id").bind(sourceEventId).all<{ when_json: string }>(),
    db.prepare(
      "SELECT name FROM task_templates WHERE event_id = ? AND kind = 'form' AND due_at IS NULL ORDER BY position, id",
    ).bind(sourceEventId).all<{ name: string }>(),
  ]);

  const requires: CopyPrerequisites["requires"] = {};
  const reasons: CopyPrerequisites["reasons"] = {};
  if (Number(bound?.total ?? 0) > 0) {
    requires.forms = ["formats", "tracks"];
    reasons.forms = "This form's dropdowns are filled from your formats and tracks, so they travel together — a copied form over empty options cannot be submitted.";
  }
  if (Number(levelsBound?.total ?? 0) > 0) {
    requires.forms = [...new Set([...(requires.forms ?? []), "routing" as CopySetKey])];
    reasons.forms = `${reasons.forms ?? "This form uses conference-owned options."} Its Audience level is owned by routing, so routing and Levels travel with the form.`;
  }
  const usesFormat = rules.results.some((row) => {
    try {
      const parsed = JSON.parse(row.when_json) as { field?: unknown; all?: Array<{ fieldKey?: unknown; field?: unknown }> };
      return parsed.field === "format" || parsed.all?.some((item) => item.fieldKey === "format" || item.field === "format");
    } catch {
      return false;
    }
  });
  if (rules.results.length > 0) {
    requires.routing = ["forms", "tracks"];
    reasons.routing = "Routing rules need the copied forms and tracks so their conditions and landings remain in this conference.";
    if (usesFormat) {
      requires.routing = ["forms", "tracks", "formats"];
      reasons.routing += " At least one rule names a format, so formats travel too.";
    }
  }
  if (formTasks.results.length > 0) {
    requires.task_templates = ["forms"];
    const names = formTasks.results.map((row) => row.name);
    reasons.task_templates = `${names.length === 1 ? "One task" : `${names.length} tasks`} sends speakers to a form (${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}), so the CFP forms travel with them.`;
  }
  return { requires, reasons };
}

/** Per-set counts for the create screen's checklist, and the skipped tally. */
export async function readCopyPlan(db: D1Database, sourceEventId: string): Promise<CopyPlan> {
  const event = await db
    .prepare("SELECT id, name FROM events WHERE id = ?")
    .bind(sourceEventId)
    .first<{ id: string; name: string }>();
  if (!event) throw ApiError.notFound("conference not found");

  const counts: CopyCounts = {};
  for (const table of COPY_TABLES) {
    const predicate = `${whereFor(table)}${activePredicate(table.table)}${table.table === "task_templates" ? " AND due_at IS NULL" : ""}`;
    const row = await db
      .prepare(`SELECT COUNT(*) AS total FROM ${table.table} WHERE ${predicate}`)
      .bind(sourceEventId)
      .first<{ total: number }>();
    counts[table.table] = Number(row?.total ?? 0);
  }
  const skipped = await db
    .prepare("SELECT COUNT(*) AS total FROM task_templates WHERE event_id = ? AND due_at IS NOT NULL")
    .bind(sourceEventId)
    .first<{ total: number }>();

  return {
    event: { id: event.id, name: event.name },
    counts,
    taskTemplatesSkippedFixedDue: Number(skipped?.total ?? 0),
    ...(await readPrerequisites(db, sourceEventId)),
  };
}

function assertSelectionIsLegal(
  selection: Record<CopySetKey, boolean>,
  prerequisites: CopyPrerequisites,
): void {
  for (const key of COPY_SET_KEYS) {
    if (!selection[key]) continue;
    const missing = (prerequisites.requires[key] ?? []).filter((required) => !selection[required]);
    if (missing.length === 0) continue;
    // 422 with the reason on it, never a 500 out of a rolled-back batch.
    throw ApiError.unprocessable(
      `${prerequisites.reasons[key] ?? "This set depends on another."} Include ${missing.join(" and ")}.`,
      `copy.${key}`,
    );
  }
}

/**
 * Read the source conference and build the insert statements for the new one.
 *
 * Columns come from the rows themselves, so a column the next migration adds is
 * carried without anyone remembering to add it to a list; `copy-manifest.ts`
 * declares every column it expects, and a drift test holds that declaration
 * against the live schema.
 */
export async function planEventCopy(
  db: D1Database,
  sourceEventId: string,
  newEventId: string,
  requested: CopySelection | undefined,
  now: number,
): Promise<CopyResult> {
  const selection = resolveSelection(requested);
  assertSelectionIsLegal(selection, await readPrerequisites(db, sourceEventId));

  const statements: D1PreparedStatement[] = [];
  const counts: CopyCounts = {};
  const idMaps = new Map<string, Map<string, string>>();
  let taskTemplatesSkippedFixedDue = 0;

  for (const table of COPY_TABLES) {
    if (!selection[table.set]) continue;
    const rows = await db.prepare(selectFor(table)).bind(sourceEventId).all<Record<string, unknown>>();
    const idMap = new Map<string, string>();
    idMaps.set(table.table, idMap);
    let copied = 0;

    for (const row of rows.results) {
      if (table.skip?.(row)) {
        if (table.table === "task_templates") taskTemplatesSkippedFixedDue += 1;
        continue;
      }
      const columns = Object.keys(row);
      const values = columns.map((column) => {
        if (column === table.key) return null; // replaced below
        if (table.nulls.includes(column)) return null;
        if (column in table.constants) return table.constants[column] ?? null;
        if (table.stamps.includes(column)) return now;
        const target = table.remap[column];
        if (target !== undefined) {
          if (target === "__event__") return newEventId;
          const source = row[column];
          if (source === null || source === undefined) return null;
          // A parent that was not copied leaves the reference empty rather than
          // pointing across conferences. The combinations where the schema
          // forbids that are refused above, before anything is written.
          return idMaps.get(target)?.get(String(source)) ?? null;
        }
        const mapped = table.mapJson?.(column, row[column], idMaps);
        return (mapped === undefined ? row[column] : mapped) as string | number | null;
      });

      const freshId = newUlid(now);
      idMap.set(String(row[table.key]), freshId);
      values[columns.indexOf(table.key)] = freshId;

      statements.push(
        db.prepare(
          `INSERT INTO ${table.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        ).bind(...(values as (string | number | null)[])),
      );
      copied += 1;
    }
    counts[table.table] = copied;
  }

  return { statements, counts, taskTemplatesSkippedFixedDue };
}
