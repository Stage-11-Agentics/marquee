import type { D1Database } from "@cloudflare/workers-types";

import type { Id, OutboxRow, OutboxSendPolicy } from "../../db/schema";
import { sha256Hex } from "../../lib/auth/random-token";
import { renderAdHocMail, renderMail, type MergeData } from "./render";
import { findTemplate } from "./templates";

export interface EnqueueOutboxInput {
  db: D1Database;
  eventId: Id;
  templateKey: string;
  entityId: Id;
  personId?: Id | null;
  toEmail: string;
  data?: MergeData;
  subject?: string;
  body?: string;
  html?: string;
  text?: string;
  icsUid?: string | null;
  icsBody?: string | null;
  scheduledFor?: number | null;
  now?: number;
}

export interface EnqueuedOutbox {
  id: Id;
  inserted: boolean;
  idempotencyKey: string;
}

/** The canonical AC-117 identity; entityId is the business action, not a UUID generated for the row. */
export async function buildIdempotencyKey(
  templateKey: string,
  entityId: Id,
  personId: Id | null | undefined,
): Promise<string> {
  return sha256Hex([templateKey, entityId, personId ?? ""].join(":"));
}

function isUniqueConstraint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint|UNIQUE constraint|constraint failed/i.test(message);
}

async function findByIdempotencyKey(db: D1Database, idempotencyKey: string): Promise<OutboxRow | null> {
  return db
    .prepare("SELECT * FROM outbox WHERE idempotency_key = ?")
    .bind(idempotencyKey)
    .first<OutboxRow>();
}

async function insertOutbox(
  input: EnqueueOutboxInput,
  sendPolicy: OutboxSendPolicy = "demo_safe",
): Promise<EnqueuedOutbox> {
  const now = input.now ?? Date.now();
  const idempotencyKey = await buildIdempotencyKey(input.templateKey, input.entityId, input.personId);
  const id = crypto.randomUUID();
  let rendered = {
    subject: input.subject ?? "",
    text: input.text ?? input.body ?? "",
    html: input.html ?? input.body ?? "",
  };
  if (input.subject !== undefined && input.body !== undefined && input.html === undefined && input.text === undefined) {
    rendered = renderAdHocMail(input.subject, input.body, input.data ?? {});
  } else if (input.subject === undefined && input.body === undefined && input.html === undefined && input.text === undefined) {
    const template = await findTemplate(input.db, input.eventId, input.templateKey);
    const fromTemplate = renderMail(template, input.data ?? {});
    rendered = {
      subject: input.subject ?? fromTemplate.subject,
      text: input.text ?? input.body ?? fromTemplate.text,
      html: input.html ?? fromTemplate.html,
    };
  }

  try {
    const policySql = sendPolicy === "always_live" ? ", send_policy" : "";
    const policyValue = sendPolicy === "always_live" ? ", 'always_live'" : "";
    await input.db
      .prepare(
        `INSERT INTO outbox
          (id, event_id, template_key, entity_id, person_id, to_email, subject, html, text,
           ics_uid, ics_body, status${policySql}, suppressed_reason,
           idempotency_key, provider_message_id, error, scheduled_for, sent_at,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued'${policyValue}, NULL,
           ?, NULL, NULL, ?, NULL, ?, ?)`,
      )
      .bind(
        id,
        input.eventId,
        input.templateKey,
        input.entityId,
        input.personId ?? null,
        input.toEmail,
        rendered.subject,
        rendered.html,
        rendered.text,
        input.icsUid ?? null,
        input.icsBody ?? null,
        idempotencyKey,
        input.scheduledFor ?? null,
        now,
        now,
      )
      .run();
    return { id, inserted: true, idempotencyKey };
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const existing = await findByIdempotencyKey(input.db, idempotencyKey);
    if (!existing) throw error;
    return { id: existing.id, inserted: false, idempotencyKey };
  }
}

/** Normal send paths take the schema default and cannot opt into live delivery. */
export function enqueueOutbox(input: EnqueueOutboxInput): Promise<EnqueuedOutbox> {
  return insertOutbox(input);
}

/** Live site 1: a public-form confirmation may deliver only to the address typed in that request. */
export function enqueuePublicFormConfirmation(
  input: EnqueueOutboxInput & { typedAddress: string },
): Promise<EnqueuedOutbox> {
  if (input.toEmail.trim().toLowerCase() !== input.typedAddress.trim().toLowerCase()) {
    return Promise.reject(new Error("public-form live mail must target the address typed in that request"));
  }
  return insertOutbox(input, "always_live");
}

/** Live site 2: the smoke:mail/smoke:ics harness is the only other live-policy writer. */
export function enqueueSmokeHarnessMail(input: EnqueueOutboxInput): Promise<EnqueuedOutbox> {
  return insertOutbox(input, "always_live");
}
