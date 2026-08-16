import type { D1Database } from "@cloudflare/workers-types";

import { newUlid } from "../../api/ids";
import { auditStatement } from "../../lib/audit";
import { DECISION_STATUSES, SUBMISSION_STATUSES } from "../../db/schema";
import { canTransitionSubmissionStatus } from "../../lib/submission-transitions";
import { readMirrorCredential } from "./credentials";
import type { MirrorActionEnvironment, MirrorClockOptions } from "./actions";
import { MIRRORED_TABLES, type MirroredTable } from "./records";
import { MirrorTokenBucket, type MirrorClock } from "./rate-limiter";
import {
  createFetchAirtableTransport,
  rateLimitedAirtableTransport,
  type AirtableTable,
  type AirtableTransport,
  type AirtableWebhookPayload,
} from "./transport";
import { MIRROR_INBOUND_MESSAGE_TYPE } from "./messages";
import { recordMirrorSubmissionRejection } from "./rejections";

const VENDOR_AFFILIATION = new Set(["none", "vendor_to_fi", "vendor_with_champion"]);
const TASK_STATUS = new Set(["open", "done"]);

export const MIRROR_INBOUND_ALLOWLIST: Readonly<Record<MirroredTable, readonly string[]>> = {
  submissions: ["status", "primary_track_id", "tracks", "format_id", "vendor_affiliation"],
  speaker_tasks: ["status"],
  people: ["title", "company"],
};

export interface MirrorInboundResult {
  applied: number;
  cursor: string | null;
  dropped: number;
  payloads: number;
}

interface InboundRecord {
  fields: Record<string, unknown>;
  recordId: string;
  tableName: MirroredTable;
}

