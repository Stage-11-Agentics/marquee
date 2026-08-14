/**
 * The anonymous demand signal.
 *
 * A star is a row of (event, session, device) and nothing else. The device is a
 * random handle the browser minted for itself; there is no person here, no IP,
 * and no way back to one. That is the whole privacy posture of this feature in
 * one table, and it is why the number an organizer reads weeks before the doors
 * open costs an attendee nothing to produce.
 *
 * The aggregate has two halves, ruled in the round-2 review: distinct beacon
 * devices, plus distinct API-created schedule codes containing the session. A
 * code created by this site's own module carries its device hash, so it de-dups
 * against that device's beacons and the pair counts once; a code created by an
 * agent has no device and counts as one. Every schedule an agent builds for its
 * human therefore reaches the same signal the browser does, which is the point
 * of an agent-native product having a demand board at all.
 *
 * It is a signal, not a vote. A determined script can mint device handles and
 * inflate it. The counters below are vandalism economics — they make casual
 * inflation tedious — and the design accepts the rest rather than pretending an
 * anonymous control can be made authoritative.
 */
import type { D1Database } from "@cloudflare/workers-types";

/** Long enough to be unguessable, short enough to be a cheap key. */
export const DEVICE_HASH_PATTERN = /^[0-9a-f]{16,64}$/;

export interface StarBeaconStore {
  get(key: string, type: "json"): Promise<unknown | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}

/**
 * Two ceilings, because one would be wrong in a specific and predictable way.
 *
 * A conference is one NAT. The schedules limiter's 30/hr per IP is right for a
 * rare, durable write, and would blackhole an entire ballroom for a control
 * that fires on every star — a thousand attendees starring ten sessions each is
 * ten thousand honest writes from one address. So the IP ceiling is set at
 * venue scale and the per-device ceiling is the one that actually shapes
 * behaviour: a single browser cannot star more sessions than a conference has,
 * and the table's primary key means repeating itself writes nothing new.
 */
export const STAR_BEACON_DEVICE_LIMIT = 400;
export const STAR_BEACON_IP_LIMIT = 20_000;
export const STAR_BEACON_WINDOW_SECONDS = 3600;

async function spendWindow(
  store: StarBeaconStore,
  key: string,
  limit: number,
  now: number,
): Promise<boolean> {
  const windowStart = Math.floor(now / (STAR_BEACON_WINDOW_SECONDS * 1000)) * STAR_BEACON_WINDOW_SECONDS * 1000;
  const windowKey = `${key}:${windowStart}`;
  const seen = await store.get(windowKey, "json").catch(() => null);
  const count = typeof seen === "number" ? seen : 0;
  if (count >= limit) return false;
  await store
    .put(windowKey, JSON.stringify(count + 1), { expirationTtl: STAR_BEACON_WINDOW_SECONDS * 2 })
    .catch(() => { /* an uncounted star beats a refused one */ });
  return true;
}

/**
 * No KV binding (unit tests, a self-host without a cache) means no ceiling
 * rather than no service — the same call the schedules limiter makes, for the
 * same reason: refusing to record a star because a counter is missing is a
 * worse failure than an uncounted one.
 */
export async function checkStarBeaconLimit(
  store: StarBeaconStore | undefined,
  input: { clientIp: string; deviceHash: string; now: number },
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil(
      (Math.floor(input.now / (STAR_BEACON_WINDOW_SECONDS * 1000)) * STAR_BEACON_WINDOW_SECONDS * 1000
        + STAR_BEACON_WINDOW_SECONDS * 1000 - input.now) / 1000,
    ),
  );
  if (!store) return { allowed: true, retryAfterSeconds: 0 };
  const device = await spendWindow(store, `star-beacon:device:${input.deviceHash}`, STAR_BEACON_DEVICE_LIMIT, input.now);
  if (!device) return { allowed: false, retryAfterSeconds };
  const ip = await spendWindow(store, `star-beacon:ip:${input.clientIp}`, STAR_BEACON_IP_LIMIT, input.now);
  return { allowed: ip, retryAfterSeconds };
}

