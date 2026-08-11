/**
 * The delivery and system health read.
 *
 * Every column this touches is already written by the product; nothing here
 * records anything new. The queries gather facts, `src/lib/delivery-health.ts`
 * turns them into organizer sentences, and the screen renders those sentences
 * without adding meaning of its own.
 */
import { z } from "@hono/zod-openapi";

import { defineApiRoute, errorResponses, jsonResponse } from "../api/route";
import { errorFields } from "../lib/observability/log";
import { runDiagnostics } from "./telemetry.routes";
import type { Env } from "../index";
import {
  MIRROR_STUCK_ATTEMPTS,
  OWED_LEDGER_LIMIT,
  QUEUE_PATIENCE_MS,
  deriveDeliveryHealth,
  readInfrastructure,
  type CalendarFacts,
  type DeliveryHealthFacts,
  type DeliveryHealthSnapshot,
  type FormFact,
  type MirrorFacts,
  type OutboxFacts,
  type OwedFact,
  type QuotaFacts,
  type UploadFacts,
  type WebhookFacts,
} from "../lib/delivery-health";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * Every owed row is judged so the counts are true, not just the page that is
 * rendered. The scan is bounded because a runaway conference must not turn one
 * screen load into an unbounded read; past the bound the ledger says so.
 */
export const OWED_SCAN_LIMIT = 2_000;

const DAY_MS = 86_400_000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

const levelSchema = z.enum(["ok", "warn", "alarm", "unknown"]);

const capabilitySchema = z.object({
  id: z.string(),
  label: z.string(),
  level: levelSchema,
  headline: z.string(),
  detail: z.string(),
  href: z.string().nullable(),
});

const owedSchema = z.object({
  submission_id: z.string(),
  submission_title: z.string(),
  person_name: z.string(),
  decision: z.string(),
  decided_at: z.number(),
  waiting_days: z.number(),
  state: z.enum([
    "never_prepared",
    "waiting",
    "waiting_too_long",
    "held_back_demo",
    "held_back",
    "undelivered",
    "send_blocked",
    "no_address",
    "changed_elsewhere",
  ]),
  level: levelSchema,
  reason: z.string(),
  what_to_do: z.string(),
  href: z.string(),
});

const deliveryHealthSchema = z.object({
  generated_at: z.number(),
  event_id: z.string(),
  demo_mode: z.boolean(),
  summary: z.object({ level: levelSchema, headline: z.string(), detail: z.string() }),
  capabilities: z.array(capabilitySchema),
  quota: z.object({
    sent_today: z.number(),
    waiting: z.number(),
    daily_limit: z.number(),
    remaining: z.number(),
    level: levelSchema,
    headline: z.string(),
    detail: z.string(),
  }),
  totals: z.object({
    sent: z.number(),
    waiting: z.number(),
    held_back: z.number(),
    undelivered: z.number(),
  }),
  owed: z.array(owedSchema),
  owed_total: z.number(),
  owed_urgent: z.number(),
  owed_counted: z.number(),
  owed_reasons: z.array(z.object({
    state: owedSchema.shape.state,
    level: levelSchema,
    reason: z.string(),
    count: z.number(),
  })),
  owed_shown: z.number(),
  owed_href: z.string(),
  infrastructure_reported: z.boolean(),
});

function whole(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A table added by a later migration may be absent on an older store. The
 * screen reports what it can rather than failing whole because one optional
 * feature was never migrated in.
 */
async function tolerant<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such (?:table|column)/i.test(message)) return fallback;
    throw error;
  }
}

const SPEAKER_PICK = `
  FROM participations health_part
  JOIN people health_person ON health_person.id = health_part.person_id
  WHERE health_part.submission_id = s.id
    AND health_part.role IN ('speaker', 'submitter')
  ORDER BY CASE health_part.role WHEN 'speaker' THEN 0 ELSE 1 END,
           health_part.position ASC,
           health_part.id ASC
  LIMIT 1`;

/**
 * The one query that matters: who was decided and has not been told.
 *
 * The decision is the latest one on the submission; the message is the outbox
 * row that decision produced, preferring a delivered one so a later retry can
 * never make a delivered decision look owed.
 */
