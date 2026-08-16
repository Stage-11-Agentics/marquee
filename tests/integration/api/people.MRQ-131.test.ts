import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../../src/index";
import { applyMigrations, env } from "../apply-migrations";

/**
 * People — the org-level record, its Lists, and the sourcing pipeline.
 *
 * One Worker-backed file on purpose: each of these costs about nineteen seconds
 * of a forty-five-second suite budget, so the whole area is proven here rather
 * than in six files that each pay the same toll.
 *
 * The thing every test below is really checking is the same thing: that what
 * the screen says happened happened ON THE SERVER. Run 1 shipped a "Draft saved
 * locally · just now" indicator over a write that never left the browser, and
 * every read here is a fresh request for exactly that reason.
 */

const NOW = Date.UTC(2026, 7, 12, 9, 0, 0);
// Business data is anchored to the fixed NOW on purpose — deterministic fixtures.
// A session's expiry is not business data: the Worker checks it against the real
// clock, so anchoring it to NOW gave this file a 24-hour shelf life and it began
// failing every run the day after that date. Validity is measured from now.
const SESSION_EXPIRES_AT = Date.now() + 86_400_000;
const ORG_ID = "org_mrq131";
const OTHER_ORG_ID = "org_mrq131_other";
const EVENT_ID = "evt_mrq131";
const TARGET_EVENT_ID = "evt_mrq205_target";
const ORIGIN = "https://marquee.stage11.dev";
const ORGANIZER = "per_mrq131_organizer";
const AUTH_SESSION = "sess_mrq131";
const SPEAKER = "per_mrq131_speaker";
const SUBMITTER = "per_mrq131_submitter";
const OUTSIDER = "per_mrq131_outsider";
const SHELL = `<!doctype html><html><head><title>Marquee</title></head><body><div id="app"></div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;

function runtimeEnv(): Env {
  return {
    ...env,
    ASSETS: assets,
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    UPLOAD_TOKEN_SECRET: "mrq131-upload-token-secret",
    UPLOAD_RATE_LIMIT_SECRET: "mrq131-upload-rate-secret",
  } as unknown as Env;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set("cookie", `mq_session=${AUTH_SESSION}`);
  return app.request(`${ORIGIN}${path}`, { ...init, headers }, runtimeEnv());
}

async function json<Result>(path: string, init: RequestInit = {}): Promise<Result> {
  const response = await request(path, init);
  expect(response.status, `${path} → ${response.status}: ${await response.clone().text()}`).toBeLessThan(400);
  return await response.json() as Result;
}

function post(path: string, body: unknown): Promise<Response> {
  return request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function person(id: string, name: string, email: string, company: string, title: string, orgId = ORG_ID): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, custom_fields, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'A biography', '[]', '{}', 0, ?, ?)`,
  ).bind(id, orgId, email, name, title, company, NOW, NOW);
}

interface PeopleEnvelope {
  data: Array<{ id: string; name: string; tags: string[]; stage: string | null; company: string | null }>;
  total: number;
  total_pages: number;
  page: number;
  facets: { company: Array<{ value: string; count: number }>; title: Array<{ value: string; count: number }>; tag: Array<{ value: string; count: number }> };
}

