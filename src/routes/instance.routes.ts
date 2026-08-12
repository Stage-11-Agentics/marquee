import { z } from "@hono/zod-openapi";

import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { requireOrgAdmin } from "../lib/auth/org-admin";
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
  key: z.enum(["mail", "uploads", "spam", "domain"]),
  label: z.string(),
  configured: z.boolean(),
  note: z.string(),
  fix: z.array(z.string()),
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
    requireOrgAdmin(context, "program:read");
    const environment = context.env as unknown as InstanceStatusEnvironment;
    context.header("Cache-Control", "no-store");
    return context.json(
      {
        data: {
          host: instanceHostname(context.req.url),
          rows: readInstanceStatus(environment, context.req.url),
        },
      },
      200,
    );
  },
);

export const apiRoutes = [getInstanceStatus];
