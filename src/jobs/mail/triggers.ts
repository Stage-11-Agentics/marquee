import type { D1Database } from "@cloudflare/workers-types";

import type { Id } from "../../db/schema";
import { mintMagicLink } from "../../lib/auth/magic-links";
import { draftResumeRedirectTo } from "../../routes/public-form.shared";
import { IDEMPOTENCY_REGISTRY, type EntityId } from "./idempotency";
import { buildIdempotencyKey, enqueueOutbox, findByIdempotencyKey, type EnqueuedOutbox } from "./outbox";
import { selectDraftCloseReminderCandidates, selectOverdueTaskCandidates, selectPreCloseReminderCandidates } from "./schedule";
import { findTemplate, TRIGGER_TEMPLATE_KEYS, type MailTemplateKey } from "./templates";
import type { MergeData } from "./render";
import { assertKnownMergeFields } from "../../lib/mail-merge-fields";

export type TriggerKey = (typeof TRIGGER_TEMPLATE_KEYS)[number];

export interface TriggerInput {
  db: D1Database;
  eventId: Id;
  templateKey: TriggerKey;
  entityId: EntityId;
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
  return enqueueOutbox({ ...input, entityId: IDEMPOTENCY_REGISTRY.trigger(input.entityId) });
}

export async function enqueueBulkReminder(input: {
  db: D1Database;
  eventId: Id;
  templateKey?: MailTemplateKey;
  recipients: Array<{
    entityId: EntityId;
    personId: Id;
    toEmail: string;
    data?: MergeData;
  }>;
  subject?: string;
  body?: string;
  /** Stable across retries of one compose; absent means this is a new send. */
  sendId?: Id;
  now?: number;
}): Promise<EnqueuedOutbox[]> {
  const templateKey = input.templateKey ?? "reminder_generic";
  if (templateKey === "draft_close_reminder") {
    throw new Error("draft_close_reminder requires a draft-bound scheduler context");
  }
  const template = await findTemplate(input.db, input.eventId, templateKey);
  assertKnownMergeFields(input.subject ?? template.subject, input.body ?? template.body_md);
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
        idempotencyKey: input.sendId === undefined
          ? undefined
          : await buildIdempotencyKey(
            templateKey,
            IDEMPOTENCY_REGISTRY.customSend(input.sendId, recipient.entityId),
            recipient.personId,
          ),
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
      entityId: IDEMPOTENCY_REGISTRY.preCloseReminder(row.entityId),
      personId: row.personId,
      toEmail: row.toEmail,
      data: row.data,
      now,
    });
    if (result) rows.push(result);
  }
  return rows;
}

/**
 * Draft-close reminders need one extra step between template admission and
 * outbox insertion: mint the submission-bound public capability. The stable
 * key is derived once, selected before minting, and passed unchanged into the
 * insert-and-catch path. A losing race may leave only its expiring orphan link.
 */
export async function enqueueDraftCloseReminderRows(db: D1Database, now = Date.now()): Promise<EnqueuedOutbox[]> {
  const rows: EnqueuedOutbox[] = [];
  for (const candidate of await selectDraftCloseReminderCandidates(db, now)) {
    const entityId = IDEMPOTENCY_REGISTRY.draftCloseReminder(candidate.submissionId);
    const idempotencyKey = await buildIdempotencyKey(candidate.templateKey, entityId, candidate.personId);
    const existing = await findByIdempotencyKey(db, idempotencyKey);
    if (existing) {
      rows.push({ id: existing.id, inserted: false, idempotencyKey });
      continue;
    }
    const template = await findTemplate(db, candidate.eventId, candidate.templateKey);
    if (template.enabled !== 1) continue;
    const link = await mintMagicLink(db, {
      eventId: candidate.eventId,
      personId: candidate.personId,
      purpose: "draft_resume",
      redirectTo: draftResumeRedirectTo(candidate.formSlug, candidate.submissionId),
      now,
    });
    const resumeLink = `/f/${encodeURIComponent(candidate.formSlug)}?resume=${encodeURIComponent(link.token)}`;
    rows.push(await enqueueOutbox({
      db,
      eventId: candidate.eventId,
      templateKey: candidate.templateKey,
      entityId,
      personId: candidate.personId,
      toEmail: candidate.toEmail,
      data: { ...candidate.data, "draft.resume_link": resumeLink },
      idempotencyKey,
      now,
    }));
  }
  return rows;
}

/** AC-127's count-oriented API; repeat scans remain UNIQUE-key idempotent. */
export async function enqueuePreCloseReminders(db: D1Database, now = Date.now()): Promise<number> {
  const rows = await enqueuePreCloseReminderRows(db, now);
  return rows.filter((row) => row.inserted).length;
}

/** AC-125's hourly overdue trigger; cancelled task tombstones never reach the outbox. */
export async function enqueueOverdueTaskReminderRows(db: D1Database, now = Date.now()): Promise<EnqueuedOutbox[]> {
  const rows: EnqueuedOutbox[] = [];
  for (const candidate of await selectOverdueTaskCandidates(db, now)) {
    const result = await enqueueTrigger({
      db,
      eventId: candidate.eventId,
      templateKey: candidate.templateKey,
      entityId: IDEMPOTENCY_REGISTRY.overdueTaskReminder(candidate.entityId),
      personId: candidate.personId,
      toEmail: candidate.toEmail,
      data: candidate.data,
      now,
    });
    if (result) rows.push(result);
  }
  return rows;
}

export async function enqueueOverdueTaskReminders(db: D1Database, now = Date.now()): Promise<number> {
  const rows = await enqueueOverdueTaskReminderRows(db, now);
  return rows.filter((row) => row.inserted).length;
}

export function isMailTemplateKey(value: string): value is MailTemplateKey {
  return [...TRIGGER_TEMPLATE_KEYS].includes(value as TriggerKey);
}
