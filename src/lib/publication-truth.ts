import type { D1Database } from "@cloudflare/workers-types";

import { newUlid } from "../api/ids";

/**
 * Publication is a fact about a submission and its agenda item, never a UI
 * stage or the legacy `submissions.is_published` mirror.  Keep the wire codes
 * closed: callers can add copy without silently inventing a second predicate.
 */
export const PUBLICATION_REASON_CODES = [
  "READY_TO_PUBLISH",
  "ALREADY_PUBLISHED",
  "POST_PUBLISH_REVERSED",
  "WRONG_KIND",
  "FOREIGN_EVENT",
  "UNKNOWN_ID",
  "STALE_SELECTION",
  "MALFORMED_SLOT",
  "MISSING_AGENDA_ITEM",
  "MISSING_DATE_TIME",
  "MISSING_DURATION",
  "MISSING_ROOM",
  "FOREIGN_ROOM",
  "NOT_ACCEPTED",
  "PUBLIC_BOUNDARY_CLOSED",
  "PRIVACY_EXCLUDED",
] as const;

export type PublicationReasonCode = (typeof PUBLICATION_REASON_CODES)[number];

const REASON_PRECEDENCE: readonly PublicationReasonCode[] = [
  "FOREIGN_EVENT",
  "UNKNOWN_ID",
  "WRONG_KIND",
  "POST_PUBLISH_REVERSED",
  "ALREADY_PUBLISHED",
  "STALE_SELECTION",
  "MALFORMED_SLOT",
  "NOT_ACCEPTED",
  "MISSING_AGENDA_ITEM",
  "MISSING_DATE_TIME",
  "MISSING_DURATION",
  "MISSING_ROOM",
  "FOREIGN_ROOM",
  "PUBLIC_BOUNDARY_CLOSED",
  "PRIVACY_EXCLUDED",
  "READY_TO_PUBLISH",
];

export const PUBLICATION_REASON_COPY: Record<PublicationReasonCode, string | null> = {
  READY_TO_PUBLISH: null,
  ALREADY_PUBLISHED: "the agenda record is already published",
  POST_PUBLISH_REVERSED: "no longer accepted — the decision was reversed after scheduling",
  WRONG_KIND: "only Sessions can go public",
  FOREIGN_EVENT: "this record is not part of this conference",
  UNKNOWN_ID: "this record is not part of this conference",
  STALE_SELECTION: "the selection is stale — refresh before publishing",
  MALFORMED_SLOT: "the scheduled slot is malformed before it can go public",
  MISSING_AGENDA_ITEM: "needs a room and time before it can go public",
  MISSING_DATE_TIME: "needs a date and time before it can go public",
  MISSING_DURATION: "needs a duration before it can go public",
  MISSING_ROOM: "needs a room before it can go public",
  FOREIGN_ROOM: "the room is not part of this conference",
  NOT_ACCEPTED: "no longer accepted — the decision was reversed after scheduling",
  PUBLIC_BOUNDARY_CLOSED: "the public agenda is not open yet",
  PRIVACY_EXCLUDED: "withheld from the public agenda by privacy rules",
};

export const PUBLICATION_NOOP_CODES = [
  "EMPTY_SELECTION",
  "ALREADY_IN_STATE",
  "ALREADY_PUBLISHED",
  "NO_DECISIONS_REMAIN",
  "NO_VALID_RECIPIENT",
  "DUPLICATE_SKIPPED",
  "ALL_FAILED",
] as const;

export type PublicationNoOpReasonCode = (typeof PUBLICATION_NOOP_CODES)[number];

export type PublicationClassification =
  | "UNKNOWN_ID"
  | "FOREIGN_EVENT"
  | "WRONG_KIND"
  | "STALE_SELECTION"
  | "ACCEPTED_UNSCHEDULED"
  | "UNSCHEDULED_WITHHELD"
  | "EXISTING_ITEM_MALFORMED"
  | "EXISTING_ITEM_WITHHELD"
  | "READY_TO_PUBLISH"
  | "BOARD_ANOMALY"
  | "PUBLIC_LIVE"
  | "PUBLISHED_NOT_PUBLIC";

