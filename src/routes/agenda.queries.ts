import { strongEtag } from "../api/concurrency";
import {
  DEFAULT_SCHEDULABLE_STATUSES,
  durationIsAllowed,
  formatDuration,
  normalizeSchedulableStatuses,
  parseJsonArray,
  roomLabel,
  shouldBeInUnscheduledPool,
  type AgendaBuilding,
  type AgendaConflict,
  type AgendaEvent,
  type AgendaFormat,
  type AgendaPoolItem,
  type AgendaRoom,
  type AgendaSession,
  type AgendaSnapshot,
  type AgendaTrack,
  type SchedulableStatus,
} from "../api/agenda";
import { conflictParticipants, dedupeParticipants, sharedConflictParticipants } from "../lib/conflicts";
import { showsBuildingComparisonCount } from "../lib/venue-disclosure";
import { getTransitConflicts, type TransitAgendaItem } from "../lib/venue-geometry";
import type { SubmissionSpeakerListItem, SubmissionTrackListItem } from "../api/submissions";

const SETTINGS_KEY = "agenda_schedulable_statuses";
const LEGACY_SETTINGS_KEY = "agenda.schedulable_statuses";

interface EventRow extends AgendaEvent {}

interface SettingRow {
  value_json: string;
  updated_at: number;
}

interface RoomQueryRow {
  id: string;
  name: string;
  capacity: number;
  av_capabilities: string;
  notes: string | null;
  building_id: string;
  building_name: string;
  building_address: string;
  lat: number | null;
  lng: number | null;
  access_minutes: number;
}

interface FormatQueryRow extends AgendaFormat {}

interface TrackQueryRow extends AgendaTrack {}

interface SessionQueryRow {
  id: string;
  submission_id: string | null;
  kind: "session" | "break";
  item_title: string | null;
  submission_title: string | null;
  submission_status: string | null;
  starts_at: number;
  duration_min: number;
  room_id: string;
  room_name: string;
  building_name: string;
  track_id: string | null;
  track_name: string | null;
  format_id: string | null;
  format_name: string | null;
  is_published: number;
  updated_at: number;
  speakers_json: string;
  tracks_json: string;
  format_default_duration_min: number | null;
  format_min_duration_min: number | null;
  format_max_duration_min: number | null;
}

interface PoolQueryRow {
  submission_id: string;
  kind: "abstract" | "session";
  title: string;
  status: SchedulableStatus;
  format_id: string | null;
  format_name: string | null;
  default_duration_min: number | null;
  min_duration_min: number | null;
  max_duration_min: number | null;
  updated_at: number;
  speakers_json: string;
  tracks_json: string;
}

export interface AgendaItemVersion {
  id: string;
  event_id: string;
  submission_id: string | null;
  kind: "session" | "break";
  starts_at: number;
  duration_min: number;
  room_id: string;
  track_id: string | null;
  is_published: number;
  updated_at: number;
}

export interface PlacementSubmission {
  id: string;
  event_id: string;
  kind: "abstract" | "session";
  title: string;
  status: string;
  format_id: string | null;
  default_duration_min: number | null;
  min_duration_min: number | null;
  max_duration_min: number | null;
  primary_track_id: string | null;
}

const SESSION_FROM = `
  FROM agenda_items item
  LEFT JOIN submissions submission ON submission.id = item.submission_id
  JOIN rooms room ON room.id = item.room_id AND room.event_id = item.event_id
  JOIN buildings building ON building.id = room.building_id AND building.event_id = item.event_id
  LEFT JOIN tracks track ON track.id = item.track_id AND track.event_id = item.event_id
  LEFT JOIN formats format ON format.id = submission.format_id AND format.event_id = item.event_id
`;

function parseTracks(value: string): SubmissionTrackListItem[] {
  return parseJsonArray<SubmissionTrackListItem>(value).map((track) => ({
    ...track,
    is_primary: Boolean(track.is_primary),
  }));
}

function parseSpeakers(value: string): SubmissionSpeakerListItem[] {
  return dedupeParticipants(parseJsonArray<SubmissionSpeakerListItem>(value));
}

