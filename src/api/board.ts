import type { D1Database } from "@cloudflare/workers-types";

import type { ListEnvelope } from "./list";
import { submissionStatusPredicate } from "../routes/submissions.queries";
import {
  executeListPage,
  orderClause,
  parsePagination,
  resolveSort,
  type SortRegistry,
} from "./pagination";

export const BOARD_STAGES = [
  "submitted",
  "in_review",
  "waved",
  "accepted",
  "onboarding",
  "scheduled",
  "published",
  "declined",
] as const;

export type BoardStage = (typeof BOARD_STAGES)[number];

export const BOARD_STAGE_LABELS: Record<BoardStage, string> = {
  submitted: "Submitted",
  in_review: "In Review",
  waved: "Waved",
  accepted: "Accepted",
  onboarding: "Onboarding",
  scheduled: "Scheduled",
  published: "Published",
  declined: "Declined / not advancing",
};

export const BOARD_STAGE_ENTRY_ACTIONS: Record<BoardStage, string> = {
  submitted: "Review new submissions",
  in_review: "Score and compare",
  waved: "Send a decision",
  accepted: "Set up a session",
  onboarding: "Complete speaker tasks",
  scheduled: "Publish when ready",
  published: "Live on the public site",
  declined: "Review the decision history",
};

export const BOARD_SORTS = {
  newest: { column: "s.updated_at", direction: "desc" },
  title: { column: "s.title COLLATE NOCASE", direction: "asc" },
} as const satisfies SortRegistry;

export interface BoardListFilters {
  eventId: string;
  page?: number;
  per_page?: number;
  q?: string;
  sort?: keyof typeof BOARD_SORTS;
  kind?: "abstract" | "session";
  track?: string;
  format?: string;
  wave?: string;
}

export interface BoardSlot {
  starts_at: number;
  day: string;
  time: string;
  duration_min: number;
  room: string;
  building: string;
  timezone: string;
  is_published: boolean;
}

export interface BoardCard {
  id: string;
  kind: "abstract" | "session";
  title: string;
  speakers: Array<{ id: string; name: string; company: string | null }>;
  tracks: Array<{ id: string; name: string; color: string; is_primary: boolean }>;
  stage: BoardStage;
  stage_label: string;
  time_in_stage_hours: number;
  time_in_stage: string;
  format: string | null;
  format_id: string | null;
  wave: { id: string; name: string } | null;
  slot: BoardSlot | null;
}

export interface BoardColumn {
  id: BoardStage;
  label: string;
  count: number;
  entry_action: string;
}

export interface BoardFacets {
  tracks: Array<{ id: string; name: string }>;
  formats: Array<{ id: string; name: string }>;
  waves: Array<{ id: string; name: string }>;
}

export interface BoardListEnvelope extends ListEnvelope<BoardCard> {
  columns: BoardColumn[];
  facets: BoardFacets;
}

interface BoardQueryRow {
  id: string;
  kind: "abstract" | "session";
  title: string;
  format_id: string | null;
  format: string | null;
  wave_id: string | null;
  wave: string | null;
  speakers_json: string;
  tracks_json: string;
  stage: BoardStage;
  updated_at: number;
  starts_at: number | null;
  duration_min: number | null;
  room: string | null;
  building: string | null;
  timezone: string;
  agenda_published: number | null;
}

interface QueryParts {
  where: string;
  bindings: unknown[];
}

const FROM = `FROM submissions s
JOIN events event ON event.id = s.event_id
LEFT JOIN formats format ON format.id = s.format_id
LEFT JOIN waves wave ON wave.id = s.wave_id
LEFT JOIN agenda_items ai ON ai.submission_id = s.id AND ai.kind = 'session'
LEFT JOIN rooms room ON room.id = ai.room_id
LEFT JOIN buildings building ON building.id = room.building_id`;

/**
 * The board is a projection of the record, so stage derivation is deliberately
 * read-only and uses the same predicates as dashboard/list reads. Terminal
 * decisions have their own column; they are not a private meaning of Waved.
 */
