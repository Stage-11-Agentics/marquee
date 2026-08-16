import type { D1Database, MessageBatch, Queue } from "@cloudflare/workers-types";

import type { OutboxRow } from "../../db/schema";
import { writeAudit } from "../../lib/audit";
import { demoMailAllowlistFor, normalizeAllowlistEmail } from "../../lib/demo-mail-allowlist";
import { RESEND_MAIL_FROM } from "../../lib/mail/config";
import { MAX_CALENDAR_CANCELLATION_ATTEMPTS } from "../calendar/limits";
import { enqueueDraftCloseReminderRows, enqueueOverdueTaskReminderRows, enqueuePreCloseReminderRows } from "./triggers";

export const MAIL_MESSAGE_TYPE = "mail_outbox";
const PROCESSING_SENTINEL = "__mail_processing__";
const PROCESSING_LEASE_MS = 5 * 60_000;
export interface MailQueueMessage {
  type: typeof MAIL_MESSAGE_TYPE;
  outbox_id: string;
}

export interface MailConsumerEnv {
  DB: D1Database;
  RESEND_API_KEY?: string;
}

export interface MailProvider {
  sendBatch(rows: readonly OutboxRow[]): Promise<readonly string[]>;
  sendSingle(row: OutboxRow): Promise<string>;
}

interface ResendEmail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  attachments?: Array<{ filename: string; content: string; content_type: string }>;
}

interface CalendarAttachment {
  content: string;
  content_type: string;
  filename: string;
}

type DeliveryRow = OutboxRow & { calendar_parts?: readonly CalendarAttachment[] };

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function emailPayload(row: OutboxRow): ResendEmail {
  const deliveryRow = row as DeliveryRow;
  const batchAttachments = deliveryRow.calendar_parts;
  const method = row.ics_body?.match(/^METHOD:(REQUEST|CANCEL)(?:\r?\n|$)/m)?.[1] ?? "REQUEST";
  return {
    from: RESEND_MAIL_FROM,
    to: [row.to_email],
    subject: row.subject,
    html: row.html,
    text: row.text,
    headers: {
      "Content-Class": "urn:content-classes:calendarmessage",
      "Idempotency-Key": row.idempotency_key,
    },
    ...(batchAttachments?.length
      ? { attachments: batchAttachments.map((part) => ({ ...part })) }
      : row.ics_body
      ? {
          attachments: [
            {
              filename: `${row.ics_uid ?? row.id}.ics`,
              content: encodeBase64(row.ics_body),
              content_type: `text/calendar; charset=utf-8; method=${method}`,
            },
          ],
        }
      : {}),
  };
}

async function calendarPartsFor(
  db: D1Database,
  rows: readonly OutboxRow[],
): Promise<Map<string, CalendarAttachment[]>> {
  const batchIds = rows.filter((row) => row.template_key === "calendar_batch_request").map((row) => row.id);
  if (batchIds.length === 0) return new Map();
  const placeholders = batchIds.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT outbox_id, filename, ics_body, content_type
     FROM outbox_calendar_parts
     WHERE outbox_id IN (${placeholders})
     ORDER BY outbox_id ASC, part_index ASC`,
  ).bind(...batchIds).all<{ outbox_id: string; filename: string; ics_body: string; content_type: string }>();
  const parts = new Map<string, CalendarAttachment[]>();
  for (const row of result.results) {
    const existing = parts.get(row.outbox_id) ?? [];
    existing.push({ content: encodeBase64(row.ics_body), content_type: row.content_type, filename: row.filename });
    parts.set(row.outbox_id, existing);
  }
  return parts;
}

async function resendRequest(
  apiKey: string,
  path: "/emails" | "/emails/batch",
  body: unknown,
  idempotencyKey: string,
): Promise<{ id?: string; data?: Array<{ id?: string }> }> {
  const response = await fetch(`https://api.resend.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    id?: string;
    data?: Array<{ id?: string }>;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message ?? `mail provider returned ${response.status}`);
  }
  return payload;
}

/** The only provider adapter in the repository. It is intentionally private to the consumer module. */
function createResendProvider(env: MailConsumerEnv): MailProvider {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  const apiKey = env.RESEND_API_KEY;
  return {
    async sendBatch(rows) {
      if (rows.length === 0) return [];
      const response = await resendRequest(
        apiKey,
        "/emails/batch",
        rows.map(emailPayload),
        rows.map((row) => row.idempotency_key).join(","),
      );
      return (response.data ?? []).map((item) => item.id ?? "");
    },
    async sendSingle(row) {
      const response = await resendRequest(
        apiKey,
        "/emails",
        emailPayload(row),
        row.idempotency_key,
      );
      if (!response.id) throw new Error("mail provider returned no message id");
      return response.id;
    },
  };
}

