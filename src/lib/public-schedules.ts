/**
 * Schedule short codes: the one primitive behind the share link, the sync
 * link, the JSON an agent reads, and the calendar feed a phone subscribes to.
 *
 * There is no account here and there never will be. A code is a random handle
 * an attendee chose to create; the write key that edits it is returned once
 * and stored only as a hash. Nothing in the row identifies a person.
 */
import type { D1Database } from "@cloudflare/workers-types";

import { loadPublicAgenda, type PublicEvent, type PublicSession } from "./public-site";

/** Crockford-ish base32: no I, L, O or U, so a code read aloud survives. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 13;
export const CODE_PATTERN = /^MQ-[0-9A-HJKMNP-TV-Z]{13}$/;
/** Vandalism economics, not authorization: a cap keeps one row from becoming a payload. */
export const MAX_SESSIONS = 200;

export interface PublicScheduleRow {
  code: string;
  event_id: string;
  session_ids: string;
  write_key_hash: string;
  /**
   * The browser that owns this code, when one created it. Null for a schedule
   * an agent built — and that null is what the demand aggregate reads to count
   * an agent-built code as one voice instead of none.
   */
  device_hash: string | null;
  created_at: number;
  updated_at: number;
}

/** The handle a browser mints for itself. Sixteen to sixty-four hex characters. */
export const DEVICE_HASH_PATTERN = /^[0-9a-f]{16,64}$/;

export interface PublicScheduleUrls {
  share: string;
  sync: string;
  webcal: string;
  ics: string;
  json: string;
}

export interface PublicScheduleView {
  code: string;
  event: PublicEvent;
  sessions: PublicSession[];
  /**
   * The whole published programme this code was read against. It costs nothing
   * — the view already loads it to resolve the set — and it is what lets a
   * caller derive the owner's speaking sessions without a second query.
   */
  allSessions: PublicSession[];
  overlaps: Array<[string, string]>;
  updatedAt: number;
}

