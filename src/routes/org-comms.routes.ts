/**
 * Email a selection of people from People.
 *
 * This is an ENTRY POINT, not a second mail path. The render, the merge tags,
 * the outbox row, the demo-safe suppression, and the queue are all the ones
 * `/comms/send` already uses — `enqueueBulkReminder` → `outbox` →
 * `enqueueMailMessage`, unchanged.
 *
 * What it does own is the audience. The conference-scoped selector resolves
 * recipients through `memberships`/`participations` for one event, so it cannot
 * address someone the organization knows who has no membership in that
 * conference — which is most of People. So the audience is resolved here,
 * org-scoped, and then handed to the existing path.
 *
 * The outbox row carries an `event_id` because the column is NOT NULL; it is the
 * organization's conference, resolved in one documented place
 * (`orgAttributionEventId`).
 */
import { z } from "@hono/zod-openapi";

import { ApiError } from "../api/errors";
import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { IDEMPOTENCY_REGISTRY } from "../jobs/mail/idempotency";
import { mergeDataForRecipient } from "../jobs/mail/merge-data";
import { renderAdHocMail } from "../jobs/mail/render";
import type { MailTemplateKey } from "../jobs/mail/templates";
import { enqueueBulkReminder } from "../jobs/mail/triggers";
import { orgAttributionEventId, requireOrgAccess } from "../lib/auth/org-access";
import { mergeFieldErrorMessage, unknownMergeFieldsForCommunication } from "../lib/mail-merge-fields";
import { claimRequestOperation, completeRequestOperation, dispatchRequestOperationNow, linkRequestOperationOutbox, markRequestOperationDispatchPending } from "../lib/request-operations";

const audienceFieldsSchema = z.object({
  person_ids: z.array(z.string().trim().min(1)).min(1).max(500).optional(),
  list_id: z.string().trim().min(1).optional(),
}).strict();
type AudienceShape = z.infer<typeof audienceFieldsSchema>;
const audienceSchema = audienceFieldsSchema.superRefine((audience: AudienceShape, context: z.RefinementCtx) => {
  if ((audience.person_ids !== undefined) === (audience.list_id !== undefined)) {
    context.addIssue({ code: "custom", message: "audience must carry exactly one of person_ids or list_id", path: [] });
  }
});
const audienceComposeSchema = audienceFieldsSchema.extend({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
}).superRefine((audience: AudienceShape, context: z.RefinementCtx) => {
  if ((audience.person_ids !== undefined) === (audience.list_id !== undefined)) {
    context.addIssue({ code: "custom", message: "audience must carry exactly one of person_ids or list_id", path: [] });
  }
});
const idempotencyKeyHeaders = z.object({
  "idempotency-key": z.string().trim().min(1).max(200).optional()
    .describe("Durable key for retrying one ad-hoc compose; omit for a new nudge."),
});

interface RecipientPerson {
  id: string;
  name: string;
  email: string;
  company: string | null;
  do_not_contact: number;
}

interface Audience {
  people: RecipientPerson[];
  excluded_people: string[];
  skipped: Array<{ person_id: string; name: string; reason: string }>;
}

function hasUsableEmail(person: RecipientPerson): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email.trim());
}

/**
 * The people a send addresses: an explicit selection, or every member of a
 * Fixed list. Always filtered through the org, so an id from elsewhere resolves
 * to nobody rather than to a stranger's inbox.
 */
async function audienceFor(
  db: D1Database,
  orgId: string,
  audience: AudienceShape,
): Promise<Audience> {
  let people: RecipientPerson[];
  let skipped: Audience["skipped"] = [];
  if (audience.person_ids && audience.person_ids.length > 0) {
    // One binding for the whole selection, the way the conference-scoped
    // selector already does it: a placeholder per id would put a 500-person
    // send straight through D1's binding cap.
    const selectedPersonIds = [...new Set(audience.person_ids as readonly string[])];
    const rows = await db
      .prepare(
        `SELECT id, name, email, company, do_not_contact FROM people
         WHERE org_id = ? AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
         ORDER BY name COLLATE NOCASE, id`,
      )
      .bind(orgId, JSON.stringify(selectedPersonIds))
      .all<RecipientPerson>();
    people = rows.results;
    const found = new Set(people.map((person) => person.id));
    skipped = selectedPersonIds
      .filter((personId) => !found.has(personId))
      .map((personId) => ({
        person_id: personId,
        name: personId,
        reason: "person was not found in this organization",
      }));
  } else if (audience.list_id) {
    const rows = await db
      .prepare(
        `SELECT DISTINCT person.id, person.name, person.email, person.company, person.do_not_contact
         FROM person_list_members member
         JOIN people person ON person.id = member.person_id
         JOIN person_lists saved ON saved.id = member.list_id
         WHERE member.list_id = ? AND saved.org_id = ? AND person.org_id = ?
         ORDER BY person.name COLLATE NOCASE, person.id`,
      )
      .bind(audience.list_id, orgId, orgId)
      .all<RecipientPerson>();
    people = rows.results;
  } else {
    throw ApiError.badRequest("a send needs person_ids or a list_id", "person_ids");
  }
  return {
    people: people.filter((person) => Number(person.do_not_contact) !== 1),
    excluded_people: people.filter((person) => Number(person.do_not_contact) === 1).map((person) => person.name),
    skipped,
  };
}