function toRoom(row: RoomQueryRow): AgendaRoom {
  const building: AgendaBuilding = {
    id: row.building_id,
    name: row.building_name,
    address: row.building_address,
    lat: row.lat,
    lng: row.lng,
    access_minutes: Number(row.access_minutes ?? 0),
  };
  return {
    id: row.id,
    name: row.name,
    label: roomLabel(row.name, row.building_name),
    capacity: Number(row.capacity),
    building,
    av_capabilities: parseJsonArray<string>(row.av_capabilities),
    notes: row.notes,
  };
}

function toSession(row: SessionQueryRow): AgendaSession {
  const rawSpeakers = parseJsonArray<SubmissionSpeakerListItem>(row.speakers_json);
  const speakers = dedupeParticipants(rawSpeakers);
  const tracks = parseTracks(row.tracks_json);
  const status = row.kind === "break"
    ? "scheduled"
    : row.is_published === 1
      ? "published"
      : "scheduled";
  return {
    id: row.id,
    submission_id: row.submission_id,
    kind: row.kind,
    title: row.submission_title ?? row.item_title ?? "Untitled reservation",
    starts_at: Number(row.starts_at),
    duration_min: Number(row.duration_min),
    room_id: row.room_id,
    room: row.room_name,
    building: row.building_name,
    track_id: row.track_id,
    track: row.track_name,
    tracks,
    speakers,
    // The visible speaker list remains one row per person, but the agenda
    // flag must inspect every role: a second role can be declined while the
    // first role remains the display representative.
    has_declined_participant: rawSpeakers.some((speaker) => speaker.confirmation_status === "declined"),
    format_id: row.format_id,
    format: row.format_name,
    status,
    is_published: row.is_published === 1,
    updated_at: Number(row.updated_at),
    etag: strongEtag(row.id, Number(row.updated_at)),
  };
}

function toPoolItem(row: PoolQueryRow): AgendaPoolItem {
  return {
    submission_id: row.submission_id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    format_id: row.format_id,
    format: row.format_name,
    default_duration_min: Number(row.default_duration_min ?? 30),
    min_duration_min: Number(row.min_duration_min ?? 5),
    max_duration_min: Number(row.max_duration_min ?? 240),
    speakers: parseSpeakers(row.speakers_json),
    tracks: parseTracks(row.tracks_json),
    updated_at: Number(row.updated_at),
  };
}

function overlaps(left: AgendaSession, right: AgendaSession): boolean {
  return left.starts_at < right.starts_at + right.duration_min * 60_000
    && right.starts_at < left.starts_at + left.duration_min * 60_000;
}

function transitInputs(
  sessions: readonly AgendaSession[],
  rooms: readonly AgendaRoom[],
): { items: TransitAgendaItem[]; buildings: AgendaBuilding[] } {
  const roomMap = new Map(rooms.map((room) => [room.id, room]));
  const items = sessions.map<TransitAgendaItem>((session) => ({
    id: session.id,
    starts_at: session.starts_at,
    duration_min: session.duration_min,
    building_id: roomMap.get(session.room_id)?.building.id ?? null,
    person_ids: conflictParticipants(session.speakers).map((participant) => participant.id),
  }));
  return {
    items,
    buildings: [...new Map(rooms.map((room) => [room.building.id, room.building])).values()],
  };
}

function orderedAgendaPair(left: AgendaSession, right: AgendaSession): [AgendaSession, AgendaSession] {
  return left.starts_at < right.starts_at
    || (left.starts_at === right.starts_at && left.id.localeCompare(right.id) <= 0)
    ? [left, right]
    : [right, left];
}

