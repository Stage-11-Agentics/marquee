import type { ListEnvelope } from "../api/list";
import type {
  SubmissionListItem,
  SubmissionSpeakerListItem,
  SubmissionTrackListItem,
} from "../api/submissions";
import {
  executeListPage,
  orderClause,
  parsePagination,
  resolveSort,
  type SortRegistry,
} from "../api/pagination";

export const SUBMISSION_SORTS = {
  newest: { column: "s.submitted_at", direction: "desc" },
  updated: { column: "s.updated_at", direction: "desc" },
  title: { column: "s.title COLLATE NOCASE", direction: "asc" },
  score: { column: "score", direction: "desc" },
} as const satisfies SortRegistry;

export const SUBMISSION_STATUS_FILTERS = [
  "draft",
  "submitted",
  "in_review",
  "accepted",
  "waitlisted",
  "rejected",
  "withdrawn",
  "waved",
  "unreviewed",
  "scheduled",
  "published",
] as const;

export interface SubmissionListFilters {
  eventId: string;
  page?: number;
  per_page?: number;
  q?: string;
  sort?: keyof typeof SUBMISSION_SORTS;
  kind?: "abstract" | "session";
  status?: (typeof SUBMISSION_STATUS_FILTERS)[number];
  track?: string;
}

interface SubmissionQueryRow {
  id: string;
  kind: "abstract" | "session";
  title: string;
  stored_status: Exclude<SubmissionListItem["status"], "scheduled" | "published">;
  format: string | null;
  speakers_json: string;
  tracks_json: string;
  score: number | null;
  submitted_at: number | null;
  updated_at: number;
  origin: SubmissionListItem["origin"];
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

function filterParts(filters: SubmissionListFilters): QueryParts {
  const clauses = ["s.event_id = ?"];
  const bindings: unknown[] = [filters.eventId];

  if (filters.kind) {
    clauses.push("s.kind = ?");
    bindings.push(filters.kind);
  }
  if (filters.status === "scheduled") {
    clauses.push("ai.id IS NOT NULL AND ai.is_published = 0");
  } else if (filters.status === "published") {
    clauses.push("ai.id IS NOT NULL AND ai.is_published = 1");
  } else if (filters.status === "waved") {
    clauses.push("s.wave_id IS NOT NULL AND s.status = 'accepted'");
  } else if (filters.status === "unreviewed") {
    clauses.push("s.status IN ('submitted', 'in_review')");
  } else if (filters.status) {
    clauses.push("s.status = ?");
    bindings.push(filters.status);
  }
  if (filters.track) {
    clauses.push(`EXISTS (
      SELECT 1 FROM submission_tracks filter_st
      WHERE filter_st.submission_id = s.id AND filter_st.track_id = ?
    )`);
    bindings.push(filters.track);
  }
  if (filters.q) {
    const query = `%${filters.q.toLocaleLowerCase()}%`;
    clauses.push(`(
      lower(s.id) LIKE ? OR lower(s.title) LIKE ? OR lower(s.search_blob) LIKE ?
      OR EXISTS (
        SELECT 1 FROM participations search_par
        JOIN people search_person ON search_person.id = search_par.person_id
        WHERE search_par.submission_id = s.id
          AND (lower(search_person.name) LIKE ? OR lower(coalesce(search_person.company, '')) LIKE ?)
      )
      OR EXISTS (
        SELECT 1 FROM submission_tracks search_st
        JOIN tracks search_track ON search_track.id = search_st.track_id
        WHERE search_st.submission_id = s.id AND lower(search_track.name) LIKE ?
      )
    )`);
    bindings.push(query, query, query, query, query, query);
  }
  return { where: clauses.join(" AND "), bindings };
}

const FROM = `FROM submissions s
JOIN events event ON event.id = s.event_id
LEFT JOIN formats format ON format.id = s.format_id
LEFT JOIN agenda_items ai ON ai.submission_id = s.id AND ai.kind = 'session'
LEFT JOIN rooms room ON room.id = ai.room_id
LEFT JOIN buildings building ON building.id = room.building_id`;

function parseJsonArray<T>(value: string): T[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function toItem(row: SubmissionQueryRow): SubmissionListItem {
  const status = row.starts_at === null
    ? row.stored_status
    : row.agenda_published === 1
      ? "published"
      : "scheduled";
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    status,
    format: row.format,
    speakers: parseJsonArray<SubmissionSpeakerListItem>(row.speakers_json),
    tracks: parseJsonArray<SubmissionTrackListItem>(row.tracks_json).map((track) => ({
      ...track,
      is_primary: Boolean(track.is_primary),
    })),
    score: row.score === null ? null : Number(row.score),
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
    origin: row.origin,
    missing_fields: [],
    slot: row.starts_at === null || row.duration_min === null || row.room === null || row.building === null
      ? null
      : {
          starts_at: row.starts_at,
          duration_min: row.duration_min,
          room: row.room,
          building: row.building,
          timezone: row.timezone,
          is_published: row.agenda_published === 1,
        },
  };
}

export async function listSubmissions(
  database: D1Database,
  filters: SubmissionListFilters,
): Promise<ListEnvelope<SubmissionListItem>> {
  const page = parsePagination(filters);
  const sort = resolveSort(SUBMISSION_SORTS, filters.sort, "newest");
  // The shared helper deliberately emits the canonical `id ASC` tie-break.
  // This query joins several id-bearing tables, so qualify that fixed suffix.
  const stableOrder = orderClause(sort).replace(/, id ASC$/, ", s.id ASC");
  const { where, bindings } = filterParts(filters);
  const count = database.prepare(`SELECT COUNT(DISTINCT s.id) AS total ${FROM} WHERE ${where}`).bind(...bindings);
  const data = database.prepare(`
    SELECT
      s.id,
      s.kind,
      s.title,
      s.status AS stored_status,
      format.name AS format,
      COALESCE((
        SELECT json_group_array(json_object('id', ordered.id, 'name', ordered.name, 'company', ordered.company))
        FROM (
          SELECT speaker.id, speaker.name, speaker.company
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
          'color', ordered.color,
          'is_primary', ordered.is_primary
        ))
        FROM (
          SELECT carried.id, carried.name, carried.color, st.is_primary
          FROM submission_tracks st
          JOIN tracks carried ON carried.id = st.track_id
          WHERE st.submission_id = s.id
          ORDER BY st.is_primary DESC, carried.position ASC, carried.id ASC
        ) ordered
      ), '[]') AS tracks_json,
      (SELECT ROUND(AVG(evaluation.score), 2) FROM evaluations evaluation WHERE evaluation.submission_id = s.id) AS score,
      s.submitted_at,
      s.updated_at,
      s.origin,
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
  const envelope = await executeListPage<SubmissionQueryRow>({ count, data, page });
  return { ...envelope, data: envelope.data.map(toItem) };
}
