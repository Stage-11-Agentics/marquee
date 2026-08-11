import type { D1Database } from "@cloudflare/workers-types";

import type { Id } from "../../db/schema";
import { enqueueOutbox, type EnqueuedOutbox } from "./outbox";
import { findTemplate, TRIGGER_TEMPLATE_KEYS, type MailTemplateKey } from "./templates";
import type { MergeData } from "./render";

export type TriggerKey = (typeof TRIGGER_TEMPLATE_KEYS)[number];

export interface TriggerInput {
  db: D1Database;
  eventId: Id;
  templateKey: TriggerKey;
  entityId: Id;
  personId: Id;
  toEmail: string;
  data?: MergeData;
  scheduledFor?: number | null;
  now?: number;
  icsUid?: string | null;
  icsBody?: string | null;
}

/** Every automated trigger follows the same enabled-template and outbox path. */
export async function enqueueTrigger(input: TriggerInput): Promise<EnqueuedOutbox | null> {
  const template = await findTemplate(input.db, input.eventId, input.templateKey);
  if (template.enabled !== 1) return null;
  return enqueueOutbox(input);
}

export async function enqueueBulkReminder(input: {
  db: D1Database;
  eventId: Id;
  templateKey?: MailTemplateKey;
  recipients: Array<{
    entityId: Id;
    personId: Id;
    toEmail: string;
    data?: MergeData;
  }>;
  subject?: string;
  body?: string;
  now?: number;
}): Promise<EnqueuedOutbox[]> {
  const templateKey = input.templateKey ?? "reminder_generic";
  const result: EnqueuedOutbox[] = [];
  for (const recipient of input.recipients) {
    result.push(
      await enqueueOutbox({
        db: input.db,
        eventId: input.eventId,
        templateKey,
        entityId: recipient.entityId,
        personId: recipient.personId,
        toEmail: recipient.toEmail,
        data: recipient.data,
        subject: input.subject,
        body: input.body,
        now: input.now,
      }),
    );
  }
  return result;
}

/** AC-127's hourly scheduler: only eligible, enabled forms are enqueued. */
export async function enqueuePreCloseReminders(db: D1Database, now = Date.now()): Promise<number> {
  const forms = await db
    .prepare(
      `SELECT f.id, f.event_id, f.closes_at, f.reminder_offset_hours,
              p.id AS person_id, p.email, p.name
       FROM forms f
       JOIN submissions s ON s.form_id = f.id
       JOIN participations part ON part.submission_id = s.id AND part.role IN ('speaker', 'submitter')
       JOIN people p ON p.id = part.person_id
       WHERE f.status = 'open'
         AND f.reminder_offset_hours IS NOT NULL
         AND f.closes_at IS NOT NULL
         AND ? >= (f.closes_at - f.reminder_offset_hours * 3600000)
         AND ? < f.closes_at`,
    )
    .bind(now, now)
    .all<{ id: Id; event_id: Id; closes_at: number; person_id: Id; email: string; name: string }>();

  let count = 0;
  for (const row of forms.results) {
    const result = await enqueueTrigger({
      db,
      eventId: row.event_id,
      templateKey: "form_closing_reminder",
      entityId: row.id,
      personId: row.person_id,
      toEmail: row.email,
      data: {
        "speaker.first_name": row.name.trim().split(/\s+/)[0] ?? row.name,
        "form.closes_at": new Date(row.closes_at).toISOString(),
      },
      now,
    });
    if (result?.inserted) count += 1;
  }
  return count;
}

export function isMailTemplateKey(value: string): value is MailTemplateKey {
  return [...TRIGGER_TEMPLATE_KEYS].includes(value as TriggerKey);
}