/** Starring twice is starring once: the primary key is the idempotence. */
export async function writeStarBeacon(
  database: D1Database,
  input: { eventId: string; sessionId: string; deviceHash: string; starred: boolean; now: number },
): Promise<void> {
  if (input.starred) {
    await database
      .prepare(
        `INSERT INTO session_star_beacons (event_id, session_id, device_hash, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, device_hash) DO NOTHING`,
      )
      .bind(input.eventId, input.sessionId, input.deviceHash, input.now)
      .run();
    return;
  }
  await database
    .prepare("DELETE FROM session_star_beacons WHERE session_id = ? AND device_hash = ?")
    .bind(input.sessionId, input.deviceHash)
    .run();
}

/**
 * Every session's count in two queries, never N.
 *
 * `json_each` expands each code's stored id array so the second half is a
 * GROUP BY rather than a read-and-count in JavaScript — a conference with a few
 * thousand codes should not ship its whole schedule table to the Worker to
 * render one agenda.
 */
export async function sessionDemandCounts(
  database: D1Database,
  eventId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const beacons = await database
    .prepare(
      `SELECT session_id AS session_id, COUNT(DISTINCT device_hash) AS n
       FROM session_star_beacons WHERE event_id = ? GROUP BY session_id`,
    )
    .bind(eventId)
    .all<{ session_id: string; n: number }>();
  for (const row of beacons.results ?? []) counts.set(row.session_id, Number(row.n));

  const codes = await database
    .prepare(
      `SELECT entry.value AS session_id, COUNT(*) AS n
       FROM public_schedules AS schedule, json_each(schedule.session_ids) AS entry
       WHERE schedule.event_id = ? AND schedule.device_hash IS NULL
       GROUP BY entry.value`,
    )
    .bind(eventId)
    .all<{ session_id: string; n: number }>();
  for (const row of codes.results ?? []) {
    counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + Number(row.n));
  }
  return counts;
}

/** The gauges beside the board, from the same rows the board is built from. */
export interface DemandStats {
  imported: number;
  synced: number;
  viaAgents: number;
  claimed: number;
  advancePicks: number;
}

export async function demandStats(database: D1Database, eventId: string): Promise<DemandStats> {
  const attendance = await database
    .prepare(
      `SELECT
         SUM(CASE WHEN source = 'import' THEN 1 ELSE 0 END) AS imported,
         SUM(CASE WHEN source = 'claim' AND verified_at IS NOT NULL THEN 1 ELSE 0 END) AS claimed
       FROM event_attendances WHERE event_id = ?`,
    )
    .bind(eventId)
    .first<{ imported: number | null; claimed: number | null }>();
  const schedules = await database
    .prepare(
      `SELECT
         COUNT(*) AS synced,
         SUM(CASE WHEN device_hash IS NULL THEN 1 ELSE 0 END) AS via_agents
       FROM public_schedules WHERE event_id = ?`,
    )
    .bind(eventId)
    .first<{ synced: number | null; via_agents: number | null }>();
  const picks = await database
    .prepare("SELECT COUNT(*) AS advance_picks FROM session_star_beacons WHERE event_id = ?")
    .bind(eventId)
    .first<{ advance_picks: number | null }>();
  return {
    imported: Number(attendance?.imported ?? 0),
    synced: Number(schedules?.synced ?? 0),
    viaAgents: Number(schedules?.via_agents ?? 0),
    claimed: Number(attendance?.claimed ?? 0),
    advancePicks: Number(picks?.advance_picks ?? 0),
  };
}

/* ── The public-counts setting ─────────────────────────────────────────── */