/**
 * Exported so a route can tell an operator the truth at the moment they act.
 * A UI that says "invitation sent" while the consumer will suppress it is a
 * label that lies, and the operator only finds out when nobody replies.
 */
export async function demoMailWouldBeSuppressed(
  db: D1Database,
  eventId: string,
  toEmail: string,
  sendPolicy: string = "demo_safe",
): Promise<boolean> {
  if (sendPolicy === "always_live") return false;
  const event = await db
    .prepare("SELECT demo_mode FROM events WHERE id = ?")
    .bind(eventId)
    .first<{ demo_mode: 0 | 1 }>();
  if (!event || event.demo_mode !== 1) return false;
  const allowlist = await demoMailAllowlistFor(db, eventId);
  return !allowlist.includes(normalizeAllowlistEmail(toEmail));
}

async function shouldSuppress(db: D1Database, row: OutboxRow): Promise<boolean> {
  return demoMailWouldBeSuppressed(db, row.event_id, row.to_email, row.send_policy);
}

async function claimRow(db: D1Database, id: string, now: number): Promise<OutboxRow | null> {
  const result = await db
    .prepare(
      `UPDATE outbox SET error = ?, updated_at = ?
       WHERE id = ? AND status = 'queued'
         AND (error IS NULL OR (error = ? AND updated_at < ?))`,
    )
    .bind(PROCESSING_SENTINEL, now, id, PROCESSING_SENTINEL, now - PROCESSING_LEASE_MS)
    .run();
  if ((result.meta.changes ?? 0) !== 1) return null;
  return db.prepare("SELECT * FROM outbox WHERE id = ?").bind(id).first<OutboxRow>();
}

async function syncCalendarCancellation(
  db: D1Database,
  row: OutboxRow,
  status: "sent" | "suppressed" | "failed",
  now: number,
  error: string | null = null,
): Promise<void> {
  if (row.template_key !== "calendar_cancel" || row.entity_id === null) return;
  const cancellation = status === "failed"
    ? await db.prepare("SELECT attempts FROM calendar_cancellations WHERE idempotency_key = ?").bind(row.entity_id).first<{ attempts: number }>()
    : null;
  const durableStatus = status === "failed" && (cancellation?.attempts ?? 0) >= MAX_CALENDAR_CANCELLATION_ATTEMPTS
    ? "abandoned"
    : status;
  await db.prepare(
    `UPDATE calendar_cancellations
     SET status = ?, last_error = ?, updated_at = ?
     WHERE idempotency_key = ?`,
  ).bind(durableStatus, error, now, row.entity_id).run();
}

async function suppressRow(db: D1Database, row: OutboxRow, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE outbox
       SET status = 'suppressed', suppressed_reason = ?, error = NULL, updated_at = ?
       WHERE id = ? AND error = ?`,
    )
    .bind("demo_mode_not_allowlisted", now, row.id, PROCESSING_SENTINEL)
    .run();
  await syncCalendarCancellation(db, row, "suppressed", now);
}

async function markSent(db: D1Database, row: OutboxRow, providerMessageId: string | null, now: number): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE outbox
       SET status = 'sent', provider_message_id = ?, delivery_state = 'unknown',
           bounce_type = NULL, bounce_subtype = NULL, delivered_at = NULL,
           delivery_event_id = NULL, delivery_event_created_at = NULL,
           error = NULL, sent_at = ?, updated_at = ?
       WHERE id = ? AND error = ?`,
    )
    .bind(providerMessageId, now, now, row.id, PROCESSING_SENTINEL)
    .run();
  const changed = (result.meta.changes ?? 0) === 1;
  if (changed) await syncCalendarCancellation(db, row, "sent", now);
  return changed;
}

function calendarSequence(row: OutboxRow): number | null {
  const match = row.ics_body?.match(/^SEQUENCE:(\d+)\s*$/m);
  return match ? Number(match[1]) : null;
}

