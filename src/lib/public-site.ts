import type { D1Database } from "@cloudflare/workers-types";

import { EMBED_KINDS, type EmbedKind, type EmbedLayout, type EmbedOutputFormat, type FormRow } from "../db/schema";
import { participantAudienceFilterSql, participantListSql } from "./participants";
import { showsBuildingComparisonCount } from "./venue-disclosure";
import { slugify } from "./ids";
import { roomDisplayLabel } from "./venues";
import { syntheticPublicHeadshotUrl } from "./public-headshots";

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

export interface PublicFormat {
  id: string;
  name: string;
}

export interface PublicRoom {
  id: string;
  name: string;
  label: string;
}

export interface PublicSpeakerSummary {
  id: string;
  slug: string;
  name: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  headshotUrl: string | null;
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
  endTime: string;
  startsAt: number;
  durationMin: number;
  roomId: string;
  room: string;
  building: string | null;
  /** Street address of the building, for a directions link an attendee can act on. */
  buildingAddress: string | null;
  roomLabel: string;
  format: PublicFormat | null;
  tracks: PublicTrack[];
  speakers: PublicSpeakerSummary[];
}

export interface PublicVenueDisclosure {
  buildingName: string | null;
  showComparison: boolean;
}

export interface PublicAgendaData {
  event: PublicEvent;
  venue: PublicVenueDisclosure;
  days: PublicDay[];
  tracks: PublicTrack[];
  formats: PublicFormat[];
  rooms: PublicRoom[];
  sessions: PublicSession[];
  filters: {
    day: string;
    track: string | null;
    format: string | null;
    room: string | null;
    q: string | null;
    status: string | null;
  };
}

export interface PublicSpeakerDirectoryData {
  event: PublicEvent;
  venue: PublicVenueDisclosure;
  speakers: PublicSpeakerDirectoryEntry[];
  filters: {
    q: string | null;
    view: PublicSpeakerDirectoryView;
  };
}

export type PublicSpeakerDirectoryView = "gallery" | "list";

export interface PublicSpeakerDirectoryEntry extends PublicSpeakerSummary {
  sessionCount: number;
}

export interface PublicSpeaker extends PublicSpeakerSummary {
  sessions: Array<Pick<PublicSession, "id" | "slug" | "title" | "day" | "date" | "time" | "roomLabel">>;
}

/**
 * Public speaker records only carry a display name, so keep the directory's
 * family-name heuristic explicit and modest: honor the common "Family, Given"
 * form, otherwise use the final whitespace-delimited token. A mononym stays
 * whole, and hyphenated/diacritic names remain intact instead of being
 * normalized into a guess about their spelling or cultural name order.
 */
export function publicSpeakerSurname(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  const comma = normalized.indexOf(",");
  if (comma > 0) {
    const familyName = normalized.slice(0, comma).trim();
    if (familyName) return familyName;
  }
  const parts = normalized.split(" ");
  return parts.length > 1 ? parts.at(-1)! : normalized;
}

export function comparePublicSpeakerDirectoryEntries(
  left: Pick<PublicSpeakerSummary, "id" | "name">,
  right: Pick<PublicSpeakerSummary, "id" | "name">,
): number {
  return publicSpeakerSurname(left.name).localeCompare(publicSpeakerSurname(right.name))
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id);
}

export interface PublicEmbedConfig {
  kind: EmbedKind;
  tracks: string[];
  statuses: string[];
  accent: string | null;
  layout: EmbedLayout | null;
  output: EmbedOutputFormat;
}

export interface PublicEmbedFilters {
  track?: string | null;
  format?: string | null;
  room?: string | null;
  status?: string | null;
  accent?: string | null;
  layout?: string | null;
}

export interface ResolvedPublicEmbed {
  event: PublicEvent;
  slug: string;
  kind: EmbedKind;
  config: PublicEmbedConfig;
}

export interface PublicEmbedCfp {
  formSlug: string;
  formName: string;
  status: "open" | "closed";
  closesAt: number | null;
  formats: string[];
  url: string;
}