const OWED_FROM = `
FROM submissions s
JOIN submission_decisions d
  ON d.id = (
    SELECT candidate.id
    FROM submission_decisions candidate
    WHERE candidate.event_id = s.event_id AND candidate.submission_id = s.id
    ORDER BY candidate.decided_at DESC, candidate.id DESC
    LIMIT 1
  )
LEFT JOIN outbox ob
  ON ob.id = (
    SELECT candidate.id
    FROM outbox candidate
    WHERE candidate.event_id = s.event_id
      AND (candidate.id = d.outbox_id OR candidate.entity_id = d.id)
    ORDER BY CASE WHEN candidate.status = 'sent' THEN 0 ELSE 1 END,
             candidate.created_at DESC,
             candidate.id DESC
    LIMIT 1
  )
WHERE s.event_id = ?
  AND d.resulting_status IN ('accepted', 'rejected')
  AND COALESCE(ob.status, '') <> 'sent'`;

interface OwedQueryRow {
  submission_id: string;
  submission_title: string;
  person_name: string | null;
  person_email: string | null;
  decided_at: number;
  resulting_status: string;
  outbox_status: string | null;
  outbox_created_at: number | null;
  suppressed_reason: string | null;
  outbox_error: string | null;
  last_write_source: string | null;
}

async function readOwed(database: D1Database, eventId: string): Promise<{ rows: OwedFact[]; total: number }> {
  return tolerant(async () => {
    const [page, totalRow] = await Promise.all([
      database
        .prepare(`
          SELECT
            s.id AS submission_id,
            s.title AS submission_title,
            s.last_write_source AS last_write_source,
            d.decided_at AS decided_at,
            d.resulting_status AS resulting_status,
            ob.status AS outbox_status,
            ob.created_at AS outbox_created_at,
            ob.suppressed_reason AS suppressed_reason,
            ob.error AS outbox_error,
            (SELECT health_person.name ${SPEAKER_PICK}) AS person_name,
            (SELECT health_person.email ${SPEAKER_PICK}) AS person_email
          ${OWED_FROM}
          ORDER BY d.decided_at ASC, s.id ASC
          LIMIT ?
        `)
        .bind(eventId, OWED_SCAN_LIMIT)
        .all<OwedQueryRow>(),
      database.prepare(`SELECT COUNT(*) AS total ${OWED_FROM}`).bind(eventId).first<{ total: number | null }>(),
    ]);
    const rows: OwedFact[] = page.results.map((row) => {
      const email = (row.person_email ?? "").trim();
      const status = row.outbox_status;
      return {
        submission_id: row.submission_id,
        submission_title: row.submission_title,
        person_name: row.person_name,
        decided_at: whole(row.decided_at),
        resulting_status: row.resulting_status,
        outbox_status: status === "queued" || status === "sent" || status === "suppressed" || status === "failed" ? status : null,
        outbox_created_at: optionalNumber(row.outbox_created_at),
        suppressed_reason: row.suppressed_reason,
        has_error: status === "failed" && row.outbox_error !== null,
        // Carried, never rendered: the derivation classifies it into an
        // organizer sentence. Only a real failure's text is passed on, so a
        // claimed-but-unfinished row's processing sentinel cannot be mistaken
        // for a provider message.
        error_text: status === "failed" ? row.outbox_error : null,
        has_valid_address: email.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
        changed_elsewhere: row.last_write_source === "airtable",
      };
    });
    return { rows, total: whole(totalRow?.total) };
  }, { rows: [], total: 0 });
}

async function readOutbox(database: D1Database, eventId: string, now: number): Promise<OutboxFacts> {
  const row = await database
    .prepare(`
      SELECT
        COUNT(CASE WHEN status = 'queued' THEN 1 END) AS queued,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) AS sent,
        COUNT(CASE WHEN status = 'suppressed' THEN 1 END) AS suppressed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed,
        COUNT(CASE
          WHEN status = 'queued' AND created_at < ? AND (scheduled_for IS NULL OR scheduled_for <= ?)
          THEN 1 END) AS stuck_queued,
        COUNT(CASE WHEN status = 'sent' AND sent_at >= ? THEN 1 END) AS sent_last_7_days,
        MAX(CASE WHEN status = 'sent' THEN sent_at END) AS last_sent_at
      FROM outbox
      WHERE event_id = ?
    `)
    .bind(now - QUEUE_PATIENCE_MS, now, now - SEVEN_DAYS_MS, eventId)
    .first<Record<string, number | null>>();
  return {
    queued: whole(row?.queued),
    sent: whole(row?.sent),
    suppressed: whole(row?.suppressed),
    failed: whole(row?.failed),
    stuck_queued: whole(row?.stuck_queued),
    sent_last_7_days: whole(row?.sent_last_7_days),
    last_sent_at: optionalNumber(row?.last_sent_at),
  };
}

