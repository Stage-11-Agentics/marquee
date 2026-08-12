import type { SubmissionListStatus, SubmissionSpeakerListItem, SubmissionTrackListItem } from "./submissions";

export const AGENDA_VIEWS = ["list", "day", "week", "track", "room"] as const;
export type AgendaView = (typeof AGENDA_VIEWS)[number];

/** The default is deliberately narrow: acceptance is the hand-off into scheduling. */
export const DEFAULT_SCHEDULABLE_STATUSES = ["accepted"] as const;

/**
 * Keep the publication batch below D1's 100-statement batch limit: two writes
 * plus one conditional audit statement per selected Session.
 */
export const MAX_BATCH_PUBLISH_IDS = 90;

export const SCHEDULABLE_STATUS_OPTIONS = [
  "draft",
  "submitted",
  "in_review",
  "accepted",
  "waitlisted",
  "rejected",
  "withdrawn",
] as const satisfies readonly SubmissionListStatus[];

export type SchedulableStatus = (typeof SCHEDULABLE_STATUS_OPTIONS)[number];

export interface AgendaEvent {
  id: string;
  name: string;
  slug?: string;
  starts_on: string;
  ends_on: string;
  timezone: string;
}

export interface AgendaPublishCandidate {
  agenda_item_id: string;
  submission_id: string;
  title: string;
  starts_at: number;
  duration_min: number;
  room: string;
  building: string;
  speakers: SubmissionSpeakerListItem[];
}

export interface AgendaPublication {
  live: number;
  not_yet_public: number;
  candidates: AgendaPublishCandidate[];
  public_agenda_url: string;
}

export interface AgendaBuilding {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  access_minutes: number;
}

export interface AgendaVenueDisclosure {
  pinned_building_count: number;
  primary_building_name: string | null;
}

export interface AgendaRoom {
  id: string;
  name: string;
  label: string;
  capacity: number;
  building: AgendaBuilding;
  av_capabilities: string[];
  notes: string | null;
}

export interface AgendaFormat {
  id: string;
  name: string;
  default_duration_min: number;
  min_duration_min: number;
  max_duration_min: number;
}

export interface AgendaTrack {
  id: string;
  name: string;
  color: string;
  is_primary?: boolean;
}

export interface AgendaSession {
  id: string;
  submission_id: string | null;
  kind: "session" | "break";
  title: string;
  starts_at: number;
  duration_min: number;
  room_id: string;
  room: string;
  building: string;
  track_id: string | null;
  track: string | null;
  tracks: AgendaTrack[];
  speakers: SubmissionSpeakerListItem[];
  has_declined_participant: boolean;
  format_id: string | null;
  format: string | null;
  status: SubmissionListStatus | "scheduled" | "published";
  is_published: boolean;
  updated_at: number;
  etag: string;
}

export interface AgendaPoolItem {
  submission_id: string;
  kind: "abstract" | "session";
  title: string;
  status: SchedulableStatus;
  format_id: string | null;
  format: string | null;
  default_duration_min: number;
  min_duration_min: number;
  max_duration_min: number;
  speakers: SubmissionSpeakerListItem[];
  tracks: SubmissionTrackListItem[];
  updated_at: number;
}

export type AgendaConflictKind = "room" | "person" | "transit";

export interface AgendaConflict {
  kind: AgendaConflictKind;
  message: string;
  session_ids: [string, string];
  person_id?: string;
  label?: "Transit";
}

export interface AgendaSnapshot {
  event: AgendaEvent;
  publication: AgendaPublication;
  venue?: AgendaVenueDisclosure;
  schedulable_statuses: SchedulableStatus[];
  rooms: AgendaRoom[];
  formats: AgendaFormat[];
  tracks: AgendaTrack[];
  sessions: AgendaSession[];
  unscheduled: AgendaPoolItem[];
  conflicts: AgendaConflict[];
}

export function roomLabel(room: string, building: string | null | undefined): string {
  return building ? `${room} · ${building}` : room;
}

export function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function normalizeSchedulableStatuses(value: unknown): SchedulableStatus[] {
  if (!Array.isArray(value)) return [...DEFAULT_SCHEDULABLE_STATUSES];
  const statuses = value.filter(
    (status): status is SchedulableStatus =>
      typeof status === "string" &&
      (SCHEDULABLE_STATUS_OPTIONS as readonly string[]).includes(status),
  );
  return statuses.length ? [...new Set(statuses)] : [...DEFAULT_SCHEDULABLE_STATUSES];
}

export function shouldBeInUnscheduledPool(
  status: string,
  hasAgendaItem: boolean,
  schedulableStatuses: readonly string[] = DEFAULT_SCHEDULABLE_STATUSES,
): boolean {
  return !hasAgendaItem && schedulableStatuses.includes(status);
}

export function durationIsAllowed(
  duration: number,
  format: Pick<AgendaFormat, "min_duration_min" | "max_duration_min"> | null,
): boolean {
  if (!Number.isInteger(duration) || duration <= 0) return false;
  if (!format) return true;
  return duration >= format.min_duration_min && duration <= format.max_duration_min;
}

export function formatDuration(
  format: Pick<AgendaFormat, "default_duration_min"> | null,
): number {
  return format?.default_duration_min ?? 30;
}

export function viewNames(): readonly AgendaView[] {
  return AGENDA_VIEWS;
}