export function getConflicts(
  sessions: readonly AgendaSession[],
  rooms: readonly AgendaRoom[],
  _timezone: string,
): AgendaConflict[] {
  const roomMap = new Map(rooms.map((room) => [room.id, room]));
  const transit = transitInputs(sessions, rooms);
  const transitConflicts = getTransitConflicts(transit.items, transit.buildings);
  const usedTransitConflicts = new Set<number>();
  const conflicts: AgendaConflict[] = [];
  for (let index = 0; index < sessions.length; index += 1) {
    const left = sessions[index]!;
    for (let next = index + 1; next < sessions.length; next += 1) {
      const right = sessions[next]!;
      if (left.kind === "break" && right.kind === "break") continue;
      const sharedPeople = sharedConflictParticipants(left.speakers, right.speakers);
      const shared = sharedPeople[0] ?? null;
      if (overlaps(left, right)) {
        if (left.room_id === right.room_id) {
          conflicts.push({
            kind: "room",
            message: `Room overlap — ${left.room} is occupied by overlapping sessions.`,
            session_ids: [left.id, right.id],
          });
        }
        if (shared) {
          conflicts.push({
            kind: "person",
            message: `${shared.name} is double-booked across two sessions.`,
            session_ids: [left.id, right.id],
            person_id: shared.id,
          });
        }
      }
      if (sharedPeople.length) {
        const [first, second] = orderedAgendaPair(left, right);
        const from = roomMap.get(first.room_id)?.building;
        const to = roomMap.get(second.room_id)?.building;
        if (!from || !to || from.id === to.id) continue;
        const available = Math.max(
          0,
          Math.floor((second.starts_at - (first.starts_at + first.duration_min * 60_000)) / 60_000),
        );
        for (const speaker of sharedPeople) {
          const transitIndex = transitConflicts.findIndex((candidate, candidateIndex) =>
            !usedTransitConflicts.has(candidateIndex)
            && candidate.speaker_id === speaker.id
            && candidate.from_building_id === from.id
            && candidate.to_building_id === to.id
            && candidate.access_minutes === Math.max(0, to.access_minutes)
            && candidate.available_minutes === available,
          );
          if (transitIndex < 0) continue;
          const transitConflict = transitConflicts[transitIndex]!;
          usedTransitConflicts.add(transitIndex);
          conflicts.push({
            kind: "transit",
            label: transitConflict.label,
            message: transitConflict.message,
            session_ids: [first.id, second.id],
            person_id: transitConflict.speaker_id,
          });
        }
      }
    }
  }
  return conflicts;
}

/** MRQ-20's exported name remains available to its existing unit contract. */
export const deriveConflicts = getConflicts;

async function readStatuses(database: D1Database, eventId: string): Promise<SchedulableStatus[]> {
  const current = await database.prepare(
    "SELECT value_json FROM event_settings WHERE event_id = ? AND key = ?",
  ).bind(eventId, SETTINGS_KEY).first<SettingRow>();
  const legacy = current ?? await database.prepare(
    "SELECT value_json FROM event_settings WHERE event_id = ? AND key = ?",
  ).bind(eventId, LEGACY_SETTINGS_KEY).first<SettingRow>();
  if (!legacy) return [...DEFAULT_SCHEDULABLE_STATUSES];
  try {
    return normalizeSchedulableStatuses(JSON.parse(legacy.value_json));
  } catch {
    return [...DEFAULT_SCHEDULABLE_STATUSES];
  }
}

async function readEvent(database: D1Database, eventId: string): Promise<EventRow | null> {
  return database.prepare(
    "SELECT id, name, starts_on, ends_on, timezone FROM events WHERE id = ?",
  ).bind(eventId).first<EventRow>();
}

async function readRooms(database: D1Database, eventId: string): Promise<AgendaRoom[]> {
  const result = await database.prepare(`
    SELECT room.id, room.name, room.capacity, room.av_capabilities, room.notes,
      building.id AS building_id, building.name AS building_name, building.address AS building_address,
      building.lat, building.lng, building.access_minutes
    FROM rooms room
    JOIN buildings building ON building.id = room.building_id AND building.event_id = room.event_id
    WHERE room.event_id = ?
    ORDER BY building.position ASC, room.position ASC, room.id ASC
  `).bind(eventId).all<RoomQueryRow>();
  return result.results.map(toRoom);
}

async function readFormats(database: D1Database, eventId: string): Promise<AgendaFormat[]> {
  const result = await database.prepare(
    "SELECT id, name, default_duration_min, min_duration_min, max_duration_min FROM formats WHERE event_id = ? ORDER BY position ASC, id ASC",
  ).bind(eventId).all<FormatQueryRow>();
  return result.results.map((format) => ({
    ...format,
    default_duration_min: Number(format.default_duration_min),
    min_duration_min: Number(format.min_duration_min),
    max_duration_min: Number(format.max_duration_min),
  }));
}

async function readTracks(database: D1Database, eventId: string): Promise<AgendaTrack[]> {
  const result = await database.prepare(
    "SELECT id, name, color FROM tracks WHERE event_id = ? ORDER BY position ASC, id ASC",
  ).bind(eventId).all<TrackQueryRow>();
  return result.results;
}