/**
 * The daily send ceiling belongs to the mail account, not to one conference,
 * so the quota read deliberately spans every conference in this installation.
 */
async function readQuota(database: D1Database, now: number): Promise<QuotaFacts> {
  const startOfDay = now - (now % DAY_MS);
  const row = await database
    .prepare(`
      SELECT
        COUNT(CASE WHEN status = 'sent' AND sent_at >= ? THEN 1 END) AS sent_today,
        COUNT(CASE WHEN status = 'queued' AND (scheduled_for IS NULL OR scheduled_for <= ?) THEN 1 END) AS waiting
      FROM outbox
    `)
    .bind(startOfDay, now + DAY_MS)
    .first<Record<string, number | null>>();
  return { sent_today: whole(row?.sent_today), waiting: whole(row?.waiting) };
}

async function readForms(database: D1Database, eventId: string): Promise<FormFact[]> {
  const result = await database
    .prepare("SELECT id, name, status, opens_at, closes_at FROM forms WHERE event_id = ? ORDER BY created_at ASC")
    .bind(eventId)
    .all<{ id: string; name: string; status: string; opens_at: number | null; closes_at: number | null }>();
  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    opens_at: optionalNumber(row.opens_at),
    closes_at: optionalNumber(row.closes_at),
  }));
}

async function readCalendar(database: D1Database, eventId: string): Promise<CalendarFacts> {
  return tolerant(async () => {
    const [invites, failures] = await Promise.all([
      database
        .prepare(`
          SELECT COUNT(*) AS total, COUNT(CASE WHEN ci.last_sent_at IS NULL THEN 1 END) AS unsent
          FROM calendar_invites ci
          JOIN submissions s ON s.id = ci.submission_id
          WHERE s.event_id = ?
        `)
        .bind(eventId)
        .first<{ total: number | null; unsent: number | null }>(),
      database
        .prepare("SELECT COUNT(*) AS failed FROM outbox WHERE event_id = ? AND ics_uid IS NOT NULL AND status = 'failed'")
        .bind(eventId)
        .first<{ failed: number | null }>(),
    ]);
    return {
      invites_total: whole(invites?.total),
      invites_unsent: whole(invites?.unsent),
      invite_sends_failed: whole(failures?.failed),
    };
  }, { invites_total: 0, invites_unsent: 0, invite_sends_failed: 0 });
}

async function readUploads(database: D1Database, eventId: string): Promise<UploadFacts> {
  return tolerant(async () => {
    const row = await database
      .prepare("SELECT COUNT(*) AS held FROM attachments WHERE event_id = ? AND status = 'ready'")
      .bind(eventId)
      .first<{ held: number | null }>();
    return { files_held: whole(row?.held) };
  }, { files_held: 0 });
}

async function readMirror(database: D1Database): Promise<MirrorFacts> {
  return tolerant(async () => {
    const [pending, state] = await Promise.all([
      database
        .prepare(`
          SELECT
            COUNT(CASE WHEN drained_at IS NULL THEN 1 END) AS pending,
            COUNT(CASE WHEN drained_at IS NULL AND attempts >= ? THEN 1 END) AS stuck
          FROM mirror_outbox
        `)
        .bind(MIRROR_STUCK_ATTEMPTS)
        .first<{ pending: number | null; stuck: number | null }>(),
      database
        .prepare(`
          SELECT
            COUNT(CASE WHEN airtable_table_id IS NOT NULL THEN 1 END) AS connected,
            MAX(last_sync_at) AS last_sync_at,
            COUNT(CASE WHEN last_error IS NOT NULL THEN 1 END) AS errored
          FROM mirror_state
        `)
        .first<{ connected: number | null; last_sync_at: number | null; errored: number | null }>(),
    ]);
    return {
      configured: whole(state?.connected) > 0,
      pending: whole(pending?.pending),
      stuck: whole(pending?.stuck),
      last_sync_at: optionalNumber(state?.last_sync_at),
      has_error: whole(state?.errored) > 0,
    };
  }, { configured: false, pending: 0, stuck: 0, last_sync_at: null, has_error: false });
}

