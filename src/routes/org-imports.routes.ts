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

interface OrgPeopleImportRow {
  outcome: "created" | "updated";
  target_id: string | null;
  before_json: string | null;
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

async function personHasReferences(db: D1Database, personId: string): Promise<boolean> {
  const references = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM participations WHERE person_id = ?) AS participations,
       (SELECT COUNT(*) FROM submissions WHERE submitter_person_id = ? OR decided_by_person_id = ?) AS submissions,
       (SELECT COUNT(*) FROM evaluations WHERE reviewer_person_id = ?) AS evaluations,
       (SELECT COUNT(*) FROM memberships WHERE person_id = ?) AS memberships`,
  ).bind(personId, personId, personId, personId, personId).first<{
    participations: number;
    submissions: number;
    evaluations: number;
    memberships: number;
  }>();
  return Boolean(references && (
    Number(references.participations) > 0
    || Number(references.submissions) > 0
    || Number(references.evaluations) > 0
    || Number(references.memberships) > 0
  ));
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
          `INSERT INTO import_rows (id, import_id, row_index, entity, outcome, target_id, before_json, created_at, updated_at)
           VALUES (?, ?, ?, 'person', ?, ?, ?, ?, ?)`,
        ).bind(
          newUlid(now), importId, index, existing ? "updated" : "created", personId,
          existing ? JSON.stringify({ name: existing.name, title: existing.title, company: existing.company, bio: existing.bio }) : null,
          now, now,
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
    description: "Restores the values overwritten by a people CSV import and removes newly created people when they have no other records.",
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
      return context.json({ undone: 0, retained_manifest: true }, 200);
    }

    const rows = await context.env.DB.prepare(
      `SELECT outcome, target_id, before_json
       FROM import_rows
       WHERE import_id = ? AND entity = 'person' AND outcome IN ('created', 'updated')
       ORDER BY row_index DESC`,
    ).bind(importId).all<OrgPeopleImportRow>();
    const statements: D1PreparedStatement[] = [];
    const now = Date.now();
    let undone = 0;
    for (const row of rows.results) {
      if (!row.target_id) continue;
      if (row.outcome === "updated") {
        if (!row.before_json) throw ApiError.conflict("this import has no restore receipt");
        const before = restoreSnapshot(row.before_json);
        statements.push(context.env.DB.prepare(
          `UPDATE people
           SET name = ?, title = ?, company = ?, bio = ?, updated_at = ?
           WHERE id = ? AND org_id = ?`,
        ).bind(before.name, before.title, before.company, before.bio, now, row.target_id, access.orgId));
        undone += 1;
        continue;
      }
      // A newly imported person is safe to remove only while no later workflow
      // has attached to them. Undo must not erase a roster, submission, or
      // reviewer's history that appeared after the import.
      if (await personHasReferences(context.env.DB, row.target_id)) continue;
      statements.push(context.env.DB.prepare(
        "DELETE FROM people WHERE id = ? AND org_id = ?",
      ).bind(row.target_id, access.orgId));
      undone += 1;
    }
    statements.push(context.env.DB.prepare(
      "UPDATE imports SET status = 'undone', undone_at = ?, updated_at = ? WHERE id = ?",
    ).bind(now, now, importId));
    await context.env.DB.batch(statements);
    return context.json({ undone, retained_manifest: true }, 200);
  },
);

export const apiRoutes = [importPeople, undoPeopleImport];
