/**
 * MRQ-164 Part 1 — the round-4 judge's exact scenario, driven through the API.
 *
 * Two time-overlapping sessions in different rooms share one person: primary
 * speaker on the first, `co_speaker` added after intake on the second. The
 * conflicts panel exists to catch precisely this.
 */
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { DEMO_EVENT_ID, DEMO_ORGANIZER_PERSON_ID, demoFixtureRows } from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const SESSION_ID = "sess-cospeaker-conflict";
const COOKIE = `mq_session=${SESSION_ID}`;
const NOW = Date.now();
const START = Date.UTC(2026, 9, 12, 13);

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", COOKIE);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  for (const row of demoFixtureRows(NOW)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  await env.DB.batch([
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'cospeaker-fixture', NULL, ?, ?)").bind(SESSION_ID, DEMO_ORGANIZER_PERSON_ID, NOW + 86_400_000, NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("building-cospeaker", DEMO_EVENT_ID, "North Hall", "1 Conference Way", 0, 40.7625, -73.9814, 5, NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)").bind("room-cospeaker-a", DEMO_EVENT_ID, "building-cospeaker", "Central Park Ballroom", 120, 0, "[]", NOW, NOW),
    env.DB.prepare("INSERT INTO rooms (id, event_id, building_id, name, capacity, position, av_capabilities, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)").bind("room-cospeaker-b", DEMO_EVENT_ID, "building-cospeaker", "New York Ballroom", 120, 1, "[]", NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("format-cospeaker", DEMO_EVENT_ID, "Stage Talk", 45, 15, 90, 0, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("track-cospeaker", DEMO_EVENT_ID, "Agents", "#db4c3f", 0, NOW, NOW),
    // Priya leads the first talk; Marcus leads the second. Marcus joins the
    // first as a co-speaker after intake, which is the judge's scenario.
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, (SELECT org_id FROM events WHERE id = ?), 'priya@mrq164.test', 'Priya Raman', '[]', 1, 'marquee', ?, ?)").bind("person-priya-164", DEMO_EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, is_demo, last_write_source, created_at, updated_at) VALUES (?, (SELECT org_id FROM events WHERE id = ?), 'marcus@mrq164.test', 'Marcus Okafor', '[]', 1, 'marquee', ?, ?)").bind("person-marcus-164", DEMO_EVENT_ID, NOW, NOW),
    ...[
      ["sub-164-ci", "Taming 40-Minute CI", "person-priya-164"],
      ["sub-164-lightning", "Lightning: Agents in Production Q&A", "person-marcus-164"],
    ].map(([id, title, personId]) => env.DB.prepare(`
      INSERT INTO submissions
        (id, event_id, form_id, kind, bypass_evaluation, title, abstract, status, format_id, primary_track_id, origin, submitter_person_id, submitted_at, last_saved_at, is_published, search_blob, last_write_source, created_at, updated_at)
      VALUES (?, ?, NULL, 'abstract', 0, ?, 'MRQ-164 fixture', 'accepted', 'format-cospeaker', 'track-cospeaker', 'admin', ?, ?, ?, 0, ?, 'marquee', ?, ?)
    `).bind(id, DEMO_EVENT_ID, title, personId, NOW, NOW, String(title).toLowerCase(), NOW, NOW)),
    ...[
      ["sub-164-ci", "person-priya-164"],
      ["sub-164-lightning", "person-marcus-164"],
    ].flatMap(([submissionId, personId]) => [
      env.DB.prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, ?, 'speaker', 0, 'confirmed', ?, ?)").bind(`par-${submissionId}`, submissionId, personId, NOW, NOW),
      env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES (?, ?, 'track-cospeaker', 1, ?, ?)").bind(`sbt-${submissionId}`, submissionId, NOW, NOW),
    ]),
  ]);
}

