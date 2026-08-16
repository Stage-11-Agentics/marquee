import type { D1Database } from "@cloudflare/workers-types";

import { auditStatement } from "../../lib/audit";

/**
 * Status-field rejection reasons are deliberately shared across mirror tickets.
 * MRQ-239 adds its transition reason at this seam; callers must not invent a
 * second audit, counter, or outbound-repair path for it.
 */
export const MIRROR_REJECTION_REASONS = [
  "forbidden_while_published",
  "illegal_transition",
] as const;

export type MirrorRejectionReason = (typeof MIRROR_REJECTION_REASONS)[number];

export interface MirrorSubmissionRejection {
  db: D1Database;
  eventId: string;
  rowId: string;
  field: string;
  reason: MirrorRejectionReason;
  before: unknown;
  requested: unknown;
  now: number;
}

/**
 * Record the provider edit and put current Marquee truth back into the next
 * outbound pass. The conditional insert keeps an already queued repair
 * idempotent and does nothing when the organization has no mapped table.
 */
export async function recordMirrorSubmissionRejection(
  input: MirrorSubmissionRejection,
): Promise<void> {
  const { db } = input;
  await db.batch([
    auditStatement(db, {
      eventId: input.eventId,
      actorKind: "airtable",
      actorPersonId: null,
      action: "mirror.inbound_rejected",
      entityType: "submission",
      entityId: input.rowId,
      before: { [input.field]: input.before },
      after: {
        reason: input.reason,
        field: input.field,
        requested: input.requested,
      },
      now: input.now,
      requestId: null,
    }),
    db
      .prepare(
        `INSERT INTO mirror_outbox
           (id, table_name, row_id, op, payload, status, attempts, last_error,
            drained_at, created_at, updated_at)
         SELECT lower(hex(randomblob(16))), 'submissions', submission.id, 'upsert',
                json_object('marquee_id', submission.id,
                            'event_id', submission.event_id,
                            'last_write_source', 'marquee'),
                'queued', 0, NULL, NULL, ?, ?
           FROM submissions submission
          WHERE submission.id = ?
            AND submission.event_id = ?
            AND EXISTS (
              SELECT 1 FROM mirror_state state
               WHERE state.table_name = 'submissions'
                 AND state.airtable_table_id IS NOT NULL
                 AND length(trim(state.airtable_table_id)) > 0
            )
            AND NOT EXISTS (
              SELECT 1 FROM mirror_outbox pending
               WHERE pending.table_name = 'submissions'
                 AND pending.row_id = submission.id
                 AND pending.op = 'upsert'
                 AND pending.drained_at IS NULL
                 AND pending.status IN ('queued', 'failed')
            )`,
      )
      .bind(input.now, input.now, input.rowId, input.eventId),
  ]);
}
