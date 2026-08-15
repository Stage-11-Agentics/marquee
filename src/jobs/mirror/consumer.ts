import type { D1Database, MessageBatch, Queue } from "@cloudflare/workers-types";

import type { MirrorOutboxRow } from "../../db/schema";
import { mirrorConfig, type MirrorEnvironment } from "./config";
import { currentAirtableRecord, currentRowIds, MIRRORED_TABLES, type MirroredTable } from "./records";
import {
  MIRROR_OUTBOX_MESSAGE_TYPE,
  MIRROR_RECONCILE_MESSAGE_TYPE,
  type MirrorQueueMessage,
} from "./messages";
import { MirrorTokenBucket, type MirrorClock } from "./rate-limiter";
import { createFetchAirtableTransport, type AirtableTransport } from "./transport";
import { parseMirrorOutboxPayload } from "./outbox";

const PROCESSING_LEASE_MS = 5 * 60_000;
const PROVIDER_BATCH_SIZE = 10;
export const MAX_MIRROR_ATTEMPTS = 5;

export interface MirrorConsumerEnvironment extends MirrorEnvironment {
  MIRROR_QUEUE: Queue<unknown>;
}

export interface MirrorDrainOptions {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  transport?: AirtableTransport;
  limiter?: MirrorTokenBucket;
}

interface ClaimedMirrorRow extends MirrorOutboxRow {
  table_name: MirroredTable;
}

function clockFor(options: MirrorDrainOptions): MirrorClock {
  return {
    now: options.now ?? (() => Date.now()),
    sleep: options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
  };
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push([...values.slice(index, index + size)]);
  return result;
}

function isMirroredTable(value: string): value is MirroredTable {
  return (MIRRORED_TABLES as readonly string[]).includes(value);
}

function isMirrorMessage(value: unknown): value is MirrorQueueMessage {
  if (!value || typeof value !== "object") return false;
  const body = value as { type?: unknown };
  return body.type === MIRROR_OUTBOX_MESSAGE_TYPE || body.type === MIRROR_RECONCILE_MESSAGE_TYPE;
}

function rateLimitedTransport(transport: AirtableTransport, limiter: MirrorTokenBucket): AirtableTransport {
  return {
    async patchRecords(input) {
      await limiter.take();
      await transport.patchRecords(input);
    },
    async deleteRecords(input) {
      await limiter.take();
      await transport.deleteRecords(input);
    },
  };
}

async function claimRow(db: D1Database, id: string, now: number): Promise<ClaimedMirrorRow | null> {
  const result = await db.prepare(
    `UPDATE mirror_outbox
        SET status = 'processing', attempts = attempts + 1, updated_at = ?
      WHERE id = ?
        AND drained_at IS NULL
        AND attempts < ?
        AND (
          status IN ('queued', 'failed')
          OR (status = 'processing' AND updated_at < ?)
        )`,
  ).bind(now, id, MAX_MIRROR_ATTEMPTS, now - PROCESSING_LEASE_MS).run();
  if (Number(result.meta.changes ?? 0) !== 1) return null;
  const row = await db.prepare("SELECT * FROM mirror_outbox WHERE id = ?").bind(id).first<MirrorOutboxRow>();
  if (!row || !isMirroredTable(row.table_name)) return null;
  return row as ClaimedMirrorRow;
}

async function claimAllPending(db: D1Database, now: number): Promise<ClaimedMirrorRow[]> {
  const rows = await db.prepare(
    `SELECT id FROM mirror_outbox
      WHERE drained_at IS NULL
        AND status IN ('queued', 'failed')
        AND attempts < ?
      ORDER BY created_at ASC, id ASC
      LIMIT 100`,
  ).bind(MAX_MIRROR_ATTEMPTS).all<{ id: string }>();
  const claimed: ClaimedMirrorRow[] = [];
  for (const row of rows.results) {
    const next = await claimRow(db, row.id, now);
    if (next) claimed.push(next);
  }
  return claimed;
}