const people = (query = ""): Promise<PeopleEnvelope> => json<PeopleEnvelope>(`/api/v1/org/people${query}`);

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "DevFlow", "devflow", NOW, NOW),
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(OTHER_ORG_ID, "Somebody Else", "somebody-else", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'DevFlow Conf 2027', 'devflow-2027', 'Ship it', '2027-05-12', '2027-05-14', 'America/Los_Angeles', 'Moscone West', '#0b6a72', 'live', 0, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, NOW, NOW),
    person(ORGANIZER, "Jordan Alvarez", "jordan@example.com", "DevFlow", "Program lead"),
    person(SPEAKER, "Priya Raman", "priya@example.com", "Latticework Systems", "Principal Engineer"),
    person(SUBMITTER, "Marcus Okafor", "marcus@example.com", "Northwind Data", "Staff Engineer"),
    person(OUTSIDER, "Someone Elsewhere", "elsewhere@example.com", "Elsewhere", "Director", OTHER_ORG_ID),
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq131', ?, ?, ?, 'owner', ?, ?)")
      .bind(ORG_ID, ORGANIZER, EVENT_ID, NOW, NOW),
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)")
      .bind(AUTH_SESSION, ORGANIZER, SESSION_EXPIRES_AT, NOW, NOW),
  ]);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, origin, submitter_person_id, search_blob, created_at, updated_at)
      VALUES ('sub_mrq131', ?, 'session', 'Why your CI is slow', 'An abstract', 'accepted', 'public', ?, 'ci', ?, ?)`)
      .bind(EVENT_ID, SPEAKER, NOW, NOW),
    env.DB.prepare(`INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
      VALUES ('par_mrq131', 'sub_mrq131', ?, 'speaker', 0, 'pending', ?, ?)`).bind(SPEAKER, NOW, NOW),
  ]);
});

test("CONTRACT · MRQ-131 · CRM-01 · People is the organization's list, not one conference's", async () => {
  const envelope = await people();
  const names = envelope.data.map((row) => row.name);
  // The submitter never spoke anywhere and is still here: this list is not a
  // roster with the word "People" written on it.
  expect(names).toContain("Priya Raman");
  expect(names).toContain("Marcus Okafor");
  // Another organization's person is not this organization's business.
  expect(names).not.toContain("Someone Elsewhere");
  expect(envelope.total).toBe(3);
});

test("CONTRACT · MRQ-131 · CRM-01 · search narrows on the server and clearing restores everyone", async () => {
  const narrowed = await people("?q=priya");
  expect(narrowed.data.map((row) => row.name)).toEqual(["Priya Raman"]);
  expect(narrowed.total).toBe(1);
  expect((await people()).total).toBe(3);
  // Search covers the fields an organizer actually types.
  expect((await people("?q=Northwind")).data.map((row) => row.name)).toEqual(["Marcus Okafor"]);
});

test("CONTRACT · MRQ-131 · CRM-02 · an attribute filter narrows consistently and clears", async () => {
  const filtered = await people(`?company=${encodeURIComponent("Latticework Systems")}`);
  expect(filtered.total).toBe(1);
  expect(filtered.data[0]?.name).toBe("Priya Raman");
  // The panel keeps this facet open so the organizer can switch values without
  // clearing the chip; its UI labels these as available-value counts rather
  // than pretending Northwind is in the visible Latticework result.
  expect(filtered.facets.company.map((facet) => facet.value)).toContain("Northwind Data");
  expect((await people()).total).toBe(3);
});

test("CONTRACT · MRQ-131 · R7 · paging is server-side and the total is the whole set", async () => {
  const firstPage = await people("?per_page=2&page=1");
  expect(firstPage.data).toHaveLength(2);
  expect(firstPage.total).toBe(3);
  expect(firstPage.total_pages).toBe(2);
  const secondPage = await people("?per_page=2&page=2");
  expect(secondPage.data).toHaveLength(1);
  expect(secondPage.total).toBe(3);
  // No overlap: a page boundary that repeats a row is a page boundary that lies.
  const ids = new Set([...firstPage.data, ...secondPage.data].map((row) => row.id));
  expect(ids.size).toBe(3);
});

test("CONTRACT · MRQ-131 · CRM-03 · a note survives a reload, because it was written to the server", async () => {
  const created = await post(`/api/v1/org/people/${SPEAKER}/notes`, {
    body: "Confirmed the keynote slot on a call — hold Thursday morning.",
  });
  expect(created.status).toBe(201);

  // A completely fresh request, the way a reload is.
  const record = await json<{ notes: Array<{ body: string; actor_name: string | null }>; activity: Array<{ summary: string }> }>(
    `/api/v1/org/people/${SPEAKER}`,
  );
  expect(record.notes.map((note) => note.body)).toEqual([
    "Confirmed the keynote slot on a call — hold Thursday morning.",
  ]);
  expect(record.notes[0]?.actor_name).toBe("Jordan Alvarez");
  // The log is the activity feed; the note is in it without a second write.
  expect(record.activity.some((entry) => entry.summary === "Note added")).toBe(true);
});

test("CONTRACT · MRQ-131 · CRM-04 · a tag persists, filters the list, and can be taken off again", async () => {
  expect((await post(`/api/v1/org/people/${SPEAKER}/tags`, { tag: "Keynote" })).status).toBe(200);

  const record = await json<{ person: { tags: string[] } }>(`/api/v1/org/people/${SPEAKER}`);
  expect(record.person.tags).toEqual(["Keynote"]);

  const tagged = await people("?tag=Keynote");
  expect(tagged.data.map((row) => row.name)).toEqual(["Priya Raman"]);
  expect(tagged.facets.tag.map((facet) => facet.value)).toContain("Keynote");

  const removed = await request(`/api/v1/org/people/${SPEAKER}/tags/Keynote`, { method: "DELETE" });
  expect(removed.status).toBe(200);
  expect((await people("?tag=Keynote")).total).toBe(0);
  // Removal is an append, so the log still records that the tag was there.
  const after = await json<{ activity: Array<{ summary: string }> }>(`/api/v1/org/people/${SPEAKER}`);
  expect(after.activity.some((entry) => entry.summary.includes("Tag added"))).toBe(true);
  expect(after.activity.some((entry) => entry.summary.includes("Tag removed"))).toBe(true);
});

test("CONTRACT · MRQ-131 · CRM-03 · connections span conferences and come from participations", async () => {
  const record = await json<{ connections: Array<{ title: string; event_name: string; role: string }> }>(
    `/api/v1/org/people/${SPEAKER}`,
  );
  expect(record.connections).toHaveLength(1);
  expect(record.connections[0]?.title).toBe("Why your CI is slow");
  expect(record.connections[0]?.event_name).toBe("DevFlow Conf 2027");
  expect(record.connections[0]?.role).toBe("speaker");
});

test("CONTRACT · MRQ-131 · CRM-07/08 · a stage move survives a reload and the history is the log", async () => {
  expect((await post(`/api/v1/org/people/${SUBMITTER}/stage`, {
    stage: "identified",
    score: 85,
    rationale: "Strong platform track record.",
  })).status).toBe(200);
  expect((await post(`/api/v1/org/people/${SUBMITTER}/stage`, { stage: "contacted" })).status).toBe(200);

  const board = await json<{ stages: Array<{ id: string; kind: string }>; cards: Array<{ person_id: string; stage: string; score: number | null; rationale: string | null }> }>(
    "/api/v1/org/pipeline",
  );
  expect(board.stages).toHaveLength(6);
  expect(board.stages.some((stage) => stage.kind === "won")).toBe(true);
  expect(board.stages.some((stage) => stage.kind === "lost")).toBe(true);

  const card = board.cards.find((entry) => entry.person_id === SUBMITTER);
  expect(card?.stage).toBe("contacted");
  // A move states where, not why — so the rationale carries forward.
  expect(card?.score).toBe(85);
  expect(card?.rationale).toBe("Strong platform track record.");

  const record = await json<{ stage_history: Array<{ stage: string }> }>(`/api/v1/org/people/${SUBMITTER}`);
  expect(record.stage_history.map((entry) => entry.stage)).toEqual(["identified", "contacted"]);
  // And the board is filterable from People by the same stage.
  expect((await people("?stage=contacted")).data.map((row) => row.name)).toEqual(["Marcus Okafor"]);
});

test("CONTRACT · MRQ-205 · Outreach targets round-trip, legacy cards stay nullable, and DNC names exclusions", async () => {
  await env.DB.prepare(`INSERT INTO events
    (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
    VALUES (?, ?, 'AIE NYC 2026', 'aie-nyc-2026', 'A stage for practical ideas', '2026-10-19', '2026-10-21', 'America/New_York', 'Javits Center', '#635bff', 'draft', 0, ?, ?)`)
    .bind(TARGET_EVENT_ID, ORG_ID, NOW, NOW)
    .run();

  const moved = await post(`/api/v1/org/people/${SUBMITTER}/stage`, {
    stage: "contacted",
    target_event_id: TARGET_EVENT_ID,
    next_touch_on: "2026-08-11",
  });
  expect(moved.status).toBe(200);
  const movedBody = await moved.json() as {
    card: { target_event_id: string | null; next_touch_on: string | null };
  };
  expect(movedBody.card).toMatchObject({ target_event_id: TARGET_EVENT_ID, next_touch_on: "2026-08-11" });

  const board = await json<{
    cards: Array<{
      person_id: string;
      target_event_id: string | null;
      target_event_name: string | null;
      next_touch_on: string | null;
    }>;
    target_events: Array<{ id: string; name: string }>;
  }>("/api/v1/org/pipeline");
  const targeted = board.cards.find((card) => card.person_id === SUBMITTER)!;
  expect(targeted).toMatchObject({
    target_event_id: TARGET_EVENT_ID,
    target_event_name: "AIE NYC 2026",
    next_touch_on: "2026-08-11",
  });
  expect(board.target_events.map((event) => event.name)).toEqual(["AIE NYC 2026", "DevFlow Conf 2027"]);

  const record = await json<{
    person: { outreach_target_event_id: string | null; outreach_target_event_name: string | null; outreach_next_touch_on: string | null };
    card: { target_event_id: string | null; target_event_name?: string | null; next_touch_on: string | null } | null;
    target_events: Array<{ id: string; name: string }>;
  }>(`/api/v1/org/people/${SUBMITTER}`);
  expect(record.person).toMatchObject({
    outreach_target_event_id: TARGET_EVENT_ID,
    outreach_target_event_name: "AIE NYC 2026",
    outreach_next_touch_on: "2026-08-11",
  });
  expect(record.card).toMatchObject({ target_event_id: TARGET_EVENT_ID, target_event_name: "AIE NYC 2026" });
  expect(record.target_events).toHaveLength(2);

  // A pre-MRQ-205 stage row has no target and remains readable as a legacy card.
  await env.DB.prepare(`INSERT INTO person_events
    (id, org_id, person_id, kind, value_json, actor_person_id, created_at)
    VALUES ('pev_mrq205_legacy', ?, ?, 'stage', '{"stage":"identified"}', NULL, ?)`)
    .bind(ORG_ID, SPEAKER, NOW)
    .run();
  const legacy = await json<{ card: { target_event_id: string | null; next_touch_on: string | null } | null }>(`/api/v1/org/people/${SPEAKER}`);
  expect(legacy.card).toEqual(expect.objectContaining({ target_event_id: null, next_touch_on: null }));

  await json<{ person: unknown }>(`/api/v1/org/people/${SPEAKER}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ do_not_contact: true }),
  });
  const preview = await json<{ recipients: number; excluded_people: string[] }>("/api/v1/org/comms/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ person_ids: [SPEAKER, SUBMITTER], subject: "Hello", body: "Hi there" }),
  });
  expect(preview).toMatchObject({ recipients: 1, excluded_people: ["Priya Raman"] });
  const send = await json<{ selected: number; queued: number; excluded_people: string[] }>("/api/v1/org/comms/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ person_ids: [SPEAKER, SUBMITTER], subject: "Hello", body: "Hi there" }),
  });
  expect(send).toMatchObject({ selected: 1, queued: 1, excluded_people: ["Priya Raman"] });
  const recipients = await env.DB.prepare("SELECT person_id FROM outbox WHERE subject = 'Hello'").all<{ person_id: string }>();
  expect(recipients.results.map((row) => row.person_id)).toEqual([SUBMITTER]);
});