export interface PublicEmbedData {
  event: PublicEvent;
  venue: PublicVenueDisclosure;
  slug: string;
  kind: EmbedKind;
  config: PublicEmbedConfig;
  tracks: PublicTrack[];
  formats: PublicFormat[];
  rooms: PublicRoom[];
  sessions: PublicSession[];
  speakers: PublicSpeaker[];
  cfp: PublicEmbedCfp | null;
  filters: {
    track: string | null;
    format: string | null;
    room: string | null;
    status: string | null;
    layout: EmbedLayout | null;
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
  room_id: string;
  room_name: string;
  building_name: string | null;
  building_address: string | null;
  format_id: string | null;
  format_name: string | null;
  speakers_json: string;
  tracks_json: string;
}

interface EmbedRow {
  enabled: number;
  event_id: string;
  event_slug: string;
  kind: EmbedKind;
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

/**
 * Every facet accepts an id or a display name — `?track=Agents` and
 * `?track=trk_agents` both narrow the list — so the value handed back to the
 * controls has to be resolved to the id the `<option>`s carry. Without this a
 * shared name-form link filters the agenda while the select still reads
 * "All tracks", and the control describes a view nobody is looking at. An
 * unresolvable value is returned untouched: it matches no option, which is the
 * honest rendering of a facet that matched nothing.
 */
function canonicalFacet(
  value: string | null | undefined,
  options: readonly { id: string; name: string }[],
): string | null {
  const wanted = value?.trim().toLocaleLowerCase();
  if (!wanted) return null;
  const match = options.find(
    (option) => option.id.toLocaleLowerCase() === wanted || option.name.toLocaleLowerCase() === wanted,
  );
  return match?.id ?? value?.trim() ?? null;
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

export function parseSpeakers(value: string): PublicSpeakerSummary[] {
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
      headshotUrl: syntheticPublicHeadshotUrl(
        speaker.name,
        speaker.is_demo === 1 || speaker.is_demo === true,
      ),
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
  filters: {
    track?: string | null;
    format?: string | null;
    room?: string | null;
    q?: string | null;
    status?: string | null;
    speakerOnly?: boolean;
  },
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

  // Format and room accept an id or a display name, exactly as the track facet
  // does. The selects always submit ids; the tolerance is for a human (or an
  // agent) typing `?format=Workshop` into the address bar and expecting it to
  // mean what it says.
  if (filters.format) {
    clauses.push("(s.format_id = ? OR lower(fmt.name) = lower(?))");
    bindings.push(filters.format, filters.format);
  }

  if (filters.room) {
    clauses.push("(ai.room_id = ? OR lower(room.name) = lower(?))");
    bindings.push(filters.room, filters.room);
  }

  if (filters.status && filters.status !== "all" && filters.status !== "published") {
    const allowed = new Set(["accepted", "waitlisted", "in_review", "submitted"]);
    clauses.push("s.status = ?");
    bindings.push(allowed.has(filters.status) ? filters.status : "__not_public__");
  }

  if (filters.q?.trim()) {
    const query = `%${filters.q.trim().toLocaleLowerCase()}%`;
    const speakerMatch = `EXISTS (
      SELECT 1 FROM participations search_par
      JOIN people search_person ON search_person.id = search_par.person_id
      WHERE search_par.submission_id = s.id${participantAudienceFilterSql("search_par", "public")}
        AND (lower(search_person.name) LIKE ? OR lower(coalesce(search_person.company, '')) LIKE ?)
    )`;
    if (filters.speakerOnly) {
      clauses.push(speakerMatch);
      bindings.push(query, query);
    } else {
      clauses.push(`(
        lower(s.title) LIKE ?
        OR lower(coalesce(s.abstract, '')) LIKE ?
        OR lower(s.search_blob) LIKE ?
        OR ${speakerMatch}
      )`);
      bindings.push(query, query, query, query, query);
    }
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
        ai.room_id,
        room.name AS room_name,
        building.name AS building_name,
        building.address AS building_address,
        fmt.id AS format_id,
        fmt.name AS format_name,
        ${participantListSql({
          submissionId: "s.id",
          audience: "public",
          fields: {
            id: "speaker.id",
            name: "speaker.name",
            title: "speaker.title",
            company: "speaker.company",
            bio: "speaker.bio",
            is_demo: "speaker.is_demo",
            social_links: "speaker.social_links",
          },
        })} AS speakers_json,
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
      LEFT JOIN formats fmt ON fmt.id = s.format_id AND fmt.event_id = s.event_id
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

async function loadFormatCatalog(database: D1Database, eventId: string): Promise<PublicFormat[]> {
  const result = await database
    .prepare("SELECT id, name FROM formats WHERE event_id = ? ORDER BY position ASC, id ASC")
    .bind(eventId)
    .all<PublicFormat>();
  return result.results.map((format) => ({ id: format.id, name: format.name }));
}

interface RoomCatalogRow {
  id: string;
  name: string;
  building_name: string | null;
}

/**
 * The room facet's options carry the same venue disclosure the session cards
 * do. Labelling a room with its building here while the cards suppress it
 * would make the filter control the channel that leaks what the labels hide.
 */
async function loadRoomCatalog(
  database: D1Database,
  eventId: string,
  showBuildingComparison: boolean,
): Promise<PublicRoom[]> {
  const result = await database
    .prepare(
      `SELECT room.id, room.name, building.name AS building_name
         FROM rooms room
         LEFT JOIN buildings building ON building.id = room.building_id AND building.event_id = room.event_id
        WHERE room.event_id = ?
        ORDER BY room.position ASC, room.id ASC`,
    )
    .bind(eventId)
    .all<RoomCatalogRow>();
  return result.results.map((room) => ({
    id: room.id,
    name: room.name,
    label: showBuildingComparison
      ? roomDisplayLabel({ name: room.name }, room.building_name ? { name: room.building_name } : null)
      : room.name,
  }));
}

const ABSTRACT_SNIPPET_CHARS = 180;
const ABSTRACT_EXPANDED_CHARS = 640;

export interface PublicAbstractSnippet {
  /** The 2–3 lines rendered on the card before any interaction. */
  head: string;
  /** What a `Show more` expansion reveals in place; empty when nothing is hidden. */
  rest: string;
  /** True when even the expansion stops short of the full abstract. */
  clipped: boolean;
}

function cutAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const window = text.slice(0, limit);
  const lastSpace = window.lastIndexOf(" ");
  return (lastSpace > limit * 0.6 ? window.slice(0, lastSpace) : window).trimEnd();
}

/**
 * Server-side truncation for public session cards. The agenda is on an
 * AC-85 cold-render budget and abstracts are unbounded, so a list page ships a
 * snippet plus a bounded expansion — never every abstract in full. When the
 * abstract outruns the expansion the caller links out to the session page
 * rather than presenting a cut as the whole text.
 */
export function publicAbstractSnippet(
  abstract: string | null | undefined,
  limits: { head?: number; expanded?: number } = {},
): PublicAbstractSnippet | null {
  const text = abstract?.replaceAll(/\s+/g, " ").trim();
  if (!text) return null;
  const headLimit = limits.head ?? ABSTRACT_SNIPPET_CHARS;
  const expandedLimit = Math.max(limits.expanded ?? ABSTRACT_EXPANDED_CHARS, headLimit);
  if (text.length <= headLimit) return { head: text, rest: "", clipped: false };
  const head = cutAtWord(text, headLimit);
  const remainder = text.slice(head.length).trimStart();
  const restBudget = expandedLimit - head.length;
  const rest = cutAtWord(remainder, restBudget);
  return { head, rest, clipped: rest.length < remainder.length };
}

async function publicVenueDisclosure(
  database: D1Database,
  eventId: string,
): Promise<{ buildingName: string | null; showComparison: boolean }> {
  const [count, primary] = await Promise.all([
    database.prepare(
      "SELECT COUNT(DISTINCT id) AS pinned_count FROM buildings WHERE event_id = ? AND lat IS NOT NULL AND lng IS NOT NULL",
    ).bind(eventId).first<{ pinned_count: number | null }>(),
    database.prepare(
      "SELECT name FROM buildings WHERE event_id = ? AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY position ASC, id ASC LIMIT 1",
    ).bind(eventId).first<{ name: string }>(),
  ]);
  const showComparison = showsBuildingComparisonCount(count?.pinned_count);
  return { buildingName: showComparison ? null : primary?.name ?? null, showComparison };
}

function toPublicSessions(rows: PublicSessionRow[], event: PublicEvent, showBuildingComparison: boolean): PublicSession[] {
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
      endTime: zonedParts(row.starts_at + row.duration_min * 60_000, event.timezone).time,
      startsAt: row.starts_at,
      durationMin: row.duration_min,
      roomId: row.room_id,
      room: row.room_name,
      building: row.building_name,
      buildingAddress: row.building_address,
      roomLabel: showBuildingComparison ? roomDisplayLabel(room, building) : room.name,
      format: row.format_id && row.format_name ? { id: row.format_id, name: row.format_name } : null,
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
  format?: string | null;
  room?: string | null;
  q?: string | null;
  status?: string | null;
}

export async function loadPublicAgenda(
  database: D1Database,
  filters: PublicAgendaFilters = {},
): Promise<PublicAgendaData | null> {
  const event = await findLiveEvent(database, filters.eventSlug);
  if (!event) return null;
  const [catalog, formats, venue] = await Promise.all([
    loadTrackCatalog(database, event.id),
    loadFormatCatalog(database, event.id),
    publicVenueDisclosure(database, event.id),
  ]);
  const rooms = await loadRoomCatalog(database, event.id, venue.showComparison);
  const query = sessionRowsQuery(event, filters);
  const rows = await database.prepare(query.sql).bind(...query.bindings).all<PublicSessionRow>();
  const allSessions = toPublicSessions(rows.results, event, venue.showComparison);
  const days = eventDays(event);
  const selectedDay = filters.allDays || !filters.day || filters.day === "all" ? null : filters.day;
  const sessions = selectedDay
    ? allSessions.filter((session) => session.date === selectedDay || session.day === selectedDay)
    : allSessions;
  return {
    event,
    venue,
    days,
    tracks: catalog,
    formats,
    rooms,
    sessions,
    filters: {
      day: canonicalFacet(selectedDay, days.map((day) => ({ id: day.id, name: day.label }))) ?? "all",
      track: canonicalFacet(filters.track, catalog),
      format: canonicalFacet(filters.format, formats),
      room: canonicalFacet(filters.room, rooms),
      q: filters.q?.trim() || null,
      status: filters.status ?? null,
    },
  };
}

export async function loadPublicSpeakerDirectory(
  database: D1Database,
  filters: { eventSlug?: string | null; q?: string | null; view?: string | null } = {},
): Promise<PublicSpeakerDirectoryData | null> {
  const event = await findLiveEvent(database, filters.eventSlug);
  if (!event) return null;
  const query = sessionRowsQuery(event, { q: filters.q, speakerOnly: true });
  const [venue, rows] = await Promise.all([
    publicVenueDisclosure(database, event.id),
    database.prepare(query.sql).bind(...query.bindings).all<PublicSessionRow>(),
  ]);
  const search = filters.q?.trim().toLocaleLowerCase() || null;
  const speakersById = new Map<string, PublicSpeakerDirectoryEntry>();
  for (const session of toPublicSessions(rows.results, event, venue.showComparison)) {
    for (const speaker of session.speakers) {
      if (search && !speaker.name.toLocaleLowerCase().includes(search) && !(speaker.company ?? "").toLocaleLowerCase().includes(search)) continue;
      const existing = speakersById.get(speaker.id);
      if (existing) {
        existing.sessionCount += 1;
      } else {
        speakersById.set(speaker.id, { ...speaker, sessionCount: 1 });
      }
    }
  }
  return {
    event,
    venue,
    speakers: [...speakersById.values()].sort(comparePublicSpeakerDirectoryEntries),
    filters: {
      q: filters.q?.trim() || null,
      view: filters.view === "list" ? "list" : "gallery",
    },
  };
}

export async function loadPublicSession(
  database: D1Database,
  slug: string,
  eventSlug?: string | null,
): Promise<{ event: PublicEvent; venue: PublicVenueDisclosure; session: PublicSession } | null> {
  const agenda = await loadPublicAgenda(database, { eventSlug, allDays: true });
  if (!agenda) return null;
  const session = agenda.sessions.find((item) =>
    item.slug === slug || item.id === slug || publicSessionSlug(item.title, item.id) === slug,
  );
  return session ? { event: agenda.event, venue: agenda.venue, session } : null;
}

export async function loadPublicSpeaker(
  database: D1Database,
  slug: string,
  eventSlug?: string | null,
): Promise<{ event: PublicEvent; venue: PublicVenueDisclosure; speaker: PublicSpeaker } | null> {
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
    venue: agenda.venue,
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

export function parseEmbedConfig(value: string | null, kind: EmbedKind): PublicEmbedConfig {
  const raw = parseJson<Record<string, unknown>>(value, {});
  const trackValues = Array.isArray(raw.tracks)
    ? raw.tracks.filter((item): item is string => typeof item === "string")
    : typeof raw.track === "string" ? [raw.track] : [];
  const statusValues = Array.isArray(raw.statuses)
    ? raw.statuses.filter((item): item is string => typeof item === "string")
    : typeof raw.status === "string" ? [raw.status] : [];
  const layout = raw.layout === "list" ? "list" : raw.layout === "cards" ? "cards" : null;
  const output = raw.output === "json" || raw.output === "ical" ? raw.output : "html";
  return {
    kind,
    tracks: trackValues,
    statuses: statusValues,
    accent: validAccent(raw.accent ?? raw.color),
    layout,
    output,
  };
}

function inferEmbedKind(slug: string): EmbedKind | null {
  if (slug === "agenda" || slug.endsWith("-agenda")) return "agenda";
  if (slug === "sessions" || slug.endsWith("-sessions")) return "sessions";
  if (slug === "speakers" || slug.endsWith("-speakers")) return "speakers";
  if (slug === "cfp" || slug.endsWith("-cfp")) return "cfp";
  return null;
}

function inferEventSlug(slug: string): string | null {
  if (EMBED_KINDS.includes(slug as EmbedKind)) return null;
  return slug.replace(/-(?:agenda|sessions|speakers|cfp)$/, "") || null;
}

export async function resolvePublicEmbed(
  database: D1Database,
  request: { slug: string; eventSlug?: string | null; kind?: EmbedKind },
): Promise<ResolvedPublicEmbed | null> {
  const row = await database.prepare(
    `SELECT embeds.event_id, events.slug AS event_slug, embeds.kind, embeds.slug, embeds.config, embeds.enabled
       FROM embeds JOIN events ON events.id = embeds.event_id
      WHERE events.status = 'live' AND embeds.slug = ? LIMIT 1`,
  ).bind(request.slug).first<EmbedRow>();
  if (row) {
    if (row.enabled !== 1) return null;
    const event = await findLiveEvent(database, row.event_slug);
    if (!event) return null;
    return {
      event,
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
  if (request.slug !== kind && request.slug !== `${event.slug}-${kind}`) return null;
  return {
    event,
    slug: request.slug,
    kind,
    config: { kind, tracks: [], statuses: [], accent: null, layout: null, output: "html" },
  };
}

async function findPrimaryEmbedForm(database: D1Database, eventId: string): Promise<FormRow | null> {
  return database
    .prepare(
      `SELECT * FROM forms
        WHERE event_id = ? AND status <> 'draft'
        ORDER BY (status = 'open') DESC, opens_at DESC, id ASC
        LIMIT 1`,
    )
    .bind(eventId)
    .first<FormRow>();
}

/** Mirrors `publicFormIsClosed` in `src/routes/public-form.shared.ts` — duplicated
 * rather than imported so this module (reachable from the client bundle via
 * `EmbedPage.tsx`) never pulls in route-layer code that assumes Worker globals. */
function isFormClosed(form: FormRow, now = Date.now()): boolean {
  return form.status !== "open"
    || (form.opens_at !== null && Number(form.opens_at) > now)
    || (form.closes_at !== null && Number(form.closes_at) <= now);
}

async function loadPublicCfp(database: D1Database, eventId: string): Promise<PublicEmbedCfp | null> {
  const form = await findPrimaryEmbedForm(database, eventId);
  if (!form) return null;
  const formatRows = await database
    .prepare("SELECT name FROM formats WHERE event_id = ? ORDER BY position ASC, id ASC")
    .bind(eventId)
    .all<{ name: string }>();
  return {
    formSlug: form.slug,
    formName: form.name,
    status: isFormClosed(form) ? "closed" : "open",
    closesAt: form.closes_at !== null ? Number(form.closes_at) : null,
    formats: formatRows.results.map((row) => row.name),
    url: `/f/${encodeURIComponent(form.slug)}`,
  };
}

export async function loadPublicEmbed(
  database: D1Database,
  resolved: ResolvedPublicEmbed,
  filters: PublicEmbedFilters = {},
): Promise<PublicEmbedData> {
  const accent = validAccent(filters.accent) ?? resolved.config.accent;
  const config = { ...resolved.config, accent };

  if (resolved.kind === "cfp") {
    return {
      event: resolved.event,
      venue: { buildingName: null, showComparison: false },
      slug: resolved.slug,
      kind: resolved.kind,
      config,
      tracks: [],
      formats: [],
      rooms: [],
      sessions: [],
      speakers: [],
      cfp: await loadPublicCfp(database, resolved.event.id),
      filters: { track: null, format: null, room: null, status: null, layout: null },
    };
  }

  const track = filters.track ?? resolved.config.tracks[0] ?? null;
  const format = filters.format ?? null;
  const room = filters.room ?? null;
  const status = filters.status ?? resolved.config.statuses[0] ?? null;
  const layout: EmbedLayout = filters.layout === "list"
    ? "list"
    : resolved.config.layout ?? "cards";
  const agenda = await loadPublicAgenda(database, {
    eventSlug: resolved.event.slug,
    allDays: true,
    track,
    format,
    room,
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
    venue: agenda.venue,
    slug: resolved.slug,
    kind: resolved.kind,
    config,
    tracks: agenda.tracks,
    formats: agenda.formats,
    rooms: agenda.rooms,
    sessions: agenda.sessions,
    speakers: [...speakersById.values()].sort((left, right) => left.name.localeCompare(right.name)),
    cfp: null,
    // The agenda resolved these against the catalogs, so a name-form value
    // reaches the embed's controls as the id its options carry.
    filters: {
      track: agenda.filters.track,
      format: agenda.filters.format,
      room: agenda.filters.room,
      status,
      layout: resolved.kind === "speakers" ? layout : null,
    },
  };
}

export function publicEmbedCacheKey(
  eventId: string,
  slug: string,
  filters: PublicEmbedFilters = {},
): string {
  return [
    "public-embed",
    eventId,
    slug,
    filters.track ?? "all-tracks",
    filters.status ?? "all-statuses",
    filters.accent ?? "event-accent",
    filters.layout === "list" ? "list" : "cards",
    // Every facet the embed honors has to key the cache. A facet outside the
    // key serves one visitor's filtered list to the next visitor.
    filters.format ?? "all-formats",
    filters.room ?? "all-rooms",
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