const SPEAKERS_JSON = `COALESCE((
  SELECT json_group_array(json_object('id', ordered.id, 'name', ordered.name, 'company', ordered.company, 'role', ordered.role, 'confirmation_status', ordered.confirmation_status))
  FROM (
    SELECT person.id, person.name, person.company, participation.role, participation.confirmation_status
    FROM participations participation
    JOIN people person ON person.id = participation.person_id
    WHERE participation.submission_id = submission.id
    ORDER BY participation.position ASC, participation.id ASC
  ) ordered
), '[]')`;

const TRACKS_JSON = `COALESCE((
  SELECT json_group_array(json_object('id', ordered.id, 'name', ordered.name, 'color', ordered.color, 'is_primary', ordered.is_primary))
  FROM (
    SELECT carried.id, carried.name, carried.color, submission_track.is_primary
    FROM submission_tracks submission_track
    JOIN tracks carried ON carried.id = submission_track.track_id
    WHERE submission_track.submission_id = submission.id
    ORDER BY submission_track.is_primary DESC, carried.position ASC, carried.id ASC
  ) ordered
), '[]')`;

async function readSessions(database: D1Database, eventId: string): Promise<AgendaSession[]> {
  const result = await database.prepare(`
    SELECT item.id, item.submission_id, item.kind, item.title AS item_title,
      submission.title AS submission_title, submission.status AS submission_status,
      item.starts_at, item.duration_min, item.room_id, room.name AS room_name,
      building.name AS building_name, item.track_id, track.name AS track_name,
      format.id AS format_id, format.name AS format_name, item.is_published, item.updated_at,
      ${SPEAKERS_JSON} AS speakers_json, ${TRACKS_JSON} AS tracks_json,
      format.default_duration_min AS format_default_duration_min,
      format.min_duration_min AS format_min_duration_min,
      format.max_duration_min AS format_max_duration_min
    ${SESSION_FROM}
    WHERE item.event_id = ?
    ORDER BY item.starts_at ASC, room.position ASC, item.id ASC
  `).bind(eventId).all<SessionQueryRow>();
  return result.results.map(toSession);
}

async function readPool(
  database: D1Database,
  eventId: string,
  statuses: readonly SchedulableStatus[],
): Promise<AgendaPoolItem[]> {
  const placeholders = statuses.map(() => "?").join(", ");
  const result = await database.prepare(`
    SELECT submission.id AS submission_id, submission.kind, submission.title, submission.status,
      submission.format_id, format.name AS format_name,
      format.default_duration_min, format.min_duration_min, format.max_duration_min,
      submission.updated_at, ${SPEAKERS_JSON} AS speakers_json, ${TRACKS_JSON} AS tracks_json
    FROM submissions submission
    LEFT JOIN formats format ON format.id = submission.format_id AND format.event_id = submission.event_id
    WHERE submission.event_id = ?
      AND submission.status IN (${placeholders})
      AND NOT EXISTS (
        SELECT 1 FROM agenda_items item
        WHERE item.event_id = submission.event_id AND item.submission_id = submission.id AND item.kind = 'session'
      )
    ORDER BY submission.updated_at DESC, submission.id ASC
  `).bind(eventId, ...statuses).all<PoolQueryRow>();
  return result.results
    .filter((row) => shouldBeInUnscheduledPool(row.status, false, statuses))
    .map(toPoolItem);
}

export async function readAgendaSnapshot(
  database: D1Database,
  eventId: string,
): Promise<AgendaSnapshot | null> {
  const event = await readEvent(database, eventId);
  if (!event) return null;
  const [statuses, rooms, formats, tracks, sessions, venue] = await Promise.all([
    readStatuses(database, eventId),
    readRooms(database, eventId),
    readFormats(database, eventId),
    readTracks(database, eventId),
    readSessions(database, eventId),
    readAgendaVenueDisclosure(database, eventId),
  ]);
  const unscheduled = await readPool(database, eventId, statuses);
  return {
    event,
    venue,
    schedulable_statuses: statuses,
    rooms,
    formats,
    tracks,
    sessions,
    unscheduled,
    conflicts: getConflicts(sessions, rooms, event.timezone),
  };
}

