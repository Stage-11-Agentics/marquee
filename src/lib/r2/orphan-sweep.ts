/**
 * Nightly batched cleanup of `pending` attachment rows older than 24 hours.
 * Never runs on a request path, never lists R2 — it walks D1's `pending`
 * rows and deletes the matching object first, then the row, so a crash
 * mid-batch never orphans a D1 row pointing at nothing (missing R2 object is
 * treated as already deleted; a failed R2 delete keeps the row for retry).
 */

const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH_SIZE = 100;

export interface OrphanSweepResult {
  scanned: number;
  deleted: number;
  errors: number;
}

export async function runUploadOrphanSweep(
  db: D1Database,
  media: R2Bucket,
  nowMs: number,
): Promise<OrphanSweepResult> {
  const cutoff = nowMs - ORPHAN_AGE_MS;
  const result: OrphanSweepResult = { scanned: 0, deleted: 0, errors: 0 };

  const { results } = await db
    .prepare(
      `SELECT id, r2_key FROM attachments WHERE status = 'pending' AND created_at < ?1 LIMIT ?2`,
    )
    .bind(cutoff, SWEEP_BATCH_SIZE)
    .all<{ id: string; r2_key: string }>();

  for (const row of results ?? []) {
    result.scanned += 1;
    try {
      await media.delete(row.r2_key);
      await db.prepare(`DELETE FROM attachments WHERE id = ?1 AND status = 'pending'`).bind(row.id).run();
      result.deleted += 1;
    } catch {
      result.errors += 1;
    }
  }

  return result;
}
