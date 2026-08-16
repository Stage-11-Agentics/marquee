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
import {
  createFieldPayload,
  createTableFields,
  ensureMirrorSchema,
  findExactMirrorTable,
  MIRROR_FIELD_COUNTS,
  MIRROR_TABLE_SCHEMA,
  type MirrorSchemaIssue,
  type MirrorSchemaOperation,
} from "./schema";
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
import type { MirrorRejectionReason } from "./rejections";

export interface MirrorActionEnvironment extends MirrorEnvironment {
  MIRROR_QUEUE?: Queue<unknown>;
}

export type MirrorIntent = "verify" | "provision" | "adopt";

export interface MirrorActionFailure {
  ok: false;
  field: "token" | "base_id" | "configuration" | "tables";
  message: string;
  code?: "provider_forbidden" | "rate_limited" | "schema_conflict";
  retryable?: boolean;
  details?: unknown;
}

export type MirrorConnectionFailure = MirrorActionFailure;

export interface MirrorRoleReadiness {
  role: MirroredTable;
  label: string;
  expected_field_count: number;
  candidate_table_ids: readonly string[];
  selected_table_id: string | null;
  state: "ready" | "missing" | "conflict" | "unknown";
  conflict: MirrorSchemaIssue | null;
}

export interface MirrorReadiness {
  needs_provisioning: boolean;
  provisionable: boolean;
  max_conformant_roles: number;
  roles: readonly MirrorRoleReadiness[];
}

export interface MirrorTableProgress {
  role: MirroredTable;
  label: string;
  table_id: string | null;
  state: "idle" | "created" | "adopted" | "conflict" | "complete";
  expected_field_count: number;
  conformant_field_count: number;
  missing_fields: readonly string[];
  conflicts: readonly MirrorSchemaIssue[];
}

