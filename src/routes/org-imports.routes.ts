/**
 * Import people from a CSV.
 *
 * One call: post the file, get back what happened. There is no upload step, no
 * mapping wizard, and no separate "run" — the identical requirement on the
 * conference side is a drop zone that produces rows, and three round trips to
 * reach the same place is the shape this product exists to delete.
 *
 * The write is the same shape as adding a person by hand: matched on email, so
 * an address the organization already knows is updated and never duplicated. The
 * `imports`/`import_rows` receipt is written too, so an import is inspectable and
 * reversible afterwards rather than being an unlogged bulk write.
 */
import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { orgAttributionEventId, requireOrgAccess } from "../lib/auth/org-access";
import { planPersonImport } from "../lib/people-import";

const importParams = z.object({ importId: z.string().min(1) });

interface OrgPersonImportSnapshot {
  name: string;
  title: string | null;
  company: string | null;
  bio: string | null;
}

const PERSON_PROFILE_FIELDS = ["name", "title", "company", "bio"] as const;
type PersonProfileField = (typeof PERSON_PROFILE_FIELDS)[number];

interface OrgPeopleImportRow {
  row_index: number;
  outcome: "created" | "updated";
  target_id: string | null;
  before_json: string | null;
  after_json: string | null;
}

interface CurrentPersonProfile extends OrgPersonImportSnapshot {
  id: string;
}

type UndoSkipReason = "changed_after_import" | "has_references" | "missing_restore_receipt";

interface UndoSkip {
  target_id: string;
  reason: UndoSkipReason;
  fields: PersonProfileField[];
  references: string[];
}

/**
 * Every direct foreign key to people must appear here. The predicate is kept
 * as a fixed string rather than assembled from table names supplied by a
 * request. `PERSON_ID` is replaced with either the CTE target or the outer
 * `people.id` when the same inventory guards a delete.
 */
const PERSON_REFERENCE_CHECKS = [
  { label: "memberships", predicate: "EXISTS (SELECT 1 FROM memberships WHERE memberships.person_id = PERSON_ID)" },
  { label: "auth_sessions", predicate: "EXISTS (SELECT 1 FROM auth_sessions WHERE auth_sessions.person_id = PERSON_ID)" },
  { label: "magic_links", predicate: "EXISTS (SELECT 1 FROM magic_links WHERE magic_links.person_id = PERSON_ID)" },
  { label: "api_tokens", predicate: "EXISTS (SELECT 1 FROM api_tokens WHERE api_tokens.created_by = PERSON_ID OR api_tokens.acts_as_person_id = PERSON_ID)" },
  { label: "form_admins", predicate: "EXISTS (SELECT 1 FROM form_admins WHERE form_admins.person_id = PERSON_ID)" },
  { label: "outbox", predicate: "EXISTS (SELECT 1 FROM outbox WHERE outbox.person_id = PERSON_ID)" },
  { label: "submissions", predicate: "EXISTS (SELECT 1 FROM submissions WHERE submissions.submitter_person_id = PERSON_ID OR submissions.decided_by_person_id = PERSON_ID)" },
  { label: "submission_decisions", predicate: "EXISTS (SELECT 1 FROM submission_decisions WHERE submission_decisions.decided_by_person_id = PERSON_ID)" },
  { label: "saved_views", predicate: "EXISTS (SELECT 1 FROM saved_views WHERE saved_views.person_id = PERSON_ID)" },
  { label: "participations", predicate: "EXISTS (SELECT 1 FROM participations WHERE participations.person_id = PERSON_ID)" },
  { label: "committee_members", predicate: "EXISTS (SELECT 1 FROM committee_members WHERE committee_members.person_id = PERSON_ID)" },
  { label: "reviewer_track_scopes", predicate: "EXISTS (SELECT 1 FROM reviewer_track_scopes WHERE reviewer_track_scopes.person_id = PERSON_ID)" },
  { label: "round_assignments", predicate: "EXISTS (SELECT 1 FROM round_assignments WHERE round_assignments.reviewer_person_id = PERSON_ID)" },
  { label: "evaluations", predicate: "EXISTS (SELECT 1 FROM evaluations WHERE evaluations.reviewer_person_id = PERSON_ID OR evaluations.override_person_id = PERSON_ID)" },
  { label: "comparisons", predicate: "EXISTS (SELECT 1 FROM comparisons WHERE comparisons.reviewer_person_id = PERSON_ID)" },
  { label: "round_promotions", predicate: "EXISTS (SELECT 1 FROM round_promotions WHERE round_promotions.promoted_by = PERSON_ID)" },
  { label: "speaker_tasks", predicate: "EXISTS (SELECT 1 FROM speaker_tasks WHERE speaker_tasks.person_id = PERSON_ID)" },
  { label: "calendar_invites", predicate: "EXISTS (SELECT 1 FROM calendar_invites WHERE calendar_invites.person_id = PERSON_ID)" },
  { label: "audit_log", predicate: "EXISTS (SELECT 1 FROM audit_log WHERE audit_log.actor_person_id = PERSON_ID)" },
  { label: "file_comments", predicate: "EXISTS (SELECT 1 FROM file_comments WHERE file_comments.author_person_id = PERSON_ID)" },
  { label: "person_events", predicate: "EXISTS (SELECT 1 FROM person_events WHERE person_events.person_id = PERSON_ID OR person_events.actor_person_id = PERSON_ID)" },
  { label: "person_lists", predicate: "EXISTS (SELECT 1 FROM person_lists WHERE person_lists.created_by = PERSON_ID)" },
  { label: "person_list_members", predicate: "EXISTS (SELECT 1 FROM person_list_members WHERE person_list_members.person_id = PERSON_ID)" },
] as const;

