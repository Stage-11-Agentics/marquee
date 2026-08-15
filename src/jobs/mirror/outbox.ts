import type { D1Database, D1PreparedStatement, Queue } from "@cloudflare/workers-types";

import type { MirrorOutboxRow } from "../../db/schema";
import { mirrorConfig, type MirrorEnvironment } from "./config";
import { MIRROR_OUTBOX_MESSAGE_TYPE, type MirrorOutboxMessage } from "./messages";
import { MIRRORED_TABLES } from "./records";

export const MIRROR_SUPPRESSION_TABLE = "__mirror_suppressed__";
const SUPPRESSION_ROW_ID = "__mirror_suppression__";

export interface MirrorOutboxEnvironment extends MirrorEnvironment {
  MIRROR_QUEUE: Queue<unknown>;
}

/** Statements are composed into reseed's one atomic batch. */
export function mirrorSuppressionStatements(db: D1Database, now: number): [D1PreparedStatement, D1PreparedStatement] {
  return [
    db.prepare(
      `INSERT OR REPLACE INTO mirror_state
        (id, table_name, airtable_table_id, cursor, webhook_id,
         webhook_expires_at, last_sync_at, local_row_count, remote_row_count,
         last_error, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, NULL, ?, ?)`,
    ).bind(SUPPRESSION_ROW_ID, MIRROR_SUPPRESSION_TABLE, now, now),
    db.prepare("DELETE FROM mirror_state WHERE id = ?").bind(SUPPRESSION_ROW_ID),
  ];
}

/**
 * Queue only local outbox ids. The actual provider call happens in the queue
 * consumer; a missing key/base returns zero and leaves the product quiet.
 */
export async function dispatchPendingMirrorMessages(
  env: MirrorOutboxEnvironment,
  requestId?: string,
  now = Date.now(),
): Promise<number> {
  if (!mirrorConfig(env)) {
    // Missing configuration is an inert, successful off state. An operator
    // may be provisioning or rotating secrets, so pending work must remain
    // available for the next configured dispatch. Cleanup belongs only to an
    // explicit disconnect action, not this request-path probe.
    return 0;
  }
  const rows = await env.DB.prepare(
    `SELECT id FROM mirror_outbox
      WHERE drained_at IS NULL
        AND status IN ('queued', 'failed')
      ORDER BY created_at ASC, id ASC
      LIMIT 100`,
  ).all<{ id: string }>();
  if (rows.results.length === 0) return 0;
  const messages = rows.results.map((row) => ({
    body: {
      type: MIRROR_OUTBOX_MESSAGE_TYPE,
      outbox_id: row.id,
      ...(requestId ? { request_id: requestId } : {}),
    } satisfies MirrorOutboxMessage,
  }));
  if (typeof env.MIRROR_QUEUE.sendBatch === "function") {
    await env.MIRROR_QUEUE.sendBatch(messages);
  } else {
    for (const message of messages) await env.MIRROR_QUEUE.send(message.body);
  }
  // `now` is intentionally accepted for deterministic callers and to make the
  // dispatch clock explicit; queue delivery remains the state transition.
  void now;
  return rows.results.length;
}

export async function clearMirrorOutbox(db: D1Database): Promise<void> {
  // This helper is intentionally explicit: dispatch and queue consumption
  // never call it implicitly when configuration is absent.
  // check:api intentionally exercises meta routes with no D1 binding; an
  // explicit cleanup request is a no-op when that binding is absent.
  if (typeof (db as unknown as { prepare?: unknown })?.prepare !== "function") return;
  const placeholders = MIRRORED_TABLES.map(() => "?").join(",");
  await db.prepare(
    `DELETE FROM mirror_outbox
      WHERE drained_at IS NULL
        AND table_name IN (${placeholders})`,
  ).bind(...MIRRORED_TABLES).run();
}

export function parseMirrorOutboxPayload(row: MirrorOutboxRow): { marquee_id?: string } {
  try {
    const parsed = JSON.parse(row.payload) as { marquee_id?: unknown };
    return typeof parsed.marquee_id === "string" ? { marquee_id: parsed.marquee_id } : {};
  } catch {
    return {};
  }
}