describe.sequential("MRQ-164 co-speaker double-booking", () => {
  beforeAll(seedFixture, 10_000);

  test("AC-77 · MRQ-164 REPRO · a co-speaker added after intake is double-booked and the agenda says so", async () => {
    const added = await request(`/api/v1/events/${DEMO_EVENT_ID}/submissions/sub-164-ci/participants`, {
      method: "POST",
      body: JSON.stringify({ name: "Marcus Okafor", email: "marcus@mrq164.test", role: "co_speaker" }),
    });
    expect(added.status).toBe(201);

    for (const [submissionId, roomId] of [["sub-164-ci", "room-cospeaker-a"], ["sub-164-lightning", "room-cospeaker-b"]]) {
      const placed = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/items`, {
        method: "POST",
        body: JSON.stringify({ submission_id: submissionId, starts_at: START, room_id: roomId, track_id: "track-cospeaker", duration_min: 45 }),
      });
      expect(placed.status).toBe(201);
    }

    const snapshot = await (await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`)).json<{
      sessions: Array<{ title: string; speakers: Array<{ id: string; name: string; role?: string }> }>;
      conflicts: Array<{ kind: string; person_id?: string; message: string }>;
    }>();

    const ci = snapshot.sessions.find((session) => session.title === "Taming 40-Minute CI");
    expect(ci?.speakers.map((speaker) => speaker.id)).toContain("person-marcus-164");

    expect(snapshot.conflicts.filter((conflict) => conflict.kind === "person" && conflict.person_id === "person-marcus-164")).toHaveLength(1);
  });

  test("AC-77 · MRQ-164 REPRO · a session created through + Add session is double-booked and the agenda says so", async () => {
    const created = await request(`/api/v1/events/${DEMO_EVENT_ID}/submissions`, {
      method: "POST",
      body: JSON.stringify({
        kind: "session",
        title: "Second Lightning: Agents in Production Q&A",
        submitter_person_id: "person-marcus-164",
        format_id: "format-cospeaker",
        primary_track_id: "track-cospeaker",
      }),
    });
    expect(created.status).toBe(201);
    const record = await created.json<{ id: string; participants: Array<{ person_id: string; name: string; role: string }> }>();
    expect(record.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ person_id: "person-marcus-164", role: "speaker" }),
      expect.objectContaining({ person_id: "person-marcus-164", role: "submitter" }),
    ]));

    const placed = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/items`, {
      method: "POST",
      body: JSON.stringify({ submission_id: record.id, starts_at: START, room_id: "room-cospeaker-b", track_id: "track-cospeaker", duration_min: 45 }),
    });
    expect(placed.status).toBe(201);

    const snapshot = await (await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`)).json<{
      sessions: Array<{ id: string; title: string; speakers: Array<{ id: string; name: string; role?: string }> }>;
      conflicts: Array<{ kind: string; person_id?: string; session_ids: string[] }>;
    }>();
    const lightning = snapshot.sessions.find((session) => session.title === "Second Lightning: Agents in Production Q&A");
    // The tile names Marcus, so the detector must know he is on that stage.
    expect(lightning?.speakers.map((speaker) => speaker.name)).toContain("Marcus Okafor");
    expect(snapshot.conflicts.some((conflict) =>
      conflict.kind === "person"
      && conflict.person_id === "person-marcus-164"
      && conflict.session_ids.includes(lightning!.id),
    )).toBe(true);

    const published = await request(`/api/v1/events/${DEMO_EVENT_ID}/submissions/${record.id}/publish`, { method: "POST" });
    expect(published.status).toBe(200);
    for (const path of [
      `/api/v1/public/agenda?event=aie-nyc-2026`,
      `/api/v1/public/embeds/aie-nyc-2026-agenda?event=aie-nyc-2026`,
    ]) {
      const response = await request(path);
      expect(response.status).toBe(200);
      const payload = await response.json<{ sessions: Array<{ title: string; speakers: Array<{ name: string }> }> }>();
      const publicSession = payload.sessions.find((session) => session.title === "Second Lightning: Agents in Production Q&A");
      expect(publicSession?.speakers.map((speaker) => speaker.name)).toContain("Marcus Okafor");
    }
  });

  test("AC-335, AC-336 · MRQ-224 · two people shared across one overlapping pair raise two flags, not one", async () => {
    // The panel case. Marcus already co-speaks on the CI talk and speaks on the
    // lightning talk; Priya now moderates the lightning talk while speaking on
    // the CI talk. One overlapping pair, two double-booked people.
    //
    // The detector used to emit `sharedPeople[0]` and stop, so an organizer who
    // moved the person it named was told the schedule was clear while the
    // second clash stood — and a panel is four people, which makes two shared
    // names the ordinary case rather than the exotic one. On unfixed main this
    // finds one flag and fails.
    const added = await request(`/api/v1/events/${DEMO_EVENT_ID}/submissions/sub-164-lightning/participants`, {
      method: "POST",
      body: JSON.stringify({ name: "Priya Raman", email: "priya@mrq164.test", role: "moderator" }),
    });
    expect(added.status).toBe(201);

    const snapshot = await (await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda`)).json<{
      sessions: Array<{ id: string; title: string }>;
      conflicts: Array<{ kind: string; person_id?: string; session_ids: string[] }>;
    }>();
    const ci = snapshot.sessions.find((session) => session.title === "Taming 40-Minute CI")!;
    const lightning = snapshot.sessions.find((session) => session.title === "Lightning: Agents in Production Q&A")!;
    const pair = snapshot.conflicts.filter((conflict) =>
      conflict.kind === "person"
      && conflict.session_ids.includes(ci.id)
      && conflict.session_ids.includes(lightning.id),
    );
    expect(pair.map((conflict) => conflict.person_id).sort())
      .toEqual(["person-marcus-164", "person-priya-164"].sort());

    // And the audience is told which of them is running the room. The public
    // projection carries participation.role, so a panel stops reading as four
    // equal names; a plain speaker's card is unchanged because role is null.
    const published = await request(`/api/v1/events/${DEMO_EVENT_ID}/submissions/sub-164-lightning/publish`, { method: "POST" });
    expect(published.status).toBe(200);
    const payload = await (await request("/api/v1/public/agenda?event=aie-nyc-2026")).json<{
      sessions: Array<{ title: string; speakers: Array<{ name: string; role: string | null }> }>;
    }>();
    const session = payload.sessions.find((entry) => entry.title === "Lightning: Agents in Production Q&A")!;
    expect(session.speakers.find((speaker) => speaker.name === "Priya Raman")?.role).toBe("moderator");
    expect(session.speakers.find((speaker) => speaker.name === "Marcus Okafor")?.role).toBe(null);
  });

  test("CONTRACT · a sponsor contact is not auto-published when a distinct speaker is supplied", async () => {
    const created = await request(`/api/v1/events/${DEMO_EVENT_ID}/submissions`, {
      method: "POST",
      body: JSON.stringify({
        kind: "session",
        title: "Sponsor contact stays private",
        submitter_person_id: "person-marcus-164",
        participants: [
          { person_id: "person-marcus-164", role: "sponsor_contact" },
          { person_id: "person-priya-164", role: "speaker" },
        ],
        format_id: "format-cospeaker",
        primary_track_id: "track-cospeaker",
      }),
    });
    expect(created.status).toBe(201);
    const record = await created.json<{ id: string; participants: Array<{ person_id: string; role: string }> }>();
    expect(record.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ person_id: "person-marcus-164", role: "sponsor_contact" }),
      expect.objectContaining({ person_id: "person-priya-164", role: "speaker" }),
    ]));
    expect(record.participants).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ person_id: "person-marcus-164", role: "speaker" }),
    ]));

    const placed = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/items`, {
      method: "POST",
      body: JSON.stringify({ submission_id: record.id, starts_at: START + 3_600_000, room_id: "room-cospeaker-a", track_id: "track-cospeaker", duration_min: 45 }),
    });
    expect(placed.status).toBe(201);
    const published = await request(`/api/v1/events/${DEMO_EVENT_ID}/submissions/${record.id}/publish`, { method: "POST" });
    expect(published.status).toBe(200);

    for (const path of [
      `/api/v1/public/agenda?event=aie-nyc-2026`,
      `/api/v1/public/embeds/aie-nyc-2026-agenda?event=aie-nyc-2026`,
    ]) {
      const response = await request(path);
      expect(response.status).toBe(200);
      const payload = await response.json<{ sessions: Array<{ title: string; speakers: Array<{ name: string }> }> }>();
      const publicSession = payload.sessions.find((session) => session.title === "Sponsor contact stays private");
      expect(publicSession?.speakers.map((speaker) => speaker.name)).toEqual(["Priya Raman"]);
    }
  });

  test("CONTRACT · a sponsor contact without a speaker stays out of public agenda and embed", async () => {
    const created = await request(`/api/v1/events/${DEMO_EVENT_ID}/submissions`, {
      method: "POST",
      body: JSON.stringify({
        kind: "session",
        title: "Sponsor contact awaiting speaker",
        submitter_person_id: "person-marcus-164",
        participants: [
          { person_id: "person-marcus-164", role: "sponsor_contact" },
        ],
        format_id: "format-cospeaker",
        primary_track_id: "track-cospeaker",
      }),
    });
    expect(created.status).toBe(201);
    const record = await created.json<{ id: string; participants: Array<{ person_id: string; role: string }> }>();
    expect(record.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ person_id: "person-marcus-164", role: "sponsor_contact" }),
    ]));

    const placed = await request(`/api/v1/events/${DEMO_EVENT_ID}/agenda/items`, {
      method: "POST",
      body: JSON.stringify({ submission_id: record.id, starts_at: START + 7_200_000, room_id: "room-cospeaker-b", track_id: "track-cospeaker", duration_min: 45 }),
    });
    expect(placed.status).toBe(201);
    const published = await request(`/api/v1/events/${DEMO_EVENT_ID}/submissions/${record.id}/publish`, { method: "POST" });
    expect(published.status).toBe(200);

    for (const path of [
      `/api/v1/public/agenda?event=aie-nyc-2026`,
      `/api/v1/public/embeds/aie-nyc-2026-agenda?event=aie-nyc-2026`,
    ]) {
      const response = await request(path);
      expect(response.status).toBe(200);
      const payload = await response.json<{ sessions: Array<{ title: string; speakers: Array<{ name: string }> }> }>();
      const publicSession = payload.sessions.find((session) => session.title === "Sponsor contact awaiting speaker");
      expect(publicSession).toBeDefined();
      expect(publicSession?.speakers.map((speaker) => speaker.name)).not.toContain("Marcus Okafor");
    }
  });
});