function personReferencePredicates(personExpression: string): string[] {
  return PERSON_REFERENCE_CHECKS.map(({ predicate }) => predicate.replaceAll("PERSON_ID", personExpression));
}

function personReferenceSelect(): string {
  return PERSON_REFERENCE_CHECKS.map(({ label, predicate }) =>
    `${predicate.replaceAll("PERSON_ID", "target.id")} AS "${label}"`).join(",\n       ");
}

function noPersonReferencesPredicate(): string {
  return personReferencePredicates("people.id").map((predicate) => `NOT (${predicate})`).join(" AND ");
}

function conditionalRestoreStatement(
  db: D1Database,
  orgId: string,
  personId: string,
  before: OrgPersonImportSnapshot,
  after: OrgPersonImportSnapshot,
  fields: readonly PersonProfileField[],
  now: number,
): D1PreparedStatement {
  const assignments = fields.map((field) => `${field} = CASE WHEN ${field} IS ? THEN ? ELSE ${field} END`);
  const match = fields.map((field) => `${field} IS ?`).join(" OR ");
  const bindings: Array<string | number | null> = [];
  for (const field of fields) bindings.push(after[field], before[field]);
  bindings.push(now, personId, orgId);
  for (const field of fields) bindings.push(after[field]);
  return db.prepare(
    `UPDATE people
     SET ${assignments.join(", ")}, updated_at = ?
     WHERE id = ? AND org_id = ? AND (${match})`,
  ).bind(...bindings);
}

function restoreSnapshot(value: string): OrgPersonImportSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw ApiError.conflict("this import receipt cannot be restored");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw ApiError.conflict("this import receipt cannot be restored");
  }
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.name !== "string") throw ApiError.conflict("this import receipt cannot be restored");
  const text = (field: string): string | null => {
    const fieldValue = candidate[field];
    if (fieldValue !== null && typeof fieldValue !== "string") throw ApiError.conflict("this import receipt cannot be restored");
    return fieldValue as string | null;
  };
  return { name: candidate.name, title: text("title"), company: text("company"), bio: text("bio") };
}

async function personHasReferences(db: D1Database, personId: string): Promise<string[]> {
  return personReferences(db, personId);
}

async function personReferences(db: D1Database, personId: string): Promise<string[]> {
  const references = await db.prepare(
    `WITH target AS (SELECT ? AS id)
     SELECT ${personReferenceSelect()}
     FROM target`,
  ).bind(personId).first<Record<string, number>>();
  if (!references) return [];
  return PERSON_REFERENCE_CHECKS
    .filter(({ label }) => Number(references[label]) > 0)
    .map(({ label }) => label);
}