export const BOARD_STAGE_SQL = `CASE
  WHEN ${submissionStatusPredicate("published", { includeCancelledAt: true })} THEN 'published'
  WHEN ${submissionStatusPredicate("scheduled", { includeCancelledAt: true })} THEN 'scheduled'
  WHEN ${submissionStatusPredicate("onboarding", { includeCancelledAt: true })} THEN 'onboarding'
  WHEN ${submissionStatusPredicate("waved", { includeCancelledAt: true })} THEN 'waved'
  WHEN ${submissionStatusPredicate("accepted", { includeCancelledAt: true })} THEN 'accepted'
  WHEN ${submissionStatusPredicate("in_review", { includeCancelledAt: true })} THEN 'in_review'
  WHEN ${submissionStatusPredicate("submitted", { includeCancelledAt: true })} THEN 'submitted'
  ELSE 'declined'
END`;

function filterParts(filters: BoardListFilters): QueryParts {
  const clauses = ["s.event_id = ?", "s.status <> 'draft'"];
  const bindings: unknown[] = [filters.eventId];
  if (filters.kind) {
    clauses.push("s.kind = ?");
    bindings.push(filters.kind);
  }
  if (filters.track) {
    clauses.push(`EXISTS (
      SELECT 1 FROM submission_tracks filtered_track
      WHERE filtered_track.submission_id = s.id AND filtered_track.track_id = ?
    )`);
    bindings.push(filters.track);
  }
  if (filters.format) {
    clauses.push("s.format_id = ?");
    bindings.push(filters.format);
  }
  if (filters.wave) {
    clauses.push("s.wave_id = ?");
    bindings.push(filters.wave);
  }
  if (filters.q) {
    const query = `%${filters.q.toLocaleLowerCase()}%`;
    clauses.push(`(
      lower(s.id) LIKE ? OR lower(s.title) LIKE ? OR lower(s.search_blob) LIKE ?
      OR lower(coalesce(format.name, '')) LIKE ?
      OR lower(coalesce(wave.name, '')) LIKE ?
      OR EXISTS (
        SELECT 1 FROM participations search_participation
        JOIN people search_person ON search_person.id = search_participation.person_id
        WHERE search_participation.submission_id = s.id
          AND (lower(search_person.name) LIKE ? OR lower(coalesce(search_person.company, '')) LIKE ?)
      )
      OR EXISTS (
        SELECT 1 FROM submission_tracks search_submission_track
        JOIN tracks search_track ON search_track.id = search_submission_track.track_id
        WHERE search_submission_track.submission_id = s.id AND lower(search_track.name) LIKE ?
      )
    )`);
    bindings.push(query, query, query, query, query, query, query, query);
  }
  return { where: clauses.join(" AND "), bindings };
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function formatSlot(row: BoardQueryRow): BoardSlot | null {
  if (row.starts_at === null || row.duration_min === null || row.room === null || row.building === null) return null;
  const date = new Date(row.starts_at);
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: row.timezone,
  }).formatToParts(date);
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: row.timezone,
  }).format(date);
  return {
    starts_at: row.starts_at,
    day: `${value("weekday")} · ${value("month")} ${value("day")}`,
    time,
    duration_min: row.duration_min,
    room: row.room,
    building: row.building,
    timezone: row.timezone,
    is_published: row.agenda_published === 1,
  };
}

function durationLabel(hours: number): string {
  if (hours < 24) return `${hours}h in stage`;
  return `${Math.floor(hours / 24)}d in stage`;
}

function toCard(row: BoardQueryRow): BoardCard {
  const hours = Math.max(0, Math.floor((Date.now() - row.updated_at) / 3_600_000));
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    speakers: parseJsonArray(row.speakers_json),
    tracks: parseJsonArray<{ id: string; name: string; color: string; is_primary: number }>(row.tracks_json).map((track) => ({
      ...track,
      is_primary: Boolean(track.is_primary),
    })),
    stage: row.stage,
    stage_label: BOARD_STAGE_LABELS[row.stage],
    time_in_stage_hours: hours,
    time_in_stage: durationLabel(hours),
    format: row.format,
    format_id: row.format_id,
    wave: row.wave_id === null || row.wave === null ? null : { id: row.wave_id, name: row.wave },
    slot: formatSlot(row),
  };
}

