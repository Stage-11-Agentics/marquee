import type { D1Database } from "@cloudflare/workers-types";

import { slugify } from "./ids";
import { roomDisplayLabel } from "./venues";

export const EMBED_CACHE_TTL_SECONDS = 30;
const CLOUDFLARE_KV_MIN_TTL_SECONDS = 60;

export interface PublicEmbedCache {
  get(key: string, type: "json"): Promise<unknown | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  list(options: { prefix: string }): Promise<{ keys: Array<{ name: string }> }>;
  delete(key: string): Promise<void>;
}

export interface PublicEvent {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  startsOn: string;
  endsOn: string;
  timezone: string;
  venue: string | null;
  accent: string | null;
}

export interface PublicDay {
  id: string;
  label: string;
}

export interface PublicTrack {
  id: string;
  name: string;
  color: string;
}

export interface PublicSpeakerSummary {
  id: string;
  slug: string;
  name: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  socialLinks: string[];
}

export interface PublicSession {
  id: string;
  slug: string;
  title: string;
  abstract: string | null;
  status: string;
  day: string;
  date: string;
  time: string;
  startsAt: number;
  durationMin: number;
  room: string;
  building: string | null;
  roomLabel: string;
  tracks: PublicTrack[];
  speakers: PublicSpeakerSummary[];
}

export interface PublicAgendaData {
  event: PublicEvent;
  days: PublicDay[];
  tracks: PublicTrack[];
  sessions: PublicSession[];
  filters: {
    day: string | null;
    track: string | null;
    q: string | null;
    status: string | null;
  };
}

export interface PublicSpeaker extends PublicSpeakerSummary {
  sessions: Array<Pick<PublicSession, "id" | "slug" | "title" | "day" | "date" | "time" | "roomLabel">>;
}

export interface PublicEmbedConfig {
  kind: "agenda" | "speakers";
  tracks: string[];
  statuses: string[];
  accent: string | null;
}

export interface ResolvedPublicEmbed {
  event: PublicEvent;
  slug: string;
  kind: "agenda" | "speakers";
  config: PublicEmbedConfig;
}

export interface PublicEmbedData {
  event: PublicEvent;
  slug: string;
  kind: "agenda" | "speakers";
  config: PublicEmbedConfig;
  tracks: PublicTrack[];
  sessions: PublicSession[];
  speakers: PublicSpeaker[];
  filters: {
    track: string | null;
    status: string | null;
  };
}

interface EventRow {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  starts_on: string;
  ends_on: string;
  timezone: string;
  venue: string | null;
  accent: string | null;
}

interface PublicSessionRow {
  id: string;
  title: string;
  abstract: string | null;
  status: string;
  starts_at: number;
  duration_min: number;
  room_name: string;
  building_name: string | null;
  speakers_json: string;
  tracks_json: string;
}

interface EmbedRow {
  event_id: string;
  event_slug: string;
  kind: "agenda" | "speakers";
  slug: string;
  config: string;
}

interface PublicEmbedCacheEnvelope {
  __marqueePublicEmbed: true;
  expiresAt: number;
  data: PublicEmbedData;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isPublicEmbedCacheEnvelope(value: unknown): value is PublicEmbedCacheEnvelope {
  return typeof value === "object" && value !== null &&
    "__marqueePublicEmbed" in value &&
    (value as { __marqueePublicEmbed?: unknown }).__marqueePublicEmbed === true;
}

function toEvent(row: EventRow): PublicEvent {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    timezone: row.timezone,
    venue: row.venue,
    accent: row.accent,
  };
}

async function findLiveEvent(
  database: D1Database,
  eventSlug?: string | null,
): Promise<PublicEvent | null> {
  const query = eventSlug
    ? `SELECT id, slug, name, tagline, starts_on, ends_on, timezone, venue, accent
         FROM events WHERE status = 'live' AND slug = ? LIMIT 1`
    : `SELECT id, slug, name, tagline, starts_on, ends_on, timezone, venue, accent
         FROM events WHERE status = 'live'
        ORDER BY demo_mode DESC, created_at ASC, id ASC LIMIT 1`;
  const row = await database.prepare(query).bind(...(eventSlug ? [eventSlug] : [])).first<EventRow>();
  return row ? toEvent(row) : null;
}