const importResponse = z.object({
  import_id: z.string(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  unmapped: z.array(z.string()).describe("Columns no field claimed; they were ignored, not guessed at."),
  headers: z.array(z.string()),
  undo_path: z.string().describe("POST this path to restore the values overwritten by this import."),
}).openapi("PeopleImportResult");

const undoResponse = z.object({
  undone: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  skipped_rows: z.array(z.object({
    target_id: z.string(),
    reason: z.enum(["changed_after_import", "has_references", "missing_restore_receipt"]),
    fields: z.array(z.enum(["name", "title", "company", "bio"])),
    references: z.array(z.string()),
  })),
  retained_manifest: z.literal(true),
}).openapi("PeopleImportUndoResult");

const importPeople = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/imports",
    operationId: "importOrgPeople",
    summary: "Import people from a CSV",
    description:
      "Columns are mapped by header. Matched on email: an existing person is updated, never duplicated. Returns created, updated, skipped, and any column it could not map.",
    tags: ["People"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              csv: z.string().min(1).max(2_000_000).describe("The file's contents, as text."),
              filename: z.string().trim().max(200).optional(),
            }),
          },
        },
      },
    },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 202: jsonResponse(importResponse, "Import result"), ...errorResponses([400, 401, 403, 422, 429, 500]) },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const body = context.req.valid("json");
    const plan = planPersonImport(body.csv);
    const now = Date.now();
    // `imports.event_id` is NOT NULL, so the receipt is attributed to the
    // organization's conference — the documented single-org shortcut, decided in
    // one place.
    const eventId = await orgAttributionEventId(context.env.DB, access.orgId);
    const importId = newUlid(now);
    await context.env.DB.prepare(
      `INSERT INTO imports (id, event_id, source, file_key, mapping, status, created_at, updated_at)
       VALUES (?, ?, 'people_csv', ?, ?, 'applied', ?, ?)`,
    ).bind(
      importId,
      eventId,
      body.filename ?? "people.csv",
      JSON.stringify({ auto_mapped: true, unmapped: plan.unmapped, headers: plan.headers }),
      now,
      now,
    ).run();

    let created = 0;
    let updated = 0;
    const receipts: D1PreparedStatement[] = [];
    for (const [index, row] of plan.rows.entries()) {
      const existing = await context.env.DB
        .prepare("SELECT id, name, title, company, bio FROM people WHERE org_id = ? AND lower(email) = ?")
        .bind(access.orgId, row.email)
        .first<{ id: string; name: string; title: string | null; company: string | null; bio: string | null }>();
      const personId = existing?.id ?? newUlid(now);
      const after = existing ? {
        name: row.name,
        title: row.title ?? existing.title,
        company: row.company ?? existing.company,
        bio: row.bio ?? existing.bio,
      } : null;
      if (existing) {
        // An import is an update, never an erase: a blank cell means "this
        // export does not carry the field", not "delete what the speaker wrote".
        await context.env.DB.prepare(
          `UPDATE people SET name = ?, title = COALESCE(?, title), company = COALESCE(?, company),
                  bio = COALESCE(?, bio), updated_at = ? WHERE id = ?`,
        ).bind(row.name, row.title, row.company, row.bio, now, personId).run();
        updated += 1;
      } else {
        await context.env.DB.prepare(
          `INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, custom_fields, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}', 0, ?, ?)`,
        ).bind(personId, access.orgId, row.email, row.name, row.title, row.company, row.bio, now, now).run();
        created += 1;
      }
      receipts.push(
        context.env.DB.prepare(
          `INSERT INTO import_rows (id, import_id, row_index, entity, outcome, target_id, before_json, after_json, created_at, updated_at)
           VALUES (?, ?, ?, 'person', ?, ?, ?, ?, ?, ?)`,
        ).bind(
          newUlid(now), importId, index, existing ? "updated" : "created", personId,
          existing ? JSON.stringify({ name: existing.name, title: existing.title, company: existing.company, bio: existing.bio }) : null,
          after ? JSON.stringify(after) : null, now, now,
        ),
      );
    }
    if (receipts.length > 0) await context.env.DB.batch(receipts);
    return context.json({
      import_id: importId,
      created,
      updated,
      skipped: plan.skipped,
      unmapped: plan.unmapped,
      headers: plan.headers,
      undo_path: `/api/v1/org/imports/${importId}/undo`,
    }, 202);
  },
);