export async function readAgendaConflicts(
  database: D1Database,
  eventId: string,
): Promise<AgendaConflict[]> {
  const event = await readEvent(database, eventId);
  if (!event) return [];
  const [rooms, sessions] = await Promise.all([
    readRooms(database, eventId),
    readSessions(database, eventId),
  ]);
  return getConflicts(sessions, rooms, event.timezone);
}

export async function readAgendaVenueDisclosure(
  database: D1Database,
  eventId: string,
): Promise<{ pinned_building_count: number; primary_building_name: string | null }> {
  const result = await database.prepare(
    `SELECT id, name
     FROM buildings
     WHERE event_id = ? AND lat IS NOT NULL AND lng IS NOT NULL
     ORDER BY position ASC, id ASC`,
  ).bind(eventId).all<{ id: string; name: string }>();
  const pinned = [...new Map(result.results.map((building) => [building.id, building])).values()];
  return {
    pinned_building_count: pinned.length,
    primary_building_name: pinned.length < 2 ? pinned[0]?.name ?? null : null,
  };
}

export async function readAgendaBuildingComparison(
  database: D1Database,
  eventId: string,
): Promise<boolean> {
  const disclosure = await readAgendaVenueDisclosure(database, eventId);
  return showsBuildingComparisonCount(disclosure.pinned_building_count);
}

export async function readAgendaItemVersion(
  database: D1Database,
  eventId: string,
  itemId: string,
): Promise<AgendaItemVersion | null> {
  return database.prepare(`
    SELECT id, event_id, submission_id, kind, starts_at, duration_min, room_id, track_id, is_published, updated_at
    FROM agenda_items
    WHERE id = ? AND event_id = ?
  `).bind(itemId, eventId).first<AgendaItemVersion>();
}

export async function readPlacementSubmission(
  database: D1Database,
  eventId: string,
  submissionId: string,
): Promise<PlacementSubmission | null> {
  return database.prepare(`
    SELECT submission.id, submission.event_id, submission.kind, submission.title, submission.status,
      submission.format_id, format.default_duration_min, format.min_duration_min, format.max_duration_min,
      (
        SELECT submission_track.track_id
        FROM submission_tracks submission_track
        WHERE submission_track.submission_id = submission.id
        ORDER BY submission_track.is_primary DESC, submission_track.id ASC
        LIMIT 1
      ) AS primary_track_id
    FROM submissions submission
    LEFT JOIN formats format ON format.id = submission.format_id AND format.event_id = submission.event_id
    WHERE submission.id = ? AND submission.event_id = ?
  `).bind(submissionId, eventId).first<PlacementSubmission>();
}

export async function hasAgendaItem(
  database: D1Database,
  eventId: string,
  submissionId: string,
): Promise<boolean> {
  const row = await database.prepare(
    "SELECT 1 AS present FROM agenda_items WHERE event_id = ? AND submission_id = ? AND kind = 'session' LIMIT 1",
  ).bind(eventId, submissionId).first<{ present: number }>();
  return row !== null;
}

export async function roomBelongsToEvent(
  database: D1Database,
  eventId: string,
  roomId: string,
): Promise<boolean> {
  const row = await database.prepare(
    "SELECT 1 AS present FROM rooms WHERE id = ? AND event_id = ?",
  ).bind(roomId, eventId).first<{ present: number }>();
  return row !== null;
}

export async function trackBelongsToEvent(
  database: D1Database,
  eventId: string,
  trackId: string,
): Promise<boolean> {
  const row = await database.prepare(
    "SELECT 1 AS present FROM tracks WHERE id = ? AND event_id = ?",
  ).bind(trackId, eventId).first<{ present: number }>();
  return row !== null;
}

export function placementDuration(
  requested: number | undefined,
  submission: PlacementSubmission,
): number {
  const format: AgendaFormat | null = submission.format_id === null || submission.default_duration_min === null
    ? null
    : {
      id: submission.format_id,
      name: "",
      default_duration_min: Number(submission.default_duration_min),
      min_duration_min: Number(submission.min_duration_min ?? submission.default_duration_min),
      max_duration_min: Number(submission.max_duration_min ?? submission.default_duration_min),
    };
  const duration = requested ?? formatDuration(format);
  if (!durationIsAllowed(duration, format)) {
    throw new Error("duration is outside the selected format's allowed range");
  }
  return duration;
}

export { SETTINGS_KEY };