function mergeDataFor(person: RecipientPerson) {
  return mergeDataForRecipient({
    name: person.name,
    email: person.email,
  });
}

const previewOrgMail = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/comms/preview",
    operationId: "previewOrgCommunication",
    summary: "Render one recipient's message with the merge tags resolved",
    description: "Shows recipient 1 of the selection exactly as it will be sent.",
    tags: ["People"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: audienceComposeSchema,
          },
        },
      },
    },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "read" }, concurrency: "none" },
    responses: {
      200: jsonResponse(
        z.object({
          to_email: z.string(),
          subject: z.string(),
          text: z.string(),
          html: z.string(),
          recipients: z.number().int(),
          excluded_people: z.array(z.string()),
          skipped: z.array(z.object({ person_id: z.string(), name: z.string(), reason: z.string() })),
        }),
        "Rendered preview",
      ),
      ...errorResponses([400, 401, 403, 404, 429, 500]),
    },
  },
  async (context) => {
    const access = requireOrgAccess(context);
    const body = context.req.valid("json");
    const audience = await audienceFor(context.env.DB, access.orgId, body);
    if (audience.people.length === 0 && audience.excluded_people.length === 0) {
      throw ApiError.notFound("that selection resolves to nobody in this organization");
    }
    const sendablePeople = audience.people.filter(hasUsableEmail);
    const first = sendablePeople[0];
    const rendered = first ? renderAdHocMail(body.subject, body.body, mergeDataFor(first)) : { text: "", html: "" };
    return context.json({
      ...rendered,
      to_email: first?.email ?? "",
      subject: body.subject,
      recipients: sendablePeople.length,
      excluded_people: audience.excluded_people,
      skipped: audience.skipped,
    }, 200);
  },
);

const operationResponseSchema = z.object({
  operation_id: z.string(),
  effect: z.enum(["changed", "no_op"]),
  reason_code: z.string().nullable(),
  notice: z.string().nullable(),
  duplicate_skipped: z.number().int().nonnegative(),
  dispatch_state: z.enum(["not_required", "pending", "dispatched"]),
});

