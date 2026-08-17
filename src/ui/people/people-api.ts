/**
 * The People screens' side of the org API.
 *
 * Every read and write here goes to the server. Nothing about a person — a
 * note, a tag, a stage move — is ever "saved" in the browser and shown as
 * saved: the composer clears after the write lands, so a reload shows what the
 * screen said it did.
 */
import { apiFetch } from "../shell/api-client";

export interface Person {
  id: string;
  name: string;
  email: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  headshot_attachment_id: string | null;
  tags: string[];
  stage: string | null;
  do_not_contact: boolean;
  outreach_target_event_id: string | null;
  outreach_target_event_name: string | null;
  outreach_next_touch_on: string | null;
  conference_count: number;
  last_contact_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface Facet {
  value: string;
  count: number;
}

export interface PeoplePage {
  data: Person[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  facets: { company: Facet[]; title: Facet[]; tag: Facet[] };
}

export interface PersonNote {
  id: string;
  body: string;
  actor_person_id: string | null;
  actor_name: string | null;
  created_at: number;
}

export interface StageEntry {
  id: string;
  stage: string;
  stage_name: string;
  score: number | null;
  rationale: string | null;
  actor_person_id: string | null;
  actor_name: string | null;
  created_at: number;
  target_event_id: string | null;
  target_event_name?: string | null;
  next_touch_on: string | null;
}

export interface PersonConnection {
  submission_id: string;
  title: string;
  status: string;
  role: string;
  event_id: string;
  event_name: string;
}

export interface PersonActivity {
  id: string;
  kind: string;
  summary: string;
  /** What the row adds — which tag, which roles ended, which subject. */
  detail: string | null;
  actor_name: string | null;
  created_at: number;
  undo_merge_id?: string;
}

export interface PersonActivityPage {
  data: PersonActivity[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  next_cursor: string | null;
  has_more: boolean;
}

export interface PersonRecord {
  person: Person;
  notes: PersonNote[];
  connections: PersonConnection[];
  activity: PersonActivity[];
  /** Everything the feed holds, so the drawer knows whether page two exists. */
  activity_total: number;
  activity_next_cursor: string | null;
  activity_has_more: boolean;
  stage_history: StageEntry[];
  card: StageEntry | null;
  target_events: Array<{ id: string; name: string }>;
}

export interface OrgSummary {
  people: number;
  conferences: number;
  returning_speakers: number;
  in_pipeline: number;
  top_companies: Facet[];
}

export interface PeopleImportResult {
  import_id: string;
  created: number;
  updated: number;
  skipped: number;
  unmapped: string[];
  headers: string[];
  attendances: number;
  roster_placements: number;
  event: string | null;
  undo_path: string;
}

export interface PeopleImportUndoResult {
  undone: number;
  attendances_removed: number;
  roster_placements_removed: number;
  skipped: number;
  skipped_rows: Array<{
    target_id: string;
    reason: "changed_after_import" | "has_references" | "missing_restore_receipt";
    fields: string[];
    references: string[];
  }>;
  retained_manifest: true;
}

export interface PersonMergePreview {
  org_id: string;
  retired: Person;
  survivor: Person;
  default_survivor_id: string;
  fields: Array<{
    field: string;
    survivor_value: unknown;
    retired_value: unknown;
    result: unknown;
    source: string;
    collision: boolean;
    reason?: string;
  }>;
  collisions: Array<{
    table: string;
    key: string;
    kept_id: string | null;
    retired_id: string;
    outcome: string;
    reason: string;
  }>;
  summary: {
    moved: number;
    deduped: number;
    dropped: number;
    aliases_created: number;
    aliases_repointed: number;
    collisions: number;
    references: Record<string, number>;
  };
  continuity: string;
  event_scope: string[];
  can_undo: true;
}

export interface PersonMergeExecuteResult {
  merge_id: string;
  status: "clean" | "undone" | "undo_blocked";
  retired_person_id: string;
  survivor_person_id: string;
  summary: PersonMergePreview["summary"];
  continuity: string;
  can_undo: boolean;
}

export interface PersonMergeUndoResult {
  merge_id: string;
  status: "undone" | "undo_blocked";
  restored: number;
  skipped: number;
  skipped_rows: Array<{ table: string; primary_key: string; reason: string }>;
  reason?: string;
}

export interface PersonListConfig {
  q: string;
  company?: string;
  title?: string;
  tag?: string;
  stage?: string;
}

export interface SavedPersonList {
  id: string;
  name: string;
  kind: "live" | "fixed";
  config: PersonListConfig;
  member_count: number;
  created_by_name: string | null;
  created_at: number;
  updated_at: number;
}

export interface PersonListDetail {
  id: string;
  name: string;
  kind: "live" | "fixed";
  member_count: number;
  created_by_name: string | null;
  created_at: number;
}

export interface PipelineStage {
  id: string;
  name: string;
  kind: string;
}

export interface PipelineCard {
  person_id: string;
  name: string;
  company: string | null;
  stage: string;
  score: number | null;
  rationale: string | null;
  moved_at: number;
  target_event_id: string | null;
  target_event_name: string | null;
  next_touch_on: string | null;
}

export interface PeopleFilters {
  q: string;
  company: string;
  title: string;
  tag: string;
  listId: string;
}

export const EMPTY_FILTERS: PeopleFilters = { q: "", company: "", title: "", tag: "", listId: "" };

/**
 * The attribute chips. A list is deliberately NOT one of them: its identity is
 * a name the organizer gave it, and the only thing a chip has to render is the
 * id — so the row that is supposed to say what you are looking at said
 * `list: lst_01K…` instead. The list gets its own named banner; `hasFilters`
 * still counts it so "Clear all" appears and the empty state stays honest.
 */
export function activeCriteria(filters: PeopleFilters): Array<{ key: keyof PeopleFilters; label: string; value: string }> {
  const criteria: Array<{ key: keyof PeopleFilters; label: string; value: string }> = [];
  if (filters.company) criteria.push({ key: "company", label: "company", value: filters.company });
  if (filters.title) criteria.push({ key: "title", label: "job title", value: filters.title });
  if (filters.tag) criteria.push({ key: "tag", label: "tag", value: filters.tag });
  return criteria;
}

export function hasFilters(filters: PeopleFilters): boolean {
  return filters.q.trim().length > 0 || filters.listId.length > 0 || activeCriteria(filters).length > 0;
}

/**
 * The save control's two states. With nothing ticked, an organizer is saving
 * the search they are looking at, and a saved search is normally meant to stay
 * current — so Live. With rows ticked they picked those people by hand, and
 * Fixed is what they meant.
 */
export function saveControl(selectedCount: number): { label: string; kind: "live" | "fixed" } {
  return selectedCount > 0
    ? { label: "Save selected as list", kind: "fixed" }
    : { label: "Save filter as list", kind: "live" };
}

const PEOPLE_ROUTE = "/api/v1/org/people";

export function peopleQuery(filters: PeopleFilters, page: number, perPage: number): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.company) params.set("company", filters.company);
  if (filters.title) params.set("title", filters.title);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.listId) params.set("list_id", filters.listId);
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  return params.toString();
}

