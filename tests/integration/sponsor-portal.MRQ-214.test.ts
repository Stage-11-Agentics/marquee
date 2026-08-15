/**
 * The sponsor portal, end to end against the Worker.
 *
 * The ruling under test is one sentence — "whole sponsorship, anyone completes,
 * attribution recorded" — and it is the kind of sentence that is easy to believe
 * and hard to hold: it lives in a read predicate, a completion predicate, an
 * upload predicate and a write-back, and any one of them drifting turns a
 * deliverable into a dead end for the person actually holding the file.
 *
 * So this file is deliberately built around the negative cases too: what a
 * stranger sees, what a cancelled deliverable answers, and what a completed one
 * keeps.
 */
import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../src/index";
import { createSession } from "../../src/lib/auth/auth-sessions";
import { deleteEventCascade } from "../../src/lib/events/delete-event";
import { SPONSOR_WRITEBACK_TEMPLATE_IDS } from "../../src/lib/sponsors/deliverable-templates";
import { applyMigrations, env } from "./apply-migrations";

/**
 * The real clock, not a calendar anchor (`check:clocks` rule 1). Every offset
 * below is compared against `Date.now()` by the code under test — `overdue` most
 * of all — so an absolute anchor would make "due five days ago" stop being true
 * on a date nobody wrote down.
 */
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const ORG_ID = "org_mrq214";
const EVENT_ID = "evt_mrq214";
const GOLD = "spn_mrq214_gold";
const SILVER = "spn_mrq214_silver";
const DANA = "per_mrq214_dana";
const GRZEGORZ = "per_mrq214_grzegorz";
const MONA = "per_mrq214_mona";
const STRANGER = "per_mrq214_stranger";
const SPEAKERLESS_SESSION = "sub_mrq214_speakerless";
const SILVER_SESSION = "sub_mrq214_silver_session";