test("CONTRACT · MRQ-131 · CRM-09 · both kinds of List save and resolve as metadata", async () => {
  await post(`/api/v1/org/people/${SPEAKER}/tags`, { tag: "Keynote" });

  const live = await post("/api/v1/org/lists", { name: "Keynote shortlist", kind: "live", config: { q: "", tag: "Keynote" } });
  expect(live.status).toBe(201);
  const fixed = await post("/api/v1/org/lists", { name: "2026 chairs", kind: "fixed", person_ids: [SPEAKER, SUBMITTER, OUTSIDER] });
  expect(fixed.status).toBe(201);

  const saved = await json<{ data: Array<{ id: string; name: string; kind: string; member_count: number }> }>("/api/v1/org/lists");
  const liveList = saved.data.find((entry) => entry.name === "Keynote shortlist")!;
  const fixedList = saved.data.find((entry) => entry.name === "2026 chairs")!;
  expect(liveList.kind).toBe("live");
  // A live list counts its own filter, not whatever was on screen when it saved.
  expect(liveList.member_count).toBe(1);
  // The outsider belongs to another organization and cannot be smuggled in.
  expect(fixedList.member_count).toBe(2);

  // A stray cross-org membership row must not make the metadata count disagree
  // with the org-scoped People projection.
  await env.DB
    .prepare("INSERT INTO person_list_members (list_id, person_id, created_at) VALUES (?, ?, ?)")
    .bind(fixedList.id, OUTSIDER, NOW)
    .run();
  const indexedAfterStray = await json<{ data: Array<{ id: string; member_count: number }> }>('/api/v1/org/lists');
  expect(indexedAfterStray.data.find((entry) => entry.id === fixedList.id)?.member_count).toBe(2);

  const opened = await json<{ list: { id: string; name: string; kind: string; member_count: number; created_by_name: string | null; created_at: number }; members?: unknown }>(`/api/v1/org/lists/${fixedList.id}`);
  expect(opened.list).toMatchObject({ id: fixedList.id, name: "2026 chairs", kind: "fixed", member_count: 2 });
  expect(Object.keys(opened.list).sort()).toEqual(["created_at", "created_by_name", "id", "kind", "member_count", "name"]);
  expect(opened.list.created_by_name).toBe("Jordan Alvarez");
  expect(opened.list.created_at).toEqual(expect.any(Number));
  expect(opened).not.toHaveProperty("members");

  // A live list keeps up: tag someone else and they join it without an edit.
  await post(`/api/v1/org/people/${SUBMITTER}/tags`, { tag: "Keynote" });
  const reopened = await json<{ list: { member_count: number }; members?: unknown }>(`/api/v1/org/lists/${liveList.id}`);
  expect(reopened.list.member_count).toBe(2);
  expect(reopened).not.toHaveProperty("members");

  expect((await request(`/api/v1/org/lists/${fixedList.id}`, { method: "DELETE" })).status).toBe(200);
  // Deleting a list never deletes people.
  expect((await people()).total).toBe(3);
});

