import { z } from "@hono/zod-openapi";

import { createListQuerySchema, createListResponseSchema } from "../api/list";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import {
  listSubmissions,
  SUBMISSION_SORTS,
  SUBMISSION_STATUS_FILTERS,
} from "./submissions.queries";

const submissionStatusSchema = z.enum(SUBMISSION_STATUS_FILTERS);
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
const submissionSlotSchema = z.object({
  starts_at: z.number().int(),
  duration_min: z.number().int().positive(),
  room: z.string(),
  building: z.string(),
  timezone: z.string(),
  is_published: z.boolean(),
});
const submissionListItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["abstract", "session"]),
  title: z.string(),
  status: submissionStatusSchema,
  format: z.string().nullable(),
  speakers: z.array(submissionSpeakerSchema),
  tracks: z.array(submissionTrackSchema),
  score: z.number().nullable(),
  submitted_at: z.number().int().nullable(),
  updated_at: z.number().int(),
  origin: z.enum(["public", "admin", "import"]),
  missing_fields: z.array(z.string()),
  slot: submissionSlotSchema.nullable(),
}).openapi("SubmissionListItem");

const submissionListQuerySchema = createListQuerySchema(
  {
    kind: z.enum(["abstract", "session"]).optional(),
    status: submissionStatusSchema.optional(),
    track: z.string().min(1).max(100).optional(),
  },
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
      // TODO(MRQ-60): SPEC scopes this to authenticated admin; public only
      // until the credential resolver lands.
      auth: { kind: "public" },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    request: {
      params: z.object({ eventId: z.string().min(1) }),
      query: submissionListQuerySchema,
    },
    responses: {
      200: jsonResponse(createListResponseSchema(submissionListItemSchema, "Submission"), "Matching submissions"),
      ...errorResponses([400, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const query = context.req.valid("query");
    const result = await listSubmissions(context.env.DB, { eventId, ...query });
    return context.json(result, 200);
  },
);

export const apiRoutes = [listEventSubmissions];