const SHELL = `<!doctype html><html><head><title>Marquee</title></head><body><div id="app"></div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;

/**
 * Deterministic fake R2 credentials. Signing is arithmetic over strings, so fake
 * credentials sign perfectly well — and a test that only passes on a machine
 * holding live R2 credentials is not hermetic, however green it looks locally.
 */
function runtimeEnv(): Env {
  return {
    ...env,
    ASSETS: assets,
    R2_ACCOUNT_ID: "fake-account",
    R2_BUCKET_NAME: "fake-bucket",
    R2_ACCESS_KEY_ID: "fake-key-id",
    R2_SECRET_ACCESS_KEY: "fake-secret-key",
    MEDIA_PUBLIC_ORIGIN: "media.marquee.test",
    UPLOAD_TOKEN_SECRET: "fake-token-secret",
    UPLOAD_RATE_LIMIT_SECRET: "fake-rate-limit-secret",
  } as unknown as Env;
}

/** One session per person per test, on the real clock (`check:clocks` rule 3). */
const cookies = new Map<string, string>();
async function sessionCookie(personId: string): Promise<string> {
  const cached = cookies.get(personId);
  if (cached) return cached;
  const session = await createSession(env.DB, { personId, userAgent: "mrq-214" });
  const cookie = `mq_session=${session.id}`;
  cookies.set(personId, cookie);
  return cookie;
}

async function get(path: string, personId: string): Promise<Response> {
  return app.request(path, { headers: { cookie: await sessionCookie(personId) } }, runtimeEnv());
}

async function post(path: string, personId: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { cookie: await sessionCookie(personId), "content-type": "application/json" },
    body: JSON.stringify(body),
  }, runtimeEnv());
}

async function patch(path: string, personId: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "PATCH",
    headers: { cookie: await sessionCookie(personId), "content-type": "application/json" },
    body: JSON.stringify(body),
  }, runtimeEnv());
}

type SnapshotTask = {
  id: string;
  title: string;
  status: "open" | "done";
  overdue: boolean;
  cancelled_at: number | null;
  cancelled_reason: string | null;
  template_id: string;
  submission_id: string | null;
  assignee: { person_id: string; name: string };
  completed_by: { person_id: string; name: string } | null;
};

type Snapshot = {
  seat: string;
  viewer: { id: string; name: string };
  sponsorship: {
    id: string;
    tier: string | null;
    status_label: string;
    passes: number;
    company: { id: string; name: string; website: string | null; blurb: string | null };
    booth: { number: string | null; hall: string | null; building: { name: string | null } | null } | null;
    deal_line: string[];
    organizer_contact: { name: string; email: string; role: string } | null;
  };
  contacts: Array<{ person_id: string; name: string; is_primary: boolean; is_you: boolean }>;
  tasks: SnapshotTask[];
  sessions: Array<{ id: string; title: string; description: string | null; speakers: Array<{ name: string }>; slot: { is_published: boolean } | null }>;
  handbook: Array<{ id: string }>;
  available_sponsorships: Array<{ id: string }>;
};

function person(id: string, name: string, email: string, title: string | null) {
  return env.DB.prepare(
    `INSERT INTO people (id, org_id, email, name, title, social_links, is_demo, last_write_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '[]', 1, 'marquee', ?, ?)`,
  ).bind(id, ORG_ID, email, name, title, NOW, NOW);
}

function task(input: {
  id: string;
  templateId: string;
  sponsorshipId: string;
  personId: string;
  title: string;
  kind: "acknowledge" | "file" | "form";
  dueAt: number;
  submissionId?: string | null;
  cancelledAt?: number | null;
}) {
  return env.DB.prepare(
    `INSERT INTO speaker_tasks
       (id, event_id, person_id, submission_id, sponsorship_id, template_id, title, kind, description,
        due_at, status, completed_at, completed_by_person_id, cancelled_at, response_json, attachment_id,
        last_write_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, 'open', NULL, NULL, ?, NULL, NULL, 'marquee', ?, ?)`,
  ).bind(
    input.id, EVENT_ID, input.personId, input.submissionId ?? null, input.sponsorshipId, input.templateId,
    input.title, input.kind, input.dueAt, input.cancelledAt ?? null, NOW, NOW,
  );
}

beforeEach(async () => {
  await applyMigrations();
  cookies.clear();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "AI Engineer New York", "aie-ny", NOW, NOW),
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, '2026-10-12', '2026-10-14', 'America/New_York', 'Sheraton New York Times Square', 'live', 1, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, "AI Engineer New York 2026", "aie-ny-2026", NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, 'Sponsored Talk', 20, 15, 20, 0, ?, ?)")
      .bind("fmt_mrq214", EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, position, created_at, updated_at) VALUES (?, ?, 'Financial Services', '#0b6a72', 0, ?, ?)")
      .bind("trk_mrq214", EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO buildings (id, event_id, name, address, position, lat, lng, access_minutes, access_note, created_at, updated_at) VALUES (?, ?, 'Sheraton New York Times Square', '811 7th Ave, New York, NY 10019', 0, 40.7625188, -73.9814528, 0, 'Photo ID required.', ?, ?)")
      .bind("bld_mrq214", EVENT_ID, NOW, NOW),
    person(DANA, "Dana Okafor", "dana.okafor@example.com", "Head of Developer Marketing"),
    person(GRZEGORZ, "Grzegorz Włodarczyk-Ó Braonáin", "grzegorz.wlodarczyk@example.com", "Brand Design Lead"),
    person(MONA, "Mona Haddad", "mona.haddad@example.com", "VP Marketing"),
    person(STRANGER, "Unrelated Person", "unrelated.person@example.com", null),
    person("per_mrq214_staff", "AIE Program Committee", "program.committee@example.com", null),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'program_lead', ?, ?)")
      .bind("mem_mrq214_staff", ORG_ID, EVENT_ID, "per_mrq214_staff", NOW, NOW),
    env.DB.prepare("INSERT INTO companies (id, org_id, name, website, blurb, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'marquee', ?, ?)")
      .bind("cmp_mrq214_gold", ORG_ID, "Ashworth–Meridian Capital Intelligence Group", "https://ashworth-meridian.example.com", "Agentic risk intelligence.", NOW, NOW),
    env.DB.prepare("INSERT INTO companies (id, org_id, name, website, blurb, is_demo, last_write_source, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, 1, 'marquee', ?, ?)")
      .bind("cmp_mrq214_silver", ORG_ID, "Tapestry Small-Business Lending", NOW, NOW),
    env.DB.prepare("INSERT INTO sponsor_tiers (id, event_id, name, position, created_at, updated_at) VALUES (?, ?, 'Gold', 0, ?, ?)")
      .bind("spt_mrq214_gold", EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO sponsor_tiers (id, event_id, name, position, created_at, updated_at) VALUES (?, ?, 'Silver', 1, ?, ?)")
      .bind("spt_mrq214_silver", EVENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO sponsorships
        (id, event_id, company_id, tier_id, status, passes, booth_number, booth_size, booth_hall,
         booth_building_id, booth_load_in, booth_access_note, booth_leave_note, created_at, updated_at)
      VALUES (?, ?, 'cmp_mrq214_gold', 'spt_mrq214_gold', 'committed', 6, '214', '3 m × 3 m corner',
              'Exhibit Hall · Level 2', 'bld_mrq214', 'Sun Oct 11 · 14:00–20:00', 'COI on file before load-in.',
              'Be at the dock by 13:40.', ?, ?)`)
      .bind(GOLD, EVENT_ID, NOW, NOW),
    // Every booth column null: the ruling-5 case.
    env.DB.prepare(`INSERT INTO sponsorships (id, event_id, company_id, tier_id, status, passes, created_at, updated_at)
      VALUES (?, ?, 'cmp_mrq214_silver', 'spt_mrq214_silver', 'committed', 2, ?, ?)`)
      .bind(SILVER, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO sponsorship_contacts (id, sponsorship_id, person_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .bind("spc_mrq214_dana", GOLD, DANA, NOW, NOW),
    env.DB.prepare("INSERT INTO sponsorship_contacts (id, sponsorship_id, person_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)")
      .bind("spc_mrq214_grzegorz", GOLD, GRZEGORZ, NOW, NOW),
    env.DB.prepare("INSERT INTO sponsorship_contacts (id, sponsorship_id, person_id, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .bind("spc_mrq214_mona", SILVER, MONA, NOW, NOW),
    // Two Sessions: the Gold one has nobody named, the Silver one is scheduled
    // but unpublished.
    env.DB.prepare(`INSERT INTO submissions
        (id, event_id, kind, bypass_evaluation, title, abstract, status, format_id, primary_track_id,
         origin, vendor_affiliation, submitter_person_id, sponsorship_id, decided_at, submitted_at,
         last_saved_at, is_published, search_blob, last_write_source, created_at, updated_at)
      VALUES (?, ?, 'session', 1, 'Building the Meridian data mesh', NULL, 'accepted', 'fmt_mrq214', 'trk_mrq214',
              'admin', 'vendor_to_fi', ?, ?, ?, ?, ?, 0, '', 'marquee', ?, ?)`)
      .bind(SPEAKERLESS_SESSION, EVENT_ID, DANA, GOLD, NOW - 20 * DAY, NOW - 20 * DAY, NOW - 20 * DAY, NOW, NOW),
    env.DB.prepare(`INSERT INTO submissions
        (id, event_id, kind, bypass_evaluation, title, abstract, status, format_id, primary_track_id,
         origin, vendor_affiliation, submitter_person_id, sponsorship_id, decided_at, submitted_at,
         last_saved_at, is_published, search_blob, last_write_source, created_at, updated_at)
      VALUES (?, ?, 'session', 1, 'Underwriting copilots', NULL, 'accepted', 'fmt_mrq214', 'trk_mrq214',
              'admin', 'vendor_to_fi', ?, ?, ?, ?, ?, 0, '', 'marquee', ?, ?)`)
      .bind(SILVER_SESSION, EVENT_ID, MONA, SILVER, NOW - 20 * DAY, NOW - 20 * DAY, NOW - 20 * DAY, NOW, NOW),
    // Templates. The two write-back ones carry forms; the rest are plain.
    env.DB.prepare("INSERT INTO forms (id, event_id, name, slug, kind, status, created_at, updated_at) VALUES (?, ?, 'Name your speaker', 'sponsor-name-your-speaker', 'session', 'closed', ?, ?)")
      .bind("frm_mrq214_speaker", EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO forms (id, event_id, name, slug, kind, status, created_at, updated_at) VALUES (?, ?, 'Session content', 'sponsor-session-content', 'session', 'closed', ?, ?)")
      .bind("frm_mrq214_content", EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO form_fields (id, form_id, key, label, type, required, position, config, created_at, updated_at) VALUES (?, 'frm_mrq214_speaker', 'speaker_name', 'Speaker name', 'short_text', 1, 0, '{}', ?, ?)")
      .bind("fld_mrq214_name", NOW, NOW),
    env.DB.prepare("INSERT INTO form_fields (id, form_id, key, label, type, required, position, config, created_at, updated_at) VALUES (?, 'frm_mrq214_speaker', 'speaker_email', 'Speaker email', 'email', 1, 1, '{}', ?, ?)")
      .bind("fld_mrq214_email", NOW, NOW),
    env.DB.prepare("INSERT INTO form_fields (id, form_id, key, label, type, required, position, config, created_at, updated_at) VALUES (?, 'frm_mrq214_content', 'session_description', 'Session description', 'long_text', 1, 0, '{}', ?, ?)")
      .bind("fld_mrq214_desc", NOW, NOW),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_offset_days, position, auto_assign, created_at, updated_at) VALUES (?, ?, 'Sponsor agreement', 'acknowledge', '', 1, 0, 0, ?, ?)")
      .bind("tpl_mrq214_agreement", EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_offset_days, file_config, position, auto_assign, created_at, updated_at) VALUES (?, ?, 'Company logo', 'file', '', 15, ?, 1, 0, ?, ?)")
      .bind("tpl_mrq214_logo", EVENT_ID, JSON.stringify({ accept: [".pdf"], maxBytes: 1_000_000 }), NOW, NOW),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_offset_days, position, auto_assign, created_at, updated_at) VALUES (?, ?, 'Banner artwork', 'file', '', 20, 2, 0, ?, ?)")
      .bind("tpl_mrq214_banner", EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_offset_days, form_id, position, auto_assign, created_at, updated_at) VALUES (?, ?, 'Name your speaker', 'form', '', 22, 'frm_mrq214_speaker', 3, 0, ?, ?)")
      .bind(SPONSOR_WRITEBACK_TEMPLATE_IDS.nameYourSpeaker, EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, name, kind, description, due_offset_days, form_id, position, auto_assign, created_at, updated_at) VALUES (?, ?, 'Session content', 'form', '', 22, 'frm_mrq214_content', 4, 0, ?, ?)")
      .bind(SPONSOR_WRITEBACK_TEMPLATE_IDS.sessionContent, EVENT_ID, NOW, NOW),
    task({ id: "tsk_mrq214_agreement", templateId: "tpl_mrq214_agreement", sponsorshipId: GOLD, personId: DANA, title: "Sponsor agreement", kind: "acknowledge", dueAt: NOW + DAY }),
    // Overdue, and assigned to the contact who is NOT signing in below.
    task({ id: "tsk_mrq214_logo", templateId: "tpl_mrq214_logo", sponsorshipId: GOLD, personId: GRZEGORZ, title: "Company logo", kind: "file", dueAt: NOW - 5 * DAY }),
    task({ id: "tsk_mrq214_banner", templateId: "tpl_mrq214_banner", sponsorshipId: GOLD, personId: GRZEGORZ, title: "Banner artwork", kind: "file", dueAt: NOW + 9 * DAY, cancelledAt: NOW - 2 * DAY }),
    task({ id: "tsk_mrq214_speaker", templateId: SPONSOR_WRITEBACK_TEMPLATE_IDS.nameYourSpeaker, sponsorshipId: GOLD, personId: DANA, title: "Name your speaker", kind: "form", dueAt: NOW + 22 * DAY, submissionId: SPEAKERLESS_SESSION }),
    task({ id: "tsk_mrq214_content", templateId: SPONSOR_WRITEBACK_TEMPLATE_IDS.sessionContent, sponsorshipId: SILVER, personId: MONA, title: "Session description", kind: "form", dueAt: NOW + 22 * DAY, submissionId: SILVER_SESSION }),
    // Why the banner artwork vanished, said once, about the sponsorship.
    env.DB.prepare(`INSERT INTO audit_log (id, event_id, org_id, actor_person_id, actor_name, actor_kind, action, entity_type, entity_id, after_json, created_at)
      VALUES (?, ?, ?, 'per_mrq214_staff', 'AIE Program Committee', 'user', 'sponsorship.tasks_cancelled', 'sponsorship', ?, ?, ?)`)
      .bind("aud_mrq214_cancel", EVENT_ID, ORG_ID, GOLD, JSON.stringify({ reason: "The escalator-wall placement left the Gold package." }), NOW - 2 * DAY),
  ]);
});

