import type { D1Database, Queue } from "@cloudflare/workers-types";

import { ApiError } from "../api/errors";
import { newUlid } from "../api/ids";
import { enqueueMailMessage } from "../jobs/mail/consumer";
import { sha256Hex } from "./auth/random-token";

export type RequestOperationScope =
  | { kind: "event"; eventId: string; organizationId: string }
  | { kind: "org"; organizationId: string };

export interface RequestOperationInput {
  db: D1Database;
  scope: RequestOperationScope;
  route: string;
  idempotencyKey?: string | null;
  requestId: string;
  actorKind: "user" | "api_token" | "system" | "airtable";
  actorPersonId?: string | null;
  request: unknown;
  now?: number;
}

export interface RequestOperationHandle {
  operationId: string;
  fingerprint: string;
  canonicalRequestJson: string;
  /** The lease token owned by this worker; null only for a completed replay. */
  claimToken: string | null;
  replay: { status: number; body: unknown } | null;
}

interface ExistingRequestOperation {
  operation_id: string;
  canonical_fingerprint: string;
  state: string;
  response_status: number | null;
  response_json: string | null;
  lease_expires_at: number | null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    // Arrays retain order and multiplicity; reordering a raw selector returns 409 rather than being normalized.
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

export function canonicalRequestJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function eventOperationScope(db: D1Database, eventId: string): Promise<RequestOperationScope> {
  const event = await db.prepare("SELECT id, org_id FROM events WHERE id = ?").bind(eventId).first<{ id: string; org_id: string }>();
  if (!event) throw ApiError.notFound("conference not found");
  return { kind: "event", eventId: event.id, organizationId: event.org_id };
}

/** Claim before recipient resolution or any outbox write. */
export async function claimRequestOperation(input: RequestOperationInput): Promise<RequestOperationHandle> {
  const now = input.now ?? Date.now();
  const canonical = canonicalRequestJson({ route: input.route, scope: input.scope, request: input.request });
  const fingerprint = await sha256Hex(canonical);
  const key = input.idempotencyKey?.trim() || null;
  const readExisting = async (): Promise<ExistingRequestOperation | null> => key
    ? input.db.prepare(`
        SELECT operation_id, canonical_fingerprint, state, response_status, response_json, lease_expires_at
        FROM request_operations
        WHERE organization_id = ? AND route = ? AND idempotency_key = ?
          AND ((scope_kind = 'org' AND event_id IS NULL)
            OR (scope_kind = 'event' AND event_id = ?))
        LIMIT 1
      `).bind(input.scope.organizationId, input.route, key, input.scope.kind === "event" ? input.scope.eventId : null).first<ExistingRequestOperation>()
    : null;

  if (input.actorPersonId) {
    const actor = await input.db.prepare("SELECT 1 AS present FROM people WHERE id = ? AND org_id = ?")
      .bind(input.actorPersonId, input.scope.organizationId).first<{ present: number }>();
    if (!actor) throw ApiError.forbidden("the operation actor does not belong to this organization");
  }

  const resolveExisting = async (existing: ExistingRequestOperation): Promise<RequestOperationHandle> => {
    if (existing.canonical_fingerprint !== fingerprint) {
      throw ApiError.conflict("idempotency key conflicts with an earlier request", {
        code: "key-conflict",
        operation_id: existing.operation_id,
      });
    }
    if ((existing.state === "completed" || existing.state === "failed") && existing.response_json !== null) {
      return {
        operationId: existing.operation_id,
        fingerprint,
        canonicalRequestJson: canonical,
        claimToken: null,
        replay: { status: Number(existing.response_status ?? 200), body: JSON.parse(existing.response_json) },
      };
    }
    if (existing.state === "in_flight" && Number(existing.lease_expires_at ?? 0) < now) {
      const claimToken = newUlid(now);
      const reclaimed = await input.db.prepare(`
        UPDATE request_operations
        SET claim_token = ?, lease_expires_at = ?, request_id = ?, attempt_count = attempt_count + 1,
            updated_at = ?
        WHERE operation_id = ? AND state = 'in_flight' AND lease_expires_at < ?
      `).bind(claimToken, now + 60_000, input.requestId, now, existing.operation_id, now).run();
      if (Number(reclaimed.meta.changes ?? 0) === 1) {
        return { operationId: existing.operation_id, fingerprint, canonicalRequestJson: canonical, claimToken, replay: null };
      }
    }
    throw ApiError.conflict("the earlier request is still being completed", {
      code: existing.state === "dispatch_pending" ? "operation_dispatch_pending" : "operation_in_flight",
      operation_id: existing.operation_id,
    });
  };

  const existing = await readExisting();
  if (existing) return resolveExisting(existing);

  const operationId = newUlid(now);
  try {
    await input.db.prepare(`
      INSERT INTO request_operations (
        operation_id, organization_id, scope_kind, event_id, route, idempotency_key,
        canonical_fingerprint, canonical_request_json, request_id, actor_kind,
        actor_person_id, state, outbox_ids_json, claim_token, lease_expires_at,
        attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_flight', '[]', ?, ?, 1, ?, ?)
    `).bind(
      operationId,
      input.scope.organizationId,
      input.scope.kind,
      input.scope.kind === "event" ? input.scope.eventId : null,
      input.route,
      key,
      fingerprint,
      canonical,
      input.requestId,
      input.actorKind,
      input.actorPersonId ?? null,
      operationId,
      now + 60_000,
      now,
      now,
    ).run();
  } catch (error: unknown) {
    // A concurrent keyed insert is resolved through the same replay/conflict
    // path, including stale-lease reclaim. Never admit a second mutation or
    // hide the winning operation behind a generic race error.
    if (key && /unique|constraint/i.test(error instanceof Error ? error.message : String(error))) {
      const raced = await readExisting();
      if (raced) return resolveExisting(raced);
    }
    throw error;
  }
  return { operationId, fingerprint, canonicalRequestJson: canonical, claimToken: operationId, replay: null };
}

export async function completeRequestOperation(
  db: D1Database,
  operationId: string,
  status: number,
  body: unknown,
  options: {
    outboxIds?: readonly string[];
    state?: "completed" | "failed";
    now?: number;
    claimToken?: string | null;
    dispatchClaimToken?: string | null;
  } = {},
): Promise<boolean> {
  const now = options.now ?? Date.now();
  const outboxIds = options.outboxIds ?? [];
  const dispatchClaimToken = options.dispatchClaimToken ?? (outboxIds.length > 0 ? operationId : null);
  const claimToken = options.claimToken ?? null;
  const result = outboxIds.length > 0
    ? await db.prepare(`
        UPDATE request_operations
        SET state = ?, response_status = ?, response_headers_json = '{}', response_json = ?,
            outbox_ids_json = ?, claim_token = NULL, lease_expires_at = NULL,
            dispatch_claim_token = NULL, dispatch_lease_expires_at = NULL,
            updated_at = ?, completed_at = ?
        WHERE operation_id = ? AND state = 'dispatch_pending' AND dispatch_claim_token = ?
          AND NOT EXISTS (
            SELECT 1 FROM request_operation_outbox
            WHERE operation_id = ? AND dispatch_state = 'pending'
          )
      `).bind(
        options.state ?? "completed",
        status,
        JSON.stringify(body),
        JSON.stringify(outboxIds),
        now,
        now,
        operationId,
        dispatchClaimToken,
        operationId,
      ).run()
    : await db.prepare(`
        UPDATE request_operations
        SET state = ?, response_status = ?, response_headers_json = '{}', response_json = ?,
            outbox_ids_json = ?, claim_token = NULL, lease_expires_at = NULL,
            dispatch_claim_token = NULL, dispatch_lease_expires_at = NULL,
            updated_at = ?, completed_at = ?
        WHERE operation_id = ? AND state = 'in_flight' AND claim_token = ?
      `).bind(
        options.state ?? "completed",
        status,
        JSON.stringify(body),
        JSON.stringify(outboxIds),
        now,
        now,
        operationId,
        claimToken,
      ).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function linkRequestOperationOutbox(
  db: D1Database,
  operationId: string,
  outboxIds: readonly string[],
): Promise<void> {
  if (outboxIds.length === 0) return;
  await db.batch(outboxIds.map((outboxId, ordinal) => db.prepare(`
    INSERT INTO request_operation_outbox
      (operation_id, outbox_id, ordinal, dispatch_state, dispatch_attempt_count, dispatched_at)
    VALUES (?, ?, ?, 'pending', 0, NULL)
    ON CONFLICT (operation_id, outbox_id) DO NOTHING
  `).bind(operationId, outboxId, ordinal)));
}

export async function markRequestOperationOutboxDispatched(
  db: D1Database,
  operationId: string,
  outboxIds: readonly string[],
  now = Date.now(),
  dispatchToken = operationId,
): Promise<boolean> {
  if (outboxIds.length === 0) return true;
  const result = await db.prepare(`
    UPDATE request_operation_outbox
    SET dispatch_state = 'dispatched', dispatch_attempt_count = dispatch_attempt_count + 1,
        dispatched_at = ?, last_dispatch_error = NULL
    WHERE operation_id = ?
      AND outbox_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
      AND EXISTS (
        SELECT 1 FROM request_operations
        WHERE operation_id = ? AND state = 'dispatch_pending' AND dispatch_claim_token = ?
      )
  `).bind(now, operationId, JSON.stringify([...new Set(outboxIds)]), operationId, dispatchToken).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function markRequestOperationDispatchPending(
  db: D1Database,
  operationId: string,
  status: number,
  body: unknown,
  outboxIds: readonly string[],
  options: { now?: number; claimToken?: string | null } = {},
): Promise<boolean> {
  const now = options.now ?? Date.now();
  const result = await db.prepare(`
    UPDATE request_operations
    SET state = 'dispatch_pending', response_status = ?, response_headers_json = '{}',
        response_json = ?, outbox_ids_json = ?, claim_token = NULL, lease_expires_at = NULL,
        dispatch_claim_token = ?, dispatch_lease_expires_at = ?,
        dispatch_attempt_count = dispatch_attempt_count + 1,
        dispatch_next_attempt_at = ?, updated_at = ?
    WHERE operation_id = ? AND state = 'in_flight' AND claim_token = ?
  `).bind(status, JSON.stringify(body), JSON.stringify(outboxIds), operationId, now + 60_000, now, now, operationId, options.claimToken).run();
  return Number(result.meta.changes ?? 0) === 1;
}

async function markRequestOperationDispatchFailure(
  db: D1Database,
  operationId: string,
  error: unknown,
  now: number,
  dispatchToken = operationId,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.prepare(`
    UPDATE request_operations
    SET dispatch_claim_token = NULL, dispatch_lease_expires_at = NULL,
        dispatch_last_error = ?, dispatch_next_attempt_at = ?, updated_at = ?
    WHERE operation_id = ? AND state = 'dispatch_pending' AND dispatch_claim_token = ?
  `).bind(message, now + 60_000, now, operationId, dispatchToken).run();
}

/** Send an admitted operation's outbox IDs while its response remains pending until Queue accepts all of them. */
export async function dispatchRequestOperationNow(
  db: D1Database,
  queue: Queue<unknown>,
  operationId: string,
  outboxIds: readonly string[],
  now = Date.now(),
): Promise<void> {
  try {
    // A queue send can succeed immediately before the next send fails. Mark
    // each acknowledgement as it lands so recovery resumes at the first
    // genuinely pending link instead of replaying an already accepted one.
    for (const outboxId of outboxIds) {
      await enqueueMailMessage(queue, outboxId);
      const marked = await markRequestOperationOutboxDispatched(db, operationId, [outboxId], now, operationId);
      if (!marked) throw new Error("the operation dispatch lease was reclaimed before acknowledgement");
    }
  } catch (error: unknown) {
    await markRequestOperationDispatchFailure(db, operationId, error, now, operationId);
    throw ApiError.serviceUnavailable("the operation was admitted but mail dispatch is pending", {
      code: "operation_dispatch_pending",
      operation_id: operationId,
      retry_after_seconds: 60,
    });
  }
}

/** Bounded cron recovery for operations whose response was staged before Queue acceptance. */
export async function dispatchPendingRequestOperations(
  db: D1Database,
  queue: Queue<unknown>,
  now = Date.now(),
  limit = 20,
): Promise<number> {
  const due = await db.prepare(`
    SELECT operation_id
    FROM request_operations
    WHERE state = 'dispatch_pending'
      AND (dispatch_next_attempt_at IS NULL OR dispatch_next_attempt_at <= ?)
      AND (dispatch_lease_expires_at IS NULL OR dispatch_lease_expires_at < ?)
    ORDER BY created_at ASC, operation_id ASC
    LIMIT ?
  `).bind(now, now, limit).all<{ operation_id: string }>();
  let completed = 0;
  for (const row of due.results) {
    const token = newUlid(now);
    const claimed = await db.prepare(`
      UPDATE request_operations
      SET dispatch_claim_token = ?, dispatch_lease_expires_at = ?,
          dispatch_attempt_count = dispatch_attempt_count + 1, updated_at = ?
      WHERE operation_id = ? AND state = 'dispatch_pending'
        AND (dispatch_lease_expires_at IS NULL OR dispatch_lease_expires_at < ?)
    `).bind(token, now + 60_000, now, row.operation_id, now).run();
    if (Number(claimed.meta.changes ?? 0) !== 1) continue;
    const pending = await db.prepare(`
      SELECT outbox_id FROM request_operation_outbox
      WHERE operation_id = ? AND dispatch_state = 'pending'
      ORDER BY ordinal ASC
    `).bind(row.operation_id).all<{ outbox_id: string }>();
    try {
      for (const link of pending.results) {
        await enqueueMailMessage(queue, link.outbox_id);
        const marked = await db.prepare(`
          UPDATE request_operation_outbox
          SET dispatch_state = 'dispatched', dispatch_attempt_count = dispatch_attempt_count + 1,
              dispatched_at = ?, last_dispatch_error = NULL
          WHERE operation_id = ? AND outbox_id = ?
            AND EXISTS (
              SELECT 1 FROM request_operations
              WHERE operation_id = ? AND state = 'dispatch_pending' AND dispatch_claim_token = ?
            )
        `).bind(now, row.operation_id, link.outbox_id, row.operation_id, token).run();
        if (Number(marked.meta.changes ?? 0) !== 1) throw new Error("the operation dispatch lease was reclaimed before acknowledgement");
      }
      await db.prepare(`
        UPDATE request_operations
        SET state = 'completed',
            response_json = json_patch(
              response_json,
              json_object(
                'operation',
                json_patch(
                  CASE
                    WHEN json_type(response_json, '$.operation') = 'object' THEN json_extract(response_json, '$.operation')
                    ELSE json('{}')
                  END,
                  json_object('dispatch_state', 'dispatched')
                )
              )
            ),
            completed_at = ?, dispatch_claim_token = NULL,
            dispatch_lease_expires_at = NULL, dispatch_next_attempt_at = NULL,
            updated_at = ?
        WHERE operation_id = ? AND state = 'dispatch_pending' AND dispatch_claim_token = ?
          AND NOT EXISTS (
            SELECT 1 FROM request_operation_outbox
            WHERE operation_id = ? AND dispatch_state = 'pending'
          )
      `).bind(now, now, row.operation_id, token, row.operation_id).run();
      completed += 1;
    } catch (error: unknown) {
      await db.prepare(`
        UPDATE request_operations
        SET dispatch_claim_token = NULL, dispatch_lease_expires_at = NULL,
            dispatch_last_error = ?, dispatch_next_attempt_at = ?, updated_at = ?
        WHERE operation_id = ? AND state = 'dispatch_pending' AND dispatch_claim_token = ?
      `).bind(error instanceof Error ? error.message : String(error), now + 60_000, now, row.operation_id, token).run();
    }
  }
  return completed;
}
