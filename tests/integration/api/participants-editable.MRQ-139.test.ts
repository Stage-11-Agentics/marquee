import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import {
  DEMO_EVENT_ID,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZER_PERSON_ID,
  DEMO_SPEAKER_PERSON_ID,
  demoFixtureRows,
} from "../../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "../apply-migrations";

/**
 * MRQ-139. The record RENDERED its participants and offered no way to change
 * them: a co-presenter who turns up after intake — the ordinary case at a
 * conference — could not be attached from the organizer side at all. The only
 * participant-entry path was the public form, which an organizer cannot re-run
 * on someone else's behalf.
 *
 * The second half is the contract the same finding names: a form declaring
 * `max_speakers: 4` through a field schema that can only ever collect two
 * people is a promise nothing can keep.
 */

const ORIGIN = "https://marquee.stage11.dev";
const EVENT_ID = DEMO_EVENT_ID;
const SESSION_ID = "sess-mrq-139-organizer";
const SUBMISSION_ID = "sub-mrq-139";
const SUBMITTER_PARTICIPATION_ID = "part-mrq-139-submitter";
const FORM_ID = "form-mrq-139";

interface Participant { id: string; person_id: string; name: string; email: string; role: string; }
interface Record139 { participants: Participant[]; actions: { can_edit_participants: boolean }; }

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `mq_session=${SESSION_ID}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

async function readRecord(): Promise<Record139> {
  const response = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<Record139>;
}

async function addParticipant(body: unknown): Promise<Response> {
  return request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}/participants`, { method: "POST", body: JSON.stringify(body) });
}

async function countPeople(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM people").first<{ total: number }>();
  return Number(row?.total ?? 0);
}

