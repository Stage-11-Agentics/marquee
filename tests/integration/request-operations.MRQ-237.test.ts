import type { Queue } from "@cloudflare/workers-types";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, test, vi } from "vitest";

import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZER_PERSON_ID,
  demoFixtureRows,
} from "../../src/lib/reset-demo/demo-fixture";
import { ApiError } from "../../src/api/errors";
import {
  canonicalRequestJson,
  claimRequestOperation,
  completeRequestOperation,
  dispatchPendingRequestOperations,
  linkRequestOperationOutbox,
  markRequestOperationDispatchPending,
  markRequestOperationOutboxDispatched,
} from "../../src/lib/request-operations";
import { enqueueOutbox } from "../../src/jobs/mail/outbox";
import { IDEMPOTENCY_REGISTRY } from "../../src/jobs/mail/idempotency";
import { applyMigrations } from "./apply-migrations";

const OTHER_ORG_ID = "org-mrq237-other";
const OTHER_EVENT_ID = "evt-mrq237-other";
const OTHER_PERSON_ID = "per-mrq237-other";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.now();
  for (const row of demoFixtureRows(now)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(OTHER_ORG_ID, "MRQ-237 Other Org", "mrq237-other", now, now),
    env.DB.prepare(
      `INSERT INTO events
        (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, 'Other Conference', 'mrq237-other', '2026-10-01', '2026-10-02', 'UTC', 'live', 0, ?, ?)`,
    ).bind(OTHER_EVENT_ID, OTHER_ORG_ID, now, now),
    env.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(OTHER_PERSON_ID, OTHER_ORG_ID, "other@example.com", "Other Person", now, now),
  ]);
}

function eventInput(route: string, request: unknown, now?: number) {
  return {
    db: env.DB,
    scope: { kind: "event" as const, eventId: DEMO_EVENT_ID, organizationId: DEMO_ORGANIZATION_ID },
    route,
    requestId: `${route}-request`,
    actorKind: "user" as const,
    actorPersonId: DEMO_ORGANIZER_PERSON_ID,
    request,
    ...(now === undefined ? {} : { now }),
  };
}

async function outboxFor(suffix: string, now: number): Promise<string> {
  const row = await enqueueOutbox({
    db: env.DB,
    eventId: DEMO_EVENT_ID,
    templateKey: "custom",
    entityId: IDEMPOTENCY_REGISTRY.customRecipient(`mrq237-${suffix}`),
    personId: DEMO_ORGANIZER_PERSON_ID,
    toEmail: "organizer@demo.marquee.example",
    subject: "MRQ-237",
    body: "request operation proof",
    now,
  });
  return row.id;
}