test("CONTRACT · a contact sees the WHOLE sponsorship, with every deliverable's assignee named", async () => {
  const response = await get("/api/v1/me/sponsor-portal", DANA);
  expect(response.status).toBe(200);
  const snapshot = await response.json<Snapshot>();

  expect(snapshot.seat).toBe("sponsor_contact");
  expect(snapshot.viewer.name).toBe("Dana Okafor");
  expect(snapshot.sponsorship.tier).toBe("Gold");
  expect(snapshot.sponsorship.status_label).toBe("Committed");
  expect(snapshot.sponsorship.company.name).toBe("Ashworth–Meridian Capital Intelligence Group");

  // Deliverables assigned to a colleague are present, not filtered away.
  const byId = new Map(snapshot.tasks.map((item) => [item.id, item]));
  expect(byId.get("tsk_mrq214_logo")!.assignee).toEqual({ person_id: GRZEGORZ, name: "Grzegorz Włodarczyk-Ó Braonáin" });
  expect(byId.get("tsk_mrq214_agreement")!.assignee.person_id).toBe(DANA);
  expect(byId.get("tsk_mrq214_logo")!.overdue).toBe(true);
  expect(byId.get("tsk_mrq214_agreement")!.overdue).toBe(false);

  // The contact roster names everybody, marks the primary, and marks you.
  expect(snapshot.contacts.map((contact) => [contact.person_id, contact.is_primary, contact.is_you])).toEqual([
    [DANA, true, true],
    [GRZEGORZ, false, false],
  ]);

  // The organizer contact is a real staff person, not a hardcoded address.
  expect(snapshot.sponsorship.organizer_contact).toEqual({
    name: "AIE Program Committee",
    email: "program.committee@example.com",
    role: "Program lead",
    person_id: "per_mrq214_staff",
  });
  expect(snapshot.available_sponsorships.map((option) => option.id)).toEqual([GOLD]);
});

