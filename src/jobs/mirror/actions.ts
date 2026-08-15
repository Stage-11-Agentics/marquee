import type { D1Database, Queue } from "@cloudflare/workers-types";

import { newUlid } from "../../api/ids";
import { MAX_MIRROR_ATTEMPTS } from "./limits";
import {
  encryptMirrorSecret,
  readMirrorCredential,
  redactMirrorError,
  tokenFingerprint,
} from "./credentials";
import { clearMirrorOutbox } from "./outbox";
import { MIRRORED_TABLES, type MirroredTable } from "./records";
import { MirrorTokenBucket, type MirrorClock } from "./rate-limiter";
import {
  AirtableTransportError,
  createFetchAirtableTransport,
  rateLimitedAirtableTransport,
  type AirtableTable,
  type AirtableTransport,
} from "./transport";
import { MIRROR_RECONCILE_MESSAGE_TYPE } from "./messages";
import type { MirrorEnvironment } from "./config";

export interface MirrorActionEnvironment extends MirrorEnvironment {
  MIRROR_QUEUE?: Queue<unknown>;
}

export interface MirrorConnectionFailure {
  ok: false;
  field: "token" | "base_id" | "configuration" | "tables";
  message: string;
}

export interface MirrorConnectionSuccess {
  ok: true;
  tables: readonly AirtableTable[];
}

export type MirrorConnectionResult = MirrorConnectionFailure | MirrorConnectionSuccess;

export interface MirrorMappingInput {
  people: string;
  submissions: string;
  speaker_tasks: string;
}

export interface MirrorStatus {
  baseId: string | null;
  baseUrl: string | null;
  configured: boolean;
  lastError: string | null;
  lastSyncAt: number | null;
  lastVerifiedAt: number | null;
  mapped: boolean;
  queued: number;
  setAt: number | null;
  stuck: number;
  tables: Array<{
    airtableTableId: string | null;
    localRowCount: number;
    lastSyncAt: number | null;
    name: MirroredTable;
    remoteRowCount: number;
  }>;
  tokenFingerprint: string | null;
  trafficAssisted: boolean;
  webhookExpiresAt: number | null;
}