export interface PublicationAgendaItemFact {
  id: string;
  eventId: string;
  kind: "session" | "break";
  startsAt: number | null;
  durationMin: number | null;
  roomId: string | null;
  isPublished: boolean;
  updatedAt: number;
  roomEventId: string | null;
  buildingEventId: string | null;
}

export interface PublicationSubmissionFact {
  id: string;
  eventId: string;
  kind: "abstract" | "session";
  title: string;
  status: string;
  submissionIsPublished: boolean;
  submissionUpdatedAt: number;
  agendaItems: PublicationAgendaItemFact[];
}

export interface PublicationReasonDetails {
  item_count: number;
  missing_date_time: boolean;
  missing_duration: boolean;
  missing_room: boolean;
  foreign_room: boolean;
  multiple_agenda_items: boolean;
  public_boundary_open: boolean;
  privacy_allowed: boolean;
}

export interface PublicationEvaluation {
  submissionId: string;
  title: string | null;
  classification: PublicationClassification;
  status: string | null;
  observedState: string | null;
  primaryReasonCode: PublicationReasonCode;
  reasonCodes: PublicationReasonCode[];
  reasonDetails: PublicationReasonDetails;
  observedRevision: { submission_updated_at: number; agenda_updated_at: number | null } | null;
  agendaItem: PublicationAgendaItemFact | null;
  eventId: string | null;
}

export interface PublicationEvaluationOptions {
  eventId: string;
  publicBoundaryOpen: boolean;
  expectedRevision?: { submission_updated_at: number; agenda_updated_at: number | null } | null;
}

export interface PublicationSelectionRow extends PublicationEvaluation {
  expectedRevision: { submission_updated_at: number; agenda_updated_at: number | null } | null;
}

export interface PublicationSelectionExplanation {
  operation_id: string;
  requested_ids: string[];
  duplicate_ids: string[];
  rows: PublicationSelectionRow[];
  counts: Record<PublicationClassification | "unknown_id" | "foreign_event" | "wrong_kind" | "stale_selection" | "accepted_unscheduled" | "unscheduled_withheld" | "existing_item_malformed" | "existing_item_withheld" | "ready_to_publish" | "board_anomaly" | "public_live" | "published_not_public", number>;
  all_or_nothing: true;
}

function uniqueCodes(codes: readonly PublicationReasonCode[]): PublicationReasonCode[] {
  const present = new Set(codes);
  return REASON_PRECEDENCE.filter((code) => present.has(code));
}

function reasonDetails(item: PublicationAgendaItemFact | null, itemCount: number, publicBoundaryOpen: boolean, privacyAllowed: boolean): PublicationReasonDetails {
  const missingDateTime = item === null || item.startsAt === null;
  const missingDuration = item === null || item.durationMin === null || item.durationMin <= 0;
  const missingRoom = item === null || item.roomId === null;
  const foreignRoom = item !== null && item.roomId !== null
    && (item.roomEventId !== item.eventId || item.buildingEventId !== item.eventId);
  return {
    item_count: itemCount,
    missing_date_time: missingDateTime,
    missing_duration: missingDuration,
    missing_room: missingRoom,
    foreign_room: foreignRoom,
    multiple_agenda_items: itemCount > 1,
    public_boundary_open: publicBoundaryOpen,
    privacy_allowed: privacyAllowed,
  };
}

function primaryCode(codes: readonly PublicationReasonCode[]): PublicationReasonCode {
  return uniqueCodes(codes)[0] ?? "MALFORMED_SLOT";
}

function stateLabel(classification: PublicationClassification): string {
  return classification.toLowerCase();
}

/**
 * Classify one fact object. This pure function is intentionally exported so
 * truth-table tests can prove the partition without needing a Worker runtime.
 */
