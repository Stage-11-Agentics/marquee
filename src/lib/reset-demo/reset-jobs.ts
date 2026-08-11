export type ResetJobStatus = "queued" | "running" | "done" | "failed";

export interface ResetJob {
  id: string;
  status: ResetJobStatus;
  created_at: number;
  updated_at: number;
  error?: string;
  result?: unknown;
}

const JOB_KEY_PREFIX = "reset-demo-job:";
const JOB_TTL_SECONDS = 60 * 60; // one hour — jobs are polled, not archived.

export async function createResetJob(kv: KVNamespace, now = Date.now()): Promise<ResetJob> {
  const job: ResetJob = {
    id: crypto.randomUUID(),
    status: "queued",
    created_at: now,
    updated_at: now,
  };
  await kv.put(jobKey(job.id), JSON.stringify(job), { expirationTtl: JOB_TTL_SECONDS });
  return job;
}

export async function readResetJob(kv: KVNamespace, jobId: string): Promise<ResetJob | null> {
  return kv.get<ResetJob>(jobKey(jobId), "json");
}

export async function updateResetJob(
  kv: KVNamespace,
  jobId: string,
  update: Pick<ResetJob, "status"> & Partial<Pick<ResetJob, "error" | "result">>,
): Promise<ResetJob | null> {
  const job = await readResetJob(kv, jobId);
  if (!job) return null;
  const next: ResetJob = { ...job, ...update, updated_at: Date.now() };
  await kv.put(jobKey(jobId), JSON.stringify(next), { expirationTtl: JOB_TTL_SECONDS });
  return next;
}

function jobKey(jobId: string): string {
  return `${JOB_KEY_PREFIX}${jobId}`;
}