test("CONTRACT · the deal line and the booth card are derived, and a boothless sponsorship composes down", async () => {
  const gold = await (await get("/api/v1/me/sponsor-portal", DANA)).json<Snapshot>();
  // Two Sessions? No — one. The chips are computed from what is attached, and
  // only one Session hangs off Gold in this fixture.
  expect(gold.sponsorship.deal_line).toEqual(["1 Session", "Booth 214", "6 conference passes"]);
  expect(gold.sponsorship.booth).not.toBeNull();
  expect(gold.sponsorship.booth!.number).toBe("214");
  expect(gold.sponsorship.booth!.building!.name).toBe("Sheraton New York Times Square");
  expect(gold.handbook.map((chapter) => chapter.id)).toEqual(["load-in", "brand", "faq"]);

  const silver = await (await get("/api/v1/me/sponsor-portal", MONA)).json<Snapshot>();
  expect(silver.sponsorship.booth).toBeNull();
  expect(silver.sponsorship.deal_line).toEqual(["1 Session", "2 conference passes"]);
  expect(silver.handbook.map((chapter) => chapter.id)).toEqual(["brand", "faq"]);
  expect(silver.contacts).toHaveLength(1);
});

test("CONTRACT · any contact completes any open deliverable, and the completer is recorded and shown", async () => {
  // Dana completes the acknowledge task assigned to her, then the file task
  // assigned to Grzegorz. Both must land, and both must name Dana.
  const attachment = "att_mrq214_logo";
  await env.DB.prepare(
    `INSERT INTO attachments (id, event_id, owner_type, owner_id, r2_key, filename, content_type, size_bytes, status, r2_etag, created_at, updated_at)
     VALUES (?, ?, 'task_upload', 'tsk_mrq214_logo', 'uploads/x', 'logo.pdf', 'application/pdf', 1024, 'ready', 'etag', ?, ?)`,
  ).bind(attachment, EVENT_ID, NOW, NOW).run();

  expect((await post("/api/v1/me/tasks/tsk_mrq214_agreement/complete", DANA, { acknowledged: true })).status).toBe(200);
  expect((await post("/api/v1/me/tasks/tsk_mrq214_logo/complete", DANA, { attachment_id: attachment })).status).toBe(200);

  const rows = await env.DB.prepare(
    "SELECT id, person_id, status, completed_by_person_id FROM speaker_tasks WHERE id IN ('tsk_mrq214_agreement','tsk_mrq214_logo') ORDER BY id",
  ).all<{ id: string; person_id: string; status: string; completed_by_person_id: string | null }>();
  expect(rows.results).toEqual([
    { id: "tsk_mrq214_agreement", person_id: DANA, status: "done", completed_by_person_id: DANA },
    // The assignee is UNCHANGED — the record still says whose job it was — and the
    // completer is the person who actually did it.
    { id: "tsk_mrq214_logo", person_id: GRZEGORZ, status: "done", completed_by_person_id: DANA },
  ]);

  const snapshot = await (await get("/api/v1/me/sponsor-portal", GRZEGORZ)).json<Snapshot>();
  const logo = snapshot.tasks.find((item) => item.id === "tsk_mrq214_logo")!;
  expect(logo.completed_by).toEqual({ person_id: DANA, name: "Dana Okafor" });
  expect(logo.assignee.person_id).toBe(GRZEGORZ);
});

