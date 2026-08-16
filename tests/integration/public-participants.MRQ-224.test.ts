/**
 * The public form collects the people, and does not rewrite the ones it finds.
 *
 * Three participants and a role each, the on-behalf-of disclosure, and the one
 * thing an unauthenticated form must never do: change somebody's record because
 * a stranger typed their address.
 */
import { beforeEach, expect, test, vi } from "vitest";

import { app } from "../../src/index";
import { applyMigrations, env } from "./apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const NOW = Date.now();
const ORG_ID = "org_mrq224_form";
const EVENT_ID = "evt_mrq224_form";
const FORM_ID = "form_mrq224";
const SLUG = "mrq224-cfp";
const EXISTING_CONTACT = "per_mrq224_existing";

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(`${ORIGIN}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  }, env);
}

beforeEach(async () => {
  await applyMigrations();
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "Participants CFP", "mrq224-form", NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, '2027-05-04', '2027-05-06', 'America/New_York', NULL, 'live', 1, ?, ?)`,
    ).bind(EVENT_ID, ORG_ID, "Participants CFP", "mrq224-form", NOW, NOW),
    // Deliberately four, and the shape can finally hold four.
    env.DB.prepare(
      `INSERT INTO forms
        (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md, max_speakers,
         min_speakers, per_submitter_limit, max_sponsors, admin_notify_person_ids, created_at, updated_at)
       VALUES (?, ?, 'Call for speakers', ?, 'abstract', 'open', 0, ?, '', 4, 1, 0, 0, '[]', ?, ?)`,
    ).bind(FORM_ID, EVENT_ID, SLUG, Date.UTC(2099, 0, 1), NOW, NOW),
    env.DB.prepare(
      `INSERT INTO form_fields (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
       VALUES
       ('ff_mrq224_title', ?, 'title', 'Abstract title', NULL, 'short_text', 1, 0, '{}', NULL, ?, ?),
       ('ff_mrq224_name', ?, 'speaker_name', 'Speaker name', NULL, 'short_text', 1, 1, '{}', NULL, ?, ?),
       ('ff_mrq224_email', ?, 'speaker_email', 'Speaker email', NULL, 'email', 1, 2, '{}', NULL, ?, ?)`,
    ).bind(FORM_ID, NOW, NOW, FORM_ID, NOW, NOW, FORM_ID, NOW, NOW),
    // An organization contact who already exists, with the name the organizer
    // recorded. A stranger is about to type this address into a public form.
    env.DB.prepare(
      `INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, last_write_source, created_at, updated_at)
       VALUES (?, ?, 'ana@example.com', 'Dr. Ana Reyes', 'Principal Engineer', 'Northwind', 'Ana works on schedulers.', '[]', 0, 'marquee', ?, ?)`,
    ).bind(EXISTING_CONTACT, ORG_ID, NOW, NOW),
  ]);
});

async function submit(body: Record<string, unknown>): Promise<Response> {
  return request(`/api/v1/public/forms/${SLUG}/submissions`, { method: "POST", body: JSON.stringify(body) });
}

async function participationsFor(submissionId: string): Promise<Array<{ role: string; name: string; position: number }>> {
  const rows = await env.DB
    .prepare(
      `SELECT part.role, part.position, person.name
       FROM participations part JOIN people person ON person.id = part.person_id
       WHERE part.submission_id = ? ORDER BY part.role ASC, part.position ASC`,
    )
    .bind(submissionId)
    .all<{ role: string; position: number; name: string }>();
  return rows.results;
}