function randomValues(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** 13 base32 characters — 65 bits of entropy, unguessable by anything short of a botnet. */
export function newScheduleCode(): string {
  const bytes = randomValues(CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `MQ-${code}`;
}

/** 128 bits, hex, shown once and never stored in the clear. */
export function newWriteKey(): string {
  return [...randomValues(16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashWriteKey(writeKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(writeKey));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time comparison. The window is small — an attacker would need the
 * code first — but a byte-by-byte early return on a secret is never the right
 * shape, and this costs nothing.
 */
export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function scheduleUrls(
  code: string,
  eventSlug: string,
  origin: string,
  writeKey?: string,
  /**
   * The owner's read-only feed handle. It is what separates "my calendar" from
   * "the feed anyone holding my share code could construct": the sessions the
   * owner is speaking at ride the feed only for a caller presenting this.
   */
  feedToken?: string | null,
): PublicScheduleUrls {
  const base = origin.replace(/\/+$/, "");
  const host = base.replace(/^https?:\/\//, "");
  const agenda = `${base}/agenda?event=${encodeURIComponent(eventSlug)}&sched=${code}`;
  const feed = `/api/v1/public/schedules/${code}/calendar.ics${feedToken ? `?f=${encodeURIComponent(feedToken)}` : ""}`;
  return {
    share: agenda,
    // The key rides the fragment, which no browser sends to a server: the sync
    // link can be shown, scanned, and pasted without the key ever being logged.
    sync: writeKey ? `${agenda}#k=${writeKey}` : agenda,
    webcal: `webcal://${host}${feed}`,
    ics: `${base}${feed}`,
    json: `${base}/api/v1/public/schedules/${code}`,
  };
}

/** Touching is not overlapping, and the pairs are ordered so a diff is stable. */
export function computeOverlaps(sessions: readonly PublicSession[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let left = 0; left < sessions.length; left += 1) {
    for (let right = left + 1; right < sessions.length; right += 1) {
      const first = sessions[left];
      const second = sessions[right];
      const firstEnd = first.startsAt + first.durationMin * 60_000;
      const secondEnd = second.startsAt + second.durationMin * 60_000;
      if (first.startsAt < secondEnd && second.startsAt < firstEnd) pairs.push([first.id, second.id]);
    }
  }
  return pairs;
}

/**
 * Resolve the ids an attendee (or their agent) submitted against what is
 * actually published, accepting an id or a slug for each — an agent reading
 * the page hooks and an agent reading the JSON must both work. Anything that
 * is not a published session of this event simply is not a session.
 */
export function resolveSessionIds(
  sessions: readonly PublicSession[],
  requested: readonly string[],
): { resolved: string[]; unknown: string[] } {
  const byId = new Map(sessions.map((session) => [session.id, session.id]));
  const bySlug = new Map(sessions.map((session) => [session.slug, session.id]));
  const resolved: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const value of requested) {
    const id = byId.get(value) ?? bySlug.get(value);
    if (!id) { unknown.push(value); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    resolved.push(id);
  }
  return { resolved, unknown };
}

/**
 * A modest per-IP ceiling on code creation, because a row here is permanent
 * and anonymous. This is deliberately local to this route rather than the
 * framework's rate-limit vocabulary: the shared limiter adapter is not
 * installed in this codebase yet (`allowAllRateLimiter` is what every route
 * gets), and the one endpoint in the product that writes a durable row for a
 * caller who proved nothing should not wait for that.
 *
 * A fixed window is the right crudeness — this is vandalism economics, not
 * authorization, and a caller who wants a hundred codes can have them an hour
 * apart.
 */
export const SCHEDULE_CREATE_LIMIT = 30;
export const SCHEDULE_CREATE_WINDOW_SECONDS = 3600;

export interface ScheduleRateStore {
  get(key: string, type: "json"): Promise<unknown | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}

export async function checkScheduleCreateLimit(
  store: ScheduleRateStore | undefined,
  clientIp: string,
  now: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  // No KV binding (unit tests, a self-host without a cache) means no ceiling
  // rather than no service: refusing to create schedules because a counter is
  // missing would be a worse failure than an uncounted one.
  if (!store) return { allowed: true, retryAfterSeconds: 0 };
  const windowStart = Math.floor(now / (SCHEDULE_CREATE_WINDOW_SECONDS * 1000)) * SCHEDULE_CREATE_WINDOW_SECONDS * 1000;
  const key = `schedule-create:${clientIp}:${windowStart}`;
  const seen = await store.get(key, "json").catch(() => null);
  const count = typeof seen === "number" ? seen : 0;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + SCHEDULE_CREATE_WINDOW_SECONDS * 1000 - now) / 1000));
  if (count >= SCHEDULE_CREATE_LIMIT) return { allowed: false, retryAfterSeconds };
  await store
    .put(key, JSON.stringify(count + 1), { expirationTtl: SCHEDULE_CREATE_WINDOW_SECONDS * 2 })
    .catch(() => { /* an uncounted request is better than a refused one */ });
  return { allowed: true, retryAfterSeconds };
}

export async function readSchedule(database: D1Database, code: string): Promise<PublicScheduleRow | null> {
  return database
    .prepare("SELECT code, event_id, session_ids, write_key_hash, device_hash, created_at, updated_at FROM public_schedules WHERE code = ? LIMIT 1")
    .bind(code)
    .first<PublicScheduleRow>();
}

/**
 * The set with its sessions embedded, in the order the conference happens —
 * an agent gets the whole answer in one call rather than N follow-ups.
 */
export async function loadScheduleView(
  database: D1Database,
  row: PublicScheduleRow,
): Promise<PublicScheduleView | null> {
  const eventSlug = await database
    .prepare("SELECT slug FROM events WHERE id = ? LIMIT 1")
    .bind(row.event_id)
    .first<{ slug: string }>();
  if (!eventSlug) return null;
  const agenda = await loadPublicAgenda(database, { eventSlug: eventSlug.slug, allDays: true });
  if (!agenda) return null;
  const wanted = new Set<string>(JSON.parse(row.session_ids) as string[]);
  const sessions = agenda.sessions
    .filter((session) => wanted.has(session.id))
    .sort((left, right) => left.startsAt - right.startsAt || left.id.localeCompare(right.id));
  return {
    code: row.code,
    event: agenda.event,
    sessions,
    allSessions: agenda.sessions,
    overlaps: computeOverlaps(sessions),
    updatedAt: row.updated_at,
  };
}