async function facets(db: D1Database, eventId: string): Promise<BoardFacets> {
  const [tracks, formats, waves] = await Promise.all([
    db.prepare("SELECT id, name FROM tracks WHERE event_id = ? ORDER BY position, id").bind(eventId).all<{ id: string; name: string }>(),
    db.prepare("SELECT id, name FROM formats WHERE event_id = ? ORDER BY position, id").bind(eventId).all<{ id: string; name: string }>(),
    db.prepare("SELECT id, name FROM waves WHERE event_id = ? ORDER BY position, id").bind(eventId).all<{ id: string; name: string }>(),
  ]);
  return { tracks: tracks.results, formats: formats.results, waves: waves.results };
}

export async function listBoard(
  database: D1Database,
  filters: BoardListFilters,
): Promise<BoardListEnvelope> {
  const page = parsePagination(filters);
  const sort = resolveSort(BOARD_SORTS, filters.sort, "newest");
  const stableOrder = orderClause(sort).replace(/, id ASC$/, ", s.id ASC");
  const { where, bindings } = filterParts(filters);
  const count = database.prepare(`SELECT COUNT(DISTINCT s.id) AS total ${FROM} WHERE ${where}`).bind(...bindings);
  const data = database.prepare(`
    SELECT
      s.id,
      s.kind,
      s.title,
      s.format_id,
      format.name AS format,
      s.wave_id,
      wave.name AS wave,
      s.updated_at,
      ${BOARD_STAGE_SQL} AS stage,
      COALESCE((
        SELECT json_group_array(json_object('id', ordered.id, 'name', ordered.name, 'company', ordered.company))
        FROM (
          SELECT speaker.id, speaker.name, speaker.company
          FROM participations participation
          JOIN people speaker ON speaker.id = participation.person_id
          WHERE participation.submission_id = s.id
          ORDER BY participation.position, participation.id
        ) ordered
      ), '[]') AS speakers_json,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', ordered.id, 'name', ordered.name, 'color', ordered.color,
          'is_primary', ordered.is_primary
        ))
        FROM (
          SELECT track.id, track.name, track.color, carried.is_primary
          FROM submission_tracks carried
          JOIN tracks track ON track.id = carried.track_id
          WHERE carried.submission_id = s.id
          ORDER BY carried.is_primary DESC, track.position, track.id
        ) ordered
      ), '[]') AS tracks_json,
      ai.starts_at,
      ai.duration_min,
      room.name AS room,
      building.name AS building,
      event.timezone,
      ai.is_published AS agenda_published
    ${FROM}
    WHERE ${where}
    ORDER BY ${stableOrder}
    LIMIT ? OFFSET ?
  `).bind(...bindings, page.limit, page.offset);
  const envelope = await executeListPage<BoardQueryRow>({ count, data, page });
  const [facetValues, stageCounts] = await Promise.all([
    facets(database, filters.eventId),
    database.prepare(`
      SELECT ${BOARD_STAGE_SQL} AS stage, COUNT(DISTINCT s.id) AS count
      ${FROM}
      WHERE ${where}
      GROUP BY ${BOARD_STAGE_SQL}
    `).bind(...bindings).all<{ stage: BoardStage; count: number }>(),
  ]);
  const counts = new Map(stageCounts.results.map((row) => [row.stage, Number(row.count)]));
  const columns = BOARD_STAGES.map((id) => ({
    id,
    label: BOARD_STAGE_LABELS[id],
    count: counts.get(id) ?? 0,
    entry_action: BOARD_STAGE_ENTRY_ACTIONS[id],
  }));
  return {
    ...envelope,
    columns,
    facets: facetValues,
    data: envelope.data.map(toCard),
  };
}