export interface MirrorConnectionSuccess {
  ok: true;
  tables: readonly AirtableTable[];
  readiness: MirrorReadiness;
  needsProvisioning: boolean;
  progress?: readonly MirrorTableProgress[];
  continuation?: MirroredTable | null;
  complete?: boolean;
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
  rejectedEdits: number;
  recentRejections: MirrorRejectionLogEntry[];
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

export interface MirrorRejectionLogEntry {
  before: string | null;
  createdAt: number;
  field: string;
  id: string;
  message: string;
  reason: MirrorRejectionReason;
  requested: string | null;
  title: string;
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

function mirrorLogValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function rejectionLogEntry(row: {
  after_requested: unknown;
  before_status: unknown;
  created_at: number;
  field: string;
  id: string;
  reason: MirrorRejectionReason;
  title: string | null;
}): MirrorRejectionLogEntry {
  const before = mirrorLogValue(row.before_status);
  const requested = mirrorLogValue(row.after_requested);
  const title = row.title?.trim() || "Untitled session";
  return {
    before,
    createdAt: row.created_at,
    field: row.field,
    id: row.id,
    message: `Airtable tried ${before ?? "blank"} → ${requested ?? "blank"} on ${title}; not applied.`,
    reason: row.reason,
    requested,
    title,
  };
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

interface ProviderFailureContext {
  operation: MirrorSchemaOperation | "read";
  mutation?: "createTable" | "createField" | "createWebhook";
  table?: MirroredTable;
  tableId?: string;
}

function failureForProvider(error: unknown, context: ProviderFailureContext): MirrorConnectionFailure {
  const status = error instanceof AirtableTransportError ? error.status : 0;
  if (status === 429) {
    return {
      ok: false,
      field: "tables",
      code: "rate_limited",
      retryable: true,
      message: context.table
        ? `Airtable is rate-limiting schema setup for ${context.table}; wait a moment and retry this table.`
        : "Airtable is rate-limiting schema setup; wait a moment and retry.",
    };
  }
  if ((status === 401 || status === 403) && (context.mutation === "createTable" || context.mutation === "createField")) {
    const target = context.table
      ? `${context.table}${context.tableId ? ` (${context.tableId})` : ""}`
      : "the selected Airtable table";
    return {
      ok: false,
      field: "tables",
      code: "provider_forbidden",
      message: `Airtable denied schema.bases:write while preparing ${target}. Grant that scope to create the declared schema, then retry.`,
    };
  }
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

function roleLabel(table: MirroredTable): string {
  return MIRROR_TABLE_SCHEMA[table].name;
}

function mappingValue(input: Partial<MirrorMappingInput>, tableName: MirroredTable): string | null {
  return nonEmpty(input[tableName]);
}

function validateMapping(mapping: Partial<MirrorMappingInput>): MirrorConnectionFailure | null {
  const selected = MIRRORED_TABLES.map((tableName) => mappingValue(mapping, tableName));
  const missingIndex = selected.findIndex((tableId) => !tableId);
  if (missingIndex !== -1) {
    return { ok: false, field: "tables", message: `Choose the Airtable table for ${MIRRORED_TABLES[missingIndex]}.` };
  }
  if (new Set(selected).size !== selected.length) {
    return { ok: false, field: "tables", message: "Choose a different Airtable table for each mirrored record type." };
  }
  return null;
}

function selectedTableIds(mapping: Partial<MirrorMappingInput>): Record<MirroredTable, string> | null {
  const values = MIRRORED_TABLES.map((tableName) => [tableName, mappingValue(mapping, tableName)] as const);
  if (values.some(([, tableId]) => !tableId)) return null;
  return Object.fromEntries(values) as Record<MirroredTable, string>;
}

function maximumDistinctRoles(candidateIds: readonly (readonly string[])[], index = 0, used = new Set<string>()): number {
  if (index === candidateIds.length) return 0;
  let best = maximumDistinctRoles(candidateIds, index + 1, used);
  for (const candidate of candidateIds[index]) {
    if (used.has(candidate)) continue;
    used.add(candidate);
    best = Math.max(best, 1 + maximumDistinctRoles(candidateIds, index + 1, used));
    used.delete(candidate);
  }
  return best;
}

function readinessFor(tables: readonly AirtableTable[]): MirrorReadiness {
  const roles = MIRRORED_TABLES.map((role) => {
    const candidates = tables.filter((table) => ensureMirrorSchema(role, table, "verify").conformant);
    const exact = findExactMirrorTable(tables, role);
    const exactInspection = exact ? ensureMirrorSchema(role, exact, "verify") : null;
    const firstIssue = exactInspection?.issues[0] ?? null;
    return {
      role,
      label: roleLabel(role),
      expected_field_count: MIRROR_FIELD_COUNTS[role],
      candidate_table_ids: candidates.map((table) => table.id),
      selected_table_id: candidates[0]?.id ?? null,
      state: candidates.length > 0
        ? "ready"
        : firstIssue?.code === "unknown_schema"
          ? "unknown"
          : firstIssue
            ? "conflict"
            : "missing",
      conflict: firstIssue,
    } satisfies MirrorRoleReadiness;
  });
  const maxConformantRoles = maximumDistinctRoles(roles.map((role) => role.candidate_table_ids));
  return {
    needs_provisioning: maxConformantRoles < MIRRORED_TABLES.length,
    provisionable: true,
    max_conformant_roles: maxConformantRoles,
    roles,
  };
}

function conformantFieldCount(role: MirroredTable, table: AirtableTable | undefined, operation: MirrorSchemaOperation): number {
  if (!table?.fields) return 0;
  const inspection = ensureMirrorSchema(role, table, operation);
  return MIRROR_FIELD_COUNTS[role] - inspection.missingFields.length - inspection.issues.length;
}

function progressFor(
  tables: readonly AirtableTable[],
  mapping: Partial<MirrorMappingInput>,
  operation: MirrorSchemaOperation,
  completedRole?: MirroredTable,
): MirrorTableProgress[] {
  const byId = tablesById(tables);
  return MIRRORED_TABLES.map((role) => {
    const tableId = mappingValue(mapping, role);
    const table = tableId ? byId.get(tableId) : undefined;
    const inspection = table ? ensureMirrorSchema(role, table, operation) : null;
    const issues = inspection?.issues ?? [];
    const missingFields = inspection?.missingFields.map((field) => field.name) ?? [];
    const state: MirrorTableProgress["state"] = !tableId
      ? "idle"
      : issues.length > 0
        ? "conflict"
        : inspection?.conformant
          ? completedRole === role ? "complete" : "adopted"
          : completedRole === role ? "created" : "idle";
    return {
      role,
      label: roleLabel(role),
      table_id: tableId ?? null,
      state,
      expected_field_count: MIRROR_FIELD_COUNTS[role],
      conformant_field_count: conformantFieldCount(role, table, operation),
      missing_fields: missingFields,
      conflicts: issues,
    };
  });
}

function schemaFailure(
  inspection: ReturnType<typeof ensureMirrorSchema>,
  progress: readonly MirrorTableProgress[],
): MirrorConnectionFailure {
  const issue = inspection.issues[0] ?? {
    code: "missing_field",
    operation: "adopt" as const,
    table: inspection.table,
    tableId: inspection.tableId,
    tableName: inspection.tableName,
    recovery: `Airtable table “${inspection.tableName}” is missing declared Marquee fields; retry schema adoption.`,
  };
  return {
    ok: false,
    field: "tables",
    code: "schema_conflict",
    message: issue.recovery,
    details: { issue, progress },
  };
}

async function persistVerifiedCredential(
  env: MirrorActionEnvironment,
  input: { baseId: string; orgId: string; setByPersonId: string; token: string; now: number },
): Promise<void> {
  const existing = await env.DB.prepare(
    "SELECT base_id FROM mirror_credentials WHERE org_id = ?",
  ).bind(input.orgId).first<{ base_id: string }>();
  const baseChanged = existing?.base_id !== input.baseId;
  const tokenCiphertext = await encryptMirrorSecret(input.token, env.MIRROR_CREDENTIAL_SECRET!);
  const fingerprint = await tokenFingerprint(input.token);
  const credentialId = newUlid(input.now);
  const statements = [env.DB.prepare(
    `INSERT INTO mirror_credentials
      (id, org_id, token_ciphertext, webhook_secret_ciphertext, token_fingerprint,
       base_id, set_at, set_by_person_id, last_verified_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(org_id) DO UPDATE SET
       token_ciphertext = excluded.token_ciphertext,
       webhook_secret_ciphertext = CASE
         WHEN mirror_credentials.base_id = excluded.base_id THEN mirror_credentials.webhook_secret_ciphertext
         ELSE NULL
       END,
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
    input.baseId,
    input.now,
    input.setByPersonId,
    input.now,
    input.now,
    input.now,
  )];
  if (baseChanged) {
    statements.push(env.DB.prepare(
      `UPDATE mirror_state
          SET airtable_table_id = NULL, cursor = NULL, webhook_id = NULL,
              webhook_expires_at = NULL, updated_at = ?
        WHERE table_name IN ('submissions', 'speaker_tasks', 'people')`,
    ).bind(input.now));
  }
  await env.DB.batch(statements);
}

function providerClock(options?: MirrorClockOptions): MirrorClock {
  return {
    now: options?.now ?? (() => Date.now()),
    sleep: options?.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
  };
}

async function provisionTables(
  env: MirrorActionEnvironment,
  input: {
    baseId: string;
    orgId: string;
    setByPersonId: string;
    token: string;
    now: number;
    mapping?: Partial<MirrorMappingInput>;
    tables: readonly AirtableTable[];
    transport: AirtableTransport;
  },
): Promise<MirrorConnectionResult> {
  const mapping = input.mapping ?? {};
  const available = tablesById(input.tables);
  const provided = MIRRORED_TABLES.map((role) => [role, mappingValue(mapping, role)] as const).filter(([, id]) => id);
  if (new Set(provided.map(([, id]) => id)).size !== provided.length) {
    return { ok: false, field: "tables", message: "Choose a different Airtable table for each mirrored record type." };
  }
  for (const [role, tableId] of provided) {
    if (!available.has(tableId!)) {
      return { ok: false, field: "tables", message: `Airtable does not have the selected ${role} table.` };
    }
  }

  const selected: Partial<MirrorMappingInput> = {};
  const working = [...input.tables];
  for (const role of MIRRORED_TABLES) {
    const submittedId = mappingValue(mapping, role);
    if (submittedId) {
      selected[role] = submittedId;
      continue;
    }
    const exact = findExactMirrorTable(working, role);
    if (exact) {
      const inspection = ensureMirrorSchema(role, exact, "provision");
      if (!inspection.conformant) {
        return schemaFailure(inspection, progressFor(working, selected, "provision"));
      }
      selected[role] = exact.id;
      continue;
    }
    try {
      const created = await input.transport.createTable({
        name: MIRROR_TABLE_SCHEMA[role].name,
        fields: createTableFields(role),
      });
      selected[role] = created.table.id;
      working.push(created.table);
    } catch (error) {
      return failureForProvider(error, { operation: "provision", mutation: "createTable", table: role });
    }
  }

  let finalTables: readonly AirtableTable[];
  try {
    finalTables = (await input.transport.readBaseSchema()).tables;
  } catch (error) {
    return failureForProvider(error, { operation: "provision" });
  }
  const finalById = tablesById(finalTables);
  for (const role of MIRRORED_TABLES) {
    const tableId = mappingValue(selected, role);
    const inspection = ensureMirrorSchema(role, tableId ? finalById.get(tableId) : undefined, "provision");
    if (!inspection.conformant) return schemaFailure(inspection, progressFor(finalTables, selected, "provision"));
  }
  await persistVerifiedCredential(env, {
    baseId: input.baseId,
    orgId: input.orgId,
    setByPersonId: input.setByPersonId,
    token: input.token,
    now: input.now,
  });
  const readiness = readinessFor(finalTables);
  return {
    ok: true,
    tables: finalTables,
    readiness,
    needsProvisioning: readiness.needs_provisioning,
    progress: progressFor(finalTables, selected, "provision"),
    continuation: null,
    complete: true,
  };
}

export async function connectMirror(
  env: MirrorActionEnvironment,
  input: {
    baseId: string;
    orgId: string;
    setByPersonId: string;
    token: string;
    now?: number;
    clock?: MirrorClockOptions;
    intent?: MirrorIntent;
    mapping?: Partial<MirrorMappingInput>;
  },
): Promise<MirrorConnectionResult> {
  const token = nonEmpty(input.token);
  const baseId = nonEmpty(input.baseId);
  if (!token) return { ok: false, field: "token", message: "Enter an Airtable personal access token." };
  if (!baseId) return { ok: false, field: "base_id", message: "Enter an Airtable base ID." };
  if (!nonEmpty(env.MIRROR_CREDENTIAL_SECRET)) {
    return { ok: false, field: "configuration", message: "The deployment is missing MIRROR_CREDENTIAL_SECRET." };
  }

  const clock = providerClock(input.clock);
  const now = input.now ?? clock.now();
  const limiter = new MirrorTokenBucket(clock);
  const transport = providerFor(env, token, baseId, limiter);
  let tables: readonly AirtableTable[];
  try {
    tables = (await transport.readBaseSchema()).tables;
  } catch (error) {
    return failureForProvider(error, { operation: "read" });
  }
  const intent = input.intent ?? "verify";
  if (intent === "provision") {
    return provisionTables(env, {
      baseId,
      orgId: input.orgId,
      setByPersonId: input.setByPersonId,
      token,
      now,
      mapping: input.mapping,
      tables,
      transport,
    });
  }
  if (intent === "adopt") {
    return {
      ok: false,
      field: "tables",
      message: "Submit the selected table IDs to the mapping step to adopt them.",
    };
  }
  await persistVerifiedCredential(env, { baseId, orgId: input.orgId, setByPersonId: input.setByPersonId, token, now });
  const readiness = readinessFor(tables);
  return { ok: true, tables, readiness, needsProvisioning: readiness.needs_provisioning };
}

export async function mapMirror(
  env: MirrorActionEnvironment,
  input: {
    mapping: MirrorMappingInput;
    orgId: string;
    webhookUrl?: string;
    now?: number;
    clock?: MirrorClockOptions;
    token?: string;
    intent?: Extract<MirrorIntent, "adopt" | "provision">;
    continuation?: MirroredTable | null;
  },
): Promise<MirrorConnectionResult> {
  const mappingError = validateMapping(input.mapping);
  if (mappingError) return mappingError;
  const selected = selectedTableIds(input.mapping)!;
  const intent = input.intent ?? "adopt";
  const credential = await readMirrorCredential(env.DB, env, input.orgId);
  if (!credential) return { ok: false, field: "configuration", message: "Connect Airtable before mapping its tables." };
  if (!nonEmpty(env.MIRROR_CREDENTIAL_SECRET)) {
    return { ok: false, field: "configuration", message: "The deployment is missing MIRROR_CREDENTIAL_SECRET." };
  }
  const clock = providerClock(input.clock);
  const limiter = new MirrorTokenBucket(clock);
  const providerToken = nonEmpty(input.token) ?? credential.token;
  const transport = providerFor(env, providerToken, credential.baseId, limiter);
  let tables: readonly AirtableTable[];
  try {
    tables = (await transport.readBaseSchema()).tables;
  } catch (error) {
    return failureForProvider(error, { operation: intent });
  }
  const available = tablesById(tables);
  for (const tableName of MIRRORED_TABLES) {
    const tableId = selected[tableName];
    if (!available.has(tableId)) {
      return { ok: false, field: "tables", message: `Airtable does not have the selected ${tableName} table.` };
    }
  }

  const initialInspections = MIRRORED_TABLES.map((tableName) => ensureMirrorSchema(tableName, available.get(selected[tableName]), intent));
  const firstConflict = initialInspections.find((inspection) => inspection.issues.length > 0);
  if (firstConflict) return schemaFailure(firstConflict, progressFor(tables, input.mapping, intent));
  const currentRole = input.continuation ?? MIRRORED_TABLES[0];
  const currentIndex = MIRRORED_TABLES.indexOf(currentRole);
  if (currentIndex === -1) return { ok: false, field: "tables", message: "Choose a valid mirror continuation." };
  const currentInspection = initialInspections[currentIndex];
  let workingTables = [...tables];
  let createdField = false;
  for (const field of currentInspection.missingFields) {
    try {
      const result = await transport.createField({
        tableId: currentInspection.tableId,
        ...createFieldPayload(field),
      });
      createdField = true;
      workingTables = workingTables.map((table) => table.id === currentInspection.tableId
        ? { ...table, fields: [...table.fields ?? [], result.field] }
        : table);
    } catch (error) {
      return failureForProvider(error, {
        operation: intent,
        mutation: "createField",
        table: currentRole,
        tableId: currentInspection.tableId,
      });
    }
  }

  const nextRole = MIRRORED_TABLES[currentIndex + 1] ?? null;
  const currentProgress = progressFor(workingTables, input.mapping, intent, createdField || currentInspection.conformant ? currentRole : undefined);
  if (nextRole) {
    const readiness = readinessFor(workingTables);
    return {
      ok: true,
      tables: workingTables,
      readiness,
      needsProvisioning: readiness.needs_provisioning,
      progress: currentProgress,
      continuation: nextRole,
      complete: false,
    };
  }

  let finalTables: readonly AirtableTable[];
  try {
    finalTables = (await transport.readBaseSchema()).tables;
  } catch (error) {
    return failureForProvider(error, { operation: intent });
  }
  const finalById = tablesById(finalTables);
  const finalInspections = MIRRORED_TABLES.map((tableName) => ensureMirrorSchema(tableName, finalById.get(selected[tableName]), intent));
  const finalConflict = finalInspections.find((inspection) => !inspection.conformant);
  if (finalConflict) return schemaFailure(finalConflict, progressFor(finalTables, input.mapping, intent));

  let webhook: Awaited<ReturnType<AirtableTransport["createWebhook"]>>;
  try {
    webhook = await transport.createWebhook({
      notificationUrl: nonEmpty(input.webhookUrl) ?? nonEmpty(env.MIRROR_WEBHOOK_URL) ?? DEFAULT_WEBHOOK_URL,
    });
  } catch (error) {
    return failureForProvider(error, { operation: intent, mutation: "createWebhook" });
  }
  if (!webhook.macSecretBase64) return { ok: false, field: "configuration", message: "Airtable did not return a webhook signature secret." };

  const now = input.now ?? clock.now();
  const credentialSecret = nonEmpty(env.MIRROR_CREDENTIAL_SECRET);
  if (!credentialSecret) return { ok: false, field: "configuration", message: "The deployment is missing MIRROR_CREDENTIAL_SECRET." };
  const webhookCiphertext = await encryptMirrorSecret(webhook.macSecretBase64, credentialSecret);
  const states = await Promise.all(MIRRORED_TABLES.map(async (tableName) => {
    const local = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first<{ count: number }>();
    return { tableName, localCount: Number(local?.count ?? 0) };
  }));
  const stateByName = new Map(states.map((state) => [state.tableName, state.localCount]));
  const newTokenCiphertext = input.token
    ? await encryptMirrorSecret(providerToken, credentialSecret)
    : null;
  const newFingerprint = input.token ? await tokenFingerprint(providerToken) : null;
  const statements = [
    env.DB.prepare(
      `UPDATE mirror_credentials
          SET webhook_secret_ciphertext = ?,
              token_ciphertext = COALESCE(?, token_ciphertext),
              token_fingerprint = COALESCE(?, token_fingerprint),
              last_verified_at = ?, last_error = NULL, updated_at = ?
        WHERE org_id = ?`,
    ).bind(webhookCiphertext, newTokenCiphertext, newFingerprint, now, now, input.orgId),
    env.DB.prepare(
      "DELETE FROM mirror_state WHERE table_name IN ('submissions', 'speaker_tasks', 'people')",
    ),
    ...MIRRORED_TABLES.map((tableName) => env.DB.prepare(
      `INSERT INTO mirror_state
        (id, table_name, airtable_table_id, cursor, webhook_id, webhook_expires_at,
         last_sync_at, local_row_count, remote_row_count, last_error, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, 0, NULL, ?, ?)`,
    ).bind(
      newUlid(now),
      tableName,
      selected[tableName],
      webhook.id,
      webhook.expirationTime,
      stateByName.get(tableName) ?? 0,
      now,
      now,
    )),
  ];
  await env.DB.batch(statements);
  const readiness = readinessFor(finalTables);
  return {
    ok: true,
    tables: finalTables,
    readiness,
    needsProvisioning: readiness.needs_provisioning,
    progress: progressFor(finalTables, input.mapping, intent, currentRole),
    continuation: null,
    complete: true,
  };
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
  const rejectedEdits = orgId
    ? await db.prepare(
      `SELECT COUNT(*) AS count
         FROM audit_log rejection
         JOIN events event ON event.id = rejection.event_id
        WHERE event.org_id = ? AND rejection.action = 'mirror.inbound_rejected'`,
    ).bind(orgId).first<{ count: number }>()
    : null;
  const recentRejections = orgId
    ? await db.prepare(
      `SELECT rejection.id,
              json_extract(rejection.before_json, '$.status') AS before_status,
              json_extract(rejection.after_json, '$.field') AS field,
              json_extract(rejection.after_json, '$.reason') AS reason,
              json_extract(rejection.after_json, '$.requested') AS after_requested,
              json_extract(rejection.after_json, '$.title') AS title,
              rejection.created_at
         FROM audit_log rejection
         JOIN events event ON event.id = rejection.event_id
        WHERE event.org_id = ? AND rejection.action = 'mirror.inbound_rejected'
        ORDER BY rejection.created_at DESC, rejection.id DESC
        LIMIT 8`,
    ).bind(orgId).all<{
      after_requested: unknown;
      before_status: unknown;
      created_at: number;
      field: string;
      id: string;
      reason: MirrorRejectionReason;
      title: string | null;
    }>()
    : { results: [] };
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
    rejectedEdits: Number(rejectedEdits?.count ?? 0),
    recentRejections: recentRejections.results.map(rejectionLogEntry),
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
