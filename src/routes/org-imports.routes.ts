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
import { attendanceStatement, resolveEventForOrg } from "../lib/event-attendances";
import { planPersonImport } from "../lib/people-import";
import { speakerMembershipStatement } from "../lib/speaker-membership";
import { noPersonReferencesPredicate, personReferences } from "../lib/person-references";

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

/**
 * The attendance conference recorded on an import receipt. Anything unreadable
 * means "this import did not mark anyone as attending" rather than an error:
 * a receipt written before this field existed is not a corrupt receipt.
 */
function readMappingEventId(mapping: string | null, key: "attendance_event_id" | "roster_event_id"): string | null {
  if (!mapping) return null;
  try {
    const parsed = JSON.parse(mapping) as Record<string, unknown>;
    return typeof parsed[key] === "string" ? parsed[key] : null;
  } catch {
    return null;
  }
}

async function personHasReferences(db: D1Database, personId: string): Promise<string[]> {
  return personReferences(db, personId);
}

const importResponse = z.object({
  import_id: z.string(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  unmapped: z.array(z.string()).describe("Columns no field claimed; they were ignored, not guessed at."),
  headers: z.array(z.string()),
  attendances: z.number().int().nonnegative()
    .describe("Attendance rows written for the conference named in `event`; zero when none was named."),
  roster_placements: z.number().int().nonnegative()
    .describe("Speaker seats written on the conference roster named in `event`; zero unless `roster` was asked for."),
  event: z.string().nullable().describe("The conference slug these people were marked as attending, if one was named."),
  undo_path: z.string().describe("POST this path to restore the values overwritten by this import."),
}).openapi("PeopleImportResult");

const undoResponse = z.object({
  undone: z.number().int().nonnegative(),
  attendances_removed: z.number().int().nonnegative()
    .describe("Attendance rows withdrawn at the conference this import named; zero when it named none."),
  roster_placements_removed: z.number().int().nonnegative()
    .describe("Speaker seats withdrawn at the conference this import placed people on; zero when it placed none."),
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
      "Columns are mapped by header. Matched on email: an existing person is updated, never duplicated. Pass `event` (id or slug) to mark everyone in the file as an attendee of that conference — the attendance rows are written by this call, so importing a ticket export is one request, and re-running it neither duplicates a person nor a row. Add `roster: true` to seat them on that conference's speaker roster in the same pass. Returns created, updated, skipped, and any column it could not map.",
    tags: ["People"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              csv: z.string().min(1).max(2_000_000).describe("The file's contents, as text."),
              filename: z.string().trim().max(200).optional(),
              event: z.string().trim().min(1).max(120).optional()
                .describe("A conference id or slug. Everyone imported is recorded as an attendee of it (source: import)."),
              roster: z.boolean().optional()
                .describe("Seat everyone imported on the roster of the conference in `event`, as a speaker. Requires `event`."),
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
    // Resolved before a single row is written: naming a conference this
    // organization does not run is a mistake worth refusing, not a silent
    // import that quietly marks nobody as attending anything.
    const attendanceEvent = body.event
      ? await resolveEventForOrg(context.env.DB, access.orgId, body.event)
      : null;
    if (body.event && !attendanceEvent) {
      throw ApiError.unprocessable(`this organization has no conference "${body.event}"`, "event");
    }
    // A roster is a roster OF something. Asking to seat people without naming
    // the conference is the one reading this call must not guess at.
    if (body.roster && !attendanceEvent) {
      throw ApiError.unprocessable("name the conference in `event` before asking for a place on its roster", "roster");
    }
    const rosterEvent = body.roster ? attendanceEvent : null;
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
      // The attendance event rides the receipt: undo has to know which
      // conference this import said these people were coming to, and
      // `imports.event_id` is the organization's attribution event rather than
      // the one the caller named.
      JSON.stringify({
        auto_mapped: true,
        unmapped: plan.unmapped,
        headers: plan.headers,
        ...(attendanceEvent ? { attendance_event_id: attendanceEvent.id } : {}),
        ...(rosterEvent ? { roster_event_id: rosterEvent.id } : {}),
      }),
      now,
      now,
    ).run();

    let created = 0;
    let updated = 0;
    const receipts: D1PreparedStatement[] = [];
    const attendances: D1PreparedStatement[] = [];
    const rosterSeats: D1PreparedStatement[] = [];
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
      // The whole point of passing `event`: the caller does not make a second
      // pass to say "and these people are attending". One request, and running
      // it again writes neither a second person nor a second attendance.
      if (attendanceEvent) {
        attendances.push(attendanceStatement(context.env.DB, {
          eventId: attendanceEvent.id,
          personId,
          source: "import",
          now,
        }));
      }
      // A speakers CSV that lands only in the organization is a half-done
      // import wearing a success receipt: the people are in People CRM, the
      // conference roster is exactly as empty as before, and nothing on either
      // screen says so. The seat is the same row Add speaker writes, and the
      // same upsert, so a re-run seats nobody twice.
      if (rosterEvent) {
        rosterSeats.push(speakerMembershipStatement(context.env.DB, {
          orgId: access.orgId,
          eventId: rosterEvent.id,
          personId,
          now,
        }));
      }
    }
    if (receipts.length > 0) await context.env.DB.batch(receipts);
    if (attendances.length > 0) await context.env.DB.batch(attendances);
    if (rosterSeats.length > 0) await context.env.DB.batch(rosterSeats);
    return context.json({
      import_id: importId,
      created,
      updated,
      skipped: plan.skipped,
      unmapped: plan.unmapped,
      headers: plan.headers,
      attendances: attendances.length,
      roster_placements: rosterSeats.length,
      event: attendanceEvent?.slug ?? null,
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
      `SELECT imports.id, imports.status, imports.undone_at, imports.mapping
       FROM imports JOIN events ON events.id = imports.event_id
       WHERE imports.id = ? AND imports.source = 'people_csv' AND events.org_id = ?`,
    ).bind(importId, access.orgId).first<{ id: string; status: string; undone_at: number | null; mapping: string | null }>();
    if (!imported) throw ApiError.notFound("people import not found");
    if (imported.undone_at !== null || imported.status === "undone") {
      return context.json({ undone: 0, attendances_removed: 0, roster_placements_removed: 0, skipped: 0, skipped_rows: [], retained_manifest: true }, 200);
    }

    const rows = await context.env.DB.prepare(
      `SELECT row_index, outcome, target_id, before_json, after_json
       FROM import_rows
       WHERE import_id = ? AND entity = 'person' AND outcome IN ('created', 'updated')
       ORDER BY row_index DESC`,
    ).bind(importId).all<OrgPeopleImportRow>();
    // Which conference this import marked people as attending, and which one
    // it seated them on the roster of, if any.
    const attendanceEventId = readMappingEventId(imported.mapping, "attendance_event_id");
    const rosterEventId = readMappingEventId(imported.mapping, "roster_event_id");
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

    // Reversed FIRST, so the person deletes below run against a person nothing
    // points at any more. An import that named a conference asserted "these
    // people are coming"; undoing the import withdraws that assertion, for the
    // people it touched, at that conference, and nowhere else.
    let attendancesRemoved = 0;
    let attendanceIndex = -1;
    if (attendanceEventId) {
      attendanceIndex = statements.length;
      // One statement, not one per person: a three-thousand-row ticket export
      // would otherwise queue three thousand extra deletes into a batch that
      // already carries a receipt per row.
      //
      // ONE test, and it is the right one: does any import that has not been
      // undone still assert this person is coming?
      //
      // Matching on which import inserted the row instead — the attendance
      // upsert stamps created_at only on insert, so it is knowable — looks
      // equivalent and is wrong in both directions. Undoing the re-run would
      // withdraw nothing (right) but undoing the FIRST run would delete the
      // only row while the re-run still asserted it (wrong), and then the
      // re-run's own undo could never reach it because the row it was looking
      // for no longer matched. A row survives exactly as long as something
      // still claims it, whoever inserted it.
      statements.push(context.env.DB.prepare(
        `DELETE FROM event_attendances
          WHERE event_id = ? AND source = 'import'
            AND person_id IN (
              SELECT target_id FROM import_rows
               WHERE import_id = ? AND entity = 'person' AND target_id IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM import_rows other
                JOIN imports live ON live.id = other.import_id
               WHERE other.target_id = event_attendances.person_id
                 AND other.entity = 'person'
                 AND live.id <> ?
                 AND live.status <> 'undone'
                 AND live.undone_at IS NULL
                 AND json_extract(live.mapping, '$.attendance_event_id') = ?
            )`,
      ).bind(attendanceEventId, importId, importId, attendanceEventId));
    }

    // The seat, withdrawn on exactly the same terms as the attendance above:
    // one statement, and only while no other live import still seats this
    // person here. `role = 'speaker'` is what this import wrote; a seat someone
    // earned another way — the acceptance cascade, an organizer typing them in
    // as a moderator — is not this import's to take away.
    let rosterIndex = -1;
    if (rosterEventId) {
      rosterIndex = statements.length;
      statements.push(context.env.DB.prepare(
        `DELETE FROM memberships
          WHERE event_id = ? AND role = 'speaker'
            AND person_id IN (
              SELECT target_id FROM import_rows
               WHERE import_id = ? AND entity = 'person' AND target_id IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM import_rows other
                JOIN imports live ON live.id = other.import_id
               WHERE other.target_id = memberships.person_id
                 AND other.entity = 'person'
                 AND live.id <> ?
                 AND live.status <> 'undone'
                 AND live.undone_at IS NULL
                 AND json_extract(live.mapping, '$.roster_event_id') = ?
            )`,
      ).bind(rosterEventId, importId, importId, rosterEventId));
    }

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
      //
      // The attendance row this same import wrote is excluded by name — it is
      // queued for deletion a few lines below, in the same batch and before the
      // person delete, so by execution time it is gone. Counting it would make
      // every attendee import permanently un-undoable, which is precisely the
      // shape of the bug this exclusion exists to prevent. Attendances at any
      // OTHER conference, and claim rows anywhere, still block.
      const importReferenceCount = await context.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM import_rows WHERE target_id = ? AND entity IN ('person', 'speaker') AND import_id <> ?",
      ).bind(row.target_id, importId).first<{ n: number }>();
      const references = (await personHasReferences(context.env.DB, row.target_id))
        .filter((label) => label !== "event_attendances" || !attendanceEventId)
        .filter((label) => label !== "memberships" || !rosterEventId)
        .filter((label) => label !== "import_rows.target_id" || Number(importReferenceCount?.n ?? 0) > 0);
      const strandedAttendance = attendanceEventId
        ? await context.env.DB.prepare(
            `SELECT COUNT(*) AS n FROM event_attendances
              WHERE person_id = ? AND NOT (event_id = ? AND source = 'import')`,
          ).bind(row.target_id, attendanceEventId).first<{ n: number }>()
        : null;
      if (Number(strandedAttendance?.n ?? 0) > 0) references.push("event_attendances");
      // The seat this import wrote is deleted in the same batch, above; any
      // other seat is somebody else's record and still blocks the delete.
      const strandedMembership = rosterEventId
        ? await context.env.DB.prepare(
            `SELECT COUNT(*) AS n FROM memberships
              WHERE person_id = ? AND NOT (event_id = ? AND role = 'speaker')`,
          ).bind(row.target_id, rosterEventId).first<{ n: number }>()
        : null;
      if (Number(strandedMembership?.n ?? 0) > 0) references.push("memberships");
      if (references.length > 0) {
        addSkip(row, { target_id: row.target_id, reason: "has_references", fields: [], references });
        continue;
      }
      // Keep the manifest row, but clear its live polymorphic target before
      // the guarded person delete. A receipt is historical; it must not become
      // the last reference that makes its own undo impossible.
      statements.push(context.env.DB.prepare(
        "UPDATE import_rows SET target_id = NULL, updated_at = ? WHERE import_id = ? AND row_index = ? AND target_id = ?",
      ).bind(now, importId, row.row_index, row.target_id));
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
    const changed = (operation: { resultIndex: number }): boolean =>
      Number(results[operation.resultIndex]?.meta?.changes ?? 0) > 0;
    const undone = operations.filter(changed).length;
    attendancesRemoved = attendanceIndex >= 0 ? Number(results[attendanceIndex]?.meta?.changes ?? 0) : 0;
    return context.json({
      undone,
      attendances_removed: attendancesRemoved,
      roster_placements_removed: rosterIndex >= 0 ? Number(results[rosterIndex]?.meta?.changes ?? 0) : 0,
      skipped: skippedRows.length,
      skipped_rows: skippedRows,
      retained_manifest: true,
    }, 200);
  },
);

export const apiRoutes = [importPeople, undoPeopleImport];