test("CONTRACT · a cancelled deliverable refuses with a reason and never loses finished work", async () => {
  const completion = await post("/api/v1/me/tasks/tsk_mrq214_banner/complete", DANA, { attachment_id: "anything" });
  // 409, not 404: "this was cancelled" is a true answer somebody can act on.
  expect(completion.status).toBe(409);

  const snapshot = await (await get("/api/v1/me/sponsor-portal", DANA)).json<Snapshot>();
  const banner = snapshot.tasks.find((item) => item.id === "tsk_mrq214_banner")!;
  expect(banner.cancelled_at).not.toBeNull();
  // The reason is the sponsorship's own sentence, stated once.
  expect(banner.cancelled_reason).toBe("The escalator-wall placement left the Gold package.");
  expect(banner.status).toBe("open");

  // And a completed task that is later cancelled keeps its completion (SPEC §3.7).
  await post("/api/v1/me/tasks/tsk_mrq214_agreement/complete", DANA, { acknowledged: true });
  await env.DB.prepare("UPDATE speaker_tasks SET cancelled_at = ? WHERE id = 'tsk_mrq214_agreement'").bind(NOW).run();
  const after = await env.DB.prepare("SELECT status, completed_at, completed_by_person_id FROM speaker_tasks WHERE id = 'tsk_mrq214_agreement'")
    .first<{ status: string; completed_at: number | null; completed_by_person_id: string | null }>();
  expect(after).toMatchObject({ status: "done", completed_by_person_id: DANA });
  expect(after!.completed_at).not.toBeNull();
});

