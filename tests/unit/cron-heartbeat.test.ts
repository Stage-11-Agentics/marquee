/**
 * The silent-cron detector.
 *
 * A cron that fires and fails is loud. A cron that never fires is silent, and
 * silence looks exactly like health — which is the failure this exists to make
 * visible.
 */
import { describe, expect, test } from "vitest";

import { CRON_SCHEDULE, readCronHeartbeats, recordCronHeartbeat } from "../../src/lib/observability/heartbeat";

function fakeCache(seed: Record<string, string> = {}): KVNamespace & { store: Map<string, string> } {
  const store = new Map(Object.entries(seed));
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

const HOURLY = "0 * * * *";
const NOW = Date.UTC(2026, 7, 11, 12);

describe("cron heartbeats", () => {
  test("CONTRACT · a successful run stamps a heartbeat the probe can read back", async () => {
    const cache = fakeCache();
    await recordCronHeartbeat(cache, HOURLY, NOW);
    const [hourly] = await readCronHeartbeats(cache, NOW + 60_000);
    expect(hourly).toMatchObject({ cron: HOURLY, last_success_at: NOW, age_ms: 60_000, stale: false });
  });

  test("CONTRACT · a trigger that has never run reports never, not an age since the epoch", async () => {
    const heartbeats = await readCronHeartbeats(fakeCache(), NOW);
    expect(heartbeats).toHaveLength(Object.keys(CRON_SCHEDULE).length);
    for (const heartbeat of heartbeats) {
      expect(heartbeat).toMatchObject({ last_success_at: 0, age_ms: 0, stale: true });
    }
  });

  test("CONTRACT · a trigger overdue against its own schedule is stale, with room for drift", async () => {
    const cache = fakeCache();
    await recordCronHeartbeat(cache, HOURLY, NOW);
    const hour = 3_600_000;
    // Schedulers drift; being a few minutes late is not a fault.
    expect((await readCronHeartbeats(cache, NOW + hour + 60_000))[0]?.stale).toBe(false);
    expect((await readCronHeartbeats(cache, NOW + hour * 2))[0]?.stale).toBe(true);
  });

  test("CONTRACT · a corrupt heartbeat reads as never run rather than as fresh", async () => {
    const cache = fakeCache({ [`observability:cron:${HOURLY}`]: "not-a-number" });
    expect((await readCronHeartbeats(cache, NOW))[0]).toMatchObject({ last_success_at: 0, stale: true });
  });

  test("CONTRACT · every declared trigger in the deployment config has a schedule here", async () => {
    // A trigger added to wrangler.jsonc without a period here would be watched
    // by nothing, which is the exact blind spot this file closes.
    const { readFile } = await import("node:fs/promises");
    const config = await readFile(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    const declared = [...config.matchAll(/"((?:[\d*/,\-]+\s+){4}[\d*/,\-]+)"/g)].map((match) => match[1] as string);
    expect(declared.length).toBeGreaterThan(0);
    for (const cron of declared) expect(Object.keys(CRON_SCHEDULE)).toContain(cron);
  });
});
