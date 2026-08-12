import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../../src/index";
import { reconcileTaskSet } from "../../../src/jobs/cascade/decisions";
import { applyMigrations, env } from "../apply-migrations";

/**
 * The speaker roster, and the membership gap underneath it.
 *
 * `memberships(role='speaker')` had exactly one writer — the demo reseeder — so
 * a speaker the product created at runtime existed on no roster, could not sign
 * into their own portal, and was not in the bulk-comms audience. These tests
 * fix the shape of the fix: the roster lists everyone regardless of how they
 * arrived, the acceptance boundary writes the membership row, and organizer
 * edits round-trip through the same normalizer the portal uses.
 */

const NOW = Date.UTC(2026, 7, 12, 9, 0, 0);
const ORG_ID = "org_mrq111";
const EVENT_ID = "evt_mrq111";
const ORIGIN = "https://marquee.stage11.dev";
const ORGANIZER = "per_mrq111_organizer";
const AUTH_SESSION = "sess_mrq111";
const ACCEPTED_SPEAKER = "per_mrq111_accepted";
const DONE_SPEAKER = "per_mrq111_done";
const REJECTED_PERSON = "per_mrq111_rejected";
const MODERATOR_PERSON = "per_mrq111_moderator";
const SUBMITTED_ID = "sub_mrq111_pending";
const SHELL = `<!doctype html><html><head><title>Marquee</title></head><body><div id="app"></div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;

function runtimeEnv(): Env {
  return {
    ...env,
    ASSETS: assets,
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    UPLOAD_TOKEN_SECRET: "mrq111-upload-token-secret",
    UPLOAD_RATE_LIMIT_SECRET: "mrq111-upload-rate-secret",
  } as unknown as Env;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set("cookie", `mq_session=${AUTH_SESSION}`);
  return app.request(`${ORIGIN}${path}`, { ...init, headers }, runtimeEnv());
}

async function roster(query = ""): Promise<{ rows: Array<Record<string, unknown>>; total: number; counts: Record<string, number> }> {
  const response = await request(`/api/v1/events/${EVENT_ID}/speakers${query}`);
  expect(response.status).toBe(200);
  return await response.json();
}

function person(id: string, name: string, email: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, custom_fields, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Staff Engineer', 'Latticework Systems', 'A biography', '[]', '{}', 0, ?, ?)`,
  ).bind(id, ORG_ID, email, name, NOW, NOW);
}

function submission(id: string, title: string, status: string, submitter: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO submissions (id, event_id, kind, title, abstract, status, primary_track_id, origin, submitter_person_id, search_blob, created_at, updated_at)
     VALUES (?, ?, 'session', ?, 'An abstract', ?, 'track_mrq111', 'public', ?, ?, ?, ?)`,
  ).bind(id, EVENT_ID, title, status, submitter, title.toLowerCase(), NOW, NOW);
}

function participation(id: string, submissionId: string, personId: string, role: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 'pending', ?, ?)`,
  ).bind(id, submissionId, personId, role, NOW, NOW);
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "DevFlow", "devflow", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'DevFlow Conf 2027', 'devflow-2027', 'Ship it', '2027-05-12', '2027-05-14', 'America/Los_Angeles', 'Moscone West', '#0b6a72', 'live', 0, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES ('track_mrq111', ?, 'Platform', '#0b6a72', 0, ?, ?)").bind(EVENT_ID, NOW, NOW),
    person(ORGANIZER, "Jordan Alvarez", "jordan@example.com"),
    person(ACCEPTED_SPEAKER, "Marcus Okafor", "marcus@example.com"),
    person(DONE_SPEAKER, "Dana Kowalski", "dana@example.com"),
    env.DB.prepare("INSERT INTO memberships (id, org_id, person_id, event_id, role, created_at, updated_at) VALUES ('mem_mrq111', ?, ?, ?, 'owner', ?, ?)").bind(ORG_ID, ORGANIZER, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at) VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)").bind(AUTH_SESSION, ORGANIZER, NOW + 86_400_000, NOW, NOW),
  ]);
  await env.DB.batch([
    person(REJECTED_PERSON, "Sam Reyes", "sam@example.com"),
    person(MODERATOR_PERSON, "Alex Chen", "alex@example.com"),
    submission("sub_mrq111_accepted", "Taming 40-Minute CI", "accepted", ACCEPTED_SPEAKER),
    submission(SUBMITTED_ID, "A talk still in the pile", "submitted", DONE_SPEAKER),
    participation("par_mrq111_accepted", "sub_mrq111_accepted", ACCEPTED_SPEAKER, "speaker"),
    participation("par_mrq111_pending", SUBMITTED_ID, DONE_SPEAKER, "speaker"),
    submission("sub_mrq111_rejected", "A talk the conference declined", "rejected", REJECTED_PERSON),
    participation("par_mrq111_rejected", "sub_mrq111_rejected", REJECTED_PERSON, "speaker"),
    participation("par_mrq111_moderator", "sub_mrq111_accepted", MODERATOR_PERSON, "moderator"),
    env.DB.prepare("INSERT INTO submission_tracks (id, submission_id, track_id, is_primary, created_at, updated_at) VALUES ('st_mrq111', 'sub_mrq111_accepted', 'track_mrq111', 1, ?, ?)").bind(NOW, NOW),
  ]);
});

