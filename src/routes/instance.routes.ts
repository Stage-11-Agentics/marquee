import { z } from "@hono/zod-openapi";

import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { requireOrgAdmin } from "../lib/auth/org-admin";
import { readMirrorStatus, type MirrorActionEnvironment } from "../jobs/mirror/actions";
import {
  instanceHostname,
  readInstanceStatus,
  type InstanceStatusEnvironment,
} from "../lib/instance-status";

/**
 * The machine under the conference, read honestly.
 *
 * Every row is derived on the request from a binding and a secret; nothing is
 * cached, stored, or remembered, because a remembered "mail is configured" is
 * the field that starts lying the day someone rotates a key (AC-284).
 */

const statusRow = z.object({
  key: z.enum(["mail", "uploads", "spam", "domain", "airtable"]),
  label: z.string(),
  configured: z.boolean(),
  note: z.string(),
  fix: z.array(z.string()),
  sender: z.string().nullable().optional(),
  account: z.string().nullable().optional(),
});

const instanceStatusResponse = z.object({
  data: z.object({
    host: z.string(),
    rows: z.array(statusRow),
  }),
});

const getInstanceStatus = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/instance/status",
    operationId: "getInstanceStatus",
    summary: "Read what is configured on this deployment, and what honestly is not",
    description:
      "Mail, uploads, spam protection, and domain, each derived from real binding and secret presence rather than from a stored flag. Rows always appear in the same order whether configured or not.",
    tags: ["Setup"],
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: jsonResponse(instanceStatusResponse, "The instance panel"),
      ...errorResponses([401, 403, 429, 500]),
    },
  },
  async (context) => {
    const auth = requireOrgAdmin(context, "program:read");
    const environment = context.env as unknown as InstanceStatusEnvironment;
    const mirrorEnvironment = context.env as unknown as MirrorActionEnvironment;
    let mirror = {
      configured: false,
      mapped: false,
      note: "No Airtable base is connected",
    };
    try {
      const status = await readMirrorStatus(context.env.DB, mirrorEnvironment, auth.orgId);
      mirror = {
        configured: status.configured,
        mapped: status.mapped,
        note: status.configured
          ? status.mapped
            ? "Connected · three tables mirror local records"
            : "Base verified · choose the three tables to start syncing"
          : "No Airtable base is connected",
      };
    } catch {
      // A deployment that has not yet applied the additive mirror migration
      // should still answer the rest of the Server panel honestly.
    }
    context.header("Cache-Control", "no-store");
    return context.json(
      {
        data: {
          host: instanceHostname(context.req.url),
          rows: [
            ...readInstanceStatus(environment, context.req.url),
            {
              key: "airtable" as const,
              label: "Airtable mirror",
              configured: mirror.configured && mirror.mapped,
              note: mirror.note,
              fix: ["Open Settings → Airtable"],
            },
          ],
        },
      },
      200,
    );
  },
);

export const apiRoutes = [getInstanceStatus];