async function recordSingularCalendarAudit(
  db: D1Database,
  row: OutboxRow,
  providerMessageId: string | null,
  now: number,
): Promise<void> {
  if (row.ics_uid === null) return;
  const invite = await db
    .prepare("SELECT submission_id FROM calendar_invites WHERE uid = ?")
    .bind(row.ics_uid)
    .first<{ submission_id: string }>();
  if (!invite) return;
  await writeAudit(db, {
    eventId: row.event_id,
    actorKind: "system",
    actorPersonId: null,
    action: "submission.calendar_sent",
    entityType: "submission",
    entityId: invite.submission_id,
    after: {
      outbox_id: row.id,
      provider_message_id: providerMessageId,
      template_key: row.template_key,
      method: row.template_key === "calendar_cancel" ? "CANCEL" : "REQUEST",
      sequence: calendarSequence(row),
      uid: row.ics_uid,
      sent_at: now,
    },
    now,
    requestId: null,
  });
}

/**
 * Delivery is a fact of the consumer, not of the route that admitted a row to
 * the queue. Decision retries use the decision id as their outbox entity;
 * initial decision mail uses the submission id. Ad-hoc record mail also uses
 * the submission id, so only those rows have a timeline lens to update.
 */
async function recordSentAudit(
  db: D1Database,
  row: OutboxRow,
  providerMessageId: string | null,
  now: number,
): Promise<void> {
  if (row.template_key === "calendar_batch_request") {
    const parts = await db.prepare(
      `SELECT submission_id, ics_uid, sequence
       FROM outbox_calendar_parts
       WHERE outbox_id = ?
       ORDER BY part_index ASC`,
    ).bind(row.id).all<{ submission_id: string; ics_uid: string; sequence: number }>();
    for (const part of parts.results) {
      await writeAudit(db, {
        eventId: row.event_id,
        actorKind: "system",
        actorPersonId: null,
        action: "submission.calendar_batch_sent",
        entityType: "submission",
        entityId: part.submission_id,
        after: {
          batch_outbox_id: row.id,
          outbox_id: row.id,
          provider_message_id: providerMessageId,
          sequence: part.sequence,
          template_key: row.template_key,
          uid: part.ics_uid,
          sent_at: now,
        },
        now,
        requestId: null,
      });
    }
    return;
  }
  if (row.template_key === "calendar_request" || row.template_key === "calendar_cancel") {
    await recordSingularCalendarAudit(db, row, providerMessageId, now);
    return;
  }
  const target = await db
    .prepare(
      `SELECT submission.id AS direct_submission_id,
              decision.submission_id AS decision_submission_id,
              decision.id AS retry_decision_id
       FROM outbox message
       LEFT JOIN submissions submission
         ON submission.id = message.entity_id AND submission.event_id = message.event_id
       LEFT JOIN submission_decisions decision
         ON decision.id = message.entity_id AND decision.event_id = message.event_id
       WHERE message.id = ?`,
    )
    .bind(row.id)
    .first<{ direct_submission_id: string | null; decision_submission_id: string | null; retry_decision_id: string | null }>();
  const submissionId = target?.direct_submission_id ?? target?.decision_submission_id;
  if (!submissionId) return;
  const isDecision = row.template_key === "acceptance" || row.template_key === "rejection";
  const action = isDecision
    ? target?.retry_decision_id ? "submission.decision_resent" : "submission.decision_mail_sent"
    : "submission.message_sent";
  await writeAudit(db, {
    eventId: row.event_id,
    actorKind: "system",
    actorPersonId: null,
    action,
    entityType: "submission",
    entityId: submissionId,
    after: {
      outbox_id: row.id,
      template_key: row.template_key,
      provider_message_id: providerMessageId,
      sent_at: now,
    },
    now,
    requestId: null,
  });
}

async function markFailed(db: D1Database, row: OutboxRow, error: unknown, now: number): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .prepare(
      `UPDATE outbox SET status = 'failed', error = ?, suppressed_reason = NULL, updated_at = ?
       WHERE id = ? AND error = ?`,
    )
    .bind(message.slice(0, 500), now, row.id, PROCESSING_SENTINEL)
    .run();
  await syncCalendarCancellation(db, row, "failed", now, message.slice(0, 500));
}