export function fetchPeople(filters: PeopleFilters, page: number, perPage: number, signal?: AbortSignal): Promise<PeoplePage> {
  return apiFetch<PeoplePage>(`${PEOPLE_ROUTE}?${peopleQuery(filters, page, perPage)}`, { route: PEOPLE_ROUTE, ...(signal ? { signal } : {}) });
}

export function fetchSummary(signal?: AbortSignal): Promise<OrgSummary> {
  return apiFetch<OrgSummary>("/api/v1/org/summary", { route: "/api/v1/org/summary", ...(signal ? { signal } : {}) });
}

export function fetchPerson(personId: string, signal?: AbortSignal): Promise<PersonRecord> {
  return apiFetch<PersonRecord>(`${PEOPLE_ROUTE}/${encodeURIComponent(personId)}`, {
    route: "/api/v1/org/people/{personId}",
    ...(signal ? { signal } : {}),
  });
}

/**
 * Page two onward of the feed. The drawer opens with page one inside the record
 * read; this is the same projection, so a row cannot read one way on open and
 * another after "Load more".
 */
export function fetchPersonActivity(personId: string, page: number, cursor?: string | null, signal?: AbortSignal): Promise<PersonActivityPage> {
  const params = new URLSearchParams({ page: String(page) });
  if (cursor) params.set("cursor", cursor);
  return apiFetch<PersonActivityPage>(
    `${PEOPLE_ROUTE}/${encodeURIComponent(personId)}/activity?${params.toString()}`,
    {
      route: "/api/v1/org/people/{personId}/activity",
      ...(signal ? { signal } : {}),
    },
  );
}

export function previewPersonMerge(input: { person_ids: [string, string]; survivor_id?: string }): Promise<{ preview: PersonMergePreview }> {
  return write("/api/v1/org/people/merge/preview", "/api/v1/org/people/merge/preview", input);
}

export function executePersonMerge(
  input: { person_ids: [string, string]; survivor_id?: string },
  idempotencyKey = crypto.randomUUID(),
): Promise<PersonMergeExecuteResult> {
  return write("/api/v1/org/people/merge", "/api/v1/org/people/merge", input, "POST", { "Idempotency-Key": idempotencyKey });
}

export function undoPersonMerge(mergeId: string): Promise<PersonMergeUndoResult> {
  return write("/api/v1/org/people/merge/" + encodeURIComponent(mergeId) + "/undo", "/api/v1/org/people/merge/{mergeId}/undo", {}, "POST");
}