async function readWebhooks(database: D1Database, eventId: string): Promise<WebhookFacts> {
  return tolerant(async () => {
    const row = await database
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM webhook_endpoints WHERE event_id = ?) AS endpoints,
          COUNT(CASE WHEN wd.status = 'failed' THEN 1 END) AS failed,
          COUNT(CASE WHEN wd.status = 'queued' AND wd.attempts > 0 THEN 1 END) AS retrying
        FROM webhook_deliveries wd
        JOIN webhook_endpoints we ON we.id = wd.endpoint_id
        WHERE we.event_id = ?
      `)
      .bind(eventId, eventId)
      .first<{ endpoints: number | null; failed: number | null; retrying: number | null }>();
    return {
      endpoints: whole(row?.endpoints),
      failed: whole(row?.failed),
      retrying: whole(row?.retrying),
    };
  }, { endpoints: 0, failed: 0, retrying: 0 });
}

export async function readDeliveryHealthFacts(
  database: D1Database,
  eventId: string,
  now: number,
): Promise<DeliveryHealthFacts> {
  const [event, forms, outbox, quota, owed, calendar, uploads, mirror, webhooks] = await Promise.all([
    database.prepare("SELECT demo_mode FROM events WHERE id = ?").bind(eventId).first<{ demo_mode: number | null }>(),
    readForms(database, eventId),
    readOutbox(database, eventId, now),
    readQuota(database, now),
    readOwed(database, eventId),
    readCalendar(database, eventId),
    readUploads(database, eventId),
    readMirror(database),
    readWebhooks(database, eventId),
  ]);
  return {
    now,
    event_id: eventId,
    demo_mode: whole(event?.demo_mode) === 1,
    forms,
    outbox,
    quota,
    owed: owed.rows,
    owed_total: owed.total,
    calendar,
    uploads,
    mirror,
    webhooks,
  };
}

export async function readDeliveryHealth(
  database: D1Database,
  eventId: string,
  now: number,
  infrastructurePayload: unknown = null,
): Promise<DeliveryHealthSnapshot> {
  const facts = await readDeliveryHealthFacts(database, eventId, now);
  return deriveDeliveryHealth(facts, readInfrastructure(infrastructurePayload));
}

/**
 * The infrastructure verdicts — storage, files, background jobs — are owned by
 * the telemetry surface, not by this one. They are read in process rather than
 * over HTTP: a Worker cannot fetch its own route, and going out to the network
 * to ask itself a question would be the wrong shape even if it could.
 *
 * A failure here is logged and then swallowed, so those rows read "not reported
 * yet" instead of the screen failing whole over a report it can live without.
 */
async function readPlatformReport(
  env: unknown,
  onFailure: (error: unknown) => void,
): Promise<unknown> {
  try {
    return await runDiagnostics(env as Env);
  } catch (error) {
    onFailure(error);
    return null;
  }
}

const getDeliveryHealth = defineApiRoute(
  {
    method: "get",
    path: "/api/v1/events/{eventId}/delivery-health",
    operationId: "getDeliveryHealth",
    summary: "Read delivery and system health",
    description:
      `One D1-derived answer to "is my conference fine?": a status per capability, the daily send allowance, and the ledger of people who were decided and have not been told. The daily allowance spans every conference in this installation because the send ceiling belongs to the mail account. At most ${OWED_LEDGER_LIMIT} ledger rows are returned; owed_total and owed_urgent count every one of them.`,
    tags: ["Dashboard"],
    policy: {
      auth: { kind: "grants", grants: ["program:read"] },
      rateLimit: { bucket: "read" },
      concurrency: "none",
    },
    request: { params: z.object({ eventId: z.string().min(1) }) },
    responses: {
      200: jsonResponse(deliveryHealthSchema, "Delivery and system health snapshot"),
      ...errorResponses([401, 403, 429, 500]),
    },
  },
  async (context) => {
    const { eventId } = context.req.valid("param");
    const infrastructure = await readPlatformReport(
      context.env,
      // Swallowing this silently would hide exactly the kind of quiet failure
      // this screen exists to expose, so it reaches the log even though the
      // screen degrades gracefully without it.
      (error) => context.get("logger")?.emit("worker_error", "warn", {
        source: "delivery-health.diagnostics",
        ...errorFields(error),
      }),
    );
    return context.json(await readDeliveryHealth(context.env.DB, eventId, Date.now(), infrastructure), 200);
  },
);

export const apiRoutes = [getDeliveryHealth];