export interface MirrorClockOptions {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const WEBHOOK_REFRESH_WINDOW_MS = 24 * 60 * 60_000;
const DEFAULT_WEBHOOK_URL = "https://marquee.stage11.dev/mirror/webhook";

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function providerFor(
  env: MirrorActionEnvironment,
  apiKey: string,
  baseId: string,
  limiter?: MirrorTokenBucket,
): AirtableTransport {
  if (env.MIRROR_TRANSPORT) {
    return limiter ? rateLimitedAirtableTransport(env.MIRROR_TRANSPORT, limiter) : env.MIRROR_TRANSPORT;
  }
  return createFetchAirtableTransport({
    apiKey,
    baseId,
    beforeRequest: limiter ? () => limiter.take() : undefined,
  });
}

function failureForProvider(error: unknown): MirrorConnectionFailure {
  const status = error instanceof AirtableTransportError ? error.status : 0;
  return {
    ok: false,
    field: status === 401 || status === 403 ? "token" : "base_id",
    message: status === 401 || status === 403
      ? "Airtable rejected this token. Check the personal access token and its base access."
      : status === 404
        ? "Airtable could not find or open this base. Check the base ID and token access."
        : "Airtable could not be reached with this token and base.",
  };
}

function tablesById(tables: readonly AirtableTable[]): Map<string, AirtableTable> {
  return new Map(tables.map((table) => [table.id, table]));
}

export async function connectMirror(
  env: MirrorActionEnvironment,
  input: { baseId: string; orgId: string; setByPersonId: string; token: string; now?: number },
): Promise<MirrorConnectionResult> {
  const token = nonEmpty(input.token);
  const baseId = nonEmpty(input.baseId);
  if (!token) return { ok: false, field: "token", message: "Enter an Airtable personal access token." };
  if (!baseId) return { ok: false, field: "base_id", message: "Enter an Airtable base ID." };
  if (!nonEmpty(env.MIRROR_CREDENTIAL_SECRET)) {
    return { ok: false, field: "configuration", message: "The deployment is missing MIRROR_CREDENTIAL_SECRET." };
  }

  let tables: readonly AirtableTable[];
  try {
    tables = (await providerFor(env, token, baseId).readBaseSchema()).tables;
  } catch (error) {
    return failureForProvider(error);
  }
  if (tables.length === 0) {
    return { ok: false, field: "base_id", message: "Airtable returned no tables for this base." };
  }

  const now = input.now ?? Date.now();
  const tokenCiphertext = await encryptMirrorSecret(token, env.MIRROR_CREDENTIAL_SECRET!);
  const fingerprint = await tokenFingerprint(token);
  const credentialId = newUlid(now);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO mirror_credentials
        (id, org_id, token_ciphertext, webhook_secret_ciphertext, token_fingerprint,
         base_id, set_at, set_by_person_id, last_verified_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET
         token_ciphertext = excluded.token_ciphertext,
         webhook_secret_ciphertext = NULL,
         token_fingerprint = excluded.token_fingerprint,
         base_id = excluded.base_id,
         set_at = excluded.set_at,
         set_by_person_id = excluded.set_by_person_id,
         last_verified_at = excluded.last_verified_at,
         last_error = NULL,
         updated_at = excluded.updated_at`,
    ).bind(
      credentialId,
      input.orgId,
      tokenCiphertext,
      fingerprint,
      baseId,
      now,
      input.setByPersonId,
      now,
      now,
      now,
    ),
    // Connecting a different base must not leave the old table IDs as an
    // accidental on-switch. The pending feed stays intact; only disconnect
    // is allowed to clear it.
    env.DB.prepare(
      `UPDATE mirror_state
          SET airtable_table_id = NULL, cursor = NULL, webhook_id = NULL,
              webhook_expires_at = NULL, updated_at = ?
        WHERE table_name IN ('submissions', 'speaker_tasks', 'people')`,
    ).bind(now),
  ]);
  return { ok: true, tables };
}

function mappingValue(input: MirrorMappingInput, tableName: MirroredTable): string | null {
  const value = input[tableName];
  return nonEmpty(value);
}

export async function mapMirror(
  env: MirrorActionEnvironment,
  input: { mapping: MirrorMappingInput; orgId: string; webhookUrl?: string; now?: number; clock?: MirrorClockOptions },
): Promise<MirrorConnectionResult> {
  const selected = MIRRORED_TABLES.map((tableName) => [tableName, mappingValue(input.mapping, tableName)] as const);
  const missing = selected.find(([, tableId]) => !tableId);
  if (missing) return { ok: false, field: "tables", message: `Choose the Airtable table for ${missing[0]}.` };
  const credential = await readMirrorCredential(env.DB, env, input.orgId);
  if (!credential) return { ok: false, field: "configuration", message: "Connect Airtable before mapping its tables." };
  if (!nonEmpty(env.MIRROR_CREDENTIAL_SECRET)) {
    return { ok: false, field: "configuration", message: "The deployment is missing MIRROR_CREDENTIAL_SECRET." };
  }
  const clock: MirrorClock = {
    now: input.clock?.now ?? (() => Date.now()),
    sleep: input.clock?.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
  };
  const limiter = new MirrorTokenBucket(clock);
  const transport = providerFor(env, credential.token, credential.baseId, limiter);
  let tables: readonly AirtableTable[];
  try {
    tables = (await transport.readBaseSchema()).tables;
  } catch (error) {
    return failureForProvider(error);
  }
  const available = tablesById(tables);
  for (const [tableName, tableId] of selected) {
    if (!available.has(tableId!)) {
      return { ok: false, field: "tables", message: `Airtable does not have the selected ${tableName} table.` };
    }
  }

  let webhook: Awaited<ReturnType<AirtableTransport["createWebhook"]>>;
  try {
    webhook = await transport.createWebhook({
      notificationUrl: nonEmpty(input.webhookUrl) ?? nonEmpty(env.MIRROR_WEBHOOK_URL) ?? DEFAULT_WEBHOOK_URL,
    });
  } catch (error) {
    return failureForProvider(error);
  }
  if (!webhook.macSecretBase64) {
    return { ok: false, field: "configuration", message: "Airtable did not return a webhook signature secret." };
  }

  const now = input.now ?? clock.now();
  const credentialSecret = nonEmpty(env.MIRROR_CREDENTIAL_SECRET);
  if (!credentialSecret) return { ok: false, field: "configuration", message: "The deployment is missing MIRROR_CREDENTIAL_SECRET." };
  const webhookCiphertext = await encryptMirrorSecret(webhook.macSecretBase64, credentialSecret);
  const states = await Promise.all(MIRRORED_TABLES.map(async (tableName) => {
    const local = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first<{ count: number }>();
    return { tableName, localCount: Number(local?.count ?? 0) };
  }));
  const stateByName = new Map(states.map((state) => [state.tableName, state.localCount]));
  const statements = [
    env.DB.prepare(
      `UPDATE mirror_credentials
          SET webhook_secret_ciphertext = ?, last_verified_at = ?, last_error = NULL, updated_at = ?
        WHERE org_id = ?`,
    ).bind(webhookCiphertext, now, now, input.orgId),
    env.DB.prepare(
      "DELETE FROM mirror_state WHERE table_name IN ('submissions', 'speaker_tasks', 'people')",
    ),
    ...selected.map(([tableName, tableId]) => env.DB.prepare(
      `INSERT INTO mirror_state
        (id, table_name, airtable_table_id, cursor, webhook_id, webhook_expires_at,
         last_sync_at, local_row_count, remote_row_count, last_error, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, 0, NULL, ?, ?)`,
    ).bind(
      newUlid(now),
      tableName,
      tableId,
      webhook.id,
      webhook.expirationTime,
      stateByName.get(tableName) ?? 0,
      now,
      now,
    )),
  ];
  await env.DB.batch(statements);
  return { ok: true, tables };
}

export async function readMirrorStatus(
  db: D1Database,
  environment: MirrorActionEnvironment,
  orgId?: string,
): Promise<MirrorStatus> {
  const credential = await readMirrorCredential(db, environment, orgId);
  const states = await db.prepare(
    `SELECT table_name AS name, airtable_table_id AS airtableTableId,
            local_row_count AS localRowCount, remote_row_count AS remoteRowCount,
            last_sync_at AS lastSyncAt, webhook_expires_at AS webhookExpiresAt
       FROM mirror_state
      WHERE table_name IN ('submissions', 'speaker_tasks', 'people')
      ORDER BY CASE table_name WHEN 'submissions' THEN 0 WHEN 'speaker_tasks' THEN 1 ELSE 2 END`,
  ).all<{
    airtableTableId: string | null;
    lastSyncAt: number | null;
    localRowCount: number;
    name: MirroredTable;
    remoteRowCount: number;
    webhookExpiresAt: number | null;
  }>();
  const byName = new Map(states.results.map((row) => [row.name, row]));
  const tables = MIRRORED_TABLES.map((name) => {
    const row = byName.get(name);
    return {
      name,
      airtableTableId: row?.airtableTableId ?? null,
      localRowCount: Number(row?.localRowCount ?? 0),
      remoteRowCount: Number(row?.remoteRowCount ?? 0),
      lastSyncAt: row?.lastSyncAt ?? null,
    };
  });
  const queued = await db.prepare(
    "SELECT COUNT(*) AS count FROM mirror_outbox WHERE drained_at IS NULL AND attempts < ?",
  ).bind(MAX_MIRROR_ATTEMPTS).first<{ count: number }>();
  const stuck = await db.prepare(
    "SELECT COUNT(*) AS count FROM mirror_outbox WHERE drained_at IS NULL AND attempts >= ?",
  ).bind(MAX_MIRROR_ATTEMPTS).first<{ count: number }>();
  const lastSyncAt = tables.reduce<number | null>((latest, row) =>
    row.lastSyncAt !== null && (latest === null || row.lastSyncAt > latest) ? row.lastSyncAt : latest, null);
  const webhookExpiresAt = states.results.reduce<number | null>((latest, row) =>
    row.webhookExpiresAt !== null && (latest === null || row.webhookExpiresAt < latest) ? row.webhookExpiresAt : latest, null);
  const mapped = tables.every((table) => table.airtableTableId !== null);
  return {
    baseId: credential?.baseId ?? null,
    baseUrl: credential?.baseId ? `https://airtable.com/${credential.baseId}` : null,
    configured: credential !== null,
    lastError: credential?.lastError ?? null,
    lastSyncAt,
    lastVerifiedAt: credential?.lastVerifiedAt ?? null,
    mapped,
    queued: Number(queued?.count ?? 0),
    setAt: credential?.setAt ?? null,
    stuck: Number(stuck?.count ?? 0),
    tables,
    tokenFingerprint: credential?.tokenFingerprint ?? null,
    trafficAssisted: true,
    webhookExpiresAt,
  };
}

export async function disconnectMirror(
  env: MirrorActionEnvironment,
  orgId: string,
): Promise<{ warning: string | null }> {
  const credential = await readMirrorCredential(env.DB, env, orgId);
  const state = await env.DB.prepare(
    "SELECT webhook_id FROM mirror_state WHERE webhook_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1",
  ).first<{ webhook_id: string }>();
  let warning: string | null = null;
  if (credential && state?.webhook_id) {
    try {
      await providerFor(env, credential.token, credential.baseId).deleteWebhook({ webhookId: state.webhook_id });
    } catch (error) {
      warning = redactMirrorError(error, [credential.token]);
    }
  }
  // Explicit disconnect is the one legitimate cleanup action for the feed.
  await clearMirrorOutbox(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM mirror_credentials WHERE org_id = ?").bind(orgId),
    env.DB.prepare("DELETE FROM mirror_state WHERE table_name IN ('submissions', 'speaker_tasks', 'people')"),
  ]);
  return { warning };
}