test("CONTRACT · MRQ-131 · CRM-09 · opening a List from People resolves BOTH kinds, not just Fixed", async () => {
  // The untested arm. `openList` resolved a Live list through its saved filter,
  // but `GET /org/people?list_id=` only ever looked in `person_list_members` —
  // and a Live list has no rows there, by design. So opening one showed an
  // empty table beneath a band naming a real count: two definitions of the same
  // list, one per screen. Live is also the DEFAULT kind when nothing is ticked,
  // so this was the common path, not the corner.
  await post(`/api/v1/org/people/${SPEAKER}/tags`, { tag: "Keynote" });
  const live = await post("/api/v1/org/lists", { name: "Keynote shortlist", kind: "live", config: { q: "", tag: "Keynote" } });
  const fixed = await post("/api/v1/org/lists", { name: "2026 chairs", kind: "fixed", person_ids: [SPEAKER, SUBMITTER] });
  const liveId = ((await live.json()) as { list: { id: string } }).list.id;
  const fixedId = ((await fixed.json()) as { list: { id: string } }).list.id;

  expect((await people(`?list_id=${liveId}`)).data.map((row) => row.name)).toEqual(["Priya Raman"]);
  expect((await people(`?list_id=${fixedId}`)).data.map((row) => row.name).sort()).toEqual(["Marcus Okafor", "Priya Raman"]);

  // The count the band prints and the rows the table draws come from the same
  // definition, so they cannot disagree.
  const saved = await json<{ data: Array<{ id: string; member_count: number }> }>("/api/v1/org/lists");
  expect(saved.data.find((entry) => entry.id === liveId)?.member_count).toBe((await people(`?list_id=${liveId}`)).total);

  // A Live list keeps up here too: tag someone else and the table grows.
  await post(`/api/v1/org/people/${SUBMITTER}/tags`, { tag: "Keynote" });
  expect((await people(`?list_id=${liveId}`)).total).toBe(2);

  // A chip set alongside the list narrows further rather than widening.
  const narrowed = `?list_id=${liveId}&company=${encodeURIComponent("Latticework Systems")}`;
  expect((await people(narrowed)).data.map((row) => row.name)).toEqual(["Priya Raman"]);

  // And a chip naming a field the SAVED FILTER ALSO names must still narrow.
  // This is the arm that broke: a Live list merged in as filters gave one value
  // per key, so the caller's value REPLACED the list's own predicate and
  // returned people who are not in the list — under a band still naming it.
  // `q` is the dangerous one: the search box sits directly above the band.
  const shortlist = await post("/api/v1/org/lists", { name: "Priya only", kind: "live", config: { q: "priya" } });
  const shortlistId = ((await shortlist.json()) as { list: { id: string } }).list.id;
  expect((await people(`?list_id=${shortlistId}`)).data.map((row) => row.name)).toEqual(["Priya Raman"]);
  // Marcus is NOT in that list. Searching his name inside it must find nobody,
  // not leave the list behind and find him in the whole organization.
  expect((await people(`?list_id=${shortlistId}&q=marcus`)).data.map((row) => row.name)).toEqual([]);
  // Same for a tag the list does not carry.
  expect((await people(`?list_id=${shortlistId}&tag=Keynote`)).data.map((row) => row.name)).toEqual(["Priya Raman"]);
  // The identical gesture against a Fixed list always narrowed correctly; both
  // kinds now answer it the same way, which is what an organizer assumes.
  expect((await people(`?list_id=${fixedId}&q=marcus`)).data.map((row) => row.name)).toEqual(["Marcus Okafor"]);
  expect((await people(`?list_id=${fixedId}&q=nobody`)).data.map((row) => row.name)).toEqual([]);

  // An id this organization does not own is not visible. Returning 200 with
  // zero rows would blur a missing/borrowed List into an owned empty one.
  expect((await request("/api/v1/org/people?list_id=lst_not_ours"))).toHaveProperty("status", 404);

  // A borrowed row must not change that answer. Here is a list owned by another
  // organization holding a membership row that names one of OUR people — the
  // exact row a bulk import or merge tool could write without thinking about
  // orgs. The route checks the owning List before it evaluates membership.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO person_lists (id, org_id, name, kind, config_json, created_by, created_at, updated_at)
      VALUES ('lst_alien', ?, 'Theirs', 'fixed', '{"q":""}', NULL, ?, ?)`).bind(OTHER_ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO person_list_members (list_id, person_id, created_at) VALUES ('lst_alien', ?, ?)")
      .bind(SPEAKER, NOW),
  ]);
  expect((await request("/api/v1/org/people?list_id=lst_alien"))).toHaveProperty("status", 404);
});

test("CONTRACT · MRQ-200 · every saved Live filter dimension keeps count parity", async () => {
  await post(`/api/v1/org/people/${SPEAKER}/tags`, { tag: "Keynote" });
  await post(`/api/v1/org/people/${SUBMITTER}/stage`, { stage: "contacted" });

  const cases = [
    { name: "query", config: { q: "priya" }, expected: ["Priya Raman"] },
    { name: "company", config: { company: "Latticework Systems" }, expected: ["Priya Raman"] },
    { name: "title", config: { title: "Principal Engineer" }, expected: ["Priya Raman"] },
    { name: "tag", config: { tag: "Keynote" }, expected: ["Priya Raman"] },
    { name: "stage", config: { stage: "contacted" }, expected: ["Marcus Okafor"] },
  ] as const;

  for (const entry of cases) {
    const created = await post(`/api/v1/org/lists`, { name: `Parity ${entry.name}`, kind: "live", config: entry.config });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { list: { id: string; member_count: number } };
    const peopleRows = await people(`?list_id=${createdBody.list.id}`);
    const opened = await json<{ list: { member_count: number } }>(`/api/v1/org/lists/${createdBody.list.id}`);

    expect(peopleRows.data.map((row) => row.name)).toEqual(entry.expected);
    expect(createdBody.list.member_count).toBe(entry.expected.length);
    expect(opened.list.member_count).toBe(entry.expected.length);
  }
});

test("CONTRACT · MRQ-200 · an unknown list id is not an empty list", async () => {
  const emptyCreated = await post("/api/v1/org/lists", { name: "Empty here", kind: "fixed", person_ids: [OUTSIDER] });
  const emptyId = ((await emptyCreated.json()) as { list: { id: string } }).list.id;
  expect((await json<{ total: number }>(`/api/v1/org/people?list_id=${emptyId}`)).total).toBe(0);
  expect((await request("/api/v1/org/people?list_id=lst_unknown"))).toHaveProperty("status", 404);
});

test("CONTRACT · MRQ-200 · list-scoped facet counts describe the visible population", async () => {
  const created = await post("/api/v1/org/lists", { name: "One person", kind: "fixed", person_ids: [SPEAKER] });
  const listId = ((await created.json()) as { list: { id: string } }).list.id;
  const scoped = await people(`?list_id=${listId}`);
  expect(scoped.facets.company).toEqual([{ value: "Latticework Systems", count: 1 }]);
});

test("CONTRACT · MRQ-200 · search-scoped facet counts describe the visible population", async () => {
  const searched = await people("?q=priya");
  expect(searched.facets.company).toEqual([{ value: "Latticework Systems", count: 1 }]);
});

test("CONTRACT · MRQ-200 · list, search, and chip facets share one visible population", async () => {
  await post(`/api/v1/org/people/${SPEAKER}/tags`, { tag: "Keynote" });
  const created = await post("/api/v1/org/lists", { name: "Two people", kind: "fixed", person_ids: [SPEAKER, SUBMITTER] });
  const listId = ((await created.json()) as { list: { id: string } }).list.id;
  const scoped = await people(`?list_id=${listId}&q=priya&tag=Keynote`);
  expect(scoped.facets.company).toEqual([{ value: "Latticework Systems", count: 1 }]);
  expect(scoped.facets.title).toEqual([{ value: "Principal Engineer", count: 1 }]);
  expect(scoped.facets.tag).toEqual([{ value: "Keynote", count: 1 }]);
});

test("CONTRACT · MRQ-200 · an active facet chip labels available-value counts", async () => {
  const created = await post("/api/v1/org/lists", { name: "Company slice", kind: "fixed", person_ids: [SPEAKER, SUBMITTER] });
  const listId = ((await created.json()) as { list: { id: string } }).list.id;
  const scoped = await people(`?list_id=${listId}&company=${encodeURIComponent("Northwind Data")}`);
  expect(scoped.data.map((row) => row.name)).toEqual(["Marcus Okafor"]);
  expect(scoped.facets.company).toEqual([
    { value: "Latticework Systems", count: 1 },
    { value: "Northwind Data", count: 1 },
  ]);
});

test("CONTRACT · MRQ-131 · CRM-11 · a bulk send from People is logged per recipient in the outbox", async () => {
  const sent = await post("/api/v1/org/comms/send", {
    person_ids: [SPEAKER, SUBMITTER],
    subject: "Speak at DevFlow Conf 2027?",
    body: "Hi {{speaker.first_name}}, would you submit a talk?",
  });
  expect(sent.status).toBe(202);
  const result = await sent.json() as { selected: number; queued: number };
  expect(result.selected).toBe(2);
  expect(result.queued).toBe(2);

  const logged = await env.DB
    .prepare("SELECT person_id, subject FROM outbox WHERE person_id IN (?, ?) ORDER BY person_id")
    .bind(SPEAKER, SUBMITTER)
    .all<{ person_id: string; subject: string }>();
  expect(logged.results).toHaveLength(2);
  expect(logged.results[0]?.subject).toBe("Speak at DevFlow Conf 2027?");

  // The preview shows recipient 1 with their merge tags actually resolved.
  const preview = await json<{ to_email: string; text: string }>("/api/v1/org/comms/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ person_ids: [SPEAKER], subject: "Hello {{speaker.first_name}}", body: "Hi {{speaker.first_name}}." }),
  });
  expect(preview.to_email).toBe("priya@example.com");
  expect(preview.text).toContain("Priya");
});

test("CONTRACT · MRQ-226 · an org nudge retries by compose id but a new nudge sends again", async () => {
  const body = {
    person_ids: [SPEAKER],
    subject: "MRQ-226 nudge",
    body: "A fresh note for {{speaker.first_name}}",
  };
  const first = await request("/api/v1/org/comms/send", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "mrq226-org-compose-1" },
    body: JSON.stringify(body),
  });
  expect(first.status).toBe(202);
  const firstBody = await first.json();
  expect(firstBody).toMatchObject({ selected: 1, queued: 1, duplicate: 0 });

  const retry = await request("/api/v1/org/comms/send", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "mrq226-org-compose-1" },
    body: JSON.stringify(body),
  });
  expect(retry.status).toBe(202);
  expect(await retry.json()).toEqual(firstBody);

  const newNudge = await request("/api/v1/org/comms/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(newNudge.status).toBe(202);
  expect(await newNudge.json()).toMatchObject({ selected: 1, queued: 1, duplicate: 0 });

  const rows = await env.DB.prepare("SELECT COUNT(*) AS total FROM outbox WHERE subject = 'MRQ-226 nudge' AND person_id = ?")
    .bind(SPEAKER)
    .first<{ total: number }>();
  expect(rows?.total).toBe(2);
});

test("CONTRACT · MRQ-237 · organization communication with no valid address is an honest keyed no-op", async () => {
  await env.DB.prepare("UPDATE people SET email = '' WHERE id = ? AND org_id = ?").bind(SPEAKER, ORG_ID).run();
  const input = { person_ids: [SPEAKER], subject: "MRQ-237 no address", body: "Hello {{speaker.first_name}}" };
  const headers = { "content-type": "application/json", "Idempotency-Key": "mrq237-org-no-address" };
  const first = await request("/api/v1/org/comms/send", { method: "POST", headers, body: JSON.stringify(input) });
  expect(first.status).toBe(202);
  const firstBody = await first.json<{ selected: number; queued: number; outbox_ids: string[]; operation: { effect: string; reason_code: string; notice: string } }>();
  expect(firstBody).toMatchObject({
    selected: 1,
    queued: 0,
    outbox_ids: [],
    operation: { effect: "no_op", reason_code: "NO_VALID_RECIPIENT", notice: expect.stringContaining("no selected person") },
  });
  const replay = await request("/api/v1/org/comms/send", { method: "POST", headers, body: JSON.stringify(input) });
  expect(replay.status).toBe(202);
  expect(await replay.json()).toEqual(firstBody);
  expect(await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM request_operations WHERE organization_id = ? AND route = 'org.comms.send'",
  ).bind(ORG_ID).first<{ count: number }>()).toEqual({ count: 1 });
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE event_id = ?").bind(EVENT_ID).first<{ count: number }>()).toEqual({ count: 0 });
});

test("CONTRACT · MRQ-131 · CRM-05 · a CSV import creates, updates, and reports what it could not map", async () => {
  const csv = [
    "Full Name,Email Address,Company,Job Title,Twitter",
    "Dana Kowalski,dana@example.com,Corvid Labs,Director of DevRel,@dana",
    "Priya Raman,PRIYA@example.com,Latticework Systems,Distinguished Engineer,@priya",
    ",broken@example.com,Nowhere,Nobody,",
  ].join("\n");
  const response = await post("/api/v1/org/imports", { csv, filename: "speakers.csv" });
  expect(response.status).toBe(202);
  const result = await response.json() as { created: number; updated: number; skipped: number; unmapped: string[] };
  expect(result.created).toBe(1);
  // Matched on email, case-insensitively: Priya is updated, never duplicated.
  expect(result.updated).toBe(1);
  expect(result.skipped).toBe(1);
  expect(result.unmapped).toEqual(["Twitter"]);

  const after = await people();
  expect(after.total).toBe(4);
  expect(after.data.filter((row) => row.name === "Priya Raman")).toHaveLength(1);
  const priya = await json<{ person: { title: string | null } }>(`/api/v1/org/people/${SPEAKER}`);
  expect(priya.person.title).toBe("Distinguished Engineer");
});

test("CONTRACT · MRQ-131 · CRM-12 · the header's counts agree with the list underneath it", async () => {
  await post(`/api/v1/org/people/${SUBMITTER}/stage`, { stage: "identified" });
  const summary = await json<{ people: number; conferences: number; in_pipeline: number; top_companies: Array<{ value: string; count: number }> }>(
    "/api/v1/org/summary",
  );
  expect(summary.people).toBe((await people()).total);
  expect(summary.conferences).toBe(1);
  expect(summary.in_pipeline).toBe(1);
  expect(summary.top_companies.length).toBeGreaterThan(0);
});

test("CONTRACT · MRQ-131 · one query, two entrances: event_id narrows People to the roster", async () => {
  const everyone = await people();
  const roster = await people(`?event_id=${EVENT_ID}`);
  expect(everyone.total).toBe(3);
  // Only the accepted speaker is on this conference's roster.
  expect(roster.data.map((row) => row.name)).toEqual(["Priya Raman"]);

  // And the conference's own roster endpoint agrees, because it is the same query.
  const conferenceRoster = await json<{ data: Array<{ name: string }> }>(`/api/v1/events/${EVENT_ID}/speakers`);
  expect(conferenceRoster.data.map((row) => row.name)).toEqual(roster.data.map((row) => row.name));
});

test("CONTRACT · MRQ-131 · People is organizer staff only, and never leaks another organization", async () => {
  const anonymous = await app.request(`${ORIGIN}/api/v1/org/people`, {}, runtimeEnv());
  expect(anonymous.status).toBe(401);
  // A person in another organization is not addressable, not readable, and not
  // taggable from here.
  expect((await request(`/api/v1/org/people/${OUTSIDER}`)).status).toBe(404);
  expect((await post(`/api/v1/org/people/${OUTSIDER}/notes`, { body: "no" })).status).toBe(404);
});