export async function processMailOutbox(
  db: D1Database,
  env: MailConsumerEnv,
  ids: readonly string[],
  options: { now?: number; provider?: MailProvider; sleep?: (milliseconds: number) => Promise<void> } = {},
): Promise<{ sent: number; suppressed: number; failed: number }> {
  const now = options.now ?? Date.now();
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const rows: OutboxRow[] = [];
  for (const id of [...new Set(ids)]) {
    const row = await claimRow(db, id, now);
    if (row) rows.push(row);
  }

  let sent = 0;
  let suppressed = 0;
  let failed = 0;
  const deliverable: OutboxRow[] = [];
  for (const row of rows) {
    if (await shouldSuppress(db, row)) {
      await suppressRow(db, row, now);
      suppressed += 1;
    } else {
      deliverable.push(row);
    }
  }

  const plain = deliverable.filter((row) => !row.ics_body && row.template_key !== "calendar_batch_request");
  const calendarParts = await calendarPartsFor(db, deliverable);
  const batchCalendar = deliverable
    .filter((row) => row.template_key === "calendar_batch_request")
    .map((row) => ({ row, parts: calendarParts.get(row.id) ?? [] }));
  if (batchCalendar.some(({ parts }) => parts.length === 0)) {
    for (const { row } of batchCalendar) {
      if ((calendarParts.get(row.id)?.length ?? 0) === 0) {
        await markFailed(db, row, new Error("calendar batch outbox has no child parts"), now);
        failed += 1;
      }
    }
  }
  const deliverableCalendarIds = new Set(batchCalendar.filter(({ parts }) => parts.length > 0).map(({ row }) => row.id));
  // Demo-safe batches may have no deliverable rows at all. Do not require a
  // provider credential merely to record suppression in the local outbox.
  const provider = deliverable.length > 0 ? (options.provider ?? createResendProvider(env)) : undefined;
  if (plain.length > 0) {
    try {
      if (!provider) throw new Error("mail provider is unavailable");
      const providerIds = await provider.sendBatch(plain);
      for (const [index, row] of plain.entries()) {
        // A batch response must never borrow another row's id. A synthetic or
        // first-row fallback would make an inbound bounce land on the wrong
        // speaker; a missing id stays unknown and the health surface says so.
        const providerId = providerIds[index]?.trim() || null;
        if (await markSent(db, row, providerId, now)) {
          await recordSentAudit(db, row, providerId, now);
          sent += 1;
        }
      }
    } catch (error) {
      for (const row of plain) {
        await markFailed(db, row, error, now);
        failed += 1;
      }
    }
  }

  const calendarRows = deliverable.filter((item) => item.ics_body || deliverableCalendarIds.has(item.id));
  for (const [index, row] of calendarRows.entries()) {
    if (index > 0) await sleep(100);
    try {
      if (!provider) throw new Error("mail provider is unavailable");
      const parts = calendarParts.get(row.id);
      const deliveryRow = parts ? ({ ...row, calendar_parts: parts } as OutboxRow) : row;
      const providerId = await provider.sendSingle(deliveryRow);
      if (await markSent(db, row, providerId, now)) {
        await recordSentAudit(db, row, providerId, now);
        sent += 1;
      }
    } catch (error) {
      await markFailed(db, row, error, now);
      failed += 1;
    }
  }

  return { sent, suppressed, failed };
}

export async function processMailQueue(
  batch: MessageBatch<unknown>,
  env: MailConsumerEnv,
  provider?: MailProvider,
): Promise<void> {
  const messages = batch.messages.filter((message): message is typeof message & { body: MailQueueMessage } => {
    const body = message.body as Partial<MailQueueMessage>;
    return body?.type === MAIL_MESSAGE_TYPE && typeof body.outbox_id === "string";
  });
  if (messages.length === 0) return;
  await processMailOutbox(env.DB, env, messages.map((message) => message.body.outbox_id), { provider });
  for (const message of messages) message.ack();
}

export async function enqueueMailMessage(queue: Queue<unknown>, outboxId: string): Promise<void> {
  await queue.send({ type: MAIL_MESSAGE_TYPE, outbox_id: outboxId } satisfies MailQueueMessage);
}

export async function runMailSchedule(db: D1Database, queue?: Queue<unknown>, now = Date.now()): Promise<number> {
  const results = [
    ...(await enqueuePreCloseReminderRows(db, now)),
    ...(await enqueueDraftCloseReminderRows(db, now)),
    ...(await enqueueOverdueTaskReminderRows(db, now)),
  ];
  const inserted = results.filter((row) => row.inserted);
  if (queue) {
    for (const row of inserted) await enqueueMailMessage(queue, row.id);
  }
  return inserted.length;
}