describe.sequential("MRQ-237 durable request operations", () => {
  beforeAll(seedFixture, 10_000);

  test("CONTRACT · MRQ-237 · migration creates the typed operation and outbox-link schema", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('request_operations', 'request_operation_outbox') ORDER BY name",
    ).all<{ name: string }>();
    expect(tables.results.map((row) => row.name)).toEqual([
      "request_operation_outbox",
      "request_operations",
    ]);
    const operationSchema = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'request_operations'",
    ).first<{ sql: string }>();
    expect(operationSchema?.sql).toContain("FOREIGN KEY (event_id, organization_id)");
    expect(operationSchema?.sql).toContain("state IN ('in_flight', 'dispatch_pending', 'completed', 'failed')");
  });

  test("CONTRACT · MRQ-237 · keyed claims replay byte-identically and reject changed request bodies", async () => {
    expect(canonicalRequestJson({ b: 2, a: ["first", "second"] })).toBe('{"a":["first","second"],"b":2}');
    expect(canonicalRequestJson({ a: ["first", "second"] })).not.toBe(canonicalRequestJson({ a: ["second", "first"] }));
    expect(canonicalRequestJson({ a: ["first", "first"] })).not.toBe(canonicalRequestJson({ a: ["first"] }));

    const first = await claimRequestOperation({
      ...eventInput("events.mrq237.replay", { ids: ["first", "second"] }),
      idempotencyKey: "mrq237-replay",
    });
    expect(first.claimToken).toBe(first.operationId);
    const response = { operation_id: first.operationId, effect: "no_op", reason_code: "NO_VALID_RECIPIENT" };
    expect(await completeRequestOperation(env.DB, first.operationId, 404, response, {
      claimToken: first.claimToken,
      now: Date.now() + 1,
    })).toBe(true);

    const replay = await claimRequestOperation({
      ...eventInput("events.mrq237.replay", { ids: ["first", "second"] }),
      idempotencyKey: "mrq237-replay",
    });
    expect(replay).toMatchObject({ operationId: first.operationId, claimToken: null, replay: { status: 404, body: response } });
    expect(replay.replay?.body).toEqual(response);

    await expect(claimRequestOperation({
      ...eventInput("events.mrq237.replay", { ids: ["second", "first"] }),
      idempotencyKey: "mrq237-replay",
    })).rejects.toMatchObject({
      code: "conflict",
      details: { code: "key-conflict", operation_id: first.operationId },
    } satisfies Partial<ApiError>);
  });

  test("CONTRACT · MRQ-237 · stale in-flight leases reclaim and fence the old worker", async () => {
    const initial = await claimRequestOperation({
      ...eventInput("events.mrq237.stale", { submission_id: "stale" }, 1_000),
      idempotencyKey: "mrq237-stale",
    });
    const reclaimed = await claimRequestOperation({
      ...eventInput("events.mrq237.stale", { submission_id: "stale" }, 62_000),
      idempotencyKey: "mrq237-stale",
    });
    expect(reclaimed.operationId).toBe(initial.operationId);
    expect(reclaimed.claimToken).not.toBe(initial.claimToken);
    expect(await completeRequestOperation(env.DB, initial.operationId, 200, { worker: "old" }, {
      claimToken: initial.claimToken,
      now: 62_001,
    })).toBe(false);
    expect(await env.DB.prepare(
      "SELECT state, claim_token, response_json FROM request_operations WHERE operation_id = ?",
    ).bind(initial.operationId).first<{ state: string; claim_token: string; response_json: string | null }>()).toMatchObject({
      state: "in_flight",
      claim_token: reclaimed.claimToken,
      response_json: null,
    });
    expect(await completeRequestOperation(env.DB, reclaimed.operationId, 200, { worker: "new" }, {
      claimToken: reclaimed.claimToken,
      now: 62_002,
    })).toBe(true);
    const replay = await claimRequestOperation({
      ...eventInput("events.mrq237.stale", { submission_id: "stale" }, 62_003),
      idempotencyKey: "mrq237-stale",
    });
    expect(replay.replay?.body).toEqual({ worker: "new" });
  });

  test("CONTRACT · MRQ-237 · dispatch leases fence stale acknowledgements and recover missing operation JSON", async () => {
    const now = 10_000;
    const outboxId = await outboxFor("dispatch-fence", now);
    const operation = await claimRequestOperation({
      ...eventInput("events.mrq237.dispatch", { outbox: outboxId }, now),
      idempotencyKey: "mrq237-dispatch-fence",
    });
    await linkRequestOperationOutbox(env.DB, operation.operationId, [outboxId]);
    expect(await markRequestOperationDispatchPending(env.DB, operation.operationId, 202, { queued: true }, [outboxId], {
      claimToken: operation.claimToken,
      now,
    })).toBe(true);
    await env.DB.prepare("UPDATE request_operations SET dispatch_claim_token = 'winner' WHERE operation_id = ?").bind(operation.operationId).run();
    expect(await markRequestOperationOutboxDispatched(env.DB, operation.operationId, [outboxId], now + 1, operation.operationId)).toBe(false);
    expect(await completeRequestOperation(env.DB, operation.operationId, 202, { worker: "stale" }, {
      outboxIds: [outboxId],
      dispatchClaimToken: operation.operationId,
      now: now + 1,
    })).toBe(false);
    expect(await markRequestOperationOutboxDispatched(env.DB, operation.operationId, [outboxId], now + 2, "winner")).toBe(true);
    expect(await completeRequestOperation(env.DB, operation.operationId, 202, { worker: "winner" }, {
      outboxIds: [outboxId],
      dispatchClaimToken: "winner",
      now: now + 3,
    })).toBe(true);

    const recoveryOutboxId = await outboxFor("dispatch-recovery", now + 10);
    const recovery = await claimRequestOperation({
      ...eventInput("events.mrq237.recovery", { outbox: recoveryOutboxId }, now + 10),
      idempotencyKey: "mrq237-dispatch-recovery",
    });
    await linkRequestOperationOutbox(env.DB, recovery.operationId, [recoveryOutboxId]);
    expect(await markRequestOperationDispatchPending(env.DB, recovery.operationId, 202, { queued: true }, [recoveryOutboxId], {
      claimToken: recovery.claimToken,
      now: now + 10,
    })).toBe(true);
    const queue = { send: vi.fn().mockResolvedValue(undefined) } as unknown as Queue<unknown>;
    expect(await dispatchPendingRequestOperations(env.DB, queue, now + 60_011)).toBe(1);
    expect(queue.send).toHaveBeenCalledWith({ type: "mail_outbox", outbox_id: recoveryOutboxId });
    const recovered = await env.DB.prepare(
      "SELECT state, response_json FROM request_operations WHERE operation_id = ?",
    ).bind(recovery.operationId).first<{ state: string; response_json: string }>();
    expect(recovered?.state).toBe("completed");
    expect(JSON.parse(recovered?.response_json ?? "{}")).toEqual({ queued: true, operation: { dispatch_state: "dispatched" } });

    const failedOutboxId = await outboxFor("dispatch-failure", now + 20);
    const failed = await claimRequestOperation({
      ...eventInput("events.mrq237.failure", { outbox: failedOutboxId }, now + 20),
      idempotencyKey: "mrq237-dispatch-failure",
    });
    await linkRequestOperationOutbox(env.DB, failed.operationId, [failedOutboxId]);
    await markRequestOperationDispatchPending(env.DB, failed.operationId, 202, { queued: true }, [failedOutboxId], {
      claimToken: failed.claimToken,
      now: now + 20,
    });
    const failingQueue = { send: vi.fn().mockRejectedValue(new Error("queue unavailable")) } as unknown as Queue<unknown>;
    expect(await dispatchPendingRequestOperations(env.DB, failingQueue, now + 60_021)).toBe(0);
    expect(await env.DB.prepare(
      "SELECT state, dispatch_last_error, dispatch_claim_token FROM request_operations WHERE operation_id = ?",
    ).bind(failed.operationId).first<{ state: string; dispatch_last_error: string; dispatch_claim_token: string | null }>()).toMatchObject({
      state: "dispatch_pending",
      dispatch_last_error: "queue unavailable",
      dispatch_claim_token: null,
    });
  });

  test("CONTRACT · MRQ-237 · typed scope and actor checks reject cross-tenant claims and cascades remove links", async () => {
    await expect(claimRequestOperation({
      ...eventInput("events.mrq237.actor", { action: "cross-tenant" }),
      actorPersonId: OTHER_PERSON_ID,
      idempotencyKey: "mrq237-cross-tenant-actor",
    })).rejects.toMatchObject({ code: "forbidden" } satisfies Partial<ApiError>);

    await expect(claimRequestOperation({
      ...eventInput("events.mrq237.scope", { action: "cross-tenant" }),
      scope: { kind: "event", eventId: OTHER_EVENT_ID, organizationId: DEMO_ORGANIZATION_ID },
      idempotencyKey: "mrq237-cross-tenant-scope",
    })).rejects.toThrow(/constraint|foreign key/i);

    const eventOperation = await claimRequestOperation({
      db: env.DB,
      scope: { kind: "event", eventId: OTHER_EVENT_ID, organizationId: OTHER_ORG_ID },
      route: "events.mrq237.cascade",
      requestId: "mrq237-cascade-event",
      actorKind: "system",
      request: { action: "event-delete" },
    });
    await linkRequestOperationOutbox(env.DB, eventOperation.operationId, ["outbox-event-cascade"]);
    await env.DB.prepare("DELETE FROM events WHERE id = ?").bind(OTHER_EVENT_ID).run();
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM request_operations WHERE operation_id = ?").bind(eventOperation.operationId).first<{ count: number }>()).toEqual({ count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM request_operation_outbox WHERE operation_id = ?").bind(eventOperation.operationId).first<{ count: number }>()).toEqual({ count: 0 });

    const orgOperation = await claimRequestOperation({
      db: env.DB,
      scope: { kind: "org", organizationId: OTHER_ORG_ID },
      route: "org.mrq237.cascade",
      requestId: "mrq237-cascade-org",
      actorKind: "system",
      request: { action: "org-delete" },
    });
    await linkRequestOperationOutbox(env.DB, orgOperation.operationId, ["outbox-org-cascade"]);
    // The seed person is an ordinary organization child without an ON DELETE
    // cascade in the legacy schema; remove that unrelated child so this test
    // isolates the request-operation tenant cascade.
    await env.DB.prepare("DELETE FROM people WHERE org_id = ?").bind(OTHER_ORG_ID).run();
    await env.DB.prepare("DELETE FROM organizations WHERE id = ?").bind(OTHER_ORG_ID).run();
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM request_operations WHERE operation_id = ?").bind(orgOperation.operationId).first<{ count: number }>()).toEqual({ count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM request_operation_outbox WHERE operation_id = ?").bind(orgOperation.operationId).first<{ count: number }>()).toEqual({ count: 0 });
  });
});