test("CONTRACT · completing 'Name your speaker' fills the Session and seats the speaker", async () => {
  const before = await (await get("/api/v1/me/sponsor-portal", DANA)).json<Snapshot>();
  const session = before.sessions.find((item) => item.id === SPEAKERLESS_SESSION)!;
  expect(session.speakers).toEqual([]);

  const completion = await post("/api/v1/me/tasks/tsk_mrq214_speaker/complete", DANA, {
    answers: { speaker_name: "Nadia El-Amin", speaker_email: "Nadia.El-Amin@example.com" },
  });
  expect(completion.status).toBe(200);

  const after = await (await get("/api/v1/me/sponsor-portal", DANA)).json<Snapshot>();
  expect(after.sessions.find((item) => item.id === SPEAKERLESS_SESSION)!.speakers.map((speaker) => speaker.name))
    .toEqual(["Nadia El-Amin"]);

  // A real speaker of this conference, not a string on a card: the person row,
  // the participation, and the membership their own portal reads.
  const named = await env.DB.prepare("SELECT id, name FROM people WHERE lower(email) = 'nadia.el-amin@example.com'")
    .first<{ id: string; name: string }>();
  expect(named?.name).toBe("Nadia El-Amin");
  const membership = await env.DB.prepare("SELECT role FROM memberships WHERE person_id = ? AND event_id = ?")
    .bind(named!.id, EVENT_ID).first<{ role: string }>();
  expect(membership?.role).toBe("speaker");

  // Idempotent: completing again must not mint a second person or participation.
  await post("/api/v1/me/tasks/tsk_mrq214_speaker/complete", DANA, {
    answers: { speaker_name: "Nadia El-Amin", speaker_email: "nadia.el-amin@example.com" },
  });
  const people = await env.DB.prepare("SELECT COUNT(*) AS n FROM people WHERE lower(email) = 'nadia.el-amin@example.com'").first<{ n: number }>();
  expect(Number(people?.n)).toBe(1);
  const participations = await env.DB.prepare("SELECT COUNT(*) AS n FROM participations WHERE submission_id = ? AND role = 'speaker'")
    .bind(SPEAKERLESS_SESSION).first<{ n: number }>();
  expect(Number(participations?.n)).toBe(1);
});