async function markFailed(db: D1Database, rows: readonly MirrorOutboxRow[], error: unknown, now: number): Promise<void> {
  if (rows.length === 0) return;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const placeholders = rows.map(() => "?").join(",");
  await db.prepare(
    `UPDATE mirror_outbox
        SET status = 'failed', last_error = ?, updated_at = ?
      WHERE id IN (${placeholders}) AND drained_at IS NULL`,
  ).bind(message, now, ...rows.map((row) => row.id)).run();
  for (const tableName of new Set(rows.map((row) => row.table_name))) {
    await db.prepare(
      "UPDATE mirror_state SET last_error = ?, updated_at = ? WHERE table_name = ?",
    ).bind(message, now, tableName,).run();
  }
}

async function markDrained(db: D1Database, rows: readonly MirrorOutboxRow[], now: number): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows.map(() => "?").join(",");
  await db.prepare(
    `UPDATE mirror_outbox
        SET status = 'drained', last_error = NULL, drained_at = ?, updated_at = ?
      WHERE id IN (${placeholders}) AND status = 'processing'`,
  ).bind(now, now, ...rows.map((row) => row.id)).run();
  for (const tableName of new Set(rows.map((row) => row.table_name))) {
    await db.prepare(
      `UPDATE mirror_state
          SET last_sync_at = ?, last_error = NULL, updated_at = ?
        WHERE table_name = ? AND airtable_table_id IS NOT NULL`,
    ).bind(now, now, tableName).run();
  }
}

async function tableId(db: D1Database, tableName: MirroredTable): Promise<string | null> {
  const state = await db.prepare(
    "SELECT airtable_table_id FROM mirror_state WHERE table_name = ?",
  ).bind(tableName).first<{ airtable_table_id: string | null }>();
  const id = state?.airtable_table_id?.trim();
  return id || null;
}

async function sendBatch(
  db: D1Database,
  env: MirrorConsumerEnvironment,
  rows: readonly ClaimedMirrorRow[],
  transport: AirtableTransport,
  now: number,
): Promise<void> {
  const tableGroups = new Map<MirroredTable, ClaimedMirrorRow[]>();
  for (const row of rows) {
    const group = tableGroups.get(row.table_name) ?? [];
    group.push(row);
    tableGroups.set(row.table_name, group);
  }

  for (const [tableName, group] of tableGroups) {
    const airtableTableId = await tableId(db, tableName);
    if (!airtableTableId) continue;
    // D1's own derived-column triggers can produce more than one physical
    // outbox row for a single write. The current D1 row is authoritative, so
    // collapse one claimed batch to its latest row id before making provider
    // calls; every physical row is still marked drained below.
    const latestByRow = new Map<string, ClaimedMirrorRow>();
    for (const row of group) latestByRow.set(row.row_id, row);
    for (const groupChunk of chunks([...latestByRow.values()], PROVIDER_BATCH_SIZE)) {
      const upserts = [];
      const deletes: string[] = [];
      for (const row of groupChunk) {
        const current = await currentAirtableRecord({ DB: env.DB, mirror: mirrorConfig(env)! }, tableName, row.row_id);
        if (current) upserts.push(current);
        else deletes.push(parseMirrorOutboxPayload(row).marquee_id ?? row.row_id);
      }
      if (upserts.length > 0) {
        await transport.patchRecords({ tableId: airtableTableId, records: upserts });
      }
      if (deletes.length > 0) {
        await transport.deleteRecords({ tableId: airtableTableId, marqueeIds: deletes });
      }
      const rowIds = new Set(groupChunk.map((row) => row.row_id));
      await markDrained(db, group.filter((row) => rowIds.has(row.row_id)), now);
    }
  }
}