function clockFor(options: MirrorClockOptions = {}): MirrorClock {
  return {
    now: options.now ?? (() => Date.now()),
    sleep: options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
  };
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

export async function mirrorWebhookSignature(
  body: string,
  macSecretBase64: string,
): Promise<string> {
  const secret = decodeBase64(macSecretBase64);
  if (!secret) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    secret as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function verifyMirrorWebhookSignature(
  body: string,
  supplied: string | null,
  macSecretBase64: string | null,
): Promise<boolean> {
  if (!supplied || !macSecretBase64) return false;
  const expected = await mirrorWebhookSignature(body, macSecretBase64);
  const actualBytes = decodeBase64(supplied.trim());
  const expectedBytes = decodeBase64(expected);
  return Boolean(actualBytes && expectedBytes && constantTimeEqual(actualBytes, expectedBytes));
}

function schemaFieldNames(table: AirtableTable | undefined): Map<string, string> {
  return new Map((table?.fields ?? []).map((field) => [field.id, field.name]));
}

function currentFields(
  current: Record<string, unknown> | undefined,
  table: AirtableTable | undefined,
): Record<string, unknown> {
  if (!current) return {};
  const named = current.fields;
  if (named && typeof named === "object" && !Array.isArray(named)) return named as Record<string, unknown>;
  const byId = current.cellValuesByFieldId;
  if (!byId || typeof byId !== "object" || Array.isArray(byId)) return current;
  const names = schemaFieldNames(table);
  return Object.fromEntries(Object.entries(byId as Record<string, unknown>).map(([id, value]) => [names.get(id) ?? id, value]));
}

function recordsFromPayload(
  payload: AirtableWebhookPayload,
  tableIds: ReadonlyMap<string, MirroredTable>,
  schema: ReadonlyMap<string, AirtableTable>,
): InboundRecord[] {
  const result: InboundRecord[] = [];
  const changedTables = payload.changedTablesById;
  if (changedTables && typeof changedTables === "object") {
    for (const [tableId, tableChanges] of Object.entries(changedTables)) {
      const tableName = tableIds.get(tableId);
      if (!tableName) continue;
      for (const [recordId, change] of Object.entries(tableChanges.changedRecordsById ?? {})) {
        result.push({
          recordId,
          tableName,
          fields: currentFields(change.current, schema.get(tableId)),
        });
      }
    }
  }
  // The fake and small local fixtures may provide the same information in a
  // compact form; accepting it here keeps the provider seam data-only while
  // the real adapter still passes Airtable's changedTablesById shape through.
  const compact = payload.records;
  if (Array.isArray(compact)) {
    for (const value of compact) {
      if (!value || typeof value !== "object") continue;
      const item = value as { table_id?: unknown; id?: unknown; fields?: unknown };
      const tableName = typeof item.table_id === "string" ? tableIds.get(item.table_id) : undefined;
      if (!tableName || typeof item.id !== "string" || !item.fields || typeof item.fields !== "object") continue;
      result.push({ recordId: item.id, tableName, fields: item.fields as Record<string, unknown> });
    }
  }
  return result;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim();
}

function stringList(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const values = value.map(stringValue);
    return values.every((item): item is string => item !== null) ? values : null;
  }
  const single = stringValue(value);
  return single === null ? null : single.split(",").map((item) => item.trim()).filter(Boolean);
}

async function trackIdsFor(
  db: D1Database,
  eventId: string,
  value: unknown,
): Promise<string[] | null> {
  const requested = stringList(value);
  if (requested === null) return null;
  if (requested.length === 0) return [];
  const result = await db.prepare(
    `SELECT id, name FROM tracks
      WHERE event_id = ? AND (id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        OR name IN (SELECT CAST(value AS TEXT) FROM json_each(?)))`,
  ).bind(eventId, JSON.stringify(requested), JSON.stringify(requested)).all<{ id: string; name: string }>();
  const byKey = new Map(result.results.flatMap((row) => [[row.id, row.id], [row.name, row.id]] as const));
  const ids = requested.map((item) => byKey.get(item));
  return ids.every((id): id is string => Boolean(id)) ? [...new Set(ids)] : null;
}

async function applySubmissionRecord(
  db: D1Database,
  rowId: string,
  fields: Record<string, unknown>,
  now: number,
): Promise<{ applied: boolean; dropped: number }> {
  const row = await db.prepare(
    `SELECT submission.event_id, submission.primary_track_id, submission.status, submission.title,
            EXISTS (
              SELECT 1 FROM agenda_items live_agenda
               WHERE live_agenda.event_id = submission.event_id
                 AND live_agenda.submission_id = submission.id
                 AND live_agenda.kind = 'session'
                 AND live_agenda.is_published = 1
            ) AS agenda_published
       FROM submissions submission
      WHERE submission.id = ?`,
  ).bind(rowId).first<{
    event_id: string;
    primary_track_id: string | null;
    status: string;
    title: string;
    agenda_published: number;
  }>();
  if (!row) return { applied: false, dropped: 0 };
  const allowed = MIRROR_INBOUND_ALLOWLIST.submissions;
  let dropped = Object.keys(fields).filter((field) => field !== "marquee_id" && !allowed.includes(field)).length;
  const assignments: string[] = [];
  const values: (string | number | null)[] = [];
  let changed = false;
  let decisionId: string | null = null;
  let decision: "approve" | "maybe" | "deny" | null = null;
  let decisionResultingStatus: (typeof DECISION_STATUSES)[number] | null = null;
  if (Object.hasOwn(fields, "status") && row.agenda_published === 1) {
    await recordMirrorSubmissionRejection({
      db,
      eventId: row.event_id,
      rowId,
      field: "status",
      reason: "forbidden_while_published",
      before: row.status,
      requested: fields.status,
      title: row.title,
      now,
    });
    dropped += 1;
  } else if (Object.hasOwn(fields, "status")) {
    const requestedStatus = fields.status;
    if (typeof requestedStatus !== "string" || !SUBMISSION_STATUSES.includes(requestedStatus as (typeof SUBMISSION_STATUSES)[number])) {
      await recordMirrorSubmissionRejection({
        db,
        eventId: row.event_id,
        rowId,
        field: "status",
        reason: "unrecognized_value",
        before: row.status,
        requested: requestedStatus,
        title: row.title,
        now,
      });
      dropped += 1;
    } else {
      const invalidTransition = canTransitionSubmissionStatus(row.status, requestedStatus, "airtable");
      if (invalidTransition) {
        await recordMirrorSubmissionRejection({
          db,
          eventId: row.event_id,
          rowId,
          field: "status",
          reason: "illegal_transition",
          before: row.status,
          requested: requestedStatus,
          title: row.title,
          now,
        });
        dropped += 1;
      } else if (row.status !== requestedStatus) {
        assignments.push("status = ?"); values.push(requestedStatus); changed = true;
        if (DECISION_STATUSES.includes(requestedStatus as (typeof DECISION_STATUSES)[number])) {
          decisionId = newUlid(now);
          decision = requestedStatus === "accepted" ? "approve" : requestedStatus === "waitlisted" ? "maybe" : "deny";
          decisionResultingStatus = requestedStatus as (typeof DECISION_STATUSES)[number];
          assignments.push("decided_at = ?", "decided_by_person_id = ?"); values.push(now, null);
        }
      }
    }
  }
  if (Object.hasOwn(fields, "format_id")) {
    const formatId = stringValue(fields.format_id);
    if (formatId === null) {
      assignments.push("format_id = ?"); values.push(null); changed = true;
    } else {
      const format = await db.prepare("SELECT 1 FROM formats WHERE id = ? AND event_id = ?").bind(formatId, row.event_id).first();
      if (format) { assignments.push("format_id = ?"); values.push(formatId); changed = true; }
    }
  }
  if (Object.hasOwn(fields, "vendor_affiliation") && typeof fields.vendor_affiliation === "string" && VENDOR_AFFILIATION.has(fields.vendor_affiliation)) {
    assignments.push("vendor_affiliation = ?"); values.push(fields.vendor_affiliation); changed = true;
  }
  let primaryTrackId: string | null | undefined;
  if (Object.hasOwn(fields, "primary_track_id")) {
    const candidate = stringValue(fields.primary_track_id);
    if (candidate === null) primaryTrackId = null;
    else {
      const track = await db.prepare("SELECT id FROM tracks WHERE id = ? AND event_id = ?").bind(candidate, row.event_id).first<{ id: string }>();
      if (track) primaryTrackId = track.id;
    }
    if (primaryTrackId !== undefined) {
      assignments.push("primary_track_id = ?"); values.push(primaryTrackId); changed = true;
    }
  }
  const trackIds = Object.hasOwn(fields, "tracks") ? await trackIdsFor(db, row.event_id, fields.tracks) : undefined;
  if (Object.hasOwn(fields, "tracks") && trackIds !== null) changed = true;
  if (!changed) return { applied: false, dropped };
  assignments.push("last_write_source = 'airtable'", "updated_at = ?"); values.push(now);
  const statements = [db.prepare(`UPDATE submissions SET ${assignments.join(", ")} WHERE id = ?`).bind(...values, rowId)];
  if (trackIds !== undefined && trackIds !== null) {
    const primary = primaryTrackId === undefined
      ? row.primary_track_id && trackIds.includes(row.primary_track_id) ? row.primary_track_id : trackIds[0] ?? null
      : primaryTrackId;
    statements.push(db.prepare("DELETE FROM submission_tracks WHERE submission_id = ?").bind(rowId));
    statements.push(...trackIds.map((trackId, index) => db.prepare(
      `INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), rowId, trackId, trackId === primary || (primary === null && index === 0) ? 1 : 0, now, now)));
  }
  if (decisionId !== null && decision !== null && decisionResultingStatus !== null) {
    statements.push(db.prepare(
      `INSERT INTO submission_decisions
        (id, event_id, submission_id, decision, resulting_status, feedback_md,
         decided_by_person_id, decided_at, outbox_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)`,
    ).bind(decisionId, row.event_id, rowId, decision, decisionResultingStatus, now, now, now));
    statements.push(auditStatement(db, {
      eventId: row.event_id,
      actorKind: "airtable",
      actorPersonId: null,
      action: `submission.${decision}`,
      entityType: "submission",
      entityId: rowId,
      before: { status: row.status },
      after: { status: decisionResultingStatus, decision_id: decisionId, source: "airtable" },
      now,
      requestId: null,
    }));
  }
  await db.batch(statements);
  return { applied: true, dropped };
}

async function applySpeakerTaskRecord(
  db: D1Database,
  rowId: string,
  fields: Record<string, unknown>,
  now: number,
): Promise<{ applied: boolean; dropped: number }> {
  const dropped = Object.keys(fields).filter((field) => field !== "marquee_id" && !MIRROR_INBOUND_ALLOWLIST.speaker_tasks.includes(field)).length;
  if (!Object.hasOwn(fields, "status") || typeof fields.status !== "string" || !TASK_STATUS.has(fields.status)) return { applied: false, dropped };
  const result = await db.prepare(
    "UPDATE speaker_tasks SET status = ?, last_write_source = 'airtable', updated_at = ? WHERE id = ?",
  ).bind(fields.status, now, rowId).run();
  return { applied: Number(result.meta.changes ?? 0) > 0, dropped };
}

async function applyPersonRecord(
  db: D1Database,
  rowId: string,
  fields: Record<string, unknown>,
  now: number,
): Promise<{ applied: boolean; dropped: number }> {
  const dropped = Object.keys(fields).filter((field) => field !== "marquee_id" && !MIRROR_INBOUND_ALLOWLIST.people.includes(field)).length;
  const assignments: string[] = [];
  const values: (string | null)[] = [];
  for (const field of ["title", "company"] as const) {
    if (!Object.hasOwn(fields, field) || (fields[field] !== null && typeof fields[field] !== "string")) continue;
    assignments.push(`${field} = ?`);
    values.push(fields[field] === null ? null : String(fields[field]));
  }
  if (assignments.length === 0) return { applied: false, dropped };
  assignments.push("last_write_source = 'airtable'", "updated_at = ?");
  values.push(String(now));
  const result = await db.prepare(`UPDATE people SET ${assignments.join(", ")} WHERE id = ?`).bind(...values, rowId).run();
  return { applied: Number(result.meta.changes ?? 0) > 0, dropped };
}

export async function applyMirrorRecord(
  db: D1Database,
  tableName: MirroredTable,
  fields: Record<string, unknown>,
  now = Date.now(),
): Promise<{ applied: boolean; dropped: number }> {
  const rowId = stringValue(fields.marquee_id);
  if (!rowId) return { applied: false, dropped: Object.keys(fields).length };
  if (tableName === "submissions") return applySubmissionRecord(db, rowId, fields, now);
  if (tableName === "speaker_tasks") return applySpeakerTaskRecord(db, rowId, fields, now);
  return applyPersonRecord(db, rowId, fields, now);
}

function transportFor(
  env: MirrorActionEnvironment,
  token: string,
  baseId: string,
  limiter: MirrorTokenBucket,
): AirtableTransport {
  if (env.MIRROR_TRANSPORT) return rateLimitedAirtableTransport(env.MIRROR_TRANSPORT, limiter);
  return createFetchAirtableTransport({ apiKey: token, baseId, beforeRequest: () => limiter.take() });
}

export async function pullMirrorPayloads(
  env: MirrorActionEnvironment,
  options: MirrorClockOptions & { limiter?: MirrorTokenBucket; transport?: AirtableTransport } = {},
): Promise<MirrorInboundResult> {
  const clock = clockFor(options);
  const credential = await readMirrorCredential(env.DB, env);
  if (!credential) return { applied: 0, cursor: null, dropped: 0, payloads: 0 };
  const stateRows = await env.DB.prepare(
    `SELECT table_name, airtable_table_id, webhook_id, cursor
       FROM mirror_state
      WHERE table_name IN ('submissions', 'speaker_tasks', 'people')
      ORDER BY updated_at DESC`,
  ).all<{ table_name: MirroredTable; airtable_table_id: string | null; webhook_id: string | null; cursor: string | null }>();
  const webhookId = stateRows.results.find((row) => row.webhook_id)?.webhook_id;
  if (!webhookId || !credential.webhookSecret) return { applied: 0, cursor: null, dropped: 0, payloads: 0 };
  const limiter = options.limiter ?? new MirrorTokenBucket(clock);
  const transport = options.transport
    ? rateLimitedAirtableTransport(options.transport, limiter)
    : transportFor(env, credential.token, credential.baseId, limiter);
  const schema = await transport.readBaseSchema();
  const schemaById = new Map(schema.tables.map((table) => [table.id, table]));
  const tableIds = new Map(stateRows.results.flatMap((row) => row.airtable_table_id ? [[row.airtable_table_id, row.table_name] as const] : []));
  let cursor = stateRows.results.find((row) => row.cursor)?.cursor ?? null;
  let applied = 0;
  let dropped = 0;
  let payloads = 0;
  for (let page = 0; page < 20; page += 1) {
    const previousCursor = cursor;
    const response = await transport.listPayloads({ webhookId, cursor });
    cursor = response.cursor ?? cursor;
    payloads += response.payloads.length;
    for (const payload of response.payloads) {
      for (const record of recordsFromPayload(payload, tableIds, schemaById)) {
        const result = await applyMirrorRecord(env.DB, record.tableName, record.fields, clock.now());
        if (result.applied) applied += 1;
        dropped += result.dropped;
      }
    }
    if (!response.mightHaveMore || cursor === previousCursor) break;
  }
  await env.DB.prepare(
    "UPDATE mirror_state SET cursor = ?, updated_at = ? WHERE table_name IN ('submissions', 'speaker_tasks', 'people')",
  ).bind(cursor, clock.now()).run();
  return { applied, cursor, dropped, payloads };
}

export async function handleMirrorWebhook(
  env: MirrorActionEnvironment,
  request: Request,
  options: MirrorClockOptions = {},
): Promise<{ body: MirrorInboundResult | { accepted: false } | { accepted: true; queued: boolean }; status: 200 | 202 | 401 }> {
  const body = await request.text();
  const supplied = request.headers.get("X-Airtable-Webhook-Signature");
  const credential = await readMirrorCredential(env.DB, env);
  if (!credential || !(await verifyMirrorWebhookSignature(body, supplied, credential.webhookSecret))) {
    return { body: { accepted: false }, status: 401 };
  }
  // Airtable's webhook request is a signed ping. Pulling the cursor is the
  // actual work; the body is not trusted as a D1 mutation command.
  if (env.MIRROR_QUEUE) {
    await env.MIRROR_QUEUE.send({
      type: MIRROR_INBOUND_MESSAGE_TYPE,
      requested_at: options.now?.() ?? Date.now(),
    });
    return { body: { accepted: true, queued: true }, status: 202 };
  }
  const result = await pullMirrorPayloads(env, options);
  return { body: result, status: 200 };
}