async function latestSubmission(): Promise<{ id: string; submitter_person_id: string; participants_json: string | null }> {
  return (await env.DB
    .prepare("SELECT id, submitter_person_id, participants_json FROM submissions WHERE event_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(EVENT_ID)
    .first<{ id: string; submitter_person_id: string; participants_json: string | null }>())!;
}

test("AC-329, AC-332 · a submission with three participants lands three roles and does not rename a contact", async () => {
  const response = await submit({
    answers: { title: "The panel", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    participants: [
      { name: "Ana R.", email: "ana@example.com", role: "moderator" },
      { name: "Dana Kowalski", email: "dana@example.com", role: "co_speaker" },
    ],
  });
  expect(response.status).toBe(201);

  const submission = await latestSubmission();
  const rows = await participationsFor(submission.id);
  // Speaker, moderator, co-speaker, and the submitter row that has always been
  // written. `max_speakers` said four and the shape finally holds four.
  expect(rows.map((row) => row.role).sort()).toEqual(["co_speaker", "moderator", "speaker", "submitter"]);
  expect(rows.find((row) => row.role === "moderator")?.name).toBe("Dr. Ana Reyes");

  // THE GUARD. The submitter typed "Ana R." against an address that already
  // belongs to an organization contact. Before this ticket that renamed her —
  // silently, from an unauthenticated form, with nobody in a position to see
  // it. The scoped co-speaker link remains the only way her own profile moves.
  const ana = await env.DB.prepare("SELECT name, title, bio FROM people WHERE id = ?").bind(EXISTING_CONTACT).first<{ name: string; title: string; bio: string }>();
  expect(ana?.name).toBe("Dr. Ana Reyes");
  expect(ana?.title).toBe("Principal Engineer");
  expect(ana?.bio).toBe("Ana works on schedulers.");

  // Dana did not exist and is created, because a person nobody has a record of
  // is not a person anyone can be confused with.
  const dana = await env.DB.prepare("SELECT name FROM people WHERE org_id = ? AND email = 'dana@example.com'").bind(ORG_ID).first<{ name: string }>();
  expect(dana?.name).toBe("Dana Kowalski");

  // Everyone the submitter named gets their own scoped profile invitation.
  const invites = await env.DB
    .prepare("SELECT to_email FROM outbox WHERE template_key = 'added_to_submission' ORDER BY to_email ASC")
    .all<{ to_email: string }>();
  expect(invites.results.map((row) => row.to_email)).toEqual(["ana@example.com", "dana@example.com"]);
});

test("AC-270, AC-271 · the on-behalf-of disclosure splits the submitter from the speaker", async () => {
  const response = await submit({
    answers: { title: "The keynote", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    on_behalf_of: { name: "Sam Chen", email: "sam@example.com" },
  });
  expect(response.status).toBe(201);

  const submission = await latestSubmission();
  const submitter = await env.DB.prepare("SELECT name, email, bio FROM people WHERE id = ?").bind(submission.submitter_person_id).first<{ name: string; email: string; bio: string | null }>();
  // The record's submitter is the person who filled the form in, and the
  // speaker card's profile fields describe the speaker rather than them.
  expect(submitter?.email).toBe("sam@example.com");
  expect(submitter?.name).toBe("Sam Chen");
  expect(submitter?.bio).toBe(null);

  const rows = await participationsFor(submission.id);
  expect(rows.map((row) => `${row.role}:${row.name}`).sort())
    .toEqual(["speaker:Robin Alvarez", "submitter:Sam Chen"]);

  // Confirmation mail goes to the submitter (AC-223); the speaker gets the
  // scoped profile request instead, because they hold the work.
  const receipt = await env.DB.prepare("SELECT to_email FROM outbox WHERE template_key = 'submission_confirmation' LIMIT 1").first<{ to_email: string }>();
  expect(receipt?.to_email).toBe("sam@example.com");
  const invite = await env.DB.prepare("SELECT to_email FROM outbox WHERE template_key = 'added_to_submission' LIMIT 1").first<{ to_email: string }>();
  expect(invite?.to_email).toBe("robin@example.com");
});

test("AC-270 · the disclosure off is exactly what shipped before", async () => {
  const response = await submit({
    answers: { title: "A plain talk", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    participants: [],
    on_behalf_of: null,
  });
  expect(response.status).toBe(201);
  const submission = await latestSubmission();
  const rows = await participationsFor(submission.id);
  expect(rows.map((row) => `${row.role}:${row.name}`).sort()).toEqual(["speaker:Robin Alvarez", "submitter:Robin Alvarez"]);
  const receipt = await env.DB.prepare("SELECT to_email FROM outbox WHERE template_key = 'submission_confirmation' LIMIT 1").first<{ to_email: string }>();
  expect(receipt?.to_email).toBe("robin@example.com");
  // Nobody was named by anybody else, so nobody is sent a profile request.
  const invites = await env.DB.prepare("SELECT COUNT(*) AS total FROM outbox WHERE template_key = 'added_to_submission'").first<{ total: number }>();
  expect(Number(invites?.total)).toBe(0);
});

test("AC-329 · max_speakers finally means what it says", async () => {
  const form = await (await request(`/api/v1/public/forms/${SLUG}`)).json<{ form: { max_speakers: number } }>();
  // The old shape held two people whatever the organizer typed, so the number
  // was clamped honestly to two. The shape is a list now, so four means four.
  expect(form.form.max_speakers).toBe(4);

  const tooMany = await submit({
    answers: { title: "A crowd", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    participants: [
      { name: "One", email: "one@example.com", role: "co_speaker" },
      { name: "Two", email: "two@example.com", role: "co_speaker" },
      { name: "Three", email: "three@example.com", role: "co_speaker" },
      { name: "Four", email: "four@example.com", role: "moderator" },
    ],
  });
  expect(tooMany.status).toBe(422);
});

test("AC-329 · a participant with a name and no address is refused, not dropped", async () => {
  const response = await submit({
    answers: { title: "Half a panel", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    participants: [{ name: "Ana R.", email: "", role: "moderator" }],
  });
  // Autosave tolerates a half-typed slot because the submitter is mid-sentence.
  // Submit is the moment it has to become a sentence back — a name typed
  // without an address would otherwise vanish with no explanation at all.
  expect(response.status).toBe(422);
  const body = await response.json<{ error: { details?: { issues?: Array<{ fieldKey: string }> } } }>();
  expect(JSON.stringify(body)).toContain("participants");
});

test("AC-329 · one address in two slots is one person, not two rows", async () => {
  // Two slots resolving to the same record is ordinary — a submitter listing
  // themselves again, or one address typed twice. A second participation row
  // for the same person on the same submission is not a second person; it is a
  // duplicate the record, the agenda, and the chase board would each have to
  // dedupe for themselves.
  const response = await submit({
    answers: { title: "A doubled panel", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    participants: [
      { name: "Ana R.", email: "ana@example.com", role: "moderator" },
      { name: "Ana Again", email: "ana@example.com", role: "co_speaker" },
      { name: "Robin Alvarez", email: "robin@example.com", role: "co_speaker" },
    ],
  });
  expect(response.status).toBe(201);
  const submission = await latestSubmission();
  const rows = await participationsFor(submission.id);
  // The first entry wins, so the role the submitter chose first is the one kept.
  expect(rows.map((row) => row.role).sort()).toEqual(["moderator", "speaker", "submitter"]);

  // And one invitation, not two.
  const invites = await env.DB
    .prepare("SELECT COUNT(*) AS total FROM outbox WHERE template_key = 'added_to_submission'")
    .first<{ total: number }>();
  expect(Number(invites?.total)).toBe(1);
});
