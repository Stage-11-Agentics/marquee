import assert from "node:assert/strict";

import { buildSeedRows } from "../seed/index.ts";
import { EVENT_ID, FROZEN_NOW, STAFF_PERSON_ID } from "../seed/event.ts";
import { ORGANIZER_UNREVIEWED_ASSIGNMENTS, ROUND_ONE_ID } from "../seed/evaluations.ts";
import { withLocalRuntime, type LocalRuntime } from "./local-runtime.ts";

export const DEMO_EVENT_ID = EVENT_ID;
const PAGE_SIZE = 100;

export interface JsonResponse<T = any> {
  response: Response;
  body: T;
  elapsedMs: number;
}

/** Small cookie-aware client for the same public API the demo UI consumes. */
export class ApiClient {
  readonly baseUrl: string;
  private cookie: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  get sessionCookie(): string | null {
    return this.cookie;
  }

  async login(role: "organizer" | "speaker" = "organizer"): Promise<{ event_id: string; person: { id: string; name: string } }> {
    const result = await this.json<{ ok: true; event_id: string; person: { id: string; name: string } }>("/api/v1/auth/demo", {
      method: "POST",
      body: JSON.stringify({ role }),
    });
    return result.body;
  }

  async json<T = any>(path: string, init: RequestInit = {}): Promise<JsonResponse<T>> {
    const startedAt = performance.now();
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (this.cookie) headers.set("cookie", this.cookie);
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const setCookie = response.headers.get("set-cookie");
    const match = setCookie?.match(/(?:^|,\s*)mq_session=([^;]+)/);
    if (match) this.cookie = `mq_session=${match[1]}`;
    const text = await response.text();
    let body: T;
    try {
      body = text ? JSON.parse(text) as T : undefined as T;
    } catch {
      throw new Error(`expected JSON from ${path}, got HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    if (!response.ok) {
      const message = typeof body === "object" && body !== null && "error" in body
        ? JSON.stringify((body as { error: unknown }).error)
        : text.slice(0, 500);
      throw new Error(`${init.method ?? "GET"} ${path} returned HTTP ${response.status}: ${message}`);
    }
    return { response, body, elapsedMs: performance.now() - startedAt };
  }

  async text(path: string, init: RequestInit = {}): Promise<{ response: Response; body: string; elapsedMs: number }> {
    const startedAt = performance.now();
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const body = await response.text();
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} returned HTTP ${response.status}: ${body.slice(0, 500)}`);
    return { response, body, elapsedMs: performance.now() - startedAt };
  }
}

export interface SubmissionListItem {
  id: string;
  title: string;
  status: string;
  speakers: Array<{ id: string; name: string; company: string | null }>;
  tracks: Array<{ id: string; name: string; is_primary: boolean }>;
  [key: string]: unknown;
}

export interface SubmissionListEnvelope {
  data: SubmissionListItem[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export async function fetchAllSubmissions(client: ApiClient, eventId = DEMO_EVENT_ID): Promise<SubmissionListItem[]> {
  const first = await client.json<SubmissionListEnvelope>(
    `/api/v1/events/${encodeURIComponent(eventId)}/submissions?per_page=${PAGE_SIZE}&page=1&sort=updated`,
  );
  const pages = Array.from({ length: Math.max(0, first.body.total_pages - 1) }, (_, index) => index + 2);
  const rest = await Promise.all(pages.map((page) => client.json<SubmissionListEnvelope>(
    `/api/v1/events/${encodeURIComponent(eventId)}/submissions?per_page=${PAGE_SIZE}&page=${page}&sort=updated`,
  )));
  const rows = [first.body, ...rest.map((result) => result.body)].flatMap((page) => page.data);
  assert.equal(rows.length, first.body.total, `public submissions API returned ${rows.length}/${first.body.total} rows`);
  return rows;
}

function seedRowsByTable(rows: Awaited<ReturnType<typeof buildSeedRows>>, tableName: string): Array<Record<string, string | number | null>> {
  return rows.filter((entry) => entry.table === tableName).map((entry) => entry.row);
}

function checkDirectSeedShape(rows: Awaited<ReturnType<typeof buildSeedRows>>): Record<string, number> {
  const submissions = seedRowsByTable(rows, "submissions");
  const memberships = seedRowsByTable(rows, "memberships");
  const speakerMembers = new Set(memberships.filter((row) => row.role === "speaker").map((row) => row.person_id));
  const assignments = seedRowsByTable(rows, "round_assignments").filter((row) => row.round_id === ROUND_ONE_ID && row.reviewer_person_id === STAFF_PERSON_ID);
  const evaluations = new Set(seedRowsByTable(rows, "evaluations").map((row) => `${row.round_id}:${row.submission_id}:${row.reviewer_person_id}`));
  const unreviewed = assignments.filter((row) => !evaluations.has(`${row.round_id}:${row.submission_id}:${row.reviewer_person_id}`));
  const overdueTasks = seedRowsByTable(rows, "speaker_tasks").filter((row) => row.status === "open" && Number(row.due_at) < FROZEN_NOW);
  assert.equal(submissions.length, 1_000, "seed must contain exactly 1,000 submissions");
  assert.equal(submissions.filter((row) => row.status === "accepted").length, 60, "seed must contain 60 accepted submissions");
  assert.ok(speakerMembers.size >= 150, `seed must expose >=150 accepted speaker memberships, found ${speakerMembers.size}`);
  assert.equal(unreviewed.length, ORGANIZER_UNREVIEWED_ASSIGNMENTS, "organizer round-one assignment count drifted");
  assert.ok(overdueTasks.length >= 10, `seed must contain >=10 overdue open tasks, found ${overdueTasks.length}`);
  return {
    submissions: submissions.length,
    accepted_submissions: submissions.filter((row) => row.status === "accepted").length,
    speaker_memberships: speakerMembers.size,
    organizer_unreviewed_assignments: unreviewed.length,
    overdue_tasks: overdueTasks.length,
  };
}

export interface SeedApiEvidence {
  event_id: string;
  submissions: { total: number; pages: number; api_speaker_projections: number };
  statuses: Record<string, number>;
  venues: { buildings: number; rooms: number; pinned_buildings: number; online_unpinned: boolean; access_minutes: number };
  agenda: { sessions: number; formats: number; tracks: number; visible_person_conflicts: number; visible_transit_conflicts: number };
  reviewer_queue: { total: number; unreviewed_candidates: number };
  ugliness: { long_diacritic_names: number; long_titles: number; triple_speaker_submissions: number; four_person_panels: number; overdue_task_preview: number };
  direct_seed: Record<string, number>;
}

/**
 * The API half of check:seed. The wrapper retains the MRQ-62 venue assertions;
 * this function adds the shape/scale and walkthrough assertions beside them.
 */
export async function runSeedApiChecks(runtime: LocalRuntime): Promise<SeedApiEvidence> {
  const client = new ApiClient(runtime.baseUrl);
  const auth = await client.login("organizer");
  assert.equal(auth.event_id, DEMO_EVENT_ID, "demo login must select the seeded event");

  const [rows, venuesResult, agendaResult, dashboardResult, queueResult, formsResult] = await Promise.all([
    fetchAllSubmissions(client),
    client.json<{ buildings: Array<Record<string, any>>; rooms: Array<Record<string, any>> }>(`/api/v1/events/${DEMO_EVENT_ID}/venues`),
    client.json<{ sessions: Array<Record<string, any>>; formats: Array<Record<string, any>>; tracks: Array<Record<string, any>>; conflicts: Array<Record<string, any>> }>(`/api/v1/events/${DEMO_EVENT_ID}/agenda`),
    client.json<{ task_preview: Array<Record<string, any>> }>(`/api/v1/events/${DEMO_EVENT_ID}/dashboard`),
    client.json<{ total: number; data: Array<Record<string, any>> }>(`/api/v1/events/${DEMO_EVENT_ID}/reviewer/queue`),
    client.json<{ data: Array<Record<string, any>> }>(`/api/v1/events/${DEMO_EVENT_ID}/forms?per_page=100`),
  ]);
  const venues = venuesResult.body;
  const agenda = agendaResult.body;
  const dashboard = dashboardResult.body;
  const queue = queueResult.body;
  const forms = formsResult.body;

  assert.ok(rows.length >= 1_000, `public submissions API must expose the full seed, found ${rows.length}`);
  const acceptedResponse = await client.json<SubmissionListEnvelope>(`/api/v1/events/${DEMO_EVENT_ID}/submissions?status=accepted&per_page=1`);
  assert.equal(acceptedResponse.body.total, 60, "public submissions API accepted count drifted");
  assert.ok(venues.buildings.length >= 3, "public venues API must expose the three seeded buildings");
  assert.ok(venues.rooms.length >= 10, "public venues API must expose the full room model");
  const pinnedBuildings = venues.buildings.filter((building) => building.lat !== null && building.lng !== null);
  const online = venues.buildings.find((building) => building.name === "Online");
  assert.ok(pinnedBuildings.length >= 2, "public venues API must expose at least two pinned buildings");
  assert.ok(venues.buildings.some((building) => Number(building.access_minutes) > 0), "public venues API must expose non-zero access minutes");
  assert.ok(online && online.lat === null && online.lng === null, "Online must remain unpinned in the public venues API");
  const sessions = agenda.sessions.filter((session) => session.kind === "session");
  const personConflicts = agenda.conflicts.filter((conflict) => conflict.kind === "person");
  const transitConflicts = agenda.conflicts.filter((conflict) => conflict.kind === "transit");
  assert.ok(sessions.length >= 24, `public agenda API must expose >=24 sessions, found ${sessions.length}`);
  assert.equal(agenda.formats.length, 4, "public agenda API must expose all four seeded formats");
  assert.equal(agenda.tracks.length, 8, "public agenda API must expose all eight seeded tracks");
  assert.ok(personConflicts.length >= 2, `public agenda API must expose >=2 person conflicts, found ${personConflicts.length}`);
  // The venue gate above remains the authoritative Transit assertion. The
  // agenda API currently exposes the live person conflicts but not the
  // geography-derived conflict projection, so do not silently replace that
  // MRQ-62 check with a weaker API assumption.
  assert.ok(queue.total >= 20 && queue.data.length >= 20, `organizer review queue must return >=20 unreviewed candidates, found ${queue.total}`);
  assert.ok(forms.data.some((form) => form.id === "frm_cfp" && form.status === "open"), "public event API must expose the open CFP form");
  assert.ok(dashboard.task_preview.some((task) => Number(task.due_at) < FROZEN_NOW), "dashboard task preview must include an overdue task against the frozen demo clock");

  const names = rows.flatMap((row) => row.speakers.map((speaker) => speaker.name));
  const uniqueSpeakers = new Set(rows.flatMap((row) => row.speakers.map((speaker) => speaker.id)));
  const longNames = new Set(names.filter((name) => name === "Casey O'Connell-Singh" || name === "Mei-Ling de la Fontaine" || /[^\x00-\x7F]/.test(name)));
  const longTitles = rows.filter((row) => row.title.length > 160);
  const caseySubmissions = new Set(rows.filter((row) => row.speakers.some((speaker) => speaker.name === "Casey O'Connell-Singh")).map((row) => row.id));
  const fourPersonPanels = rows.filter((row) => row.speakers.length === 4);
  assert.ok(longNames.size >= 3, "public submissions API must expose the diacritic and long-name fixtures");
  assert.ok(longTitles.length >= 1, "public submissions API must expose a title requiring truncation");
  assert.ok(caseySubmissions.size >= 3, `Casey must appear on >=3 submissions, found ${caseySubmissions.size}`);
  assert.ok(fourPersonPanels.length >= 1, "public submissions API must expose a four-person panel");

  const directRows = await buildSeedRows();
  const directSeed = checkDirectSeedShape(directRows);
  const statuses: Record<string, number> = {};
  for (const row of rows) statuses[row.status] = (statuses[row.status] ?? 0) + 1;
  return {
    event_id: auth.event_id,
    submissions: { total: rows.length, pages: Math.ceil(rows.length / PAGE_SIZE), api_speaker_projections: uniqueSpeakers.size },
    statuses,
    venues: {
      buildings: venues.buildings.length,
      rooms: venues.rooms.length,
      pinned_buildings: pinnedBuildings.length,
      online_unpinned: Boolean(online && online.lat === null && online.lng === null),
      access_minutes: Math.max(...venues.buildings.map((building) => Number(building.access_minutes))),
    },
    agenda: {
      sessions: sessions.length,
      formats: agenda.formats.length,
      tracks: agenda.tracks.length,
      visible_person_conflicts: personConflicts.length,
      visible_transit_conflicts: transitConflicts.length,
    },
    reviewer_queue: { total: queue.total, unreviewed_candidates: queue.data.length },
    ugliness: {
      long_diacritic_names: longNames.size,
      long_titles: longTitles.length,
      triple_speaker_submissions: caseySubmissions.size,
      four_person_panels: fourPersonPanels.length,
      overdue_task_preview: dashboard.task_preview.filter((task) => Number(task.due_at) < FROZEN_NOW).length,
    },
    direct_seed: directSeed,
  };
}

export { withLocalRuntime };