export function classifyPublicationFact(
  fact: PublicationSubmissionFact | null,
  options: PublicationEvaluationOptions,
): PublicationEvaluation {
  if (!fact) {
    return {
      submissionId: "",
      title: null,
      eventId: null,
      classification: "UNKNOWN_ID",
      status: null,
      observedState: null,
      primaryReasonCode: "UNKNOWN_ID",
      reasonCodes: ["UNKNOWN_ID"],
      reasonDetails: reasonDetails(null, 0, options.publicBoundaryOpen, false),
      observedRevision: null,
      agendaItem: null,
    };
  }

  if (fact.eventId !== options.eventId) {
    return {
      submissionId: fact.id,
      title: null,
      eventId: fact.eventId,
      classification: "FOREIGN_EVENT",
      status: null,
      observedState: null,
      primaryReasonCode: "FOREIGN_EVENT",
      reasonCodes: ["FOREIGN_EVENT"],
      reasonDetails: reasonDetails(null, fact.agendaItems.length, options.publicBoundaryOpen, false),
      observedRevision: null,
      agendaItem: null,
    };
  }

  const items = fact.agendaItems;
  const item = items.length === 1 ? items[0]! : null;
  // Older imported/fixture rows can retain `submissions.kind = 'abstract'`
  // after they have been placed as a Session. A session agenda placement is
  // the durable fact that made that row public before MRQ-237; do not turn
  // those already-valid rows into a new public 422/409 boundary.
  const hasSessionPlacement = items.some((candidate) => candidate.kind === "session");
  const isSession = fact.kind === "session" || hasSessionPlacement;
  const detail = reasonDetails(item, items.length, options.publicBoundaryOpen, fact.status !== "rejected" && fact.status !== "withdrawn");
  const validSlot = item !== null
    && !detail.missing_date_time
    && !detail.missing_duration
    && !detail.missing_room
    && !detail.foreign_room;
  const privacyAllowed = fact.status !== "rejected" && fact.status !== "withdrawn";
  const published = item?.isPublished === true;
  let classification: PublicationClassification;
  if (!isSession) classification = "WRONG_KIND";
  else if (items.length === 0) classification = fact.status === "accepted" ? "ACCEPTED_UNSCHEDULED" : "UNSCHEDULED_WITHHELD";
  else if (items.length > 1) classification = "EXISTING_ITEM_MALFORMED";
  else if (published && !privacyAllowed) classification = "BOARD_ANOMALY";
  else if (published && fact.status === "accepted" && options.publicBoundaryOpen && privacyAllowed && validSlot) classification = "PUBLIC_LIVE";
  else if (published) classification = "PUBLISHED_NOT_PUBLIC";
  else if (!validSlot) classification = "EXISTING_ITEM_MALFORMED";
  else if (fact.status === "accepted" && options.publicBoundaryOpen) classification = "READY_TO_PUBLISH";
  else classification = "EXISTING_ITEM_WITHHELD";

  const codes: PublicationReasonCode[] = [];
  if (!isSession) codes.push("WRONG_KIND");
  if (published) codes.push("ALREADY_PUBLISHED");
  if (published && !privacyAllowed) codes.push("POST_PUBLISH_REVERSED");
  if (items.length > 1 || (items.length === 1 && !validSlot)) {
    codes.push("MALFORMED_SLOT");
    if (detail.missing_date_time) codes.push("MISSING_DATE_TIME");
    if (detail.missing_duration) codes.push("MISSING_DURATION");
    if (detail.missing_room) codes.push("MISSING_ROOM");
    if (detail.foreign_room) codes.push("FOREIGN_ROOM");
  }
  if (fact.status !== "accepted") codes.push("NOT_ACCEPTED");
  if (items.length === 0) codes.push("MISSING_AGENDA_ITEM");
  if (!options.publicBoundaryOpen && (items.length > 0 || fact.status === "accepted")) codes.push("PUBLIC_BOUNDARY_CLOSED");
  if (!privacyAllowed && published) codes.push("PRIVACY_EXCLUDED");
  if (classification === "READY_TO_PUBLISH") codes.push("READY_TO_PUBLISH");
  const reasonCodes = uniqueCodes(codes);
  return {
    submissionId: fact.id,
    title: fact.title,
    eventId: fact.eventId,
    classification,
    status: fact.status,
    observedState: stateLabel(classification),
    primaryReasonCode: primaryCode(reasonCodes),
    reasonCodes,
    reasonDetails: { ...detail, privacy_allowed: privacyAllowed },
    observedRevision: {
      submission_updated_at: fact.submissionUpdatedAt,
      agenda_updated_at: item?.updatedAt ?? null,
    },
    agendaItem: item,
  };
}

