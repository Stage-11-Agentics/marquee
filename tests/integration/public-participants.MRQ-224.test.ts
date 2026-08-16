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
    // `id` breaks the tie: `created_at` is milliseconds and two submissions in
    // one test can share one, which would make this helper return an arbitrary
    // row and every assertion built on it a coin toss.
    .prepare("SELECT id, submitter_person_id, participants_json FROM submissions WHERE event_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
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

async function createDraft(body: Record<string, unknown>): Promise<{ resume_token: string }> {
  const response = await request(`/api/v1/public/forms/${SLUG}/drafts`, { method: "POST", body: JSON.stringify(body) });
  expect(response.status).toBe(201);
  return response.json<{ resume_token: string }>();
}

test("AC-270, AC-271 · the disclosure survives a saved draft, and the resume link goes to the discloser", async () => {
  // The draft path used to resolve its owner from `speaker_email` and ignore
  // the disclosure entirely. Two things went wrong at once and neither was
  // visible: `submitter_person_id` was set to the SPEAKER, so every AC-270/271
  // guarantee downstream inherited the wrong person; and the private resume
  // link was emailed to a third party the submitter had merely named, while the
  // person who filled the form in could not get back into her own draft.
  const draft = await createDraft({
    answers: { title: "The keynote", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    on_behalf_of: { name: "Sam Chen", email: "sam@example.com" },
  });

  const resume = await env.DB
    .prepare("SELECT to_email FROM outbox WHERE template_key = 'draft_resume' LIMIT 1")
    .first<{ to_email: string }>();
  expect(resume?.to_email).toBe("sam@example.com");

  const drafted = await latestSubmission();
  const draftOwner = await env.DB.prepare("SELECT email FROM people WHERE id = ?").bind(drafted.submitter_person_id).first<{ email: string }>();
  expect(draftOwner?.email).toBe("sam@example.com");

  const submitted = await submit({
    answers: { title: "The keynote", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    resumeToken: draft.resume_token,
    on_behalf_of: { name: "Sam Chen", email: "sam@example.com" },
  });
  expect(submitted.status).toBe(201);
  const submission = await latestSubmission();
  const submitter = await env.DB.prepare("SELECT email FROM people WHERE id = ?").bind(submission.submitter_person_id).first<{ email: string }>();
  expect(submitter?.email).toBe("sam@example.com");
  expect((await participationsFor(submission.id)).map((row) => `${row.role}:${row.name}`).sort())
    .toEqual(["speaker:Robin Alvarez", "submitter:Sam Chen"]);
});

test("AC-270 · ticking the disclosure at Submit moves the record's submitter off the draft owner", async () => {
  // A submitter can save a draft as themselves and only then realise they are
  // filing on someone else's behalf. Keeping the draft's owner would file the
  // abstract under the speaker and send them the decision.
  const draft = await createDraft({
    answers: { title: "The keynote", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
  });
  const submitted = await submit({
    answers: { title: "The keynote", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    resumeToken: draft.resume_token,
    on_behalf_of: { name: "Sam Chen", email: "sam@example.com" },
  });
  expect(submitted.status).toBe(201);
  const submission = await latestSubmission();
  const submitter = await env.DB.prepare("SELECT email FROM people WHERE id = ?").bind(submission.submitter_person_id).first<{ email: string }>();
  expect(submitter?.email).toBe("sam@example.com");
});

test("AC-332 · an unauthenticated draft cannot rewrite an existing contact", async () => {
  // The trust guard covered the people a submitter NAMES and left the door it
  // was written for open: this route is the one unauthenticated write path to
  // `people`, and a stranger who types an existing contact's address into the
  // primary speaker card renamed them.
  await createDraft({
    answers: {
      title: "The keynote",
      speaker_name: "ana",
      speaker_email: "ana@example.com",
      biography: "typed by a stranger",
    },
  });
  const ana = await env.DB.prepare("SELECT name, title, bio FROM people WHERE id = ?").bind(EXISTING_CONTACT).first<{ name: string; title: string; bio: string }>();
  expect(ana?.name).toBe("Dr. Ana Reyes");
  expect(ana?.title).toBe("Principal Engineer");
  expect(ana?.bio).toBe("Ana works on schedulers.");
});

test("AC-329 · a half-typed slot survives a saved draft and is refused at Submit", async () => {
  // Autosave must not block a submitter mid-sentence, and Submit must not
  // silently drop what they started. Both halves are asserted here because
  // storing only complete entries made the first half a silent loss: close the
  // tab with a name typed and no address, come back, and the name was gone.
  const draft = await createDraft({
    answers: { title: "A half panel", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    participants: [{ name: "Ana R.", email: "", role: "moderator" }],
  });

  const resumed = await request(`/api/v1/public/forms/${SLUG}?resume=${encodeURIComponent(draft.resume_token)}`);
  const state = await resumed.json<{ participants: Array<{ name: string; email: string; role: string }> }>();
  expect(state.participants).toEqual([{ name: "Ana R.", email: "", role: "moderator" }]);

  // And it is still refused at Submit even though this request omits the key,
  // because the refusal reads the roster the submission is carrying.
  const submitted = await submit({
    answers: { title: "A half panel", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    resumeToken: draft.resume_token,
  });
  expect(submitted.status).toBe(422);
  expect(JSON.stringify(await submitted.json())).toContain("participants");
});

test("AC-329 · a removed participant is not resurrected by the legacy answers", async () => {
  // `co_speaker_*` answers stay on the row forever and are no longer rendered.
  // "No roster stored" and "a roster stored as empty" are different facts, and
  // only the first may read those answers; fusing them would put a participant
  // the submitter deleted back on the record.
  const draft = await createDraft({
    answers: {
      title: "A shrinking panel",
      speaker_name: "Robin Alvarez",
      speaker_email: "robin@example.com",
      co_speaker_name: "Dana Kowalski",
      co_speaker_email: "dana@example.com",
    },
  });
  const first = await latestSubmission();
  expect((await participationsFor(first.id)).map((row) => row.role).sort()).toEqual(["co_speaker", "speaker", "submitter"]);

  // The submitter removes them, then a later write omits the key entirely.
  // Autosave rewrites answers from the request rather than merging into the
  // stored set, so both calls carry the full answer map — that is pre-existing
  // behaviour of this route and not what this test is about.
  const answers = {
    title: "A shrinking panel",
    speaker_name: "Robin Alvarez",
    speaker_email: "robin@example.com",
    co_speaker_name: "Dana Kowalski",
    co_speaker_email: "dana@example.com",
  };
  await request(`/api/v1/public/forms/${SLUG}/drafts/${encodeURIComponent(draft.resume_token)}`, {
    method: "PATCH",
    body: JSON.stringify({ answers, participants: [] }),
  });
  await request(`/api/v1/public/forms/${SLUG}/drafts/${encodeURIComponent(draft.resume_token)}`, {
    method: "PATCH",
    body: JSON.stringify({ answers }),
  });
  expect((await participationsFor(first.id)).map((row) => row.role).sort()).toEqual(["speaker", "submitter"]);
});

test("AC-270 · unticking the disclosure at Submit moves the submitter back to the speaker", async () => {
  // The other direction, and the one a fix aimed only at ticking would leave
  // broken: the record would keep the discloser as submitter while the
  // confirmation went to the speaker, so the row and the mail would disagree
  // permanently and nothing on any screen would say which was right.
  const draft = await createDraft({
    answers: { title: "The keynote", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    on_behalf_of: { name: "Sam Chen", email: "sam@example.com" },
  });
  const submitted = await submit({
    answers: { title: "The keynote", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    resumeToken: draft.resume_token,
    on_behalf_of: null,
  });
  expect(submitted.status).toBe(201);
  const submission = await latestSubmission();
  const submitter = await env.DB.prepare("SELECT email FROM people WHERE id = ?").bind(submission.submitter_person_id).first<{ email: string }>();
  expect(submitter?.email).toBe("robin@example.com");
  expect((await participationsFor(submission.id)).map((row) => `${row.role}:${row.name}`).sort())
    .toEqual(["speaker:Robin Alvarez", "submitter:Robin Alvarez"]);
  const receipt = await env.DB.prepare("SELECT to_email FROM outbox WHERE template_key = 'submission_confirmation' LIMIT 1").first<{ to_email: string }>();
  expect(receipt?.to_email).toBe("robin@example.com");
});

test("AC-270, AC-271 · autosaving under the disclosure never writes the speaker over the submitter", async () => {
  // The identity branch `createDraft` and Submit both carry, missing from
  // autosave. Under the disclosure the speaker card describes somebody else, so
  // an unguarded autosave filed the executive's name, bio, company and title
  // against their comms manager's own `people` row — on every PATCH, within
  // seconds of the box being ticked.
  //
  // Submit could not heal it: it finds the submitter by address and
  // short-circuits the upsert, so the wrong identity was permanent. That is why
  // this asserts the row directly rather than only the outcome.
  const draft = await createDraft({
    answers: { title: "The keynote", speaker_name: "Robin Alvarez", speaker_email: "robin@example.com" },
    on_behalf_of: { name: "Sam Chen", email: "sam@example.com" },
  });

  const patched = await request(`/api/v1/public/forms/${SLUG}/drafts/${encodeURIComponent(draft.resume_token)}`, {
    method: "PATCH",
    body: JSON.stringify({
      answers: {
        title: "The keynote, revised",
        speaker_name: "Robin Alvarez",
        speaker_email: "robin@example.com",
        speaker_company: "Northwind",
        speaker_role: "Chief Executive",
        biography: "Robin has run three companies.",
      },
      on_behalf_of: { name: "Sam Chen", email: "sam@example.com" },
    }),
  });
  expect(patched.status).toBe(200);

  const submitter = await env.DB
    .prepare("SELECT name, email, company, title, bio FROM people WHERE email = 'sam@example.com'")
    .first<{ name: string; email: string; company: string | null; title: string | null; bio: string | null }>();
  expect(submitter?.name).toBe("Sam Chen");
  expect(submitter?.company).toBe(null);
  expect(submitter?.title).toBe(null);
  expect(submitter?.bio).toBe(null);

  // The speaker's own row is where those fields belong, written through the
  // scoped path rather than onto whoever happened to be filling the form in.
  const speaker = await env.DB
    .prepare("SELECT name FROM people WHERE email = 'robin@example.com'")
    .first<{ name: string }>();
  expect(speaker?.name).toBe("Robin Alvarez");

  // And Submit still lands correctly on top of an autosaved draft.
  const submitted = await submit({
    answers: {
      title: "The keynote, revised",
      speaker_name: "Robin Alvarez",
      speaker_email: "robin@example.com",
      speaker_company: "Northwind",
      speaker_role: "Chief Executive",
      biography: "Robin has run three companies.",
    },
    resumeToken: draft.resume_token,
    on_behalf_of: { name: "Sam Chen", email: "sam@example.com" },
  });
  expect(submitted.status).toBe(201);
  const submission = await latestSubmission();
  expect((await participationsFor(submission.id)).map((row) => `${row.role}:${row.name}`).sort())
    .toEqual(["speaker:Robin Alvarez", "submitter:Sam Chen"]);
  const healed = await env.DB
    .prepare("SELECT name, bio FROM people WHERE email = 'sam@example.com'")
    .first<{ name: string; bio: string | null }>();
  expect(healed?.name).toBe("Sam Chen");
  expect(healed?.bio).toBe(null);
});
