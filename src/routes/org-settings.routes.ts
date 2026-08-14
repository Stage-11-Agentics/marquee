import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import type { OrganizationRow } from "../db/schema";
import { requireOrgAdmin } from "../lib/auth/org-admin";
import { THEME_IDS } from "../lib/theme-registry";

/**
 * The organization as a record rather than a name (ruling O7).
 *
 * A conference is a season; the organization is the thing that runs them. So
 * the values a new season should start from — the timezone the venue is
 * actually in, the appearance the team already agreed on, the voice mail speaks
 * in, the mark it wears — belong here, and each conference inherits them at
 * creation and then owns its copy. Inheritance happens once, at create: an
 * organization that changes its default timezone in March must not silently
 * move a conference someone already scheduled.
 *
 * Every field is nullable and null means "this organization has not said". That
 * distinction is load-bearing rather than tidy: an unset default follows the
 * product when the product changes its mind, a set one does not, and collapsing
 * the two would pin every silent organization to whatever today's default
 * happens to be.
 */

const orgSettings = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  default_timezone: z.string().nullable(),
  default_theme: z.string().nullable(),
  comms_from_name: z.string().nullable(),
  comms_reply_to: z.string().nullable(),
  logo_key: z.string().nullable(),
  accent: z.string().nullable(),
});
const orgSettingsResponse = z.object({ data: orgSettings });

/**
 * Every field optional, and every one of them explicitly nullable: `null` is
 * how an organizer clears a default back to "we have not said", which is a
 * different act from never having set one and must stay expressible.
 */
const orgSettingsUpdate = z
  .object({
    name: z.string().trim().min(1).max(200),
    // Checked against the runtime's own tz database rather than a list we
    // maintain: an organization in a zone we forgot to enumerate is a real
    // organization, and a stale allowlist is how it gets told otherwise.
    default_timezone: z.string().trim().min(1).max(80).nullable(),
    default_theme: z.enum(THEME_IDS as unknown as [string, ...string[]]).nullable(),
    comms_from_name: z.string().trim().max(120).nullable(),
    comms_reply_to: z.string().trim().max(320).nullable(),
    logo_key: z.string().trim().max(500).nullable(),
    accent: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, "accent must be a six-digit hex colour")
      .nullable(),
  })
  .partial()
  .strict();

const settingsErrors = errorResponses([400, 401, 403, 404, 422, 429, 500]);

const ORG_COLUMNS =
  "id, name, slug, default_timezone, default_theme, comms_from_name, comms_reply_to, logo_key, accent";

/** The columns a PATCH may move, as literals. See the note at the UPDATE. */
const WRITABLE_FIELDS = [
  "name",
  "default_timezone",
  "default_theme",
  "comms_from_name",
  "comms_reply_to",
  "logo_key",
  "accent",
] as const satisfies readonly (keyof z.infer<typeof orgSettingsUpdate>)[];

/**
 * The instance's organization. `requireOrgAdmin` has already established that
 * the caller holds an organization-wide seat on it, so this reads by that id
 * rather than picking the first row — an instance may hold more than one
 * organization row, and the caller's own is the only correct answer.
 */
async function readOrganization(db: D1Database, orgId: string): Promise<OrganizationRow> {
  const row = await db
    .prepare(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = ?`)
    .bind(orgId)
    .first<OrganizationRow>();
  if (!row) throw ApiError.notFound("organization not found");
  return row;
}

const getOrgSettings = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/org/settings",
    operationId: "getOrgSettings",
    summary: "Read the organization's profile and the defaults new conferences inherit",
    description:
      "Visible to organization-wide organizers. Every default may be null, which means this organization has not expressed a preference — distinct from having chosen the value the product would have used anyway.",
    tags: ["Organization"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: { 200: jsonResponse(orgSettingsResponse, "The organization"), ...settingsErrors },
  },
  async (context) => {
    const auth = requireOrgAdmin(context, "program:read");
    return context.json({ data: await readOrganization(context.env.DB, auth.orgId) }, 200);
  },
);

const updateOrgSettings = defineApiRoute(
  {
    method: "patch",
    path: "/api/v1/org/settings",
    operationId: "updateOrgSettings",
    summary: "Set the organization's profile and defaults",
    description:
      "Only the fields present in the body move. Passing null clears a default back to unset. Changing a default never rewrites a conference that already inherited it.",
    tags: ["Organization"],
    request: { body: { content: { "application/json": { schema: orgSettingsUpdate } } } },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: { 200: jsonResponse(orgSettingsResponse, "The organization"), ...settingsErrors },
  },
  async (context) => {
    const auth = requireOrgAdmin(context);
    const patch = context.req.valid("json") as z.infer<typeof orgSettingsUpdate>;
    // These names are interpolated into SQL, so they are taken from a literal
    // allowlist rather than from the request — `.strict()` already rejects
    // unknown keys, but a column name built from client input is the kind of
    // thing that must be safe by construction and not by a validator two files
    // away staying strict forever.
    const fields = WRITABLE_FIELDS.filter((field) => field in patch);
    if (fields.length === 0) {
      return context.json({ data: await readOrganization(context.env.DB, auth.orgId) }, 200);
    }
    if (patch.default_timezone != null && !isKnownTimezone(patch.default_timezone)) {
      throw ApiError.unprocessable("that is not a known timezone", "default_timezone");
    }
    const now = Date.now();
    const assignments = fields.map((field) => `${field} = ?`).join(", ");
    await context.env.DB.prepare(
      `UPDATE organizations SET ${assignments}, updated_at = ? WHERE id = ?`,
    )
      .bind(...fields.map((field) => patch[field] ?? null), now, auth.orgId)
      .run();
    return context.json({ data: await readOrganization(context.env.DB, auth.orgId) }, 200);
  },
);

/**
 * The runtime's own tz database is the authority. `Intl` throws a RangeError on
 * an unknown zone, which is exactly the answer wanted — a typo'd default would
 * otherwise be discovered months later by a conference whose sessions are all
 * an hour out.
 */
function isKnownTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const apiRoutes = [getOrgSettings, updateOrgSettings];