beforeEach(async () => {
  await applyMigrations();
  const now = Date.UTC(2026, 7, 12, 12, 0, 0);
  // Fixture data stays pinned to `now` for determinism, but the Worker validates
  // a session against the real clock — so expiry is measured from now, not from
  // the fixture date. Anchoring it to `now` expired this file's session 24 hours
  // after that date and failed every run thereafter.
  const sessionExpiresAt = Date.now() + 86_400_000;
  for (const row of demoFixtureRows(now)) await env.DB.prepare(row.statement).bind(...row.bindings).run();
  await env.DB.batch([
    // clock-check: allow — auth_sessions.expires_at is a credential TTL compared as an instant, not an event-local calendar date
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, person_id, role_hint, expires_at, user_agent_hash, revoked_at, created_at, updated_at)
       VALUES (?, ?, 'owner', ?, 'fixture', NULL, ?, ?)`,
    ).bind(SESSION_ID, DEMO_ORGANIZER_PERSON_ID, sessionExpiresAt, now, now),
    env.DB.prepare(
      `INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, submitted_at, last_saved_at, created_at, updated_at)
       VALUES (?, ?, 'session', 'A talk that grew a second presenter', 'accepted', 'public', ?, ?, ?, ?, ?)`,
    ).bind(SUBMISSION_ID, EVENT_ID, DEMO_ORGANIZER_PERSON_ID, now, now, now, now),
    env.DB.prepare(
      `INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at)
       VALUES (?, ?, ?, 'submitter', 0, 'confirmed', ?, ?)`,
    ).bind(SUBMITTER_PARTICIPATION_ID, SUBMISSION_ID, DEMO_ORGANIZER_PERSON_ID, now, now),
    env.DB.prepare(
      `INSERT INTO forms
        (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
         per_submitter_limit, min_speakers, max_speakers, max_sponsors,
         admin_notify_person_ids, turnstile_required, created_at, updated_at)
       VALUES (?, ?, 'MRQ-139 CFP', 'mrq-139-cfp', 'abstract', 'open', ?, ?, '', 3, 1, 4, 0, '[]', 0, ?, ?)`,
    ).bind(FORM_ID, EVENT_ID, 0, Date.UTC(2099, 0, 1), now, now),
    env.DB.prepare(
      `INSERT INTO form_fields (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
       VALUES
       ('field-mrq139-title', ?, 'title', 'Abstract title', NULL, 'short_text', 1, 0, '{}', NULL, ?, ?),
       ('field-mrq139-name', ?, 'speaker_name', 'Primary speaker', NULL, 'short_text', 1, 1, '{}', NULL, ?, ?),
       ('field-mrq139-email', ?, 'speaker_email', 'Primary email', NULL, 'email', 1, 2, '{}', NULL, ?, ?),
       ('field-mrq139-co-name', ?, 'co_speaker_name', 'Co-speaker name', NULL, 'short_text', 0, 3, '{}', NULL, ?, ?),
       ('field-mrq139-co-email', ?, 'co_speaker_email', 'Co-speaker email', NULL, 'email', 0, 4, '{}', NULL, ?, ?)`,
    ).bind(FORM_ID, now, now, FORM_ID, now, now, FORM_ID, now, now, FORM_ID, now, now, FORM_ID, now, now),
  ]);
});

describe.sequential("MRQ-139 · a submission's participants are editable after intake", () => {
  test("CONTRACT · MRQ-139 · an organizer attaches a co-presenter who is already in the organization, and it persists with that role", async () => {
    const before = await readRecord();
    expect(before.actions.can_edit_participants).toBe(true);
    expect(before.participants.map((participant) => participant.role)).toEqual(["submitter"]);

    const response = await addParticipant({ person_id: DEMO_SPEAKER_PERSON_ID, role: "co_speaker" });
    expect(response.status).toBe(201);

    // Read back through a fresh request rather than trusting the write's own
    // echo: the ticket's validation is "reload and it is still there".
    const after = await readRecord();
    expect(after.participants.find((participant) => participant.person_id === DEMO_SPEAKER_PERSON_ID)).toMatchObject({
      role: "co_speaker",
      name: "Demo Speaker",
    });
  });

  test("CONTRACT · MRQ-139 · a co-presenter nobody has met yet is created and attached in one action", async () => {
    const response = await addParticipant({ name: "Priya Raman", email: "priya@example.com", role: "moderator" });
    expect(response.status).toBe(201);
    const record = await readRecord();
    expect(record.participants.find((participant) => participant.email === "priya@example.com")).toMatchObject({ role: "moderator", name: "Priya Raman" });
    const person = await env.DB.prepare("SELECT org_id FROM people WHERE lower(email) = 'priya@example.com'").first<{ org_id: string }>();
    expect(person?.org_id).toBe(DEMO_ORGANIZATION_ID);
  });

  test("CONTRACT · MRQ-139 · an address the organization already knows is matched, not duplicated", async () => {
    const before = await countPeople();
    const response = await addParticipant({ name: "Demo Speaker Again", email: "speaker@demo.marquee.example", role: "speaker" });
    expect(response.status).toBe(201);
    expect(await countPeople()).toBe(before);
    const record = await readRecord();
    expect(record.participants.find((participant) => participant.person_id === DEMO_SPEAKER_PERSON_ID)?.role).toBe("speaker");
  });

  test("CONTRACT · MRQ-139 · adding the same person in the same role twice leaves one row, not a duplicate to dedupe later", async () => {
    expect((await addParticipant({ person_id: DEMO_SPEAKER_PERSON_ID, role: "co_speaker" })).status).toBe(201);
    // 200, not 201: nothing was created the second time, and an agent reading
    // this API should not be told otherwise.
    expect((await addParticipant({ person_id: DEMO_SPEAKER_PERSON_ID, role: "co_speaker" })).status).toBe(200);
    const record = await readRecord();
    expect(record.participants.filter((participant) => participant.person_id === DEMO_SPEAKER_PERSON_ID)).toHaveLength(1);
  });

  test("CONTRACT · MRQ-139 · a race between two identical adds is a no-op, not a constraint failure", async () => {
    // The exists-check and the INSERT are separate round trips, so two
    // simultaneous Adds both pass the check. Without ON CONFLICT DO NOTHING the
    // loser surfaces the unique index as a 500 — a double-click deserves the
    // same quiet answer as a second click a minute later.
    const responses = await Promise.all([
      addParticipant({ person_id: DEMO_SPEAKER_PERSON_ID, role: "co_speaker" }),
      addParticipant({ person_id: DEMO_SPEAKER_PERSON_ID, role: "co_speaker" }),
    ]);
    for (const response of responses) expect([200, 201]).toContain(response.status);
    const record = await readRecord();
    expect(record.participants.filter((participant) => participant.person_id === DEMO_SPEAKER_PERSON_ID)).toHaveLength(1);
  });

  test("CONTRACT · MRQ-139 · a participant added in error can be removed again", async () => {
    expect((await addParticipant({ person_id: DEMO_SPEAKER_PERSON_ID, role: "co_speaker" })).status).toBe(201);
    const added = (await readRecord()).participants.find((participant) => participant.person_id === DEMO_SPEAKER_PERSON_ID);
    expect(added?.id).toBeTruthy();
    const response = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}/participants/${added!.id}`, { method: "DELETE" });
    expect(response.status).toBe(200);
    expect((await readRecord()).participants.map((participant) => participant.role)).toEqual(["submitter"]);
  });

  test("CONTRACT · MRQ-139 · the submitter cannot be removed from their own record", async () => {
    const response = await request(`/api/v1/events/${EVENT_ID}/submissions/${SUBMISSION_ID}/participants/${SUBMITTER_PARTICIPATION_ID}`, { method: "DELETE" });
    expect(response.status).toBe(422);
    expect((await readRecord()).participants.map((participant) => participant.role)).toEqual(["submitter"]);
  });

  test("CONTRACT · MRQ-139 · a person from another organization is refused rather than silently attached", async () => {
    const now = Date.UTC(2026, 7, 12, 12, 0, 0);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES ('org_other_139', 'Another Org', 'another-139', ?, ?)").bind(now, now),
      env.DB.prepare(
        `INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at)
         VALUES ('per_other_139', 'org_other_139', 'outsider@example.com', 'Outsider', 0, 'marquee', ?, ?)`,
      ).bind(now, now),
    ]);
    const response = await addParticipant({ person_id: "per_other_139", role: "co_speaker" });
    expect(response.status).toBe(422);
    expect((await readRecord()).participants.map((participant) => participant.role)).toEqual(["submitter"]);
  });

  test("CONTRACT · MRQ-139 · the public form advertises the number of people it can actually collect", async () => {
    // The form is configured for four speakers; its fields hold a primary and
    // one co-speaker. Four was a number no applicant could ever satisfy.
    const response = await SELF.fetch(`${ORIGIN}/api/v1/public/forms/mrq-139-cfp`);
    expect(response.status).toBe(200);
    const state = await response.json() as { form: { max_speakers: number; min_speakers: number } };
    expect(state.form.max_speakers).toBe(2);
    expect(state.form.min_speakers).toBe(1);
    const configured = await env.DB.prepare("SELECT max_speakers FROM forms WHERE id = ?").bind(FORM_ID).first<{ max_speakers: number }>();
    expect(Number(configured?.max_speakers)).toBe(4);
  });
});