function write<Result>(path: string, route: string, body: unknown, method = "POST", extraHeaders: HeadersInit = {}): Promise<Result> {
  return apiFetch<Result>(path, {
    route,
    method,
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

export function addNote(personId: string, body: string): Promise<{ note: PersonNote }> {
  return write(`${PEOPLE_ROUTE}/${encodeURIComponent(personId)}/notes`, "/api/v1/org/people/{personId}/notes", { body });
}

export function addTag(personId: string, tag: string): Promise<{ tags: string[] }> {
  return write(`${PEOPLE_ROUTE}/${encodeURIComponent(personId)}/tags`, "/api/v1/org/people/{personId}/tags", { tag });
}

export function removeTag(personId: string, tag: string): Promise<{ tags: string[] }> {
  return apiFetch(`${PEOPLE_ROUTE}/${encodeURIComponent(personId)}/tags/${encodeURIComponent(tag)}`, {
    route: "/api/v1/org/people/{personId}/tags/{tag}",
    method: "DELETE",
  });
}

export function setStage(personId: string, input: {
  stage: string;
  score?: number;
  rationale?: string;
  target_event_id?: string | null;
  next_touch_on?: string | null;
}): Promise<{ card: StageEntry; stage_history: StageEntry[] }> {
  return write(`${PEOPLE_ROUTE}/${encodeURIComponent(personId)}/stage`, "/api/v1/org/people/{personId}/stage", input);
}

export function updatePerson(personId: string, input: { do_not_contact?: boolean }): Promise<{ person: Person }> {
  return write(`${PEOPLE_ROUTE}/${encodeURIComponent(personId)}`, "/api/v1/org/people/{personId}", input, "PATCH");
}

export function fetchPipeline(signal?: AbortSignal): Promise<{
  stages: PipelineStage[];
  cards: PipelineCard[];
  target_events: Array<{ id: string; name: string }>;
}> {
  return apiFetch("/api/v1/org/pipeline", { route: "/api/v1/org/pipeline", ...(signal ? { signal } : {}) });
}

export function fetchLists(signal?: AbortSignal): Promise<{ data: SavedPersonList[] }> {
  return apiFetch("/api/v1/org/lists", { route: "/api/v1/org/lists", ...(signal ? { signal } : {}) });
}

export function fetchList(listId: string, signal?: AbortSignal): Promise<{ list: PersonListDetail }> {
  return apiFetch(`/api/v1/org/lists/${encodeURIComponent(listId)}`, {
    route: "/api/v1/org/lists/{listId}",
    ...(signal ? { signal } : {}),
  });
}

export function createList(input: {
  name: string;
  kind: "live" | "fixed";
  config?: PersonListConfig;
  person_ids?: string[];
}): Promise<{ list: SavedPersonList }> {
  return write("/api/v1/org/lists", "/api/v1/org/lists", input);
}

export function deleteList(listId: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/api/v1/org/lists/${encodeURIComponent(listId)}`, {
    route: "/api/v1/org/lists/{listId}",
    method: "DELETE",
  });
}

export function previewOrgMail(input: { person_ids: string[]; subject: string; body: string }): Promise<{
  to_email: string;
  subject: string;
  text: string;
  html: string;
  recipients: number;
  excluded_people: string[];
}> {
  return write("/api/v1/org/comms/preview", "/api/v1/org/comms/preview", input);
}

export function sendOrgMail(input: { person_ids: string[]; subject: string; body: string }, idempotencyKey: string): Promise<{
  selected: number;
  queued: number;
  duplicate: number;
  excluded_people: string[];
}> {
  return write("/api/v1/org/comms/send", "/api/v1/org/comms/send", input, "POST", { "Idempotency-Key": idempotencyKey });
}

export function exportPeople(filters: PeopleFilters): Promise<string> {
  return apiFetch(`${PEOPLE_ROUTE}?${peopleQuery(filters, 1, 1)}&format=csv`, {
    route: PEOPLE_ROUTE,
    responseType: "text",
  });
}

export function importPeople(input: {
  csv: string;
  filename?: string;
  /** A conference id or slug: everyone in the file is recorded as attending it. */
  event?: string;
  /** Seat everyone in the file on that conference's roster, as a speaker. */
  roster?: boolean;
}): Promise<PeopleImportResult> {
  return write("/api/v1/org/imports", "/api/v1/org/imports", input);
}

export function undoImportedPeople(importId: string): Promise<PeopleImportUndoResult> {
  return write(
    `/api/v1/org/imports/${encodeURIComponent(importId)}/undo`,
    "/api/v1/org/imports/{importId}/undo",
    {},
  );
}

export function createPerson(input: { name: string; email: string; title?: string; company?: string }): Promise<{ person: Person }> {
  return write(PEOPLE_ROUTE, PEOPLE_ROUTE, input);
}

/** A date an organizer reads, not a timestamp an engineer reads. */
export function formatDay(value: number | null): string {
  if (value === null) return "—";
  return new Date(value).toISOString().slice(0, 10);
}

export function formatMoment(value: number): string {
  const stamp = new Date(value).toISOString();
  return `${stamp.slice(0, 10)} ${stamp.slice(11, 16)}`;
}