/** Drain one queue batch. The fake transport is injected by the hermetic suite. */
export async function drainMirrorOutbox(
  db: D1Database,
  env: MirrorConsumerEnvironment,
  ids: readonly string[] = [],
  options: MirrorDrainOptions = {},
): Promise<{ claimed: number; drained: number }> {
  const config = mirrorConfig(env);
  if (!config) return { claimed: 0, drained: 0 };
  const clock = clockFor(options);
  const now = clock.now();
  const claimed: ClaimedMirrorRow[] = [];
  if (ids.length > 0) {
    for (const id of [...new Set(ids)]) {
      const row = await claimRow(db, id, now);
      if (row) claimed.push(row);
    }
  } else {
    claimed.push(...await claimAllPending(db, now));
  }
  if (claimed.length === 0) return { claimed: 0, drained: 0 };

  const limiter = options.limiter ?? new MirrorTokenBucket(clock);
  const transport = options.transport
    ? rateLimitedTransport(options.transport, limiter)
    : createFetchAirtableTransport({ apiKey: config.apiKey, baseId: config.baseId, beforeRequest: () => limiter.take() });
  try {
    await sendBatch(db, env, claimed, transport, now);
  } catch (error) {
    await markFailed(db, claimed, error, clock.now());
    throw error;
  }
  const drained = await db.prepare(
    `SELECT COUNT(*) AS count FROM mirror_outbox
      WHERE id IN (${claimed.map(() => "?").join(",")}) AND drained_at IS NOT NULL`,
  ).bind(...claimed.map((row) => row.id)).first<{ count: number }>();
  return { claimed: claimed.length, drained: Number(drained?.count ?? 0) };
}

/** Reconcile reads D1 and sends current truth directly; it never creates per-row outbox work. */
export async function reconcileMirror(
  db: D1Database,
  env: MirrorConsumerEnvironment,
  options: MirrorDrainOptions = {},
): Promise<{ requests: number; records: number }> {
  const config = mirrorConfig(env);
  if (!config) return { requests: 0, records: 0 };
  const clock = clockFor(options);
  const limiter = options.limiter ?? new MirrorTokenBucket(clock);
  const transport = options.transport
    ? rateLimitedTransport(options.transport, limiter)
    : createFetchAirtableTransport({ apiKey: config.apiKey, baseId: config.baseId, beforeRequest: () => limiter.take() });
  let requests = 0;
  let records = 0;
  for (const tableName of MIRRORED_TABLES) {
    const airtableTableId = await tableId(db, tableName);
    if (!airtableTableId) continue;
    const ids = await currentRowIds(db, tableName);
    for (const idsChunk of chunks(ids, PROVIDER_BATCH_SIZE)) {
      const current = await Promise.all(idsChunk.map((id) => currentAirtableRecord({ DB: db, mirror: config }, tableName, id)));
      const recordsChunk = current.filter((record): record is NonNullable<typeof record> => record !== null);
      if (recordsChunk.length === 0) continue;
      await transport.patchRecords({ tableId: airtableTableId, records: recordsChunk });
      requests += 1;
      records += recordsChunk.length;
    }
    await db.prepare(
      "UPDATE mirror_state SET last_sync_at = ?, last_error = NULL, updated_at = ? WHERE table_name = ?",
    ).bind(clock.now(), clock.now(), tableName).run();
  }
  return { requests, records };
}

export async function processMirrorQueue(
  batch: MessageBatch<unknown>,
  env: MirrorConsumerEnvironment,
  options: MirrorDrainOptions = {},
): Promise<{ outbox: number; reconcile: number }> {
  const messages = batch.messages.filter((message): message is typeof message & { body: MirrorQueueMessage } => isMirrorMessage(message.body));
  if (messages.length === 0) return { outbox: 0, reconcile: 0 };
  if (!mirrorConfig(env)) return { outbox: 0, reconcile: 0 };
  const outboxIds = messages
    .map((message) => message.body)
    .filter((body): body is Extract<MirrorQueueMessage, { type: typeof MIRROR_OUTBOX_MESSAGE_TYPE }> => body.type === MIRROR_OUTBOX_MESSAGE_TYPE)
    .map((body) => body.outbox_id);
  const reconcileCount = messages.filter((message) => message.body.type === MIRROR_RECONCILE_MESSAGE_TYPE).length;
  const sharedLimiter = options.limiter ?? new MirrorTokenBucket(clockFor(options));
  const sharedOptions = { ...options, limiter: sharedLimiter };
  const transport = options.transport;
  let outbox = 0;
  if (outboxIds.length > 0) {
    outbox = (await drainMirrorOutbox(env.DB, env, outboxIds, { ...sharedOptions, transport })).drained;
  }
  let reconcile = 0;
  if (reconcileCount > 0) {
    reconcile = (await reconcileMirror(env.DB, env, { ...sharedOptions, transport })).records;
  }
  return { outbox, reconcile };
}