export async function loadPublicEvent(
  database: D1Database,
  eventSlug?: string | null,
): Promise<PublicEvent | null> {
  return findLiveEvent(database, eventSlug);
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function addDays(value: string, amount: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateLabel(value: string): string {
  const date = parseDate(value);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function eventDays(event: PublicEvent): PublicDay[] {
  const days: PublicDay[] = [];
  for (let cursor = event.startsOn; cursor <= event.endsOn; cursor = addDays(cursor, 1)) {
    days.push({ id: cursor, label: dateLabel(cursor) });
  }
  return days;
}

function zonedParts(timestamp: number, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = values.hour === "24" ? "00" : values.hour;
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${hour}:${values.minute}`,
  };
}

function publicSpeakerSlug(name: string, id: string): string {
  return slugify(name) || slugify(id) || "speaker";
}

function publicSessionSlug(title: string, id: string): string {
  return slugify(title) || slugify(id) || "session";
}

function parseSocialLinks(value: string | null | undefined): string[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
}

function parseSpeakers(value: string): PublicSpeakerSummary[] {
  const raw = parseJson<Array<Record<string, unknown>>>(value, []);
  return raw.flatMap((speaker) => {
    if (typeof speaker.id !== "string" || typeof speaker.name !== "string") return [];
    return [{
      id: speaker.id,
      slug: publicSpeakerSlug(speaker.name, speaker.id),
      name: speaker.name,
      title: typeof speaker.title === "string" ? speaker.title : null,
      company: typeof speaker.company === "string" ? speaker.company : null,
      bio: typeof speaker.bio === "string" ? speaker.bio : null,
      socialLinks: parseSocialLinks(typeof speaker.social_links === "string" ? speaker.social_links : undefined),
    }];
  });
}

function parseTracks(value: string): PublicTrack[] {
  const raw = parseJson<Array<Record<string, unknown>>>(value, []);
  return raw.flatMap((track) => {
    if (typeof track.id !== "string" || typeof track.name !== "string") return [];
    return [{
      id: track.id,
      name: track.name,
      color: typeof track.color === "string" ? track.color : "#0b6a72",
    }];
  });
}

function sessionRowsQuery(
  event: PublicEvent,
  filters: { track?: string | null; q?: string | null; status?: string | null },
): { sql: string; bindings: unknown[] } {
  const clauses = [
    "ai.event_id = ?",
    "ai.kind = 'session'",
    "ai.is_published = 1",
    "s.status NOT IN ('rejected', 'withdrawn')",
  ];
  const bindings: unknown[] = [event.id];

  if (filters.track) {
    clauses.push(`EXISTS (
      SELECT 1 FROM submission_tracks filter_st
      JOIN tracks filter_track ON filter_track.id = filter_st.track_id
      WHERE filter_st.submission_id = s.id
        AND (filter_st.track_id = ? OR lower(filter_track.name) = lower(?))
    )`);
    bindings.push(filters.track, filters.track);
  }

  if (filters.status && filters.status !== "all" && filters.status !== "published") {
    const allowed = new Set(["accepted", "waitlisted", "in_review", "submitted"]);
    clauses.push("s.status = ?");
    bindings.push(allowed.has(filters.status) ? filters.status : "__not_public__");
  }

  if (filters.q?.trim()) {
    const query = `%${filters.q.trim().toLocaleLowerCase()}%`;
    clauses.push(`(
      lower(s.title) LIKE ?
      OR lower(coalesce(s.abstract, '')) LIKE ?
      OR lower(s.search_blob) LIKE ?
      OR EXISTS (
        SELECT 1 FROM participations search_par
        JOIN people search_person ON search_person.id = search_par.person_id
        WHERE search_par.submission_id = s.id
          AND (lower(search_person.name) LIKE ? OR lower(coalesce(search_person.company, '')) LIKE ?)
      )
    )`);
    bindings.push(query, query, query, query, query);
  }

  return {
    sql: `
      SELECT
        s.id,
        s.title,
        s.abstract,
        s.status,
        ai.starts_at,
        ai.duration_min,
        room.name AS room_name,
        building.name AS building_name,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', ordered.id,
            'name', ordered.name,
            'title', ordered.title,
            'company', ordered.company,
            'bio', ordered.bio,
            'social_links', ordered.social_links
          ))
          FROM (
            SELECT speaker.id, speaker.name, speaker.title, speaker.company,
              speaker.bio, speaker.social_links
            FROM participations par
            JOIN people speaker ON speaker.id = par.person_id
            WHERE par.submission_id = s.id
            ORDER BY par.position ASC, par.id ASC
          ) ordered
        ), '[]') AS speakers_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', ordered.id,
            'name', ordered.name,
            'color', ordered.color
          ))
          FROM (
            SELECT carried.id, carried.name, carried.color
            FROM submission_tracks st
            JOIN tracks carried ON carried.id = st.track_id
            WHERE st.submission_id = s.id
            ORDER BY st.is_primary DESC, carried.position ASC, carried.id ASC
          ) ordered
        ), '[]') AS tracks_json
      FROM agenda_items ai
      JOIN submissions s ON s.id = ai.submission_id AND s.event_id = ai.event_id
      JOIN rooms room ON room.id = ai.room_id AND room.event_id = ai.event_id
      LEFT JOIN buildings building ON building.id = room.building_id AND building.event_id = room.event_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY ai.starts_at ASC, s.id ASC
    `,
    bindings,
  };
}

async function loadTrackCatalog(database: D1Database, eventId: string): Promise<PublicTrack[]> {
  const result = await database
    .prepare("SELECT id, name, color FROM tracks WHERE event_id = ? ORDER BY position ASC, id ASC")
    .bind(eventId)
    .all<PublicTrack>();
  return result.results.map((track) => ({ id: track.id, name: track.name, color: track.color }));
}

function toPublicSessions(rows: PublicSessionRow[], event: PublicEvent): PublicSession[] {
  const sessionBase = rows.map((row) => {
    const zoned = zonedParts(row.starts_at, event.timezone);
    const speakers = parseSpeakers(row.speakers_json);
    const tracks = parseTracks(row.tracks_json);
    const room = { name: row.room_name };
    const building = row.building_name ? { name: row.building_name } : null;
    return {
      id: row.id,
      slug: publicSessionSlug(row.title, row.id),
      title: row.title,
      abstract: row.abstract,
      status: row.status,
      day: dateLabel(zoned.date),
      date: zoned.date,
      time: zoned.time,
      startsAt: row.starts_at,
      durationMin: row.duration_min,
      room: row.room_name,
      building: row.building_name,
      roomLabel: roomDisplayLabel(room, building),
      tracks,
      speakers,
    } satisfies PublicSession;
  });

  const sessionCounts = new Map<string, number>();
  for (const session of sessionBase) sessionCounts.set(session.slug, (sessionCounts.get(session.slug) ?? 0) + 1);
  return sessionBase.map((session) => {
    if ((sessionCounts.get(session.slug) ?? 0) <= 1) return session;
    return { ...session, slug: `${session.slug}-${slugify(session.id)}` };
  });
}

export interface PublicAgendaFilters {
  eventSlug?: string | null;
  day?: string | null;
  allDays?: boolean;
  track?: string | null;
  q?: string | null;
  status?: string | null;
}

export async function loadPublicAgenda(
  database: D1Database,
  filters: PublicAgendaFilters = {},
): Promise<PublicAgendaData | null> {
  const event = await findLiveEvent(database, filters.eventSlug);
  if (!event) return null;
  const catalog = await loadTrackCatalog(database, event.id);
  const query = sessionRowsQuery(event, filters);
  const rows = await database.prepare(query.sql).bind(...query.bindings).all<PublicSessionRow>();
  const allSessions = toPublicSessions(rows.results, event);
  const selectedDay = filters.allDays ? null : filters.day ?? event.startsOn;
  const sessions = selectedDay
    ? allSessions.filter((session) => session.date === selectedDay || session.day === selectedDay)
    : allSessions;
  return {
    event,
    days: eventDays(event),
    tracks: catalog,
    sessions,
    filters: {
      day: selectedDay,
      track: filters.track ?? null,
      q: filters.q?.trim() || null,
      status: filters.status ?? null,
    },
  };
}

export async function loadPublicSession(
  database: D1Database,
  slug: string,
  eventSlug?: string | null,
): Promise<{ event: PublicEvent; session: PublicSession } | null> {
  const agenda = await loadPublicAgenda(database, { eventSlug, allDays: true });
  if (!agenda) return null;
  const session = agenda.sessions.find((item) =>
    item.slug === slug || item.id === slug || publicSessionSlug(item.title, item.id) === slug,
  );
  return session ? { event: agenda.event, session } : null;
}

export async function loadPublicSpeaker(
  database: D1Database,
  slug: string,
  eventSlug?: string | null,
): Promise<{ event: PublicEvent; speaker: PublicSpeaker } | null> {
  const agenda = await loadPublicAgenda(database, { eventSlug, allDays: true });
  if (!agenda) return null;
  const sessions = agenda.sessions.filter((session) => session.speakers.some((speaker) =>
    speaker.slug === slug || speaker.id === slug || publicSpeakerSlug(speaker.name, speaker.id) === slug,
  ));
  const source = sessions[0]?.speakers.find((speaker) =>
    speaker.slug === slug || speaker.id === slug || publicSpeakerSlug(speaker.name, speaker.id) === slug,
  );
  if (!source) return null;
  return {
    event: agenda.event,
    speaker: {
      ...source,
      sessions: sessions.map((session) => ({
        id: session.id,
        slug: session.slug,
        title: session.title,
        day: session.day,
        date: session.date,
        time: session.time,
        roomLabel: session.roomLabel,
      })),
    },
  };
}

function validAccent(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value) ? value : null;
}

function parseEmbedConfig(value: string | null, kind: "agenda" | "speakers"): PublicEmbedConfig {
  const raw = parseJson<Record<string, unknown>>(value, {});
  const trackValues = Array.isArray(raw.tracks)
    ? raw.tracks.filter((item): item is string => typeof item === "string")
    : typeof raw.track === "string" ? [raw.track] : [];
  const statusValues = Array.isArray(raw.statuses)
    ? raw.statuses.filter((item): item is string => typeof item === "string")
    : typeof raw.status === "string" ? [raw.status] : [];
  return {
    kind,
    tracks: trackValues,
    statuses: statusValues,
    accent: validAccent(raw.accent ?? raw.color),
  };
}

function inferEmbedKind(slug: string): "agenda" | "speakers" | null {
  if (slug === "agenda" || slug.endsWith("-agenda")) return "agenda";
  if (slug === "speakers" || slug.endsWith("-speakers")) return "speakers";
  return null;
}

function inferEventSlug(slug: string): string | null {
  if (slug === "agenda" || slug === "speakers") return null;
  return slug.replace(/-(?:agenda|speakers)$/, "") || null;
}

export async function resolvePublicEmbed(
  database: D1Database,
  request: { slug: string; eventSlug?: string | null; kind?: "agenda" | "speakers" },
): Promise<ResolvedPublicEmbed | null> {
  const row = await database.prepare(
    `SELECT embeds.event_id, events.slug AS event_slug, embeds.kind, embeds.slug, embeds.config
       FROM embeds JOIN events ON events.id = embeds.event_id
      WHERE events.status = 'live' AND embeds.slug = ? LIMIT 1`,
  ).bind(request.slug).first<EmbedRow>();
  if (row) {
    return {
      event: (await findLiveEvent(database, row.event_slug))!,
      slug: row.slug,
      kind: row.kind,
      config: parseEmbedConfig(row.config, row.kind),
    };
  }
  const kind = request.kind ?? inferEmbedKind(request.slug);
  if (!kind) return null;
  const eventSlug = request.eventSlug ?? inferEventSlug(request.slug);
  const event = await findLiveEvent(database, eventSlug);
  if (!event) return null;
  return {
    event,
    slug: request.slug,
    kind,
    config: { kind, tracks: [], statuses: [], accent: null },
  };
}

export async function loadPublicEmbed(
  database: D1Database,
  resolved: ResolvedPublicEmbed,
  filters: { track?: string | null; status?: string | null; accent?: string | null } = {},
): Promise<PublicEmbedData> {
  const track = filters.track ?? resolved.config.tracks[0] ?? null;
  const status = filters.status ?? resolved.config.statuses[0] ?? null;
  const agenda = await loadPublicAgenda(database, {
    eventSlug: resolved.event.slug,
    allDays: true,
    track,
    status,
  });
  if (!agenda) throw new Error("live embed event disappeared");

  const speakersById = new Map<string, PublicSpeaker>();
  for (const session of agenda.sessions) {
    for (const speaker of session.speakers) {
      const current = speakersById.get(speaker.id);
      if (current) {
        current.sessions.push({
          id: session.id,
          slug: session.slug,
          title: session.title,
          day: session.day,
          date: session.date,
          time: session.time,
          roomLabel: session.roomLabel,
        });
      } else {
        speakersById.set(speaker.id, {
          ...speaker,
          sessions: [{
            id: session.id,
            slug: session.slug,
            title: session.title,
            day: session.day,
            date: session.date,
            time: session.time,
            roomLabel: session.roomLabel,
          }],
        });
      }
    }
  }
  return {
    event: agenda.event,
    slug: resolved.slug,
    kind: resolved.kind,
    config: {
      ...resolved.config,
      accent: validAccent(filters.accent) ?? resolved.config.accent,
    },
    tracks: agenda.tracks,
    sessions: agenda.sessions,
    speakers: [...speakersById.values()].sort((left, right) => left.name.localeCompare(right.name)),
    filters: { track, status },
  };
}

export function publicEmbedCacheKey(
  eventId: string,
  slug: string,
  filters: { track?: string | null; status?: string | null; accent?: string | null } = {},
): string {
  return [
    "public-embed",
    eventId,
    slug,
    filters.track ?? "all-tracks",
    filters.status ?? "all-statuses",
    filters.accent ?? "event-accent",
  ].map((part) => encodeURIComponent(part)).join(":");
}

export async function readPublicEmbedCache(
  cache: PublicEmbedCache | undefined,
  key: string,
): Promise<PublicEmbedData | null> {
  if (!cache || typeof cache.get !== "function") return null;
  const cached = await cache.get(key, "json") as PublicEmbedData | PublicEmbedCacheEnvelope | null;
  if (!cached) return null;
  if (isPublicEmbedCacheEnvelope(cached)) {
    return cached.expiresAt > Date.now() ? cached.data : null;
  }
  return cached;
}

export async function writePublicEmbedCache(
  cache: PublicEmbedCache | undefined,
  key: string,
  value: PublicEmbedData,
): Promise<void> {
  if (!cache || typeof cache.put !== "function") return;
  const payload: PublicEmbedCacheEnvelope = {
    __marqueePublicEmbed: true,
    expiresAt: Date.now() + EMBED_CACHE_TTL_SECONDS * 1_000,
    data: value,
  };
  const serialized = JSON.stringify(payload);
  try {
    await cache.put(key, serialized, { expirationTtl: EMBED_CACHE_TTL_SECONDS });
  } catch (error) {
    // Cloudflare KV rejects expiration_ttl values below 60 seconds. Keep the
    // product's 30-second logical TTL in the value and use the smallest
    // service TTL only for the storage layer; publish mutations still purge
    // every variant explicitly.
    if (!/expiration.?ttl|at least 60/i.test(String(error))) throw error;
    await cache.put(key, serialized, { expirationTtl: CLOUDFLARE_KV_MIN_TTL_SECONDS });
  }
}

/** Call this from the agenda publish mutation so every public variant is fresh. */
export async function purgePublicEmbedCache(
  cache: PublicEmbedCache | undefined,
  options: { eventId: string; slug?: string },
): Promise<number> {
  if (!cache || typeof cache.list !== "function" || typeof cache.delete !== "function") return 0;
  const prefix = `public-embed:${encodeURIComponent(options.eventId)}:`;
  const suffix = options.slug ? `${encodeURIComponent(options.slug)}:` : "";
  const listed = await cache.list({ prefix: `${prefix}${suffix}` });
  await Promise.all(listed.keys.map((key) => cache.delete(key.name)));
  return listed.keys.length;
}