test("CONTRACT · MRQ-111 · SPK-01 · the roster lists every speaker regardless of how they arrived", async () => {
  const created = await request(`/api/v1/events/${EVENT_ID}/speakers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Priya Raman",
      email: "priya@example.com",
      title: "Principal Engineer",
      company: "Latticework Systems",
      bio: "Priya works on build systems.",
    }),
  });
  expect(created.status).toBe(201);

  const body = await roster();
  const names = body.rows.map((row) => row.name);
  // Organizer-added (no session at all), plus both participation-derived people.
  expect(names).toContain("Priya Raman");
  expect(names).toContain("Marcus Okafor");
  expect(names).toContain("Dana Kowalski");
  // The organizer is not a speaker; a roster that lists staff is not a roster.
  expect(names).not.toContain("Jordan Alvarez");
});

test("CONTRACT · MRQ-111 · 24n · the acceptance boundary writes the membership row the portal reads", async () => {
  const before = await env.DB
    .prepare("SELECT COUNT(*) AS count FROM memberships WHERE event_id = ? AND role = 'speaker'")
    .bind(EVENT_ID)
    .first<{ count: number }>();
  expect(Number(before?.count)).toBe(0);

  await reconcileTaskSet(env.DB, EVENT_ID, ["sub_mrq111_accepted"], NOW);

  const after = await env.DB
    .prepare("SELECT person_id FROM memberships WHERE event_id = ? AND role = 'speaker'")
    .bind(EVENT_ID)
    .all<{ person_id: string }>();
  expect(after.results.map((row) => row.person_id)).toEqual([ACCEPTED_SPEAKER]);

  // Idempotent: re-running acceptance must not mint a second row.
  await reconcileTaskSet(env.DB, EVENT_ID, ["sub_mrq111_accepted"], NOW + 1_000);
  const again = await env.DB
    .prepare("SELECT COUNT(*) AS count FROM memberships WHERE event_id = ? AND role = 'speaker'")
    .bind(EVENT_ID)
    .first<{ count: number }>();
  expect(Number(again?.count)).toBe(1);
});

test("CONTRACT · MRQ-111 · SPK-02 · an organizer bio edit survives a re-read and is attributable", async () => {
  const created = await request(`/api/v1/events/${EVENT_ID}/speakers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Priya Raman", email: "priya@example.com", bio: "Priya works on build systems." }),
  });
  const { speaker } = await created.json<{ speaker: { id: string; bio: string } }>();
  // The bio must survive creation: the admin path used to insert a literal NULL.
  expect(speaker.bio).toBe("Priya works on build systems.");

  const edited = await request(`/api/v1/events/${EVENT_ID}/speakers/${speaker.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bio: "Priya works on build systems. SBEK-ORG-EDIT-01" }),
  });
  expect(edited.status).toBe(200);

  const reread = await request(`/api/v1/events/${EVENT_ID}/speakers/${speaker.id}`);
  const after = await reread.json<{ speaker: { bio: string } }>();
  expect(after.speaker.bio).toContain("SBEK-ORG-EDIT-01");

  const audit = await env.DB
    .prepare("SELECT action, actor_person_id FROM audit_log WHERE entity_type = 'person' AND entity_id = ? ORDER BY id ASC")
    .bind(speaker.id)
    .all<{ action: string; actor_person_id: string }>();
  expect(audit.results.map((row) => row.action)).toEqual(["speaker_created", "speaker_updated"]);
  expect(audit.results.every((row) => row.actor_person_id === ORGANIZER)).toBe(true);
});

test("CONTRACT · MRQ-111 · SPK-04 · a status override persists, writes through to sessions, and filters", async () => {
  const patched = await request(`/api/v1/events/${EVENT_ID}/speakers/${ACCEPTED_SPEAKER}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation_status: "confirmed" }),
  });
  expect(patched.status).toBe(200);

  const reread = await request(`/api/v1/events/${EVENT_ID}/speakers/${ACCEPTED_SPEAKER}`);
  const body = await reread.json<{ speaker: { status: string; sessions: Array<{ confirmation_status: string }> } }>();
  expect(body.speaker.status).toBe("confirmed");
  // The badge and the per-session chips are the same fact seen twice: the
  // override writes both so the two screens cannot tell different stories.
  expect(body.speaker.sessions.map((session) => session.confirmation_status)).toEqual(["confirmed"]);

  const filtered = await roster("?status=confirmed");
  expect(filtered.rows.map((row) => row.id)).toEqual([ACCEPTED_SPEAKER]);
  const others = await roster("?status=pending");
  expect(others.rows.map((row) => row.id)).not.toContain(ACCEPTED_SPEAKER);
});