test("CONTRACT · completing the session-content deliverable fills the Session's description", async () => {
  const completion = await post("/api/v1/me/tasks/tsk_mrq214_content/complete", MONA, {
    answers: { session_description: "A ten-minute teardown of what passed audit and what did not." },
  });
  expect(completion.status).toBe(200);
  const snapshot = await (await get("/api/v1/me/sponsor-portal", MONA)).json<Snapshot>();
  expect(snapshot.sessions.find((item) => item.id === SILVER_SESSION)!.description)
    .toBe("A ten-minute teardown of what passed audit and what did not.");
  // Written under the same audit action the speaker portal uses, so a Session's
  // history reads as one story.
  const audit = await env.DB.prepare("SELECT action FROM audit_log WHERE entity_id = ? AND action = 'speaker_talk_updated'")
    .bind(SILVER_SESSION).first<{ action: string }>();
  expect(audit?.action).toBe("speaker_talk_updated");
});

test("CONTRACT · company profile edits write the ORGANIZATION-level company facts", async () => {
  const response = await patch(`/api/v1/me/sponsorships/${GOLD}/company`, DANA, {
    name: "Ashworth–Meridian Group",
    website: "https://ashworth-meridian.example.com/sponsors",
    blurb: "Agentic risk and underwriting intelligence.",
  });
  expect(response.status).toBe(200);
  const company = await env.DB.prepare("SELECT name, website, blurb FROM companies WHERE id = 'cmp_mrq214_gold'")
    .first<{ name: string; website: string; blurb: string }>();
  expect(company).toEqual({
    name: "Ashworth–Meridian Group",
    website: "https://ashworth-meridian.example.com/sponsors",
    blurb: "Agentic risk and underwriting intelligence.",
  });
});

test("CONTRACT · a person who is not a contact on the sponsorship reaches none of it", async () => {
  // The read.
  expect((await get("/api/v1/me/sponsor-portal", STRANGER)).status).toBe(404);
  // Somebody else's deal, named explicitly in the query string.
  expect((await get(`/api/v1/me/sponsor-portal?sponsorshipId=${GOLD}`, MONA)).status).toBe(404);
  // The completion.
  expect((await post("/api/v1/me/tasks/tsk_mrq214_agreement/complete", STRANGER, { acknowledged: true })).status).toBe(404);
  // A contact of a DIFFERENT sponsorship is a stranger to this one.
  expect((await post("/api/v1/me/tasks/tsk_mrq214_agreement/complete", MONA, { acknowledged: true })).status).toBe(404);
  // The company write.
  expect((await patch(`/api/v1/me/sponsorships/${GOLD}/company`, MONA, { name: "Hostile Rename" })).status).toBe(404);
  const company = await env.DB.prepare("SELECT name FROM companies WHERE id = 'cmp_mrq214_gold'").first<{ name: string }>();
  expect(company?.name).toBe("Ashworth–Meridian Capital Intelligence Group");
});

test("CONTRACT · the upload signer agrees with the completion route about who may act", async () => {
  const sign = async (personId: string, ownerId: string) => post("/api/v1/me/uploads/sign", personId, {
    ownerType: "task_upload",
    ownerId,
    // A vector PDF, which is what `task_upload` can actually presign: its policy
    // narrows DOCUMENT_RULES, and there is no sniffer for SVG or EPS.
    filename: "logo.pdf",
    contentType: "application/pdf",
    sizeBytes: 2048,
  });

  // A contact may presign an upload for a colleague's file deliverable — the
  // whole point of anyone-completes. A predicate that disagreed here would let
  // the task validate and then fail at the PUT.
  const colleague = await sign(DANA, "tsk_mrq214_logo");
  expect(colleague.status).toBe(200);
  // The assignee themself, unchanged.
  expect((await sign(GRZEGORZ, "tsk_mrq214_logo")).status).toBe(200);
  // And a stranger, and a contact of another deal, may not.
  expect((await sign(STRANGER, "tsk_mrq214_logo")).status).toBe(403);
  expect((await sign(MONA, "tsk_mrq214_logo")).status).toBe(403);
});

