import { reseedDemo, type ReseedResult } from "./reseed-demo";
import { updateResetJob } from "./reset-jobs";

export const MIRROR_RECONCILE_MESSAGE_TYPE = "mirror_reconcile";

export interface ResetJobBindings {
  CACHE: KVNamespace;
  DB: D1Database;
  MIRROR_QUEUE: Queue<unknown>;
}

/**
 * The queue consumer path for `reset_demo` messages (SPEC §4.1/§3.9): run the
 * reseed, then enqueue exactly ONE mirror reconcile job — the reseed writes
 * with suppress_mirror, so the whole base must not be re-queued row by row.
 * The reconcile message consumer lands with M-25/M-26.
 */
export async function runResetJob(
  env: ResetJobBindings,
  jobId: string,
): Promise<ReseedResult> {
  await updateResetJob(env.CACHE, jobId, { status: "running" });
  try {
    const result = await reseedDemo(env.DB);
    await env.MIRROR_QUEUE.send({
      type: MIRROR_RECONCILE_MESSAGE_TYPE,
      reason: "reset_demo",
      requested_at: result.reseededAt,
    });
    await updateResetJob(env.CACHE, jobId, { status: "done", result });
    return result;
  } catch (error) {
    await updateResetJob(env.CACHE, jobId, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