export async function queueMirrorSync(
  env: MirrorActionEnvironment,
  orgId?: string,
  now = Date.now(),
): Promise<{ queued: boolean }> {
  if (!env.MIRROR_QUEUE) return { queued: false };
  if (!(await readMirrorCredential(env.DB, env, orgId))) return { queued: false };
  await env.MIRROR_QUEUE.send({
    type: MIRROR_RECONCILE_MESSAGE_TYPE,
    reason: "manual",
    requested_at: now,
  });
  return { queued: true };
}

async function countRemoteRecords(
  transport: AirtableTransport,
  tableId: string,
): Promise<number> {
  let offset: string | undefined;
  let count = 0;
  do {
    const page = await transport.listRecords({ tableId, offset });
    count += page.records.length;
    offset = page.offset ?? undefined;
  } while (offset);
  return count;
}

export async function keepaliveMirror(
  env: MirrorActionEnvironment,
  options: MirrorClockOptions = {},
): Promise<{ refreshed: boolean; requests: number; records: number }> {
  const clock: MirrorClock = {
    now: options.now ?? (() => Date.now()),
    sleep: options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
  };
  const now = clock.now();
  const credential = await readMirrorCredential(env.DB, env);
  if (!credential) return { refreshed: false, requests: 0, records: 0 };
  const states = await env.DB.prepare(
    `SELECT table_name, airtable_table_id, webhook_id, webhook_expires_at
       FROM mirror_state
      WHERE table_name IN ('submissions', 'speaker_tasks', 'people')`,
  ).all<{ table_name: MirroredTable; airtable_table_id: string | null; webhook_id: string | null; webhook_expires_at: number | null }>();
  const mapped = states.results.filter((state) => state.airtable_table_id);
  if (mapped.length !== MIRRORED_TABLES.length) return { refreshed: false, requests: 0, records: 0 };
  const limiter = new MirrorTokenBucket(clock);
  const transport = providerFor(env, credential.token, credential.baseId, limiter);
  let requests = 0;
  let records = 0;
  const expiresAt = states.results.reduce<number | null>((earliest, state) =>
    state.webhook_expires_at !== null && (earliest === null || state.webhook_expires_at < earliest)
      ? state.webhook_expires_at
      : earliest, null);
  if (expiresAt === null || expiresAt <= now + WEBHOOK_REFRESH_WINDOW_MS) {
    const webhook = await transport.createWebhook({ notificationUrl: nonEmpty(env.MIRROR_WEBHOOK_URL) ?? DEFAULT_WEBHOOK_URL });
    if (!webhook.macSecretBase64) throw new Error("Airtable did not return a webhook signature secret");
    const secret = nonEmpty(env.MIRROR_CREDENTIAL_SECRET);
    if (!secret) throw new Error("The deployment is missing MIRROR_CREDENTIAL_SECRET");
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE mirror_credentials SET webhook_secret_ciphertext = ?, last_verified_at = ?, last_error = NULL, updated_at = ? WHERE org_id = ?",
      ).bind(await encryptMirrorSecret(webhook.macSecretBase64, secret), now, now, credential.orgId),
      env.DB.prepare(
        "UPDATE mirror_state SET webhook_id = ?, webhook_expires_at = ?, updated_at = ? WHERE table_name IN ('submissions', 'speaker_tasks', 'people')",
      ).bind(webhook.id, webhook.expirationTime, now),
    ]);
    requests += 1;
  }
  for (const state of mapped) {
    const local = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${state.table_name}`).first<{ count: number }>();
    const remote = await countRemoteRecords(transport, state.airtable_table_id!);
    requests += 1;
    records += Number(local?.count ?? 0) + remote;
    await env.DB.prepare(
      "UPDATE mirror_state SET local_row_count = ?, remote_row_count = ?, last_sync_at = ?, last_error = NULL, updated_at = ? WHERE table_name = ?",
    ).bind(Number(local?.count ?? 0), remote, now, now, state.table_name).run();
  }
  return { refreshed: true, requests, records };
}

export async function verifyStoredWebhookSecret(
  db: D1Database,
  environment: MirrorActionEnvironment,
): Promise<string | null> {
  const credential = await readMirrorCredential(db, environment);
  return credential?.webhookSecret ?? null;
}