const sendOrgMail = defineApiRoute(
  {
    method: "post",
    path: "/api/v1/org/comms/send",
    operationId: "sendOrgCommunication",
    summary: "Email a selection of people",
    description:
      "Queues through the same outbox, suppression, and delivery log as every other message the product sends; every send is logged per recipient.",
    tags: ["People"],
    request: {
      headers: idempotencyKeyHeaders,
      body: {
        content: {
          "application/json": {
            schema: audienceComposeSchema,
          },
        },
      },
    },
    policy: { auth: { kind: "authenticated" }, rateLimit: { bucket: "write" }, concurrency: "none" },
    responses: {
      202: jsonResponse(
        z.object({
          selected: z.number().int(),
          queued: z.number().int(),
          duplicate: z.number().int(),
          duplicate_skipped: z.number().int().nonnegative(),
          outbox_ids: z.array(z.string()),
          excluded_people: z.array(z.string()),
          skipped: z.array(z.object({ person_id: z.string(), name: z.string(), reason: z.string() })),
          operation: operationResponseSchema,
        }),
        "Messages queued",
      ),
      ...errorResponses([400, 401, 403, 404, 429, 500, 503]),
    },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const body = context.req.valid("json");
    const duplicateSkipped = body.person_ids
      ? body.person_ids.length - new Set(body.person_ids).size
      : 0;
    const unknown = unknownMergeFieldsForCommunication(body.subject, body.body);
    if (unknown.length > 0) throw ApiError.badRequest(mergeFieldErrorMessage(unknown), "template");
    const requestId = context.get("requestId") ?? crypto.randomUUID();
    const operation = await claimRequestOperation({
      db: context.env.DB,
      scope: { kind: "org", organizationId: access.orgId },
      route: "org.comms.send",
      idempotencyKey: context.req.header("Idempotency-Key"),
      requestId,
      actorKind: access.kind === "session" ? "user" : "api_token",
      actorPersonId: access.personId,
      request: body,
    });
    if (operation.replay) return context.json(operation.replay.body, operation.replay.status as 202);
    const audience = await audienceFor(context.env.DB, access.orgId, body);
    if (audience.people.length === 0 && audience.excluded_people.length === 0) {
      const operationResponse = {
        operation_id: operation.operationId,
        effect: "no_op" as const,
        reason_code: "NO_VALID_RECIPIENT",
        notice: "Nothing changed — that selection resolves to nobody in this organization",
        duplicate_skipped: duplicateSkipped,
        dispatch_state: "not_required" as const,
      };
      const error = new ApiError("not_found", "that selection resolves to nobody in this organization", {
        details: { operation: operationResponse, skipped: audience.skipped },
      });
      const errorBody = error.toEnvelope(requestId);
      await completeRequestOperation(context.env.DB, operation.operationId, 404, errorBody, { claimToken: operation.claimToken });
      throw error;
    }
    const invalidAddress = audience.people
      .filter((person) => !hasUsableEmail(person))
      .map((person) => ({ person_id: person.id, name: person.name, reason: "no valid email address on file" }));
    const skipped = [...audience.skipped, ...invalidAddress];
    const sendablePeople = audience.people.filter(hasUsableEmail);
    if (sendablePeople.length === 0) {
      const response = {
        selected: audience.people.length,
        queued: 0,
        duplicate: 0,
        duplicate_skipped: duplicateSkipped,
        outbox_ids: [],
        excluded_people: audience.excluded_people,
        skipped,
        operation: {
          operation_id: operation.operationId,
          effect: "no_op" as const,
          reason_code: "NO_VALID_RECIPIENT",
          notice: "Nothing changed — no selected person has a valid address",
          duplicate_skipped: duplicateSkipped,
          dispatch_state: "not_required" as const,
        },
      };
      await completeRequestOperation(context.env.DB, operation.operationId, 202, response, { claimToken: operation.claimToken });
      return context.json(response, 202);
    }
    const eventId = await orgAttributionEventId(context.env.DB, access.orgId);
    const queued = await enqueueBulkReminder({
      db: context.env.DB,
      eventId,
      // Same ad-hoc key the conference-scoped send uses for a typed message.
      templateKey: "custom" as MailTemplateKey,
      sendId: context.req.header("Idempotency-Key")?.trim() || crypto.randomUUID(),
      recipients: sendablePeople.map((person) => ({
        entityId: IDEMPOTENCY_REGISTRY.customRecipient(person.id),
        personId: person.id,
        toEmail: person.email,
        data: mergeDataFor(person),
      })),
      subject: body.subject,
      body: body.body,
    });
    const outboxIds: string[] = [];
    let duplicate = 0;
    for (const item of queued) {
      if (item.inserted) {
        outboxIds.push(item.id);
      } else {
        duplicate += 1;
      }
    }
    await linkRequestOperationOutbox(context.env.DB, operation.operationId, outboxIds);
    const pendingResponse = {
      selected: audience.people.length,
      queued: outboxIds.length,
      duplicate,
      duplicate_skipped: duplicateSkipped,
      outbox_ids: outboxIds,
      excluded_people: audience.excluded_people,
      skipped,
      operation: {
        operation_id: operation.operationId,
        effect: outboxIds.length > 0 ? "changed" as const : "no_op" as const,
        reason_code: outboxIds.length > 0 ? null : "DUPLICATE_SKIPPED",
        notice: outboxIds.length > 0 ? `Queued ${outboxIds.length} message${outboxIds.length === 1 ? "" : "s"}` : "Nothing changed — every selected person was already queued",
        duplicate_skipped: duplicateSkipped,
        dispatch_state: outboxIds.length > 0 ? "pending" as const : "not_required" as const,
      },
    };
    if (outboxIds.length > 0) {
      const dispatchAdmitted = await markRequestOperationDispatchPending(context.env.DB, operation.operationId, 202, pendingResponse, outboxIds, { claimToken: operation.claimToken });
      if (!dispatchAdmitted) throw ApiError.conflict("the operation claim was reclaimed before mail dispatch", { code: "operation_in_flight", operation_id: operation.operationId });
      await dispatchRequestOperationNow(context.env.DB, context.env.MAIL_QUEUE, operation.operationId, outboxIds);
    }
    const response = {
      ...pendingResponse,
      operation: {
        ...pendingResponse.operation,
        dispatch_state: outboxIds.length > 0 ? "dispatched" as const : "not_required" as const,
      },
    };
    await completeRequestOperation(context.env.DB, operation.operationId, 202, response, { outboxIds, claimToken: operation.claimToken, dispatchClaimToken: operation.operationId });
    return context.json(response, 202);
  },
);

export const apiRoutes = [previewOrgMail, sendOrgMail];