interface PublicationQueryRow {
  id: string;
  event_id: string;
  kind: "abstract" | "session";
  title: string;
  status: string;
  submission_is_published: number;
  submission_updated_at: number;
  agenda_item_id: string | null;
  agenda_event_id: string | null;
  agenda_kind: "session" | "break" | null;
  starts_at: number | null;
  duration_min: number | null;
  room_id: string | null;
  agenda_is_published: number | null;
  agenda_updated_at: number | null;
  room_event_id: string | null;
  building_event_id: string | null;
}

function toAgendaItem(row: PublicationQueryRow): PublicationAgendaItemFact | null {
  if (row.agenda_item_id === null || row.agenda_event_id === null || row.agenda_kind === null) return null;
  return {
    id: row.agenda_item_id,
    eventId: row.agenda_event_id,
    kind: row.agenda_kind,
    startsAt: row.starts_at,
    durationMin: row.duration_min,
    roomId: row.room_id,
    isPublished: row.agenda_is_published === 1,
    updatedAt: Number(row.agenda_updated_at ?? 0),
    roomEventId: row.room_event_id,
    buildingEventId: row.building_event_id,
  };
}

async function readEventBoundary(database: D1Database, eventId: string): Promise<boolean> {
  const row = await database.prepare("SELECT status FROM events WHERE id = ?").bind(eventId).first<{ status: string }>();
  return row?.status === "live";
}

/** Read the complete event-scoped publication partition, including malformed rows. */
export async function readPublicationFacts(
  database: D1Database,
  eventId: string,
  submissionIds?: readonly string[],
): Promise<{ eventExists: boolean; publicBoundaryOpen: boolean; facts: PublicationSubmissionFact[] }> {
  const publicBoundaryOpen = await readEventBoundary(database, eventId);
  const eventExists = publicBoundaryOpen || Boolean(await database.prepare("SELECT 1 AS present FROM events WHERE id = ?").bind(eventId).first());
  const predicate = submissionIds
    ? "s.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))"
    : "s.event_id = ?";
  const binding = submissionIds ? JSON.stringify([...new Set(submissionIds)]) : eventId;
  const result = await database.prepare(`
    SELECT s.id, s.event_id, s.kind, s.title, s.status,
      s.is_published AS submission_is_published, s.updated_at AS submission_updated_at,
      item.id AS agenda_item_id, item.event_id AS agenda_event_id, item.kind AS agenda_kind,
      item.starts_at, item.duration_min, item.room_id,
      item.is_published AS agenda_is_published, item.updated_at AS agenda_updated_at,
      room.event_id AS room_event_id, building.event_id AS building_event_id
    FROM submissions s
    LEFT JOIN agenda_items item
      ON item.submission_id = s.id
     AND item.event_id = s.event_id
     AND item.kind = 'session'
    LEFT JOIN rooms room
      ON room.id = item.room_id AND room.event_id = item.event_id
    LEFT JOIN buildings building
      ON building.id = room.building_id AND building.event_id = room.event_id
    WHERE ${predicate}
    ORDER BY s.id ASC, item.id ASC
  `).bind(binding).all<PublicationQueryRow>();
  const byId = new Map<string, PublicationSubmissionFact>();
  for (const row of result.results) {
    const current = byId.get(row.id) ?? {
      id: row.id,
      eventId: row.event_id,
      kind: row.kind,
      title: row.title,
      status: row.status,
      submissionIsPublished: row.submission_is_published === 1,
      submissionUpdatedAt: Number(row.submission_updated_at),
      agendaItems: [],
    };
    const item = toAgendaItem(row);
    if (item && !current.agendaItems.some((candidate) => candidate.id === item.id)) current.agendaItems.push(item);
    byId.set(row.id, current);
  }
  return { eventExists, publicBoundaryOpen, facts: [...byId.values()] };
}