/**
 * A conference holding a sponsorship must still be deletable.
 *
 * `deleteEventCascade` hand-enumerates every event-owned table into one D1 batch,
 * and a sponsorship sits in the middle of the dependency graph: referenced from
 * above by the deliverables and Sessions, pointing down at a building, the event,
 * and — through its contacts — people. Any of those in the wrong order and the
 * batch aborts on a foreign key, which does not fail loudly in a unit: it makes
 * the conference *undeletable*, and takes `POST /admin/remove-demo` with it.
 *
 * Nothing tested this. The existing conference-delete test is a source regex.
 */
test("CONTRACT · a conference holding sponsorships can still be deleted, and companies survive it", async () => {
  const event = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(EVENT_ID).first();
  const result = await deleteEventCascade(
    env.DB,
    [event as never],
    { actorKind: "system", actorPersonId: null, requestId: null },
    {},
    undefined,
    Date.now(),
  );
  expect(result.removedEvents).toBe(1);

  for (const table of ["sponsorships", "sponsorship_contacts", "sponsor_tiers"]) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
    expect(Number(row?.n), `${table} survived the cascade`).toBe(0);
  }
  const events = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE id = ?").bind(EVENT_ID).first<{ n: number }>();
  expect(Number(events?.n)).toBe(0);
  // Companies are organization-level and outlive every conference — the same rule
  // that keeps `people` alive. A conference delete that took them would delete the
  // sponsor relationship along with one year's deal.
  const companies = await env.DB.prepare("SELECT COUNT(*) AS n FROM companies").first<{ n: number }>();
  expect(Number(companies?.n)).toBe(2);
});

test("CONTRACT · removing the demo scope takes the demo companies with it", async () => {
  const event = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(EVENT_ID).first();
  await deleteEventCascade(
    env.DB,
    [event as never],
    { actorKind: "system", actorPersonId: null, requestId: null },
    { removeDemoPeople: true, preserveOrgAttachments: false },
    undefined,
    Date.now(),
  );
  // `is_demo` symmetry: a demo removal that left seeded companies behind would
  // leave the CRM's second noun holding rows nothing references.
  const companies = await env.DB.prepare("SELECT COUNT(*) AS n FROM companies").first<{ n: number }>();
  expect(Number(companies?.n)).toBe(0);
  const people = await env.DB.prepare("SELECT COUNT(*) AS n FROM people WHERE is_demo = 1").first<{ n: number }>();
  expect(Number(people?.n)).toBe(0);
});

/**
 * The write-back must prove the task's two independent joins agree.
 *
 * `task-access.ts` proves the caller holds the sponsorship. Nothing in the schema
 * ties `speaker_tasks.submission_id` to `speaker_tasks.sponsorship_id`, so a
 * mismatched pair — which only a future writer can produce, but a future writer
 * certainly can — would otherwise let a contact rewrite a Session that is not
 * theirs by completing their own deliverable.
 */
test("CONTRACT · a deliverable pointed at another sponsorship's Session writes nothing to it", async () => {
  // Mona's own session-content deliverable, repointed at GOLD's Session.
  await env.DB.prepare("UPDATE speaker_tasks SET submission_id = ? WHERE id = 'tsk_mrq214_content'")
    .bind(SPEAKERLESS_SESSION).run();
  const before = await env.DB.prepare("SELECT title, abstract FROM submissions WHERE id = ?")
    .bind(SPEAKERLESS_SESSION).first<{ title: string; abstract: string | null }>();

  const response = await post("/api/v1/me/tasks/tsk_mrq214_content/complete", MONA, {
    answers: { session_description: "Hostile rewrite of somebody else's Session." },
  });
  // The completion itself is hers to make; what it must not do is reach the other
  // sponsorship's record.
  expect(response.status).toBe(200);
  const after = await env.DB.prepare("SELECT title, abstract FROM submissions WHERE id = ?")
    .bind(SPEAKERLESS_SESSION).first<{ title: string; abstract: string | null }>();
  expect(after).toEqual(before);
});
