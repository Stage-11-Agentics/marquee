/**
 * HEAD/range verification, bounded sniff, and the pending -> ready
 * transition. Idempotent: a repeated completion of an already-ready
 * attachment returns the same result without re-verifying. Any type/size
 * mismatch deletes the R2 object immediately and leaves the row pending
 * (retryable) rather than ready.
 */

import { policyFor, type UploadPolicy } from "./policy";
import type { UploadOwnerConfig } from "./protocol";
import { matchesExpectedKind, readImageDimensions, SNIFF_HEAD_BYTES } from "./sniff";

export interface AttachmentPendingRow {
  id: string;
  event_id: string;
  owner_type: string;
  owner_id: string;
  r2_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: "pending" | "ready";
}

export type CompleteOutcome =
  | { ok: true; r2Etag: string }
  | { ok: false; reason: "missing_object" }
  | { ok: false; reason: "size_mismatch" | "type_mismatch" | "dimension_too_small" };

/**
 * `env.MEDIA` is the R2 binding. Deletes the object on any contradiction and
 * confirms the delete landed (`head === null`) before returning the mismatch
 * so callers never report a rejection while bytes remain live.
 */
export async function verifyAndComplete(
  media: R2Bucket,
  row: AttachmentPendingRow,
  ownerConfig?: UploadOwnerConfig,
): Promise<CompleteOutcome> {
  if (row.status === "ready") {
    const head = await media.head(row.r2_key);
    return head ? { ok: true, r2Etag: head.etag } : { ok: false, reason: "missing_object" };
  }

  const head = await media.head(row.r2_key);
  if (!head) return { ok: false, reason: "missing_object" };
  if (head.size !== row.size_bytes) {
    await media.delete(row.r2_key);
    return { ok: false, reason: "size_mismatch" };
  }

  const policy: UploadPolicy | null = policyFor(row.owner_type as never, ownerConfig);
  const rangeEnd = Math.min(head.size, SNIFF_HEAD_BYTES) - 1;
  const ranged = await media.get(row.r2_key, { range: { offset: 0, length: rangeEnd + 1 } });
  if (!ranged) {
    await media.delete(row.r2_key);
    return { ok: false, reason: "missing_object" };
  }
  const sample = new Uint8Array(await ranged.arrayBuffer());

  const rule = policy?.rules.find((candidate) => candidate.mime === row.content_type.toLowerCase());
  if (!rule || !matchesExpectedKind(sample, rule.kind)) {
    await media.delete(row.r2_key);
    return { ok: false, reason: "type_mismatch" };
  }

  if (policy?.minImageDimension && (rule.kind === "jpeg" || rule.kind === "png" || rule.kind === "webp")) {
    const dimensions = readImageDimensions(sample, rule.kind);
    if (!dimensions || dimensions.width < policy.minImageDimension || dimensions.height < policy.minImageDimension) {
      await media.delete(row.r2_key);
      return { ok: false, reason: "dimension_too_small" };
    }
  }

  return { ok: true, r2Etag: head.etag };
}
