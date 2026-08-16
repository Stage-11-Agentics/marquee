import { SELF } from "cloudflare:test";
import { beforeAll, expect, test } from "vitest";

import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZER_PERSON_ID,
  DEMO_SPEAKER_PERSON_ID,
  demoFixtureRows,
} from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = DEMO_EVENT_ID;
const OWNER_ID = DEMO_ORGANIZER_PERSON_ID;
const OWNER_SESSION = "sess-mrq-242-owner";
const SECOND_ORGANIZER = "per-mrq-242-second";
const SECOND_SESSION = "sess-mrq-242-second";
const SPEAKER_SESSION = "sess-mrq-242-speaker";
const SENTINEL = "MRQ-242 internal-only sentinel — never publish or send";

let submissionId = "";

async function request(path: string, init: RequestInit = {}, session = OWNER_SESSION): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mq_session=${session}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

beforeAll(async () => {
  await applyMigrations();
  const now = Date.now();
  for (const row of demoFixtureRows(now)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, created_at, updated_at)
       VALUES (?, ?, 'second-organizer@mrq-242.example', 'Second Organizer', ?, ?)`,
    ).bind(SECOND_ORGANIZER, DEMO_ORGANIZATION_ID, now, now),
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES ('mem-mrq-242-second', ?, NULL, ?, 'program_lead', ?, ?)`,
    ).bind(DEMO_ORGANIZATION_ID, SECOND_ORGANIZER, now, now),
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)`,
    ).bind(OWNER_SESSION, OWNER_ID, now + 86_400_000, now, now),
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'program_lead', ?, 'fixture', NULL, ?, ?)`,
    ).bind(SECOND_SESSION, SECOND_ORGANIZER, now + 86_400_000, now, now),
    // The speaker seat is a positive control: it is authenticated but cannot
    // read an internal organizer note.
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'speaker', ?, 'fixture', NULL, ?, ?)`,
    ).bind(SPEAKER_SESSION, DEMO_SPEAKER_PERSON_ID, now + 86_400_000, now, now),
  ]);

  const created = await request(`/api/v1/events/${EVENT_ID}/submissions`, {
    method: "POST",
    body: JSON.stringify({
      kind: "abstract",
      title: "MRQ-242 fresh submission",
      abstract: "A new record with no evaluation rows yet.",
      submitter_person_id: DEMO_SPEAKER_PERSON_ID,
      participants: [{ person_id: DEMO_SPEAKER_PERSON_ID, role: "speaker" }],
    }),
  });
  expect(created.status).toBe(201);
  submissionId = (await created.json() as { id: string }).id;
});

test("AC-337 + AC-338 + AC-339 · a fresh submission saves one internal note and a second organizer sees its authenticated attribution", async () => {
  const beforeEvaluations = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM evaluations WHERE submission_id = ?",
  ).bind(submissionId).first<{ count: number }>();
  expect(Number(beforeEvaluations?.count ?? 0)).toBe(0);

  const written = await request(`/api/v1/submissions/${submissionId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body: SENTINEL }),
  });
  expect(written.status).toBe(201);
  const created = await written.json() as { note: Record<string, unknown> };
  expect(created.note).toMatchObject({
    submission_id: submissionId,
    body: SENTINEL,
    author_person_id: OWNER_ID,
    author_name: "Demo Organizer",
  });

  const readBySecondOrganizer = await request(`/api/v1/submissions/${submissionId}/notes`, {}, SECOND_SESSION);
  expect(readBySecondOrganizer.status).toBe(200);
  expect(await readBySecondOrganizer.json()).toEqual({ notes: [created.note] });

  const afterEvaluations = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM evaluations WHERE submission_id = ?",
  ).bind(submissionId).first<{ count: number }>();
  expect(Number(afterEvaluations?.count ?? 0)).toBe(0);
});

test("AC-338 + AC-340 · the authenticated speaker cannot read the note, and its sentinel never reaches public or outbound projections", async () => {
  const speakerRead = await request(`/api/v1/submissions/${submissionId}/notes`, {}, SPEAKER_SESSION);
  expect(speakerRead.status).toBe(403);
  expect(await speakerRead.text()).not.toContain(SENTINEL);

  const publicAgenda = await SELF.fetch(`${ORIGIN}/api/v1/public/agenda?event=aie-nyc-2026`);
  expect(await publicAgenda.text()).not.toContain(SENTINEL);

  const outbound = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM outbox WHERE subject LIKE ? OR text LIKE ?",
  ).bind(`%${SENTINEL}%`, `%${SENTINEL}%`).first<{ count: number }>();
  expect(Number(outbound?.count ?? 0)).toBe(0);
});

test("AC-337 + AC-338 · notes have no update path and the request cannot choose an author", async () => {
  const forged = await request(`/api/v1/submissions/${submissionId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body: "forged", author_person_id: DEMO_SPEAKER_PERSON_ID }),
  });
  expect(forged.status).toBe(400);

  const update = await request(`/api/v1/submissions/${submissionId}/notes`, {
    method: "PATCH",
    body: JSON.stringify({ body: "updated" }),
  });
  expect([404, 405]).toContain(update.status);

  const notes = await request(`/api/v1/submissions/${submissionId}/notes`);
  expect(notes.status).toBe(200);
  expect((await notes.json() as { notes: Array<{ body: string }> }).notes.map((note) => note.body)).toEqual([SENTINEL]);
});
