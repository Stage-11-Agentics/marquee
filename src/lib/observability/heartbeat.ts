/**
 * Cron heartbeats: the answer to "did the scheduled work actually run?"
 *
 * A cron that fires and fails is loud. A cron that never fires is silent — the
 * trigger was removed, the deploy dropped it, the account was suspended — and
 * silence looks exactly like health. Each successful run stamps the time it
 * finished into KV; the diagnostics probe reads those stamps back and calls a
 * trigger stale when its own schedule says it should have fired by now.
 *
 * KV is the right store for this: it is already bound, a heartbeat is worthless
 * if it is more than a few minutes stale, and it costs no migration.
 */

const HEARTBEAT_PREFIX = "observability:cron:";
/** Long enough that a daily trigger's heartbeat outlives its own period. */
const HEARTBEAT_TTL_SECONDS = 60 * 60 * 24 * 3;

export interface CronHeartbeat {
  cron: string;
  /** Epoch milliseconds of the last successful completion. */
  last_success_at: number;
  /** Milliseconds since that success, at read time. */
  age_ms: number;
  /** The run is overdue against its own schedule. */
  stale: boolean;
}

/** The triggers declared in `wrangler.jsonc`, with the period each promises. */
export const CRON_SCHEDULE: Readonly<Record<string, number>> = {
  "0 * * * *": 60 * 60 * 1_000,
  "15 4 * * *": 24 * 60 * 60 * 1_000,
  "30 4 * * *": 24 * 60 * 60 * 1_000,
};

/** A trigger is not called stale the instant it is due; schedulers drift. */
const STALENESS_GRACE = 1.5;

export async function recordCronHeartbeat(
  cache: KVNamespace,
  cron: string,
  now: number = Date.now(),
): Promise<void> {
  await cache.put(`${HEARTBEAT_PREFIX}${cron}`, String(now), {
    expirationTtl: HEARTBEAT_TTL_SECONDS,
  });
}

/**
 * Read every declared trigger's heartbeat. A trigger that has never run reports
 * `last_success_at: 0` and is stale — a fresh deployment says so honestly
 * instead of claiming health it has not earned.
 */
export async function readCronHeartbeats(
  cache: KVNamespace,
  now: number = Date.now(),
): Promise<CronHeartbeat[]> {
  return Promise.all(
    Object.entries(CRON_SCHEDULE).map(async ([cron, periodMs]) => {
      const raw = await cache.get(`${HEARTBEAT_PREFIX}${cron}`);
      const lastSuccessAt = Number(raw);
      if (!Number.isFinite(lastSuccessAt) || lastSuccessAt <= 0) {
        // Never run. `age_ms` is 0 rather than "milliseconds since the epoch",
        // which is not an age of anything; `last_success_at: 0` is what says
        // never, and `stale` is what says it matters.
        return { cron, last_success_at: 0, age_ms: 0, stale: true };
      }
      const ageMs = Math.max(0, now - lastSuccessAt);
      return {
        cron,
        last_success_at: lastSuccessAt,
        age_ms: ageMs,
        stale: ageMs > periodMs * STALENESS_GRACE,
      };
    }),
  );
}