const undoPeopleImport = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/imports/{importId}/undo",
    operationId: "undoOrgPeopleImport",
    summary: "Undo a people CSV import",
    description: "Restores imported values only while they are unchanged, removes newly created people with no references, and reports rows or fields it conservatively retains.",
    tags: ["People"],
    request: { params: importParams },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(undoResponse, "People import undo outcome"), ...errorResponses([400, 401, 403, 404, 409, 422, 429, 500]) },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const { importId } = context.req.valid("param");
    const imported = await context.env.DB.prepare(
      `SELECT imports.id, imports.status, imports.undone_at
       FROM imports JOIN events ON events.id = imports.event_id
       WHERE imports.id = ? AND imports.source = 'people_csv' AND events.org_id = ?`,
    ).bind(importId, access.orgId).first<{ id: string; status: string; undone_at: number | null }>();
    if (!imported) throw ApiError.notFound("people import not found");
    if (imported.undone_at !== null || imported.status === "undone") {
      return context.json({ undone: 0, skipped: 0, skipped_rows: [], retained_manifest: true }, 200);
    }

    const rows = await context.env.DB.prepare(
      `SELECT row_index, outcome, target_id, before_json, after_json
       FROM import_rows
       WHERE import_id = ? AND entity = 'person' AND outcome IN ('created', 'updated')
       ORDER BY row_index DESC`,
    ).bind(importId).all<OrgPeopleImportRow>();
    const statements: D1PreparedStatement[] = [];
    const operations: Array<{ resultIndex: number; kind: "restore" | "delete" }> = [];
    const skippedRows: UndoSkip[] = [];
    const now = Date.now();

    const addSkip = (row: OrgPeopleImportRow, skip: UndoSkip): void => {
      skippedRows.push(skip);
      const reason = skip.reason === "changed_after_import"
        ? `undo skipped fields changed after import: ${skip.fields.join(", ")}`
        : skip.reason === "has_references"
          ? `undo retained person with references: ${skip.references.join(", ")}`
          : "undo skipped row because its imported values were not recorded";
      statements.push(context.env.DB.prepare(
        "UPDATE import_rows SET reason = ?, updated_at = ? WHERE import_id = ? AND row_index = ?",
      ).bind(reason, now, importId, row.row_index));
    };

    for (const row of rows.results) {
      if (!row.target_id) continue;
      if (row.outcome === "updated") {
        if (!row.before_json) throw ApiError.conflict("this import has no restore receipt");
        const before = restoreSnapshot(row.before_json);
        if (!row.after_json) {
          addSkip(row, { target_id: row.target_id, reason: "missing_restore_receipt", fields: [], references: [] });
          continue;
        }
        const after = restoreSnapshot(row.after_json);
        const current = await context.env.DB.prepare(
          "SELECT id, name, title, company, bio FROM people WHERE id = ? AND org_id = ?",
        ).bind(row.target_id, access.orgId).first<CurrentPersonProfile>();
        if (!current) continue;
        const changedFields = PERSON_PROFILE_FIELDS.filter((field) => before[field] !== after[field]);
        const conflictedFields = changedFields.filter((field) => current[field] !== before[field] && current[field] !== after[field]);
        if (conflictedFields.length > 0) {
          addSkip(row, { target_id: row.target_id, reason: "changed_after_import", fields: [...conflictedFields], references: [] });
        }
        const restoreFields = changedFields.filter((field) => current[field] === after[field]);
        if (restoreFields.length > 0) {
          const resultIndex = statements.length;
          statements.push(conditionalRestoreStatement(context.env.DB, access.orgId, row.target_id, before, after, restoreFields, now));
          operations.push({ resultIndex, kind: "restore" });
        }
        continue;
      }
      // A newly imported person is safe to remove only while no later workflow
      // has attached to them. Undo must not erase a roster, submission, or
      // reviewer's history that appeared after the import.
      const references = await personHasReferences(context.env.DB, row.target_id);
      if (references.length > 0) {
        addSkip(row, { target_id: row.target_id, reason: "has_references", fields: [], references });
        continue;
      }
      const resultIndex = statements.length;
      statements.push(context.env.DB.prepare(
        `DELETE FROM people
         WHERE id = ? AND org_id = ? AND ${noPersonReferencesPredicate()}`,
      ).bind(row.target_id, access.orgId));
      operations.push({ resultIndex, kind: "delete" });
    }
    statements.push(context.env.DB.prepare(
      "UPDATE imports SET status = 'undone', undone_at = ?, updated_at = ? WHERE id = ?",
    ).bind(now, now, importId));
    const results = await context.env.DB.batch(statements);
    const undone = operations.reduce(
      (count, operation) => count + (Number(results[operation.resultIndex]?.meta?.changes ?? 0) > 0 ? 1 : 0),
      0,
    );
    return context.json({ undone, skipped: skippedRows.length, skipped_rows: skippedRows, retained_manifest: true }, 200);
  },
);

export const apiRoutes = [importPeople, undoPeopleImport];
