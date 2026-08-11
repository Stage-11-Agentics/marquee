import type { D1Database } from "@cloudflare/workers-types";

import type { Id } from "../../db/schema";
import { enqueueOutbox, type EnqueuedOutbox } from "./outbox";
import { selectPreCloseReminderCandidates } from "./schedule";
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
  idempotencyKey?: string;
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

/**
 * AC-127's hourly scheduler: return only the outbox results created by this
 * scan. The consumer uses these IDs for its queue handoff instead of
 * re-querying by timestamp and accidentally including an unrelated row.
 */
export async function enqueuePreCloseReminderRows(db: D1Database, now = Date.now()): Promise<EnqueuedOutbox[]> {
  const rows: EnqueuedOutbox[] = [];
  for (const row of await selectPreCloseReminderCandidates(db, now)) {
    const result = await enqueueTrigger({
      db,
      eventId: row.eventId,
      templateKey: row.templateKey,
      entityId: row.entityId,
      personId: row.personId,
      toEmail: row.toEmail,
      data: row.data,
      now,
    });
    if (result) rows.push(result);
  }
  return rows;
}

/** AC-127's count-oriented API; repeat scans remain UNIQUE-key idempotent. */
export async function enqueuePreCloseReminders(db: D1Database, now = Date.now()): Promise<number> {
  const rows = await enqueuePreCloseReminderRows(db, now);
  return rows.filter((row) => row.inserted).length;
}

export function isMailTemplateKey(value: string): value is MailTemplateKey {
  return [...TRIGGER_TEMPLATE_KEYS].includes(value as TriggerKey);
}