export async function evaluatePublication(
  database: D1Database,
  eventId: string,
  submissionId: string,
): Promise<PublicationEvaluation> {
  const result = await readPublicationFacts(database, eventId, [submissionId]);
  const fact = result.facts.find((candidate) => candidate.id === submissionId) ?? null;
  if (fact && fact.eventId !== eventId) {
    return {
      ...classifyPublicationFact(fact, { eventId, publicBoundaryOpen: result.publicBoundaryOpen }),
      title: null,
      eventId: fact.eventId,
      classification: "FOREIGN_EVENT",
      observedState: null,
      primaryReasonCode: "FOREIGN_EVENT",
      reasonCodes: ["FOREIGN_EVENT"],
    };
  }
  return classifyPublicationFact(fact, { eventId, publicBoundaryOpen: result.publicBoundaryOpen });
}

/**
 * Explain a selected publication set before any write. Missing IDs are rows,
 * never silently omitted, and duplicate IDs are reported separately.
 */
export async function explainPublicationSelection(
  database: D1Database,
  eventId: string,
  selectedIds: readonly string[],
  expectedRevisions: Readonly<Record<string, { submission_updated_at: number; agenda_updated_at: number | null }>> = {},
  operationId = newUlid(),
): Promise<PublicationSelectionExplanation> {
  const requested = [...selectedIds];
  const duplicateIds: string[] = [];
  const seen = new Set<string>();
  for (const id of requested) {
    if (seen.has(id)) duplicateIds.push(id);
    seen.add(id);
  }
  const read = await readPublicationFacts(database, eventId, [...seen]);
  const facts = new Map(read.facts.map((fact) => [fact.id, fact]));
  const rows: PublicationSelectionRow[] = [];
  for (const id of seen) {
    const fact = facts.get(id);
    let evaluation: PublicationEvaluation;
    if (!fact) {
      evaluation = {
        ...classifyPublicationFact(null, { eventId, publicBoundaryOpen: read.publicBoundaryOpen }),
        submissionId: id,
      };
    } else if (fact.eventId !== eventId) {
      evaluation = {
        ...classifyPublicationFact(fact, { eventId, publicBoundaryOpen: read.publicBoundaryOpen }),
        title: null,
        eventId: fact.eventId,
        classification: "FOREIGN_EVENT",
        observedState: null,
        primaryReasonCode: "FOREIGN_EVENT",
        reasonCodes: ["FOREIGN_EVENT"],
      };
    } else {
      evaluation = classifyPublicationFact(fact, { eventId, publicBoundaryOpen: read.publicBoundaryOpen });
      const expected = expectedRevisions[id];
      if (expected && (expected.submission_updated_at !== evaluation.observedRevision?.submission_updated_at
        || expected.agenda_updated_at !== evaluation.observedRevision?.agenda_updated_at)) {
        evaluation = {
          ...evaluation,
          classification: "STALE_SELECTION",
          observedState: evaluation.classification.toLowerCase(),
          primaryReasonCode: "STALE_SELECTION",
          reasonCodes: ["STALE_SELECTION", ...evaluation.reasonCodes.filter((code) => code !== "READY_TO_PUBLISH")],
        };
      }
    }
    rows.push({ ...evaluation, expectedRevision: expectedRevisions[id] ?? null });
  }
  const counts = Object.fromEntries([
    "unknown_id", "foreign_event", "wrong_kind", "stale_selection", "accepted_unscheduled",
    "unscheduled_withheld", "existing_item_malformed", "existing_item_withheld", "ready_to_publish",
    "board_anomaly", "public_live", "published_not_public",
  ].map((key) => [key, 0])) as PublicationSelectionExplanation["counts"];
  for (const row of rows) {
    const key = row.classification.toLowerCase() as keyof typeof counts;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return {
    operation_id: operationId,
    requested_ids: requested,
    duplicate_ids: duplicateIds,
    rows,
    counts,
    all_or_nothing: true,
  };
}

export function publicationReasonMessage(code: PublicationReasonCode, direct = false): string | null {
  if (code === "ALREADY_PUBLISHED" && direct) return "Already live — nothing changed";
  return PUBLICATION_REASON_COPY[code];
}

/** Shared SQL guard for attendee/public projections. Aliases are caller-owned. */
export function publicPublicationPredicate(aliases: { submission?: string; agenda?: string; event?: string } = {}): string {
  const submission = aliases.submission ?? "s";
  const agenda = aliases.agenda ?? "ai";
  const event = aliases.event ?? "event";
  return `(
    ${event}.status = 'live'
    AND ${submission}.status = 'accepted'
    AND ${agenda}.event_id = ${submission}.event_id
    AND ${agenda}.kind = 'session'
    AND ${agenda}.is_published = 1
    AND ${agenda}.starts_at IS NOT NULL
    AND ${agenda}.duration_min > 0
    AND EXISTS (
      SELECT 1 FROM rooms publication_room
      JOIN buildings publication_building
        ON publication_building.id = publication_room.building_id
       AND publication_building.event_id = publication_room.event_id
      WHERE publication_room.id = ${agenda}.room_id
        AND publication_room.event_id = ${agenda}.event_id
    )
  )`;
}

/**
 * SQL arms for the two organizer-facing publication gauges. These predicates
 * intentionally mirror the pure fact partition above: a gauge is a view of
 * the same event-scoped truth, never a convenient synonym for scheduled or
 * published.
 */
export function publicationClassificationPredicate(
  classification: "not_yet_public" | "live_on_site",
  aliases: { submission?: string; agenda?: string; event?: string } = {},
  options: { eventStatusAvailable?: boolean } = {},
): string {
  if (options.eventStatusAvailable === false) return "(0 = 1)";
  const submission = aliases.submission ?? "s";
  const agenda = aliases.agenda ?? "ai";
  const event = aliases.event ?? "event";
  const candidate = `${agenda}_candidate`;
  const item = (condition: (candidateAlias: string) => string) => `EXISTS (
    SELECT 1 FROM agenda_items ${candidate}
    WHERE ${candidate}.event_id = ${submission}.event_id
      AND ${candidate}.submission_id = ${submission}.id
      AND ${candidate}.kind = 'session'
      AND ${condition(candidate)}
  )`;
  const exactlyOne = `(SELECT COUNT(*) FROM agenda_items ${agenda}_count
    WHERE ${agenda}_count.event_id = ${submission}.event_id
      AND ${agenda}_count.submission_id = ${submission}.id
      AND ${agenda}_count.kind = 'session') = 1`;
  const validSlot = (alias: string) => `${alias}.starts_at IS NOT NULL
    AND ${alias}.duration_min > 0
    AND ${alias}.room_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM rooms publication_room
      JOIN buildings publication_building
        ON publication_building.id = publication_room.building_id
       AND publication_building.event_id = publication_room.event_id
      WHERE publication_room.id = ${alias}.room_id
        AND publication_room.event_id = ${submission}.event_id
    )`;
  const ready = `${event}.status = 'live'
    AND ${submission}.status = 'accepted'
    AND ${exactlyOne}
    AND ${item((candidateAlias) => `${candidateAlias}.is_published = 0 AND ${validSlot(candidateAlias)}`)}`;
  if (classification === "not_yet_public") return `(${ready})`;
  return `(${event}.status = 'live'
    AND ${submission}.status = 'accepted'
    AND ${exactlyOne}
    AND ${item((candidateAlias) => `${candidateAlias}.is_published = 1 AND ${validSlot(candidateAlias)}`)})`;
}

export const SPEC_MRQ_237_PUBLIC_PRIVACY = "SPEC-MRQ-237-PUBLIC-PRIVACY: [beyond v1.17 prototype — acknowledged divergence]";
export const SPEC_MRQ_237_PUBLICATION_GAUGES = "SPEC-MRQ-237-PUBLICATION-GAUGES: [beyond v1.17 prototype — acknowledged divergence]";