test("CONTRACT · MRQ-111 · SPK-04 · a session-less speaker can still be confirmed before scheduling", async () => {
  const created = await request(`/api/v1/events/${EVENT_ID}/speakers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Priya Raman", email: "priya@example.com" }),
  });
  const { speaker } = await created.json<{ speaker: { id: string; status: string; sessions: unknown[] } }>();
  expect(speaker.sessions).toEqual([]);
  expect(speaker.status).toBe("pending");

  await request(`/api/v1/events/${EVENT_ID}/speakers/${speaker.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation_status: "confirmed" }),
  });
  const reread = await request(`/api/v1/events/${EVENT_ID}/speakers/${speaker.id}`);
  expect((await reread.json<{ speaker: { status: string } }>()).speaker.status).toBe("confirmed");
});

test("CONTRACT · MRQ-111 · SPK-15 · logistics fields round-trip and clear honestly", async () => {
  await request(`/api/v1/events/${EVENT_ID}/speakers/${ACCEPTED_SPEAKER}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ custom_fields: { Arrival: "Arrival May 11, aisle seat", Dietary: "Vegetarian", Notes: "  " } }),
  });
  const reread = await request(`/api/v1/events/${EVENT_ID}/speakers/${ACCEPTED_SPEAKER}`);
  const body = await reread.json<{ speaker: { custom_fields: Record<string, string> } }>();
  expect(body.speaker.custom_fields).toEqual({ Arrival: "Arrival May 11, aisle seat", Dietary: "Vegetarian" });
});

test("CONTRACT · MRQ-111 · SPK-01 · search narrows to one speaker and clearing restores the roster", async () => {
  const all = await roster();
  expect(all.rows.length).toBeGreaterThan(1);
  const narrowed = await roster("?q=Marcus");
  expect(narrowed.rows.map((row) => row.name)).toEqual(["Marcus Okafor"]);
  // `total` stays the roster size while `rows` narrows, so the UI can say
  // "1 shown of N" instead of implying the roster shrank.
  expect(narrowed.total).toBe(all.total);
  const restored = await roster("?q=");
  expect(restored.rows.length).toBe(all.rows.length);
});

test("CONTRACT · MRQ-111 · CNT-10 · one email is one person: a re-added speaker joins rather than duplicates", async () => {
  const first = await request(`/api/v1/events/${EVENT_ID}/speakers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Marcus Okafor", email: "MARCUS@example.com", bio: "Re-entered by hand." }),
  });
  expect(first.status).toBe(201);
  const body = await roster();
  expect(body.rows.filter((row) => row.email === "marcus@example.com").length).toBe(1);
  expect(body.rows.find((row) => row.id === ACCEPTED_SPEAKER)?.bio).toBe("Re-entered by hand.");
});

test("CONTRACT · MRQ-111 · SPK-08 · every speaker payload carries the headshot pointer MRQ-112 renders", async () => {
  const body = await roster();
  expect(body.rows.length).toBeGreaterThan(0);
  for (const row of body.rows) expect(row).toHaveProperty("headshot_attachment_id");
});

test("CONTRACT · MRQ-111 · SPK-01 · the roster is the speaker list, not the CFP funnel", async () => {
  const body = await roster();
  const names = body.rows.map((row) => row.name);
  // A person the conference rejected is not one of its speakers, and neither is
  // a moderator: listing either would make the roster a different noun.
  expect(names).not.toContain("Sam Reyes");
  expect(names).not.toContain("Alex Chen");
  // The still-in-review speaker stays: they submitted and have not been told no.
  expect(names).toContain("Dana Kowalski");
});

