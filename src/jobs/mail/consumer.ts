import type { D1Database, MessageBatch, Queue } from "@cloudflare/workers-types";

import type { OutboxRow } from "../../db/schema";
import { enqueuePreCloseReminderRows } from "./triggers";

export const MAIL_MESSAGE_TYPE = "mail_outbox";
const PROCESSING_SENTINEL = "__mail_processing__";
const PROCESSING_LEASE_MS = 5 * 60_000;
const MAIL_FROM = "Marquee <marquee@example.com>";

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

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function emailPayload(row: OutboxRow): ResendEmail {
  const method = row.ics_body?.match(/^METHOD:(REQUEST|CANCEL)(?:\r?\n|$)/m)?.[1] ?? "REQUEST";
  return {
    from: MAIL_FROM,
    to: [row.to_email],
    subject: row.subject,
    html: row.html,
    text: row.text,
    headers: {
      "Content-Class": "urn:content-classes:calendarmessage",
      "Idempotency-Key": row.idempotency_key,
    },
    ...(row.ics_body
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

async function allowlistFor(db: D1Database, eventId: string): Promise<Set<string>> {
  const setting = await db
    .prepare("SELECT value_json FROM event_settings WHERE event_id = ? AND key = 'demo_safe_allowlist'")
    .bind(eventId)
    .first<{ value_json: string }>();
  if (!setting) return new Set();
  try {
    const parsed = JSON.parse(setting.value_json) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { emails?: unknown }).emails)
        ? (parsed as { emails: unknown[] }).emails
        : [];
    return new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim().toLowerCase()));
  } catch {
    return new Set();
  }
}

async function shouldSuppress(db: D1Database, row: OutboxRow): Promise<boolean> {
  if (row.send_policy === "always_live") return false;
  const event = await db
    .prepare("SELECT demo_mode FROM events WHERE id = ?")
    .bind(row.event_id)
    .first<{ demo_mode: 0 | 1 }>();
  if (!event || event.demo_mode !== 1) return false;
  const allowlist = await allowlistFor(db, row.event_id);
  return !allowlist.has(row.to_email.trim().toLowerCase());
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

async function suppressRow(db: D1Database, row: OutboxRow, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE outbox
       SET status = 'suppressed', suppressed_reason = ?, error = NULL, updated_at = ?
       WHERE id = ? AND error = ?`,
    )
    .bind("demo_mode_not_allowlisted", now, row.id, PROCESSING_SENTINEL)
    .run();
}

async function markSent(db: D1Database, row: OutboxRow, providerMessageId: string, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE outbox
       SET status = 'sent', provider_message_id = ?, error = NULL, sent_at = ?, updated_at = ?
       WHERE id = ? AND error = ?`,
    )
    .bind(providerMessageId, now, now, row.id, PROCESSING_SENTINEL)
    .run();
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

  const plain = deliverable.filter((row) => !row.ics_body);
  // Demo-safe batches may have no deliverable rows at all. Do not require a
  // provider credential merely to record suppression in the local outbox.
  const provider = deliverable.length > 0 ? (options.provider ?? createResendProvider(env)) : undefined;
  if (plain.length > 0) {
    try {
      if (!provider) throw new Error("mail provider is unavailable");
      const providerIds = await provider.sendBatch(plain);
      for (const [index, row] of plain.entries()) {
        await markSent(db, row, providerIds[index] ?? providerIds[0] ?? `batch:${row.idempotency_key}`, now);
        sent += 1;
      }
    } catch (error) {
      for (const row of plain) {
        await markFailed(db, row, error, now);
        failed += 1;
      }
    }
  }

  for (const [index, row] of deliverable.filter((item) => item.ics_body).entries()) {
    if (index > 0) await sleep(100);
    try {
      if (!provider) throw new Error("mail provider is unavailable");
      const providerId = await provider.sendSingle(row);
      await markSent(db, row, providerId, now);
      sent += 1;
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
  const results = await enqueuePreCloseReminderRows(db, now);
  const inserted = results.filter((row) => row.inserted);
  if (queue) {
    for (const row of inserted) await enqueueMailMessage(queue, row.id);
  }
  return inserted.length;
}
