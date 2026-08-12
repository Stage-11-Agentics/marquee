import { z } from "@hono/zod-openapi";

import { createListQuerySchema, createListResponseSchema } from "../api/list";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { SUBMISSION_LIST_STATUSES } from "../api/submissions";
import { requireDraftRead, requireSubmissionRead } from "../lib/auth/program-access";
import {
  listSubmissions,
  SUBMISSION_SORTS,
  submissionFilterSchema,
} from "./submissions.queries";

const submissionListItemStatusSchema = z.enum(SUBMISSION_LIST_STATUSES);
const submissionTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  is_primary: z.boolean(),
});
const submissionSpeakerSchema = z.object({
  id: z.string(),
  name: z.string(),
  company: z.string().nullable(),
});
const submissionSubmitterSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});
const submissionSlotSchema = z.object({
  starts_at: z.number().int(),
  duration_min: z.number().int().positive(),
  room: z.string(),
  building: z.string(),
  timezone: z.string(),
  is_published: z.boolean(),
  show_building: z.boolean(),
});
const submissionNotificationSchema = z.object({
  state: z.enum(["sent", "changed_in_airtable", "not_delivered", "no_valid_address"]),
  label: z.string(),
  detail: z.string(),
  sent_at: z.number().int().nullable(),
  outbox_status: z.enum(["queued", "sent", "suppressed", "failed"]).nullable(),
});
const submissionListItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["abstract", "session"]),
  title: z.string(),
  status: submissionListItemStatusSchema,
  format_id: z.string().nullable(),
  format: z.string().nullable(),
  speakers: z.array(submissionSpeakerSchema),
  tracks: z.array(submissionTrackSchema),
  score: z.number().nullable(),
  submitted_at: z.number().int().nullable(),
  last_saved_at: z.number().int().nullable(),
  updated_at: z.number().int(),
  origin: z.enum(["public", "admin", "import"]),
  missing_fields: z.array(z.string()),
  submitter: submissionSubmitterSchema.nullable(),
  slot: submissionSlotSchema.nullable(),
  notified: submissionNotificationSchema.nullable(),
}).openapi("SubmissionListItem");

export const submissionListQuerySchema = createListQuerySchema(
  submissionFilterSchema.shape,
  Object.keys(SUBMISSION_SORTS) as [keyof typeof SUBMISSION_SORTS, ...(keyof typeof SUBMISSION_SORTS)[]],
  { defaultSort: "newest" },
);

const listEventSubmissions = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/submissions",
    operationId: "listEventSubmissions",
    summary: "List conference submissions",
    description: "Server-filtered, sorted, and deterministically paginated Abstracts and Sessions.",
    tags: ["Submissions"],
    policy: {
      auth: { kind: "authenticated" },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    request: {
      params: z.object({ eventId: z.string().min(1) }),
      query: submissionListQuerySchema,
    },
    responses: {
      200: jsonResponse(createListResponseSchema(submissionListItemSchema, "Submission"), "Matching submissions"),
      ...errorResponses([400, 401, 403, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const query = context.req.valid("query");
    if (query.status === "draft") await requireDraftRead(context, eventId);
    else await requireSubmissionRead(context, eventId);
    const result = await listSubmissions(context.env.DB, { eventId, ...query });
    return context.json(result, 200);
  },
);

export const apiRoutes = [listEventSubmissions];