test("CONTRACT · MRQ-111 · SPK-02 · adding a speaker who already exists never clears their profile", async () => {
  // Marcus arrived through the CFP with a full profile. An organizer re-enters
  // his name and email in the Add form and saves, filling nothing else in.
  const again = await request(`/api/v1/events/${EVENT_ID}/speakers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Marcus Okafor", email: "marcus@example.com" }),
  });
  expect(again.status).toBe(201);
  const { speaker } = await again.json<{ speaker: { bio: string | null; title: string | null; company: string | null } }>();
  expect(speaker.bio).toBe("A biography");
  expect(speaker.title).toBe("Staff Engineer");
  expect(speaker.company).toBe("Latticework Systems");
});

test("CONTRACT · MRQ-111 · SPK-04 · setting a speaker back to Pending clears the invitation on both stores", async () => {
  await env.DB.prepare("UPDATE participations SET invited_at = ? WHERE id = 'par_mrq111_accepted'").bind(NOW).run();
  await request(`/api/v1/events/${EVENT_ID}/speakers/${ACCEPTED_SPEAKER}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation_status: "pending" }),
  });
  const reread = await request(`/api/v1/events/${EVENT_ID}/speakers/${ACCEPTED_SPEAKER}`);
  // A stale `invited_at` would make the rollup answer "invited" to the very
  // request that set "pending" — the two stores disagreeing in one response.
  expect((await reread.json<{ speaker: { status: string } }>()).speaker.status).toBe("pending");
});

test("CONTRACT · MRQ-111 · SPK-02 · renaming onto another person's email is a field error, not a 500", async () => {
  const response = await request(`/api/v1/events/${EVENT_ID}/speakers/${ACCEPTED_SPEAKER}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "dana@example.com" }),
  });
  expect(response.status).toBe(422);
  const body = await response.json<{ error: { field?: string } }>();
  expect(JSON.stringify(body)).toContain("email");
});

test("CONTRACT · MRQ-111 · CNT-10 · an email collision is case-insensitive, matching how identity resolves", async () => {
  // `createSpeaker` resolves identity with `lower(email)`, so an exact-match
  // guard let a case variant through and created two people sharing one address.
  const response = await request(`/api/v1/events/${EVENT_ID}/speakers/${ACCEPTED_SPEAKER}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "DANA@example.com" }),
  });
  expect(response.status).toBe(422);
  const duplicates = await env.DB
    .prepare("SELECT COUNT(*) AS count FROM people WHERE org_id = ? AND lower(email) = 'dana@example.com'")
    .bind(ORG_ID)
    .first<{ count: number }>();
  expect(Number(duplicates?.count)).toBe(1);
});

test("CONTRACT · MRQ-111 · SPK-01 · quick search never types a non-roster person as a Speaker", async () => {
  // The roster admits only live submissions, so a rejected-only speaker has no
  // record. Typing them "Speaker" would send the organizer to a 404 through a
  // link this ticket made live.
  const response = await request(`/api/v1/events/${EVENT_ID}/search?q=Sam`);
  expect(response.status).toBe(200);
  const body = await response.json<{ data: Array<{ type: string; id: string }> }>();
  expect(body.data.filter((hit) => hit.type === "Speaker").map((hit) => hit.id)).not.toContain(REJECTED_PERSON);

  const record = await request(`/api/v1/events/${EVENT_ID}/speakers/${REJECTED_PERSON}`);
  expect(record.status).toBe(404);
});

test("CONTRACT · MRQ-111 · SPK-04 · confirming a speaker keeps the original invitation date on both stores", async () => {
  const invitedOn = NOW - 30 * 86_400_000;
  await env.DB.prepare("UPDATE participations SET invited_at = ? WHERE id = 'par_mrq111_accepted'").bind(invitedOn).run();
  await request(`/api/v1/events/${EVENT_ID}/speakers/${ACCEPTED_SPEAKER}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation_status: "confirmed" }),
  });
  const membership = await env.DB
    .prepare("SELECT invited_at FROM memberships WHERE event_id = ? AND person_id = ? AND role = 'speaker'")
    .bind(EVENT_ID, ACCEPTED_SPEAKER)
    .first<{ invited_at: number | null }>();
  const participation = await env.DB
    .prepare("SELECT invited_at FROM participations WHERE id = 'par_mrq111_accepted'")
    .first<{ invited_at: number | null }>();
  expect(participation?.invited_at).toBe(invitedOn);
  expect(membership?.invited_at).toBe(invitedOn);
});
