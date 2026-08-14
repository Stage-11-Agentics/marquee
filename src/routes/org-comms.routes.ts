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
import { enqueueMailMessage } from "../jobs/mail/consumer";
import { mergeDataForRecipient } from "../jobs/mail/merge-data";
import { renderAdHocMail } from "../jobs/mail/render";
import type { MailTemplateKey } from "../jobs/mail/templates";
import { enqueueBulkReminder } from "../jobs/mail/triggers";
import { orgAttributionEventId, requireOrgAccess } from "../lib/auth/org-access";
import { mergeFieldErrorMessage, unknownMergeFields } from "../lib/mail-merge-fields";

const audienceSchema = z.object({
  person_ids: z.array(z.string().min(1)).min(1).max(500).optional(),
  list_id: z.string().min(1).optional(),
});

interface RecipientPerson {
  id: string;
  name: string;
  email: string;
  company: string | null;
}

/**
 * The people a send addresses: an explicit selection, or every member of a
 * Fixed list. Always filtered through the org, so an id from elsewhere resolves
 * to nobody rather than to a stranger's inbox.
 */
async function audienceFor(
  db: D1Database,
  orgId: string,
  audience: z.infer<typeof audienceSchema>,
): Promise<RecipientPerson[]> {
  if (audience.person_ids && audience.person_ids.length > 0) {
    // One binding for the whole selection, the way the conference-scoped
    // selector already does it: a placeholder per id would put a 500-person
    // send straight through D1's binding cap.
    const rows = await db
      .prepare(
        `SELECT id, name, email, company FROM people
         WHERE org_id = ? AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
         ORDER BY name COLLATE NOCASE, id`,
      )
      .bind(orgId, JSON.stringify([...new Set(audience.person_ids)]))
      .all<RecipientPerson>();
    return rows.results;
  }
  if (audience.list_id) {
    const rows = await db
      .prepare(
        `SELECT person.id, person.name, person.email, person.company
         FROM person_list_members member
         JOIN people person ON person.id = member.person_id
         JOIN person_lists saved ON saved.id = member.list_id
         WHERE member.list_id = ? AND saved.org_id = ? AND person.org_id = ?
         ORDER BY person.name COLLATE NOCASE, person.id`,
      )
      .bind(audience.list_id, orgId, orgId)
      .all<RecipientPerson>();
    return rows.results;
  }
  throw ApiError.badRequest("a send needs person_ids or a list_id", "person_ids");
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
            schema: audienceSchema.extend({
              subject: z.string().trim().min(1).max(300),
              body: z.string().trim().min(1).max(20000),
            }),
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
        }),
        "Rendered preview",
      ),
      ...errorResponses([400, 401, 403, 404, 429, 500]),
    },
  },
  async (context) => {
    const access = requireOrgAccess(context);
    const body = context.req.valid("json");
    const people = await audienceFor(context.env.DB, access.orgId, body);
    const first = people[0];
    if (!first) throw ApiError.notFound("that selection resolves to nobody in this organization");
    const rendered = renderAdHocMail(body.subject, body.body, mergeDataFor(first));
    return context.json({ ...rendered, to_email: first.email, recipients: people.length }, 200);
  },
);

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
      body: {
        content: {
          "application/json": {
            schema: audienceSchema.extend({
              subject: z.string().trim().min(1).max(300),
              body: z.string().trim().min(1).max(20000),
            }),
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
          outbox_ids: z.array(z.string()),
        }),
        "Messages queued",
      ),
      ...errorResponses([400, 401, 403, 404, 429, 500]),
    },
  },
  async (context) => {
    const access = requireOrgAccess(context, true);
    const body = context.req.valid("json");
    const unknown = unknownMergeFields(body.subject, body.body);
    if (unknown.length > 0) throw ApiError.badRequest(mergeFieldErrorMessage(unknown), "template");
    const people = await audienceFor(context.env.DB, access.orgId, body);
    if (people.length === 0) throw ApiError.notFound("that selection resolves to nobody in this organization");
    const eventId = await orgAttributionEventId(context.env.DB, access.orgId);
    const queued = await enqueueBulkReminder({
      db: context.env.DB,
      eventId,
      // Same ad-hoc key the conference-scoped send uses for a typed message.
      templateKey: "custom" as MailTemplateKey,
      recipients: people.map((person) => ({
        entityId: person.id,
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
        await enqueueMailMessage(context.env.MAIL_QUEUE, item.id);
      } else {
        duplicate += 1;
      }
    }
    return context.json({ selected: people.length, queued: outboxIds.length, duplicate, outbox_ids: outboxIds }, 202);
  },
);

export const apiRoutes = [previewOrgMail, sendOrgMail];