/**
 * Whether attendees see the number at all is the organizer's call, and it ships
 * off: a popularity display carries speaker feelings and rich-get-richer
 * dynamics, so nobody's conference acquires one by default.
 *
 * It rides `event_settings` rather than an organization row. There is no
 * org-settings table in this schema, and both the surface this governs (one
 * conference's public agenda) and the data it thresholds (one conference's
 * sessions) are event-scoped — so an event key is the honest home, and an
 * organization running two conferences can answer the question twice.
 */
export const PUBLIC_STAR_COUNTS_SETTING_KEY = "public_star_counts";
export const DEFAULT_STAR_COUNT_THRESHOLD = 3;

export interface PublicStarCountSetting {
  enabled: boolean;
  /** Floor 1. Zero would publish "0 schedules include this session", which is the worst number a session can carry. */
  threshold: number;
}

export function normalizeThreshold(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_STAR_COUNT_THRESHOLD;
  return Math.max(1, Math.min(99, Math.trunc(parsed)));
}

export function readPublicStarCountSetting(valueJson: string | null): PublicStarCountSetting {
  if (!valueJson) return { enabled: false, threshold: DEFAULT_STAR_COUNT_THRESHOLD };
  try {
    const parsed = JSON.parse(valueJson) as { enabled?: unknown; threshold?: unknown };
    return {
      enabled: parsed.enabled === true,
      threshold: normalizeThreshold(parsed.threshold),
    };
  } catch {
    return { enabled: false, threshold: DEFAULT_STAR_COUNT_THRESHOLD };
  }
}

export async function publicStarCountSetting(
  database: D1Database,
  eventId: string,
): Promise<PublicStarCountSetting> {
  const row = await database
    .prepare("SELECT value_json FROM event_settings WHERE event_id = ? AND key = ?")
    .bind(eventId, PUBLIC_STAR_COUNTS_SETTING_KEY)
    .first<{ value_json: string }>();
  return readPublicStarCountSetting(row?.value_json ?? null);
}

export async function writePublicStarCountSetting(
  database: D1Database,
  eventId: string,
  setting: PublicStarCountSetting,
  now: number,
): Promise<PublicStarCountSetting> {
  const stored: PublicStarCountSetting = {
    enabled: setting.enabled === true,
    threshold: normalizeThreshold(setting.threshold),
  };
  await database
    .prepare(
      `INSERT INTO event_settings (id, event_id, key, value_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .bind(`public-star-counts-${eventId}`, eventId, PUBLIC_STAR_COUNTS_SETTING_KEY, JSON.stringify(stored), now, now)
    .run();
  return stored;
}

/**
 * What the public agenda may show: the count when the setting is on and the
 * session has reached the threshold, and null otherwise — never zero, never a
 * hidden-but-rendered number. The caller reserves the slot either way.
 */
export function publicStarCount(
  setting: PublicStarCountSetting,
  counts: Map<string, number>,
  sessionId: string,
): number | null {
  if (!setting.enabled) return null;
  const count = counts.get(sessionId) ?? 0;
  return count >= setting.threshold ? count : null;
}

/**
 * What a public page may render, as a plain record keyed by session id.
 *
 * The setting being off is answered with an empty object and a single settings
 * read — no aggregate query runs at all, so a conference that never turns
 * counts on pays nothing for the feature existing (R7: speed is a feature).
 */
export async function publishableStarCounts(
  database: D1Database,
  eventId: string,
): Promise<Record<string, number>> {
  const setting = await publicStarCountSetting(database, eventId);
  if (!setting.enabled) return {};
  const counts = await sessionDemandCounts(database, eventId);
  const publishable: Record<string, number> = {};
  for (const [sessionId, count] of counts) {
    if (count >= setting.threshold) publishable[sessionId] = count;
  }
  return publishable;
}

/** "N schedules include this session" — one sentence, one place, said the same everywhere. */
export function starCountLabel(count: number): string {
  return `${count} ${count === 1 ? "schedule includes" : "schedules include"} this session`;
}
