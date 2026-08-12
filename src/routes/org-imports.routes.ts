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
 * `imports`/`import_rows` receipt is written too, so an import is inspectable
 * afterwards rather than being an unlogged bulk write.
 */
import { z } from "@hono/zod-openapi";

import { newUlid } from "../api/ids";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { orgAttributionEventId, requireOrgAccess } from "../lib/auth/org-access";
import { planPersonImport } from "../lib/people-import";

const importResponse = z.object({
  import_id: z.string(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  unmapped: z.array(z.string()).describe("Columns no field claimed; they were ignored, not guessed at."),
  headers: z.array(z.string()),
}).openapi("PeopleImportResult");

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
        .prepare("SELECT id FROM people WHERE org_id = ? AND lower(email) = ?")
        .bind(access.orgId, row.email)
        .first<{ id: string }>();
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
          `INSERT INTO import_rows (id, import_id, row_index, entity, outcome, target_id, created_at, updated_at)
           VALUES (?, ?, ?, 'person', ?, ?, ?, ?)`,
        ).bind(newUlid(now), importId, index, existing ? "updated" : "created", personId, now, now),
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
    }, 202);
  },
);

export const apiRoutes = [importPeople];
